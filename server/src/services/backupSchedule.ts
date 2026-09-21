// Scheduled disaster-recovery backups: owns the recurring daily/weekly
// backup config, computes when the next run is due, and ticks a
// setInterval (same shape as WatchdogService's auto-cleanup timer in
// services/watchdog.ts) that calls backupService.createScheduledBackup()
// when due. See docs/superpowers/specs/2026-09-20-scheduled-backups-design.md.

import fs from 'fs/promises';
import path from 'path';
import { WATCHDOGS_CONFIG_DIR } from './watchdog';
import { backupService, BackupResult } from './backup';

const BACKUP_SCHEDULE_CONFIG_PATH = path.join(WATCHDOGS_CONFIG_DIR, 'backup-schedule.json');

export interface BackupScheduleConfig {
  enabled: boolean;
  frequency: 'daily' | 'weekly';
  /** 0 (Sunday) - 6 (Saturday). Required when frequency === 'weekly'. */
  dayOfWeek?: number;
  /** Server local time, 'HH:mm'. */
  time: string;
  /** How many scheduled-*.tar.gz files to keep before pruning the oldest. */
  retainCount: number;
  lastRunAt?: string;
  nextRunAt?: string;
}

const DEFAULT_CONFIG: BackupScheduleConfig = {
  enabled: false,
  frequency: 'daily',
  time: '03:00',
  retainCount: 7,
};

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** Thrown by runNow() when a backup (scheduled tick or a prior runNow())
 * is already in flight. Exported so callers (routes/system.ts) can key a
 * 409 response off the exact message rather than duplicating the string. */
export const BACKUP_ALREADY_IN_PROGRESS_MESSAGE = 'A backup is already in progress';

/**
 * Computes the next local-time occurrence of `config`'s schedule strictly
 * after `from`. Pure function (no I/O, no `new Date()` inside) so it's
 * directly unit-testable with fixed dates -- see backupSchedule.test.ts.
 */
export function computeNextRunAt(
  config: Pick<BackupScheduleConfig, 'frequency' | 'dayOfWeek' | 'time'>,
  from: Date,
): Date {
  const match = TIME_RE.exec(config.time);
  if (!match) throw new Error(`Invalid time '${config.time}', expected HH:mm`);
  const hours = Number(match[1]);
  const minutes = Number(match[2]);

  if (config.frequency === 'daily') {
    const next = new Date(from);
    next.setHours(hours, minutes, 0, 0);
    if (next <= from) next.setDate(next.getDate() + 1);
    return next;
  }

  // weekly
  const dayOfWeek = config.dayOfWeek;
  if (dayOfWeek === undefined || dayOfWeek < 0 || dayOfWeek > 6) {
    throw new Error('dayOfWeek (0-6) is required when frequency is weekly');
  }
  const next = new Date(from);
  next.setHours(hours, minutes, 0, 0);
  let dayDiff = (dayOfWeek - next.getDay() + 7) % 7;
  if (dayDiff === 0 && next <= from) dayDiff = 7;
  next.setDate(next.getDate() + dayDiff);
  return next;
}

export class BackupScheduleService {
  private configPath = BACKUP_SCHEDULE_CONFIG_PATH;
  private intervalId: NodeJS.Timeout | null = null;
  // Resolves once the constructor's initial catch-up check has run.
  // Nothing else in this class depends on it -- getConfig()/updateConfig()/
  // runNow() all read/write the file directly -- but tests use it to
  // deterministically observe the one-time construction-time catch-up
  // without polling. Same idiom as WatchdogService.ready in watchdog.ts.
  private ready: Promise<void>;
  // True while a backup (scheduled tick or a manual runNow()) is actually
  // executing backupService.createScheduledBackup(). Guards against a slow
  // `tar` (root, full disaster-recovery scope, plausible on a Raspberry
  // Pi's SD card) outliving the 60s poll interval: without this, the next
  // tick would re-read a config whose nextRunAt hasn't advanced yet (that
  // only happens after the in-flight call resolves) and launch a second
  // concurrent tar against the same paths -- see checkAndRunIfDue() and
  // runNow() below. Shared by both call sites so a scheduled tick and a
  // manual "run now" can never overlap each other either.
  private running = false;

  constructor() {
    this.ready = this.checkAndRunIfDue().catch(error => {
      console.error('Backup schedule initialization error:', error);
    });
  }

  private async ensureConfig(): Promise<string> {
    try {
      await fs.mkdir(WATCHDOGS_CONFIG_DIR, { recursive: true });
      return this.configPath;
    } catch {
      // Fallback for local development or permission issues -- mirrors
      // WatchdogService.ensureConfig()'s identical fallback.
      const localDir = path.join(__dirname, '../../config');
      await fs.mkdir(localDir, { recursive: true });
      return path.join(localDir, 'backup-schedule.json');
    }
  }

  async getConfig(): Promise<BackupScheduleConfig> {
    return this.load();
  }

