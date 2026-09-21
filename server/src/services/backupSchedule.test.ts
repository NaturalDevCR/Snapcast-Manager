// eslint-disable-next-line @typescript-eslint/ban-ts-comment -- deliberate, see explanation below
// @ts-nocheck
//
// Why: see server/src/services/watchdog.test.ts's identical header for the
// full investigation into the `node --test --import ts-node/register`
// parameter-type-stripping bug this pragma works around -- this file's
// `stubModuleFn` helper (binding functions onto backupModule.backupService
// and BackupScheduleService.prototype) hits the same bug. Correctness is
// independently confirmed with real type-checking via:
//   npx tsc --noEmit --strict --target es2020 --module commonjs \
//     --esModuleInterop --skipLibCheck src/services/backupSchedule.test.ts
// This does not affect `npm run build` (test files are excluded from
// tsconfig's project) or the production `services/backupSchedule.ts` file,
// which has no such pragma.
//
// computeNextRunAt() deliberately works in the process's LOCAL time zone
// (the design's "server local time" schedule field -- see this file's
// design doc) via Date's setHours()/getDay(), not UTC. That makes this
// test's exact-ISO-string assertions dependent on whatever time zone the
// process running `npm test` happens to be in, unless pinned. Node reads
// `process.env.TZ` when it first touches local-time Date behavior, so this
// MUST be set before anything in this file (including the `./backupSchedule`
// import two lines below, transitively) constructs or reads a Date --
// pinning it here makes the test deterministic on every machine/CI runner
// regardless of its real configured time zone, while the actual production
// code still correctly uses whatever real time zone the deployed host has.
process.env.TZ = 'UTC';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, unlinkSync } from 'fs';
import * as path from 'path';
import * as os from 'os';
import { BackupScheduleService, BackupScheduleConfig, computeNextRunAt } from './backupSchedule';
import * as backupModule from './backup';

function stubModuleFn(mod: any, key: string, impl: (...args: any[]) => any): () => void {
  const original = mod[key];
  mod[key] = impl;
  return () => {
    mod[key] = original;
  };
}

// ---- computeNextRunAt(): pure function, no I/O, no service instance ----

test('computeNextRunAt() daily: returns later today when the time has not passed yet', () => {
  const from = new Date('2026-09-20T10:00:00.000Z');
  const next = computeNextRunAt({ frequency: 'daily', time: '15:30' }, from);
  assert.equal(next.toISOString(), '2026-09-20T15:30:00.000Z');
});

test('computeNextRunAt() daily: returns tomorrow when the time already passed today', () => {
  const from = new Date('2026-09-20T20:00:00.000Z');
  const next = computeNextRunAt({ frequency: 'daily', time: '03:00' }, from);
  assert.equal(next.toISOString(), '2026-09-21T03:00:00.000Z');
});

test('computeNextRunAt() weekly: returns the next matching day of week', () => {
  // 2026-09-20 is a Sunday (dayOfWeek 0).
  const from = new Date('2026-09-20T10:00:00.000Z');
  const next = computeNextRunAt({ frequency: 'weekly', dayOfWeek: 3, time: '02:00' }, from); // next Wednesday
  assert.equal(next.toISOString(), '2026-09-23T02:00:00.000Z');
});

test('computeNextRunAt() weekly: rolls to next week when today matches but the time already passed', () => {
  const from = new Date('2026-09-20T10:00:00.000Z'); // Sunday, 10:00
  const next = computeNextRunAt({ frequency: 'weekly', dayOfWeek: 0, time: '03:00' }, from);
  assert.equal(next.toISOString(), '2026-09-27T03:00:00.000Z');
});

test('computeNextRunAt() weekly: throws without a valid dayOfWeek', () => {
  assert.throws(
    () => computeNextRunAt({ frequency: 'weekly', time: '03:00' }, new Date()),
    /dayOfWeek/,
  );
});

test('computeNextRunAt() throws on a malformed time string', () => {
  assert.throws(
    () => computeNextRunAt({ frequency: 'daily', time: '9:00' }, new Date()),
    /Invalid time/,
  );
});

// ---- BackupScheduleService: real temp-file config, stubbed backupService.createScheduledBackup ----

