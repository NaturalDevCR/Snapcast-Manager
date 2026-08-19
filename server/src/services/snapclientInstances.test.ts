// eslint-disable-next-line @typescript-eslint/ban-ts-comment -- deliberate, see explanation below
// @ts-nocheck
//
// Why: see server/src/platform/systemd.test.ts's identical header for the
// full investigation into the `node --test --import ts-node/register`
// parameter-type-stripping bug this pragma works around. This file's
// mocking helpers (stubModuleFn) bind parameterized functions to
// module-exports properties, which hits the same bug. Correctness is
// independently confirmed with real type-checking via:
//   npx tsc --noEmit --strict --target es2020 --module commonjs \
//     --esModuleInterop --skipLibCheck src/services/snapclientInstances.test.ts
// This does not affect `npm run build` (test files are excluded from
// tsconfig's project) or the production `services/snapclientInstances.ts` /
// `routes/snapclientInstances.ts` files, which have no such pragma.
//
// DB isolation: `services/snapclientInstances.ts` imports the real
// `../database` singleton (better-sqlite3), which reads `process.env.DB_PATH`
// at module-load time. This file sets DB_PATH to a fresh temp file BEFORE
// importing `../services/snapclientInstances` -- see pipeSources.test.ts's
// header (Task 6-7) for why textual placement of the assignment before the
// `import` statement is sufficient here (TS compiles `import` to a
// `require()` emitted at the same source position, not hoisted).
//
// Mocking pattern: identical to pipeSources.test.ts (Tasks 6-7) --
// plain property reassignment on the imported module namespace objects for
// `platform/exec.ts`'s `run()`/`needsSudo()`, `platform/systemd.ts`'s
// `control()`/`activeState()`/`daemonReload()`/`logs()`, and
// `platform/files.ts`'s `installPrivilegedFile()`, restored in a
// try/finally after each test.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as path from 'path';
import * as os from 'os';

const tmpDbPath = path.join(os.tmpdir(), `snapclientinstances-test-${process.pid}-${Date.now()}.db`);
process.env.DB_PATH = tmpDbPath;
process.env.NODE_ENV = 'test';

import { snapclientInstanceService } from '../services/snapclientInstances';
import * as execModule from '../platform/exec';
import * as systemdModule from '../platform/systemd';
import * as filesModule from '../platform/files';
import db from '../database';

// ---- generic module-function stubbing (same pattern as pipeSources.test.ts) ----

function stubModuleFn(mod: any, key: string, impl: (...args: any[]) => any): () => void {
  const original = mod[key];
  mod[key] = impl;
  return () => {
    mod[key] = original;
  };
}

type Call = { kind: string; args: any[] };

/** Stubs run(), needsSudo(), control(), daemonReload(), activeState(), logs(),
 * and installPrivilegedFile() all at once, recording every call into `calls`. */
function stubAllPlatformCalls(calls: Call[], opts: { needsSudo?: boolean } = {}): () => void {
  const restores = [
    stubModuleFn(execModule, 'run', async (bin: string, args: string[]) => {
      calls.push({ kind: 'exec.run', args: [bin, args] });
      return { stdout: '', stderr: '' };
    }),
    stubModuleFn(execModule, 'needsSudo', () => opts.needsSudo ?? false),
    stubModuleFn(systemdModule, 'control', async (unit: string, action: string) => {
      calls.push({ kind: 'systemd.control', args: [unit, action] });
    }),
    stubModuleFn(systemdModule, 'daemonReload', async () => {
      calls.push({ kind: 'systemd.daemonReload', args: [] });
    }),
    stubModuleFn(systemdModule, 'activeState', async (unit: string) => {
      calls.push({ kind: 'systemd.activeState', args: [unit] });
      return 'inactive';
    }),
    stubModuleFn(systemdModule, 'isActive', async (unit: string) => {
      calls.push({ kind: 'systemd.isActive', args: [unit] });
      return false;
    }),
    stubModuleFn(systemdModule, 'logs', async (unit: string, lines: number) => {
      calls.push({ kind: 'systemd.logs', args: [unit, lines] });
      return '';
    }),
    stubModuleFn(filesModule, 'installPrivilegedFile', async (destPath: string, content: string, fileOpts: any) => {
      calls.push({ kind: 'files.installPrivilegedFile', args: [destPath, content, fileOpts] });
    }),
  ];
  return () => restores.forEach(r => r());
}

