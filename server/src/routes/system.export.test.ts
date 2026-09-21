import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildExportTargets, backupScheduleService } from './system';

// This file only imports pure helpers from ./system, but that import still
// executes routes/system.ts's module-level `export const
// backupScheduleService = new BackupScheduleService()` singleton
// construction, which can start a real setInterval(60_000) poll timer if
// the persisted backup-schedule config (dev-fallback or, on the deployed
// box, production) happens to be enabled. Without stopping it, that timer
// keeps this test file's `node --test` child process alive indefinitely
// after its tests finish. Stopping it here protects this file specifically
// AND acts as the general safety net for any other/future test file that
// transitively imports routes/system.ts without itself knowing about the
// singleton -- see services/backupSchedule.ts's applyScheduleState() doc
// comment for the full history of this bug class.
test.after(() => {
  backupScheduleService.stop();
});

test('buildExportTargets() includes /var/lib/snapserver (state) when it exists', () => {
  const targets = buildExportTargets({ dataDirExists: true, confFileExists: true, snapserverStateExists: true });
  assert.deepEqual(targets, [
    '-C', '/opt/snapcast-manager', 'data',
    '-C', '/etc', 'snapserver.conf',
    '-C', '/var', 'lib/snapserver',
  ]);
});

test('buildExportTargets() omits /var/lib/snapserver when it does not exist', () => {
  const targets = buildExportTargets({ dataDirExists: true, confFileExists: true, snapserverStateExists: false });
  assert.deepEqual(targets, [
    '-C', '/opt/snapcast-manager', 'data',
    '-C', '/etc', 'snapserver.conf',
  ]);
});

test('buildExportTargets() returns an empty array when nothing exists', () => {
  const targets = buildExportTargets({ dataDirExists: false, confFileExists: false, snapserverStateExists: false });
  assert.deepEqual(targets, []);
});