  private async load(): Promise<BackupScheduleConfig> {
    const configPath = await this.ensureConfig();
    try {
      const data = await fs.readFile(configPath, 'utf-8');
      return { ...DEFAULT_CONFIG, ...JSON.parse(data) };
    } catch {
      return { ...DEFAULT_CONFIG };
    }
  }

  private async save(config: BackupScheduleConfig): Promise<void> {
    const configPath = await this.ensureConfig();
    await fs.writeFile(configPath, JSON.stringify(config, null, 2), 'utf-8');
  }

  async updateConfig(
    update: Pick<BackupScheduleConfig, 'enabled' | 'frequency' | 'dayOfWeek' | 'time' | 'retainCount'>,
  ): Promise<BackupScheduleConfig> {
    if (!TIME_RE.test(update.time)) {
      throw new Error(`Invalid time '${update.time}', expected HH:mm`);
    }
    if (update.frequency === 'weekly' && (update.dayOfWeek === undefined || update.dayOfWeek < 0 || update.dayOfWeek > 6)) {
      throw new Error('dayOfWeek (0-6) is required when frequency is weekly');
    }
    if (!Number.isInteger(update.retainCount) || update.retainCount < 1) {
      throw new Error('retainCount must be an integer >= 1');
    }

    const current = await this.load();
    const next: BackupScheduleConfig = {
      ...current,
      enabled: update.enabled,
      frequency: update.frequency,
      dayOfWeek: update.frequency === 'weekly' ? update.dayOfWeek : undefined,
      time: update.time,
      retainCount: update.retainCount,
      nextRunAt: undefined,
    };
    if (next.enabled) {
      next.nextRunAt = computeNextRunAt(next, new Date()).toISOString();
    }
    await this.save(next);
    this.applyScheduleState(next);
    return next;
  }

  /** Manual "run now" -- creates a scheduled-scope backup immediately,
   * independent of the schedule (does not read/write lastRunAt/nextRunAt).
   * Rejects with BACKUP_ALREADY_IN_PROGRESS_MESSAGE (routes/system.ts maps
   * this to a 409) rather than silently no-opping or queuing, since this is
   * a direct user action with a UI button waiting on a response -- see the
   * `running` flag's doc comment above. */
  async runNow(): Promise<BackupResult> {
    if (this.running) {
      throw new Error(BACKUP_ALREADY_IN_PROGRESS_MESSAGE);
    }
    const config = await this.load();
    this.running = true;
    try {
      return await backupService.createScheduledBackup(config.retainCount);
    } finally {
      this.running = false;
    }
  }

  /**
   * Starts/stops the poll timer based on whether `config` currently calls
   * for it to be running -- same "decide from a config already in hand,
   * never a fresh load() of its own" shape as WatchdogService's
   * applyAutoCleanupState() (services/watchdog.ts), and fixing the same
   * class of bug that method's own doc comment describes: this service's
   * constructor used to call start() unconditionally, so every process
   * that merely imports the module holding its singleton (routes/system.ts,
   * mirroring routes/watchdog.ts's watchdogService convention) started a
   * real setInterval(60_000) regardless of whether scheduled backups were
   * even enabled -- keeping that process's event loop alive forever. That
   * silently broke `node --test`'s per-file process isolation for any test
   * file importing routes/system.ts without itself knowing to call
   * backupScheduleService.stop() (caught via system.export.test.ts hanging
   * indefinitely after Task 5 wired the singleton in). start()/stop() are
   * both idempotent, so calling this redundantly (constructor AND every
   * updateConfig() call) is always safe and cheap.
   */
  private applyScheduleState(config: BackupScheduleConfig): void {
    if (config.enabled) {
      this.start();
    } else {
      this.stop();
    }
  }

  private async checkAndRunIfDue(): Promise<void> {
    const config = await this.load();
    this.applyScheduleState(config);
    if (!config.enabled) return;

    if (!config.nextRunAt) {
      config.nextRunAt = computeNextRunAt(config, new Date()).toISOString();
      await this.save(config);
      return;
    }

    if (new Date(config.nextRunAt) > new Date()) return;

    // A previous run (this tick's own catch-up, an earlier tick, or a
    // concurrent manual runNow()) is still in flight -- skip this tick
    // rather than stacking a second concurrent backup. nextRunAt hasn't
    // advanced yet, so the next tick will pick this up once `running`
    // clears.
    if (this.running) return;

    this.running = true;
    try {
      await backupService.createScheduledBackup(config.retainCount);
    } finally {
      this.running = false;
    }
    config.lastRunAt = new Date().toISOString();
    config.nextRunAt = computeNextRunAt(config, new Date()).toISOString();
    await this.save(config);
  }

  /** Idempotent -- a second call while already running is a no-op, same
   * `if (this.intervalId) return;` idiom as WatchdogService.startAutoCleanup(). */
  start(): void {
    if (this.intervalId) return;
    this.intervalId = setInterval(() => {
      this.checkAndRunIfDue().catch(error => {
        console.error('Backup schedule tick error:', error);
      });
    }, 60 * 1000);
  }

  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }
}