let nameCounter = 0;
function uniqueName(prefix: string): string {
  nameCounter += 1;
  return `${prefix}-${nameCounter}-${Date.now()}`;
}

async function createTestInstance(overrides: Partial<any> = {}) {
  const calls: Call[] = [];
  const restore = stubAllPlatformCalls(calls);
  try {
    return await snapclientInstanceService.createInstance({
      name: uniqueName('test-instance'),
      host: '127.0.0.1',
      port: 1704,
      soundcard: 'hw:CARD=PCH,DEV=0',
      ...overrides,
    });
  } finally {
    restore();
  }
}

// ============================================================================
// THE CRITICAL FIX: every function that takes an `id` and does something
// privileged with it must resolve the id against the database FIRST. An id
// that doesn't correspond to a real row -- whether injection-shaped or just
// a plausible-looking nonexistent one -- must never reach a platform-layer
// call. See services/snapclientInstances.ts's getRow()/header for the
// rationale.
// ============================================================================

test('deleteInstance() with an injection-shaped, nonexistent id reports not-found and calls NO platform function', async () => {
  const calls: Call[] = [];
  const restore = stubAllPlatformCalls(calls);
  try {
    const injectionId = '; rm -rf / #';
    const result = await snapclientInstanceService.deleteInstance(injectionId);
    assert.equal(result, false, 'deleteInstance() must report not-found (false) for a nonexistent id');
    assert.equal(calls.length, 0, `expected zero platform calls, got: ${JSON.stringify(calls)}`);
  } finally {
    restore();
  }
});

test('deleteInstance() with a plausible-but-nonexistent real-looking id reports not-found and calls NO platform function', async () => {
  const calls: Call[] = [];
  const restore = stubAllPlatformCalls(calls);
  try {
    const result = await snapclientInstanceService.deleteInstance('inst-9999999999');
    assert.equal(result, false);
    assert.equal(calls.length, 0, `expected zero platform calls, got: ${JSON.stringify(calls)}`);
  } finally {
    restore();
  }
});

test('controlInstance() with an injection-shaped, nonexistent id reports not-found and calls NO platform function', async () => {
  const calls: Call[] = [];
  const restore = stubAllPlatformCalls(calls);
  try {
    const injectionId = '; rm -rf / #';
    const result = await snapclientInstanceService.controlInstance(injectionId, 'start');
    assert.equal(result, false);
    assert.equal(calls.length, 0, `expected zero platform calls, got: ${JSON.stringify(calls)}`);
  } finally {
    restore();
  }
});

test('controlInstance() with a plausible-but-nonexistent real-looking id reports not-found and calls NO platform function', async () => {
  const calls: Call[] = [];
  const restore = stubAllPlatformCalls(calls);
  try {
    const result = await snapclientInstanceService.controlInstance('inst-9999999999', 'restart');
    assert.equal(result, false);
    assert.equal(calls.length, 0, `expected zero platform calls, got: ${JSON.stringify(calls)}`);
  } finally {
    restore();
  }
});

test('getInstanceStatus() with an injection-shaped, nonexistent id returns null and calls NO platform function', async () => {
  const calls: Call[] = [];
  const restore = stubAllPlatformCalls(calls);
  try {
    const injectionId = '; rm -rf / #';
    const result = await snapclientInstanceService.getInstanceStatus(injectionId);
    assert.equal(result, null);
    assert.equal(calls.length, 0, `expected zero platform calls, got: ${JSON.stringify(calls)}`);
  } finally {
    restore();
  }
});

test('getInstanceStatus() with a plausible-but-nonexistent real-looking id returns null and calls NO platform function', async () => {
  const calls: Call[] = [];
  const restore = stubAllPlatformCalls(calls);
  try {
    const result = await snapclientInstanceService.getInstanceStatus('inst-9999999999');
    assert.equal(result, null);
    assert.equal(calls.length, 0, `expected zero platform calls, got: ${JSON.stringify(calls)}`);
  } finally {
    restore();
  }
});