function newServiceWithTempConfig(initial?: Partial<BackupScheduleConfig>): { service: BackupScheduleService; configPath: string; restore: () => void } {
  const configPath = path.join(
    os.tmpdir(),
    `backup-schedule-test-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.json`,
  );
  if (initial !== undefined) {
    writeFileSync(configPath, JSON.stringify(initial, null, 2), 'utf-8');
  }
  const proto = BackupScheduleService.prototype as any;
  const original = proto.ensureConfig;
  proto.ensureConfig = async () => configPath;
  const service = new BackupScheduleService();
  const restore = () => {
    proto.ensureConfig = original;
    service.stop();
    try {
      unlinkSync(configPath);
    } catch {
      // never written / already gone -- fine.
    }
  };
  return { service, configPath, restore };
}

test('getConfig() returns disabled defaults when no config file exists yet', async () => {
  const { service, restore } = newServiceWithTempConfig(undefined);
  try {
    await (service as any).ready;
    const config = await service.getConfig();
    assert.equal(config.enabled, false);
    assert.equal(config.frequency, 'daily');
    assert.equal(config.retainCount, 7);
  } finally {
    restore();
  }
});

test('updateConfig() persists settings and computes nextRunAt when enabling', async () => {
  const { service, restore } = newServiceWithTempConfig(undefined);
  try {
    await (service as any).ready;
    const updated = await service.updateConfig({ enabled: true, frequency: 'daily', time: '04:00', retainCount: 5 });
    assert.equal(updated.enabled, true);
    assert.equal(updated.retainCount, 5);
    assert.ok(updated.nextRunAt, 'nextRunAt must be set once enabled');
    const reloaded = await service.getConfig();
    assert.equal(reloaded.nextRunAt, updated.nextRunAt);
  } finally {
    restore();
  }
});

test('updateConfig() clears nextRunAt when disabling', async () => {
  const { service, restore } = newServiceWithTempConfig({ enabled: true, frequency: 'daily', time: '04:00', retainCount: 5, nextRunAt: '2026-01-01T00:00:00.000Z' });
  try {
    await (service as any).ready;
    const updated = await service.updateConfig({ enabled: false, frequency: 'daily', time: '04:00', retainCount: 5 });
    assert.equal(updated.enabled, false);
    assert.equal(updated.nextRunAt, undefined);
  } finally {
    restore();
  }
});

test('updateConfig() rejects an invalid time', async () => {
  const { service, restore } = newServiceWithTempConfig(undefined);
  try {
    await (service as any).ready;
    await assert.rejects(
      service.updateConfig({ enabled: true, frequency: 'daily', time: 'not-a-time', retainCount: 5 }),
      /Invalid time/,
    );
  } finally {
    restore();
  }
});

test('updateConfig() rejects weekly without dayOfWeek', async () => {
  const { service, restore } = newServiceWithTempConfig(undefined);
  try {
    await (service as any).ready;
    await assert.rejects(
      service.updateConfig({ enabled: true, frequency: 'weekly', time: '03:00', retainCount: 5 }),
      /dayOfWeek/,
    );
  } finally {
    restore();
  }
});

test('runNow() calls backupService.createScheduledBackup with the configured retainCount and does not touch lastRunAt/nextRunAt', async () => {
  const calls: number[] = [];
  const restoreCreate = stubModuleFn(backupModule.backupService, 'createScheduledBackup', async (retainCount: number) => {
    calls.push(retainCount);
    return { path: '/tmp/x', fileName: 'scheduled-x.tar.gz', size: 1, timestamp: 'x', components: [], files: [] };
  });
  const { service, restore } = newServiceWithTempConfig({ enabled: true, frequency: 'daily', time: '04:00', retainCount: 9, lastRunAt: 'never', nextRunAt: '2099-01-01T00:00:00.000Z' });
  try {
    await (service as any).ready;
    await service.runNow();
    assert.deepEqual(calls, [9]);
    const config = await service.getConfig();
    assert.equal(config.lastRunAt, 'never', 'runNow() must not update lastRunAt');
    assert.equal(config.nextRunAt, '2099-01-01T00:00:00.000Z', 'runNow() must not update nextRunAt');
  } finally {
    restoreCreate();
    restore();
  }
});

