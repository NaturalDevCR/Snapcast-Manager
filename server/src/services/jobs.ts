import { randomUUID } from 'crypto';
import Database from 'better-sqlite3';
import defaultDb from '../database';

export interface Job {
  id: string;
  label: string;
  status: 'running' | 'done' | 'error' | 'interrupted';
  log: string[];
  output?: string;
  error?: string;
  startedAt: number;
  finishedAt?: number;
}

const MAX_KEPT_JOBS = 20;
const MAX_LOG_LINES = 500;

interface JobRow {
  id: string;
  label: string;
  status: string;
  log: string;
  output: string | null;
  error: string | null;
  started_at: number;
  finished_at: number | null;
}

function rowToJob(row: JobRow): Job {
  return {
    id: row.id,
    label: row.label,
    status: row.status as Job['status'],
    log: JSON.parse(row.log) as string[],
    output: row.output ?? undefined,
    error: row.error ?? undefined,
    startedAt: row.started_at,
    finishedAt: row.finished_at ?? undefined,
  };
}

/**
 * Tracks long-running system tasks (package installs, updates) so HTTP
 * requests can return immediately and the client polls for progress instead
 * of holding a connection open for minutes (which times out).
 *
 * Only one job runs at a time — system tasks share apt/dpkg locks anyway.
 *
 * Task 24 Part 3: jobs now live in the `jobs` table (see
 * database/migrations.ts, migration 6) instead of an in-memory `Map`. A
 * server restart mid-install used to lose all job state and leave the
 * client polling a `jobId` that 404s forever; now the job row survives the
 * restart, and the constructor immediately reconciles any job left
 * 'running' by a process that died (see interruptStaleJobs() below).
 *
 * `db` is injectable (defaults to the real app singleton from
 * '../database') purely so tests can point a JobService at an isolated
 * throwaway database instead of the real one — see services/jobs.test.ts.
 */
export class JobService {
  private db: Database.Database;
  private currentJobId: string | null = null;
  private currentLog: string[] = [];

  constructor(db: Database.Database = defaultDb) {
    this.db = db;
    this.interruptStaleJobs();
  }

  /**
   * Runs once, synchronously, at construction — i.e. at process startup for
   * the real exported singleton below. Any row still recorded 'running' at
   * that point was left behind by a process that died mid-job (a crash, or
   * this app's own install/update flow restarting the server): there is no
   * possible in-memory state that could still legitimately own it, since
   * this JobService instance was just created and has no currentJobId yet.
   *
   * Marking it 'interrupted' (rather than leaving it 'running' forever, or
   * silently deleting it) gives the client polling GET /system/jobs/:id a
   * definitive, terminal answer instead of an eternal "running" or a 404.
   * It also means the row is no longer 'running', so busy/start() below
   * never mistake a stale interrupted job for one that's still in flight.
   */
  private interruptStaleJobs(): void {
    this.db
      .prepare(
        `UPDATE jobs SET status = 'interrupted', error = ?, finished_at = ? WHERE status = 'running'`,
      )
      .run('Server restarted while this job was running; its outcome is unknown.', Date.now());
  }

  /**
   * Whether a job is currently running, per the DB — not an in-memory flag.
   * Computed by querying `jobs` directly (rather than trusting only
   * `currentJobId`) so this is correct even for a JobService instance that
   * didn't itself start the running job (e.g. right after
   * interruptStaleJobs() has already cleared any stale row, or in a test
   * that shares one DB across two JobService instances).
   */
  get busy(): boolean {
    return this.db.prepare(`SELECT 1 FROM jobs WHERE status = 'running' LIMIT 1`).get() !== undefined;
  }

  start(label: string, task: () => Promise<string>): Job {
    const runningRow = this.db
      .prepare(`SELECT label FROM jobs WHERE status = 'running' LIMIT 1`)
      .get() as { label: string } | undefined;
    if (runningRow) {
      throw new Error(`Another system task is already running: ${runningRow.label || 'unknown'}`);
    }

    const job: Job = {
      id: randomUUID(),
      label,
      status: 'running',
      log: [],
      startedAt: Date.now(),
    };

    this.db
      .prepare(
        `INSERT INTO jobs (id, label, status, log, output, error, started_at, finished_at)
         VALUES (@id, @label, @status, @log, NULL, NULL, @startedAt, NULL)`,
      )
      .run({ id: job.id, label: job.label, status: job.status, log: '[]', startedAt: job.startedAt });

    this.currentJobId = job.id;
    this.currentLog = [];

    task()
      .then(output => {
        this.db
          .prepare(`UPDATE jobs SET status = 'done', output = ?, finished_at = ? WHERE id = ?`)
          .run(output, Date.now(), job.id);
      })
      .catch(err => {
        const message = err?.message || String(err);
        this.db
          .prepare(`UPDATE jobs SET status = 'error', error = ?, finished_at = ? WHERE id = ?`)
          .run(message, Date.now(), job.id);
      })
      .finally(() => {
        if (this.currentJobId === job.id) this.currentJobId = null;
        this.pruneOldJobs();
      });

    return job;
  }

  /**
   * Append a progress line to the currently running job (no-op if idle).
   *
   * `currentLog` is an in-memory buffer, appended to and re-persisted as
   * one `UPDATE ... SET log = ?` per call, rather than reading the row back
   * from SQLite and re-parsing its JSON on every single call — there is
   * only ever one job running at a time (see the single-slot constraint
   * above) and only this JobService instance appends to it, so the
   * in-memory buffer can never drift from what's on disk.
   *
   * On cost: this IS an O(n) `JSON.stringify` + a full-column `UPDATE` on
   * every call, and install flows call this many times per job (Task 11's
   * fix), so across one job's lifetime this is O(n²) in the number of log
   * lines. At this app's actual bound (MAX_LOG_LINES = 500, capped before
   * the stringify), that's ~500 stringify calls over an array that never
   * exceeds 500 short strings — on the order of low single-digit
   * milliseconds total on Pi-class hardware (measured well under that via
   * this file's `log(): caps the persisted log at 500 lines...` test, which
   * asserts 550 calls complete in under 2s and passes in low
   * single-digit ms in practice). A genuinely unbounded log or a much
   * higher call volume would make this worth revisiting (e.g. append-only
   * storage), but at this scale doing so would be solving a problem that
   * does not exist.
   */
  log(line: string): void {
    if (!this.currentJobId) return;
    this.currentLog.push(line);
    if (this.currentLog.length > MAX_LOG_LINES) {
      this.currentLog.splice(0, this.currentLog.length - MAX_LOG_LINES);
    }
    this.db.prepare(`UPDATE jobs SET log = ? WHERE id = ?`).run(JSON.stringify(this.currentLog), this.currentJobId);
  }

  get(id: string): Job | undefined {
    const row = this.db.prepare('SELECT * FROM jobs WHERE id = ?').get(id) as JobRow | undefined;
    return row ? rowToJob(row) : undefined;
  }

  /** Keep only the MAX_KEPT_JOBS most-recently-started non-running jobs; a running job is never a pruning candidate. */
  private pruneOldJobs(): void {
    const finished = this.db
      .prepare(`SELECT id FROM jobs WHERE status != 'running' ORDER BY started_at ASC`)
      .all() as { id: string }[];
    const excess = finished.length - MAX_KEPT_JOBS;
    if (excess <= 0) return;
    const del = this.db.prepare('DELETE FROM jobs WHERE id = ?');
    for (let i = 0; i < excess; i++) {
      del.run(finished[i].id);
    }
  }
}

export const jobService = new JobService();