test('getInstanceLogs() with an injection-shaped, nonexistent id returns null and calls NO platform function', async () => {
  const calls: Call[] = [];
  const restore = stubAllPlatformCalls(calls);
  try {
    const injectionId = '; rm -rf / #';
    const result = await snapclientInstanceService.getInstanceLogs(injectionId);
    assert.equal(result, null);
    assert.equal(calls.length, 0, `expected zero platform calls, got: ${JSON.stringify(calls)}`);
  } finally {
    restore();
  }
});

test('getInstanceLogs() with a plausible-but-nonexistent real-looking id returns null and calls NO platform function', async () => {
  const calls: Call[] = [];
  const restore = stubAllPlatformCalls(calls);
  try {
    const result = await snapclientInstanceService.getInstanceLogs('inst-9999999999');
    assert.equal(result, null);
    assert.equal(calls.length, 0, `expected zero platform calls, got: ${JSON.stringify(calls)}`);
  } finally {
    restore();
  }
});

test('updateInstance() with a nonexistent id still returns null (pre-existing convention, unchanged)', async () => {
  const calls: Call[] = [];
  const restore = stubAllPlatformCalls(calls);
  try {
    const result = await snapclientInstanceService.updateInstance('; rm -rf / #', { name: 'x' });
    assert.equal(result, null);
    assert.equal(calls.length, 0, `expected zero platform calls, got: ${JSON.stringify(calls)}`);
  } finally {
    restore();
  }
});

// ============================================================================
// Success paths: a REAL existing instance id resolves and calls the expected
// platform function(s) with the correctly-derived unit name.
// ============================================================================

test('deleteInstance() on a real instance stops, disables, removes both files (via rm argv), daemon-reloads, and returns true', async () => {
  const instance = await createTestInstance();
  const calls: Call[] = [];
  const restore = stubAllPlatformCalls(calls);
  try {
    const result = await snapclientInstanceService.deleteInstance(instance.id);
    assert.equal(result, true);

    const unit = `snapclient-manager-${instance.id}.service`;
    const controlCalls = calls.filter(c => c.kind === 'systemd.control').map(c => c.args);
    assert.deepEqual(controlCalls, [[unit, 'stop'], [unit, 'disable']]);

    const rmCalls = calls.filter(c => c.kind === 'exec.run' && c.args[0] === 'rm');
    assert.equal(rmCalls.length, 2);
    assert.deepEqual(
      rmCalls.map(c => c.args[1]).sort(),
      [
        ['-f', `/etc/snapclient-manager/${instance.id}.env`],
        ['-f', `/etc/systemd/system/snapclient-manager-${instance.id}.service`],
      ].sort(),
    );

    assert.equal(calls.filter(c => c.kind === 'systemd.daemonReload').length, 1);

    const row = db.prepare('SELECT * FROM snapclient_instances WHERE id = ?').get(instance.id);
    assert.equal(row, undefined, 'the DB row must be gone after a successful delete');
  } finally {
    restore();
  }
});

test('controlInstance() on a real instance calls systemd.control() with the derived unit name and returns true', async () => {
  const instance = await createTestInstance();
  const calls: Call[] = [];
  const restore = stubAllPlatformCalls(calls);
  try {
    const result = await snapclientInstanceService.controlInstance(instance.id, 'restart');
    assert.equal(result, true);
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0], {
      kind: 'systemd.control',
      args: [`snapclient-manager-${instance.id}.service`, 'restart'],
    });
  } finally {
    restore();
  }
});

test('getInstanceStatus() on a real instance calls systemd.activeState() with the derived unit name', async () => {
  const instance = await createTestInstance();
  const restoreActiveState = stubModuleFn(systemdModule, 'activeState', async (unit: string) => {
    assert.equal(unit, `snapclient-manager-${instance.id}.service`);
    return 'active';
  });
  try {
    const status = await snapclientInstanceService.getInstanceStatus(instance.id);
    assert.equal(status, 'active');
  } finally {
    restoreActiveState();
  }
});