test('constructor catch-up: runs immediately when nextRunAt is already in the past, then reschedules', async () => {
  const calls: number[] = [];
  const restoreCreate = stubModuleFn(backupModule.backupService, 'createScheduledBackup', async (retainCount: number) => {
    calls.push(retainCount);
    return { path: '/tmp/x', fileName: 'scheduled-x.tar.gz', size: 1, timestamp: 'x', components: [], files: [] };
  });
  const pastIso = new Date(Date.now() - 60_000).toISOString();
  const { service, restore } = newServiceWithTempConfig({ enabled: true, frequency: 'daily', time: '00:00', retainCount: 3, nextRunAt: pastIso });
  try {
    await (service as any).ready;
    assert.deepEqual(calls, [3], 'a due backup must run once at construction time (catch-up)');
    const config = await service.getConfig();
    assert.ok(config.lastRunAt, 'lastRunAt must be set after the catch-up run');
    assert.ok(new Date(config.nextRunAt!).getTime() > Date.now(), 'nextRunAt must be rescheduled into the future');
  } finally {
    restoreCreate();
    restore();
  }
});

test('constructor: does nothing when disabled', async () => {
  const calls: number[] = [];
  const restoreCreate = stubModuleFn(backupModule.backupService, 'createScheduledBackup', async (retainCount: number) => {
    calls.push(retainCount);
    return { path: '/tmp/x', fileName: 'x', size: 1, timestamp: 'x', components: [], files: [] };
  });
  const pastIso = new Date(Date.now() - 60_000).toISOString();
  const { service, restore } = newServiceWithTempConfig({ enabled: false, frequency: 'daily', time: '00:00', retainCount: 3, nextRunAt: pastIso });
  try {
    await (service as any).ready;
    assert.deepEqual(calls, [], 'a disabled schedule must never run, even with a past nextRunAt');
  } finally {
    restoreCreate();
    restore();
  }
});

// Regression test for a bug found integrating this service into
// routes/system.ts (Task 5): the constructor used to call start()
// unconditionally, so every process that merely imported the module
// holding the routes/system.ts singleton (mirroring routes/watchdog.ts's
// watchdogService convention -- the router's own instantiation IS the
// app's one instance) started a real setInterval(60_000) regardless of
// whether scheduled backups were even enabled, keeping that process's
// event loop alive forever. In practice this hung `node --test`'s
// per-file process isolation for any test file importing routes/system.ts
// without itself knowing to call backupScheduleService.stop() (caught via
// system.export.test.ts hanging indefinitely once Task 5 wired the
// singleton in). Fixed by applyScheduleState(), mirroring
// WatchdogService.applyAutoCleanupState()'s "decide from a config already
// in hand" shape.
test('constructor never leaves the poll timer running when the persisted config is disabled', async () => {
  const { service, restore } = newServiceWithTempConfig({ enabled: false, frequency: 'daily', time: '00:00', retainCount: 3 });
  try {
    await (service as any).ready;
    assert.equal((service as any).intervalId, null, 'a disabled schedule must not leave a live timer running');
  } finally {
    restore();
  }
});

test('constructor starts the poll timer when the persisted config is enabled', async () => {
  const { service, restore } = newServiceWithTempConfig({ enabled: true, frequency: 'daily', time: '23:59', retainCount: 3 });
  try {
    await (service as any).ready;
    assert.ok((service as any).intervalId, 'an enabled schedule must start its timer at construction time');
  } finally {
    restore();
  }
});

test('updateConfig() starts the timer immediately when enabling, and stops it immediately when disabling', async () => {
  const { service, restore } = newServiceWithTempConfig(undefined);
  try {
    await (service as any).ready;
    assert.equal((service as any).intervalId, null, 'starts disabled (default config)');

    await service.updateConfig({ enabled: true, frequency: 'daily', time: '23:59', retainCount: 3 });
    assert.ok((service as any).intervalId, 'enabling via updateConfig() must start the timer without waiting for a restart');

    await service.updateConfig({ enabled: false, frequency: 'daily', time: '23:59', retainCount: 3 });
    assert.equal((service as any).intervalId, null, 'disabling via updateConfig() must stop the timer immediately');
  } finally {
    restore();
  }
});

test('start()/stop() are idempotent and stop() actually clears the interval', async () => {
  const { service, restore } = newServiceWithTempConfig(undefined);
  try {
    await (service as any).ready;
    service.start();
    service.start(); // second call must be a no-op, not a second interval
    assert.ok((service as any).intervalId, 'interval must be running after start()');
    service.stop();
    assert.equal((service as any).intervalId, null, 'interval must be cleared after stop()');
    service.stop(); // idempotent
  } finally {
    restore();
  }
});
