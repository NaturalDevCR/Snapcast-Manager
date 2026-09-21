import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildExportTargets } from './system';

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