test('getInstanceLogs() on a real instance calls systemd.logs() with the derived unit name and 100 lines', async () => {
  const instance = await createTestInstance();
  const calls: Call[] = [];
  const restore = stubAllPlatformCalls(calls);
  try {
    const result = await snapclientInstanceService.getInstanceLogs(instance.id);
    assert.equal(result, '');
    const logsCalls = calls.filter(c => c.kind === 'systemd.logs');
    assert.equal(logsCalls.length, 1);
    assert.deepEqual(logsCalls[0].args, [`snapclient-manager-${instance.id}.service`, 100]);
  } finally {
    restore();
  }
});

test('updateInstance() on a real instance writes files via installPrivilegedFile and restarts the unit', async () => {
  const instance = await createTestInstance();
  const calls: Call[] = [];
  const restore = stubAllPlatformCalls(calls);
  try {
    const result = await snapclientInstanceService.updateInstance(instance.id, { host: '192.168.1.50' });
    assert.ok(result);
    assert.equal(result!.host, '192.168.1.50');

    const restartCalls = calls.filter(c => c.kind === 'systemd.control' && c.args[1] === 'restart');
    assert.equal(restartCalls.length, 1);
    assert.equal(restartCalls[0].args[0], `snapclient-manager-${instance.id}.service`);

    const installCalls = calls.filter(c => c.kind === 'files.installPrivilegedFile');
    assert.equal(installCalls.length, 2);
  } finally {
    restore();
  }
});

// ============================================================================
// randomUUID(): createInstance() must no longer generate colliding
// `inst-${Date.now()}` ids.
// ============================================================================

test('createInstance() generates a randomUUID-format id, not inst-<timestamp>', async () => {
  const instance = await createTestInstance();
  const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  assert.match(instance.id, uuidRe, `expected a UUID-format id, got: ${instance.id}`);
  assert.ok(!instance.id.startsWith('inst-'), 'must not use the old colliding inst-<timestamp> scheme');
});

test('createInstance() called twice in immediate succession never collides on id', async () => {
  const a = await createTestInstance();
  const b = await createTestInstance();
  assert.notEqual(a.id, b.id);
});

// ============================================================================
// installPrivilegedFile migration: writeFiles()/removeFiles() must go
// through platform/files.ts's installPrivilegedFile / platform/exec.ts's
// run(), never a predictable /tmp path + mv + chmod.
// ============================================================================

test('createInstance() writes the env and service files via installPrivilegedFile with correct destination/content/mode', async () => {
  const calls: Call[] = [];
  const restore = stubAllPlatformCalls(calls);
  try {
    const name = uniqueName('write-files-test');
    const instance = await snapclientInstanceService.createInstance({
      name,
      host: '127.0.0.1',
      port: 1704,
      soundcard: 'hw:CARD=PCH,DEV=0',
    });

    const installCalls = calls.filter(c => c.kind === 'files.installPrivilegedFile');
    assert.equal(installCalls.length, 2);

    const envCall = installCalls.find(c => c.args[0] === `/etc/snapclient-manager/${instance.id}.env`);
    assert.ok(envCall, 'expected an installPrivilegedFile call for the env file');
    assert.ok(envCall!.args[1].includes(instance.host));
    assert.deepEqual(envCall!.args[2], { mode: 0o644 });

    const svcCall = installCalls.find(
      c => c.args[0] === `/etc/systemd/system/snapclient-manager-${instance.id}.service`,
    );
    assert.ok(svcCall, 'expected an installPrivilegedFile call for the service file');
    assert.ok(svcCall!.args[1].includes(name));
    assert.deepEqual(svcCall!.args[2], { mode: 0o644 });
  } finally {
    restore();
  }
});

test('deleteInstance() removes both files via run("rm", argv) -- never a shell string', async () => {
  const instance = await createTestInstance();
  const calls: Call[] = [];
  const restore = stubAllPlatformCalls(calls);
  try {
    await snapclientInstanceService.deleteInstance(instance.id);
    const rmCalls = calls.filter(c => c.kind === 'exec.run' && c.args[0] === 'rm');
    assert.equal(rmCalls.length, 2);
    for (const c of rmCalls) {
      assert.ok(Array.isArray(c.args[1]));
      for (const a of c.args[1]) {
        assert.equal(typeof a, 'string');
        assert.ok(!a.includes('`'), 'argv element must never contain a backtick-templated shell string');
      }
    }
  } finally {
    restore();
  }
});

test('deleteInstance() applies sudo to the rm calls via argv (not string concatenation) when needsSudo() is true', async () => {
  const instance = await createTestInstance();
  const calls: Call[] = [];
  const restore = stubAllPlatformCalls(calls, { needsSudo: true });
  try {
    await snapclientInstanceService.deleteInstance(instance.id);
    const sudoRmCalls = calls.filter(c => c.kind === 'exec.run' && c.args[0] === 'sudo' && c.args[1][0] === 'rm');
    assert.equal(sudoRmCalls.length, 2);
  } finally {
    restore();
  }
});

// ============================================================================
// ALSA / audio-device exec calls: argv arrays via platform/exec.ts's run(),
// never a shell string built with template interpolation.
// ============================================================================

test('listAudioDevices() calls run("aplay", ["-l"]) and run("cat", [...]) via argv, never a shell string', async () => {
  const calls: Call[] = [];
  const restoreRun = stubModuleFn(execModule, 'run', async (bin: string, args: string[]) => {
    calls.push({ kind: 'exec.run', args: [bin, args] });
    return { stdout: '', stderr: '' };
  });
  try {
    await snapclientInstanceService.listAudioDevices();
    const aplayCalls = calls.filter(c => c.args[0] === 'aplay');
    assert.equal(aplayCalls.length, 1);
    assert.deepEqual(aplayCalls[0].args[1], ['-l']);

    const catCalls = calls.filter(c => c.args[0] === 'cat');
    assert.equal(catCalls.length, 2);
    const catPaths = catCalls.map(c => c.args[1][0]).sort();
    assert.deepEqual(catPaths, ['/proc/asound/cards', '/proc/asound/pcm']);
  } finally {
    restoreRun();
  }
});

test('listAlsaControls() rejects an invalid cardId without calling run() at all', async () => {
  const calls: Call[] = [];
  const restoreRun = stubModuleFn(execModule, 'run', async (bin: string, args: string[]) => {
    calls.push({ kind: 'exec.run', args: [bin, args] });
    return { stdout: '', stderr: '' };
  });
  try {
    const result = await snapclientInstanceService.listAlsaControls('; rm -rf / #');
    assert.deepEqual(result, []);
    assert.equal(calls.length, 0);
  } finally {
    restoreRun();
  }
});

test('setAlsaVolume() calls amixer via argv with the raw (unquoted, since no shell) controlName', async () => {
  const calls: Call[] = [];
  const restoreRun = stubModuleFn(execModule, 'run', async (bin: string, args: string[]) => {
    calls.push({ kind: 'exec.run', args: [bin, args] });
    return { stdout: '', stderr: '' };
  });
  try {
    await snapclientInstanceService.setAlsaVolume('PCH', 'Master', 75);
    const amixerCalls = calls.filter(c => c.args[0] === 'amixer');
    assert.equal(amixerCalls.length, 1);
    assert.deepEqual(amixerCalls[0].args[1], ['-D', 'hw:CARD=PCH', 'sset', 'Master', '75%']);
  } finally {
    restoreRun();
  }
});

test('setAlsaVolume() rejects an invalid controlName without calling run()', async () => {
  const calls: Call[] = [];
  const restoreRun = stubModuleFn(execModule, 'run', async (bin: string, args: string[]) => {
    calls.push({ kind: 'exec.run', args: [bin, args] });
    return { stdout: '', stderr: '' };
  });
  try {
    await assert.rejects(() => snapclientInstanceService.setAlsaVolume('PCH', '; rm -rf / #', 50));
    assert.equal(calls.length, 0);
  } finally {
    restoreRun();
  }
});

test('postInstallSetup() calls systemd.control() for the fixed snapclient.service unit, never a template string', async () => {
  const calls: Call[] = [];
  const restore = stubAllPlatformCalls(calls);
  try {
    await snapclientInstanceService.postInstallSetup();
    const controlCalls = calls.filter(c => c.kind === 'systemd.control').map(c => c.args);
    assert.deepEqual(controlCalls, [
      ['snapclient.service', 'stop'],
      ['snapclient.service', 'disable'],
    ]);
  } finally {
    restore();
  }
});
