// eslint-disable-next-line @typescript-eslint/ban-ts-comment -- deliberate, see explanation below
// @ts-nocheck
//
// Why: see server/src/platform/systemd.test.ts's identical header for the
// full investigation into the `node --test --import ts-node/register`
// parameter-type-stripping bug this pragma works around. This file's
// mocking helpers (stubModuleFn/stubFsPromises) bind parameterized
// functions to module-exports properties, which hits the same bug.
// Correctness is independently confirmed with real type-checking via:
//   npx tsc --noEmit --strict --target es2020 --module commonjs \
//     --esModuleInterop --skipLibCheck src/services/pipeSources.test.ts
// This does not affect `npm run build` (test files are excluded from
// tsconfig's project) or the production `services/pipeSources.ts` /
// `routes/pipeSources.ts` files, which have no such pragma.
//
// DB isolation: `services/pipeSources.ts` imports the real `../database`
// singleton (better-sqlite3), which reads `process.env.DB_PATH` at
// module-load time. This file sets DB_PATH to a fresh temp file BEFORE
// importing `../services/pipeSources` -- TypeScript compiles `import`
// declarations to `require()` calls emitted at the exact source position
// the `import` statement appears (not hoisted above other statements,
// unlike native ESM), so placing the DB_PATH assignment textually before
// these imports is sufficient and avoids `require()`-style imports (which
// this repo's eslint config forbids -- see `@typescript-eslint/
// no-require-imports`). `node --test` runs each test file in its own
// process, so this never collides with the real app DB or with other
// test files.
//
// One exception: `fsPromises` below uses a DEFAULT import of the Node
// builtin `fs/promises`, not a namespace (`import * as`) import. For a
// project-owned module (already marked `__esModule` by tsc), `import *
// as X` gives back the literal raw exports object, so reassigning
// `X.someExport` works for mocking (see execModule/systemdModule/
// filesModule/configModule below -- the same pattern platform/
// systemd.test.ts and platform/apt.test.ts already use). But `fs/promises`
// is a Node builtin, NOT marked `__esModule`, so a namespace import gets
// wrapped by TS's `__importStar` into a fresh object with getter-only
// (non-writable) bindings -- `fsPromises.readFile = mock` would throw. A
// DEFAULT import goes through `__importDefault` instead, which for a
// non-`__esModule` module returns `{ default: <the real live module
// object> }` -- so `fsPromisesDefault` here IS the actual, mutable,
// process-wide `fs/promises` module object (the same one
// `services/pipeSources.ts`'s own `import fs from 'fs/promises'` reads
// from at call time), making it safely reassignable the same way.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as path from 'path';
import * as os from 'os';

const tmpDbPath = path.join(os.tmpdir(), `pipesources-test-${process.pid}-${Date.now()}.db`);
process.env.DB_PATH = tmpDbPath;
process.env.NODE_ENV = 'test';

import { pipeSourceService, getFifoPath, getSystemdServiceName } from '../services/pipeSources';
import * as execModule from '../platform/exec';
import { ExecError } from '../platform/exec';
import * as systemdModule from '../platform/systemd';
import * as filesModule from '../platform/files';
import * as configModule from '../services/config';
import fsPromises from 'fs/promises';

// ---- generic module-function stubbing (same pattern as platform/*.test.ts:
// plain property reassignment + try/finally restore) ----

function stubModuleFn(mod: any, key: string, impl: (...args: any[]) => any): () => void {
  const original = mod[key];
  mod[key] = impl;
  return () => {
    mod[key] = original;
  };
}

function stubFsPromises(overrides: Record<string, (...args: any[]) => any>): () => void {
  const restores = Object.keys(overrides).map(key => stubModuleFn(fsPromises, key, overrides[key]));
  return () => restores.forEach(r => r());
}

type Call = { kind: string; args: any[] };

/** Stubs run(), needsSudo(), control(), daemonReload(), activeState(), isActive(),
 * logs(), and installPrivilegedFile() all at once, recording every call into
 * `calls`. Individual tests further override specific entries as needed. */
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
    stubModuleFn(configModule.configService, 'addStreamSource', async (uri: string) => {
      calls.push({ kind: 'config.addStreamSource', args: [uri] });
    }),
    stubModuleFn(configModule.configService, 'removeStreamSourceByFifo', async (fifo: string) => {
      calls.push({ kind: 'config.removeStreamSourceByFifo', args: [fifo] });
    }),
  ];
  return () => restores.forEach(r => r());
}

function stubDiscover(result: any[]): () => void {
  const proto = Object.getPrototypeOf(pipeSourceService);
  return stubModuleFn(proto, 'discover', async () => result);
}

/** Stubs any (public OR private -- private is TS-only, still a plain
 * prototype property at runtime) PipeSourceService method, same pattern as
 * stubDiscover() above. Used by the Task 7 migration tests to mock
 * regenerateService()/writeMpdOutput()/removeMpdOutput() per the brief. */
function stubProtoFn(name: string, impl: (...args: any[]) => any): () => void {
  const proto = Object.getPrototypeOf(pipeSourceService);
  return stubModuleFn(proto, name, impl);
}

/** Stubs platform/files.ts's readTextFile() to return fixed content for a
 * fixed set of paths, and throw ENOENT (as the real fs-backed
 * implementation would for a missing file) for anything else -- so tests
 * only need to describe the paths they care about, and every OTHER pipe
 * row left over from earlier tests in this same shared-DB file is safely
 * treated as "no old path found" (nothing to migrate). */
function stubReadTextFile(contents: Record<string, string>): () => void {
  return stubModuleFn(filesModule, 'readTextFile', async (p: string) => {
    if (Object.prototype.hasOwnProperty.call(contents, p)) return contents[p];
    const err: any = new Error(`ENOENT: no such file or directory, open '${p}'`);
    err.code = 'ENOENT';
    throw err;
  });
}

/** Old-scheme FIFO path for `name`, derived from the NEW getFifoPath()'s
 * own slug computation (both the old and new formula use the identical
 * underscoreSlug() -- only the directory prefix changed) rather than
 * reimplementing the slug regex a second time in this test file. */
function oldFifoPathFor(name: string): string {
  return getFifoPath(name).replace('/run/snapcast-manager', '/tmp');
}

let nameCounter = 0;
function uniqueName(prefix: string): string {
  nameCounter += 1;
  return `${prefix} ${nameCounter} ${Date.now()}`;
}

function baseAdoptInput(overrides: Partial<any> = {}) {
  return {
    name: uniqueName('adopt-test'),
    type: 'radio',
    url: 'https://example.com/stream.mp3',
    reconnect: true,
    reconnectStreamed: true,
    reconnectAtEof: true,
    reconnectDelayMax: 30,
    idleThreshold: 15000,
    enabled: true,
    ...overrides,
  };
}

// ============================================================================
// THE CRITICAL FIX: existingServiceName is only ever trusted after being
// matched against a fresh discover() scan's own findings -- never trusted
// as raw request-body input. See adopt()'s docstring in
// services/pipeSources.ts for the full rationale.
// ============================================================================

test('adopt() rejects an injection-shaped existingServiceName that does not appear in discover() output, and never calls systemctl/rm with it', async () => {
  const calls: Call[] = [];
  const restorePlatform = stubAllPlatformCalls(calls);
  // discover() finds nothing at all -- simulates the common case where the
  // attacker is guessing, not actually looking at a real unmanaged pipe.
  const restoreDiscover = stubDiscover([]);
  try {
    const payload = '; rm -rf / #';
    await assert.rejects(
      () => pipeSourceService.adopt(baseAdoptInput({ existingServiceName: payload })),
    );
    // Not one call anywhere in the platform layer referenced the payload,
    // and in fact no privileged call happened at all -- the whole adopt()
    // call was rejected before doing anything.
    assert.equal(calls.length, 0, `expected zero platform calls, got: ${JSON.stringify(calls)}`);
  } finally {
    restorePlatform();
    restoreDiscover();
  }
});

test('adopt() rejects a plausible-but-wrong real-looking unit name not found by discover(), proving the check is tied to discover() output, not just syntax', async () => {
  const calls: Call[] = [];
  const restorePlatform = stubAllPlatformCalls(calls);
  // discover() DID find something real -- just not the name the caller
  // supplied. 'some-other-real-thing' is syntactically a perfectly valid
  // unit name (assertValidUnitName would accept it), so if the fix were
  // merely regex-based this would incorrectly succeed.
  const restoreDiscover = stubDiscover([
    {
      name: 'Some Other Pipe',
      fifoPath: '/tmp/snapfifo_some_other_pipe',
      sourceUri: 'pipe:///tmp/snapfifo_some_other_pipe?name=Some+Other+Pipe',
      idleThreshold: 15000,
      detectedType: 'radio',
      existingService: {
        name: 'snapcast-radio-some-other-pipe',
        filePath: '/etc/systemd/system/snapcast-radio-some-other-pipe.service',
        url: 'https://example.com/other-stream.mp3',
        reconnect: true,
        reconnectStreamed: true,
        reconnectAtEof: true,
        reconnectDelayMax: 30,
        isActive: true,
      },
    },
  ]);
  try {
    await assert.rejects(
      () => pipeSourceService.adopt(baseAdoptInput({ existingServiceName: 'some-other-real-thing' })),
      /existingServiceName does not match any discovered/,
    );
    assert.equal(calls.length, 0, `expected zero platform calls, got: ${JSON.stringify(calls)}`);
    // The DB row for the attempted adopt() must not have been created either
    // -- "reject the whole call" means the whole call, not just the
    // systemctl/rm part.
    const found = pipeSourceService.list().find((p: any) => p.name.startsWith('adopt-test'));
    assert.equal(found, undefined, 'the rejected adopt() must not have inserted a DB row');
  } finally {
    restorePlatform();
    restoreDiscover();
  }
});

test('adopt() succeeds and calls the exact stop/disable/rm sequence when existingServiceName DOES match a discover() result', async () => {
  const calls: Call[] = [];
  const restorePlatform = stubAllPlatformCalls(calls, { needsSudo: false });
  const restoreDiscover = stubDiscover([
    {
      name: 'Adopted Legacy Pipe',
      fifoPath: '/tmp/snapfifo_adopted_legacy_pipe',
      sourceUri: 'pipe:///tmp/snapfifo_adopted_legacy_pipe?name=Adopted+Legacy+Pipe',
      idleThreshold: 15000,
      detectedType: 'radio',
      existingService: {
        name: 'legacy-manually-created-unit',
        filePath: '/etc/systemd/system/legacy-manually-created-unit.service',
        url: 'https://example.com/legacy-stream.mp3',
        reconnect: true,
        reconnectStreamed: true,
        reconnectAtEof: true,
        reconnectDelayMax: 30,
        isActive: true,
      },
    },
  ]);
  try {
    const input = baseAdoptInput({ name: uniqueName('adopted-pipe'), existingServiceName: 'legacy-manually-created-unit' });
    const pipe = await pipeSourceService.adopt(input);

    assert.equal(pipe.name, input.name);

    const controlCalls = calls.filter(c => c.kind === 'systemd.control');
    assert.deepEqual(
      controlCalls.map(c => c.args),
      [
        ['legacy-manually-created-unit.service', 'stop'],
        ['legacy-manually-created-unit.service', 'disable'],
        [`${getSystemdServiceName(input.name)}.service`, 'enable'],
        [`${getSystemdServiceName(input.name)}.service`, 'start'],
      ],
    );

    const rmCalls = calls.filter(c => c.kind === 'exec.run' && c.args[0] === 'rm');
    assert.equal(rmCalls.length, 1);
    assert.deepEqual(rmCalls[0].args[1], ['-f', '/etc/systemd/system/legacy-manually-created-unit.service']);

    const reloadCalls = calls.filter(c => c.kind === 'systemd.daemonReload');
    assert.equal(reloadCalls.length, 1);
  } finally {
    restorePlatform();
    restoreDiscover();
  }
});

test('adopt() applies sudo to the rm call via argv (not string concatenation) when needsSudo() is true', async () => {
  const calls: Call[] = [];
  const restorePlatform = stubAllPlatformCalls(calls, { needsSudo: true });
  const restoreDiscover = stubDiscover([
    {
      name: 'Sudo Pipe',
      fifoPath: '/tmp/snapfifo_sudo_pipe',
      sourceUri: 'pipe:///tmp/snapfifo_sudo_pipe?name=Sudo+Pipe',
      idleThreshold: 15000,
      detectedType: 'radio',
      existingService: {
        name: 'sudo-managed-unit',
        filePath: '/etc/systemd/system/sudo-managed-unit.service',
        url: 'https://example.com/sudo-stream.mp3',
        reconnect: true,
        reconnectStreamed: true,
        reconnectAtEof: true,
        reconnectDelayMax: 30,
        isActive: false,
      },
    },
  ]);
  try {
    const input = baseAdoptInput({ name: uniqueName('sudo-adopted-pipe'), existingServiceName: 'sudo-managed-unit' });
    await pipeSourceService.adopt(input);

    const sudoRmCalls = calls.filter(c => c.kind === 'exec.run' && c.args[0] === 'sudo');
    assert.equal(sudoRmCalls.length, 1);
    assert.deepEqual(sudoRmCalls[0].args[1], ['rm', '-f', '/etc/systemd/system/sudo-managed-unit.service']);
  } finally {
    restorePlatform();
    restoreDiscover();
  }
});

// ============================================================================
// installPrivilegedFile migration: writeRadioServiceFile / writeMpdOutput /
// setConfigContent must go through platform/files.ts's installPrivilegedFile
// rather than the old fixed /tmp path + mv + chmod.
// ============================================================================

test('create() with type=radio writes the unit file via installPrivilegedFile with the right destination path and mode', async () => {
  const calls: Call[] = [];
  const restorePlatform = stubAllPlatformCalls(calls);
  try {
    const name = uniqueName('radio-create-pipe');
    const pipe = await pipeSourceService.create({
      name,
      type: 'radio',
      url: 'https://example.com/create-stream.mp3',
      reconnect: true,
      reconnectStreamed: true,
      reconnectAtEof: true,
      reconnectDelayMax: 30,
      idleThreshold: 15000,
      enabled: false,
    });

    const installCalls = calls.filter(c => c.kind === 'files.installPrivilegedFile');
    assert.equal(installCalls.length, 1);
    const [destPath, content, opts] = installCalls[0].args;
    assert.equal(destPath, `/etc/systemd/system/${getSystemdServiceName(name)}.service`);
    assert.ok(content.includes(getFifoPath(name)));
    assert.ok(content.includes(pipe.url));
    assert.deepEqual(opts, { mode: 0o644 });
  } finally {
    restorePlatform();
  }
});

test('setConfigContent() (radio) writes via installPrivilegedFile with mode 0o644 and then restarts the unit', async () => {
  const calls: Call[] = [];
  const restorePlatform = stubAllPlatformCalls(calls);
  try {
    const name = uniqueName('radio-setconfig-pipe');
    const pipe = await pipeSourceService.create({
      name,
      type: 'radio',
      url: 'https://example.com/setconfig-stream.mp3',
      reconnect: true,
      reconnectStreamed: true,
      reconnectAtEof: true,
      reconnectDelayMax: 30,
      idleThreshold: 15000,
      enabled: false,
    });
    calls.length = 0; // only care about setConfigContent's own calls now

    const newContent = '[Unit]\nDescription=hand-edited\n';
    await pipeSourceService.setConfigContent(pipe.id, newContent);

    const installCalls = calls.filter(c => c.kind === 'files.installPrivilegedFile');
    assert.equal(installCalls.length, 1);
    assert.deepEqual(installCalls[0].args, [
      `/etc/systemd/system/${getSystemdServiceName(name)}.service`,
      newContent,
      { mode: 0o644 },
    ]);

    const restartCalls = calls.filter(c => c.kind === 'systemd.control' && c.args[1] === 'restart');
    assert.equal(restartCalls.length, 1);
    assert.equal(restartCalls[0].args[0], `${getSystemdServiceName(name)}.service`);
  } finally {
    restorePlatform();
  }
});

test('writeMpdOutput (via create() with type=mpd) writes via installPrivilegedFile with mode 0o640', async () => {
  const calls: Call[] = [];
  const restorePlatform = stubAllPlatformCalls(calls);
  const restoreFs = stubFsPromises({
    access: async (p: string) => {
      if (p !== '/etc/mpd.conf') {
        const err: any = new Error('ENOENT');
        err.code = 'ENOENT';
        throw err;
      }
    },
    readFile: async () => 'existing mpd.conf content\n',
  });
  try {
    const name = uniqueName('mpd-create-pipe');
    await pipeSourceService.create({
      name,
      type: 'mpd',
      url: '',
      reconnect: true,
      reconnectStreamed: true,
      reconnectAtEof: true,
      reconnectDelayMax: 30,
      idleThreshold: 15000,
      enabled: true,
    });

    const installCalls = calls.filter(c => c.kind === 'files.installPrivilegedFile');
    assert.equal(installCalls.length, 1);
    const [destPath, content, opts] = installCalls[0].args;
    assert.equal(destPath, '/etc/mpd.conf');
    assert.ok(content.includes(getFifoPath(name)));
    assert.deepEqual(opts, { mode: 0o640 });

    const mpdRestartCalls = calls.filter(c => c.kind === 'systemd.control' && c.args[0] === 'mpd.service');
    assert.equal(mpdRestartCalls.length, 1);
    assert.equal(mpdRestartCalls[0].args[1], 'restart');
  } finally {
    restorePlatform();
    restoreFs();
  }
});

// ============================================================================
// grep exit-1 quirk: `grep -rl <fifo> /etc/systemd/system/` exits 1 when it
// finds no matching files. That's "no unmanaged unit found for this FIFO",
// not an execution failure -- findServiceForFifo() (exercised here via the
// real discover(), not mocked) must return existingService: null rather
// than letting discover() throw / drop the entry.
// ============================================================================

test('discover() treats grep exiting 1 (no matches) as "no existing service found", not an error', async () => {
  const calls: Call[] = [];
  const restorePlatform = stubAllPlatformCalls(calls);
  const restoreReadConfig = stubModuleFn(configModule.configService, 'readServerConfigParsed', async () => ({
    stream: {
      source: [
        'pipe:///tmp/snapfifo_grep_quirk_test?name=GrepQuirkTest&codec=pcm&sampleformat=48000:16:2&idle_threshold=15000&send_silence=true&mode=create',
      ],
    },
  }));
  // Override just the grep call to simulate the real exit-1 quirk; the
  // shared stub's default `run()` handles everything else.
  const restoreGrepRun = stubModuleFn(execModule, 'run', async (bin: string, args: string[]) => {
    if (bin === 'grep') {
      throw new ExecError('grep', args, 1, '', '');
    }
    calls.push({ kind: 'exec.run', args: [bin, args] });
    return { stdout: '', stderr: '' };
  });
  try {
    const discovered = await pipeSourceService.discover();
    const entry = discovered.find((d: any) => d.fifoPath === '/tmp/snapfifo_grep_quirk_test');
    assert.ok(entry, 'expected the unmanaged pipe:// source to be discovered');
    assert.equal(entry.detectedType, 'radio');
    assert.equal(entry.existingService, null);
  } finally {
    restorePlatform();
    restoreReadConfig();
    restoreGrepRun();
  }
});

test('discover() propagates a real (non-exit-1) grep/exec failure up through findServiceForFifo, caught by discover()\'s own .catch(() => null)', async () => {
  const calls: Call[] = [];
  const restorePlatform = stubAllPlatformCalls(calls);
  const restoreReadConfig = stubModuleFn(configModule.configService, 'readServerConfigParsed', async () => ({
    stream: {
      source: [
        'pipe:///tmp/snapfifo_grep_real_error?name=GrepRealError',
      ],
    },
  }));
  const restoreGrepRun = stubModuleFn(execModule, 'run', async (bin: string, args: string[]) => {
    if (bin === 'grep') {
      throw new ExecError('grep', args, 2, '', 'grep: /etc/systemd/system/: Permission denied');
    }
    return { stdout: '', stderr: '' };
  });
  try {
    const discovered = await pipeSourceService.discover();
    const entry = discovered.find((d: any) => d.fifoPath === '/tmp/snapfifo_grep_real_error');
    assert.ok(entry);
    // A genuine (non-exit-1) failure still results in existingService: null
    // because discover() wraps findServiceForFifo() in .catch(() => null) --
    // it does NOT crash the whole discover() call.
    assert.equal(entry.existingService, null);
  } finally {
    restorePlatform();
    restoreReadConfig();
    restoreGrepRun();
  }
});

// ============================================================================
// Sanity: control()/delete()/getStatus() go through the platform layer with
// application-level unit-name derivation, never a raw template string.
// ============================================================================

test('control() on a radio pipe calls systemd.control() with the derived unit name via argv', async () => {
  const calls: Call[] = [];
  const restorePlatform = stubAllPlatformCalls(calls);
  try {
    const name = uniqueName('control-test-pipe');
    const pipe = await pipeSourceService.create({
      name,
      type: 'radio',
      url: 'https://example.com/control-stream.mp3',
      reconnect: true,
      reconnectStreamed: true,
      reconnectAtEof: true,
      reconnectDelayMax: 30,
      idleThreshold: 15000,
      enabled: false,
    });
    calls.length = 0;

    await pipeSourceService.control(pipe.id, 'restart');

    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0], { kind: 'systemd.control', args: [`${getSystemdServiceName(name)}.service`, 'restart'] });
  } finally {
    restorePlatform();
  }
});

test('delete() on a radio pipe stops, disables, removes the unit file (via rm argv), and daemon-reloads', async () => {
  const calls: Call[] = [];
  const restorePlatform = stubAllPlatformCalls(calls);
  try {
    const name = uniqueName('delete-test-pipe');
    const pipe = await pipeSourceService.create({
      name,
      type: 'radio',
      url: 'https://example.com/delete-stream.mp3',
      reconnect: true,
      reconnectStreamed: true,
      reconnectAtEof: true,
      reconnectDelayMax: 30,
      idleThreshold: 15000,
      enabled: false,
    });
    calls.length = 0;

    await pipeSourceService.delete(pipe.id);

    const bareUnit = getSystemdServiceName(name);
    const unit = `${bareUnit}.service`;
    const controlCalls = calls.filter(c => c.kind === 'systemd.control').map(c => c.args);
    assert.deepEqual(controlCalls, [[unit, 'stop'], [unit, 'disable']]);

    const rmCalls = calls.filter(c => c.kind === 'exec.run' && c.args[0] === 'rm');
    assert.equal(rmCalls.length, 1);
    assert.deepEqual(rmCalls[0].args[1], ['-f', `/etc/systemd/system/${unit}`]);

    assert.equal(calls.filter(c => c.kind === 'systemd.daemonReload').length, 1);
    assert.equal(pipeSourceService.getById(pipe.id), null);
  } finally {
    restorePlatform();
  }
});

test('getStatus() calls systemd.activeState() with the derived unit name', async () => {
  const restorePlatform = stubAllPlatformCalls([]);
  try {
    const name = uniqueName('status-test-pipe');
    const pipe = await pipeSourceService.create({
      name,
      type: 'radio',
      url: 'https://example.com/status-stream.mp3',
      reconnect: true,
      reconnectStreamed: true,
      reconnectAtEof: true,
      reconnectDelayMax: 30,
      idleThreshold: 15000,
      enabled: false,
    });

    const restoreActiveState = stubModuleFn(systemdModule, 'activeState', async (unit: string) => {
      assert.equal(unit, `${getSystemdServiceName(name)}.service`);
      return 'active';
    });
    try {
      const status = await pipeSourceService.getStatus(pipe.id);
      assert.equal(status, 'active');
    } finally {
      restoreActiveState();
    }
  } finally {
    restorePlatform();
  }
});

test('getZombieCount() calls run("ps", ["aux"]) via argv and counts defunct lines excluding grep\'s own line', async () => {
  const restoreRun = stubModuleFn(execModule, 'run', async (bin: string, args: string[]) => {
    assert.equal(bin, 'ps');
    assert.deepEqual(args, ['aux']);
    return {
      stdout: [
        'root  1  0.0  0.0  1000  100 ?  Ss  10:00  0:00 init',
        'user  2  0.0  0.0  1000  100 ?  Z   10:00  0:00 [zombie1] <defunct>',
        'user  3  0.0  0.0  1000  100 ?  Z   10:00  0:00 [zombie2] <defunct>',
        'user  4  0.0  0.0  1000  100 ?  S   10:00  0:00 grep defunct',
        '',
      ].join('\n'),
      stderr: '',
    };
  });
  try {
    const count = await pipeSourceService.getZombieCount();
    assert.equal(count, 2);
  } finally {
    restoreRun();
  }
});

test('getZombieCount() returns 0 (not a throw) when run() fails', async () => {
  const restoreRun = stubModuleFn(execModule, 'run', async () => {
    throw new Error('ps not found');
  });
  try {
    const count = await pipeSourceService.getZombieCount();
    assert.equal(count, 0);
  } finally {
    restoreRun();
  }
});

// ============================================================================
// Task 7: FIFO path scheme /tmp -> /run/snapcast-manager, and the automatic
// migration for existing installations still on the old path.
// ============================================================================

test('getFifoPath() returns the new /run/snapcast-manager path, not the old /tmp path', () => {
  const fifo = getFifoPath('My Radio Station!');
  assert.equal(fifo, '/run/snapcast-manager/snapfifo_my_radio_station');
  assert.ok(fifo.startsWith('/run/snapcast-manager/'));
  assert.ok(!fifo.startsWith('/tmp/'));
});

test(
  "buildRadioServiceContent()'s ExecStartPre creates /run/snapcast-manager (mode 0770), chgrps it to " +
  'audio, and mkfifos the FIFO itself at mode 660 (never 666)',
  async () => {
    const calls: Call[] = [];
    const restorePlatform = stubAllPlatformCalls(calls);
    try {
      const name = uniqueName('execstartpre-pipe');
      const fifo = getFifoPath(name);
      await pipeSourceService.create({
        name,
        type: 'radio',
        url: 'https://example.com/execstartpre-stream.mp3',
        reconnect: true,
        reconnectStreamed: true,
        reconnectAtEof: true,
        reconnectDelayMax: 30,
        idleThreshold: 15000,
        enabled: false,
      });

      const installCalls = calls.filter(c => c.kind === 'files.installPrivilegedFile');
      assert.equal(installCalls.length, 1);
      const content = installCalls[0].args[1] as string;

      assert.ok(
        content.includes('mkdir -p -m 0770 /run/snapcast-manager'),
        `expected mkdir -p -m 0770 /run/snapcast-manager in:\n${content}`,
      );
      assert.ok(
        content.includes('chgrp audio /run/snapcast-manager'),
        `expected chgrp audio /run/snapcast-manager in:\n${content}`,
      );
      assert.ok(
        content.includes(`mkfifo -m 660 ${fifo}`),
        `expected mkfifo -m 660 ${fifo} in:\n${content}`,
      );
      assert.ok(!content.includes('mkfifo -m 666'), 'must not use the old world-writable mode 666');
      assert.ok(!content.includes('-m 777'), 'must not use mode 777 anywhere');
      assert.ok(content.includes(`chgrp audio ${fifo}`), `expected chgrp audio ${fifo} in:\n${content}`);
    } finally {
      restorePlatform();
    }
  },
);

test('migrateFifoPaths() skips a radio pipe whose unit file no longer references the old /tmp path (idempotent)', async () => {
  const calls: Call[] = [];
  const restorePlatform = stubAllPlatformCalls(calls);
  try {
    const name = uniqueName('migrate-radio-skip');
    const pipe = await pipeSourceService.create({
      name,
      type: 'radio',
      url: 'https://example.com/migrate-skip-stream.mp3',
      reconnect: true,
      reconnectStreamed: true,
      reconnectAtEof: true,
      reconnectDelayMax: 30,
      idleThreshold: 15000,
      enabled: false,
    });
    calls.length = 0;

    const unitFilePath = `/etc/systemd/system/${getSystemdServiceName(name)}.service`;
    const restoreReadText = stubReadTextFile({
      [unitFilePath]: `ExecStartPre=/bin/bash -c 'mkfifo -m 660 ${getFifoPath(name)}'\n`,
    });
    let regenerateCalls = 0;
    const restoreRegenerate = stubProtoFn('regenerateService', async () => {
      regenerateCalls += 1;
    });

    try {
      await pipeSourceService.migrateFifoPaths();

      assert.equal(regenerateCalls, 0, 'regenerateService must NOT be called when already on the new path');
      const configCalls = calls.filter(
        c => c.kind === 'config.removeStreamSourceByFifo' || c.kind === 'config.addStreamSource',
      );
      assert.equal(configCalls.length, 0, `expected zero config calls, got: ${JSON.stringify(configCalls)}`);
    } finally {
      restoreReadText();
      restoreRegenerate();
    }
    void pipe;
  } finally {
    restorePlatform();
  }
});

test('migrateFifoPaths() migrates a radio pipe still on the old /tmp path: updates snapserver.conf and calls regenerateService()', async () => {
  const calls: Call[] = [];
  const restorePlatform = stubAllPlatformCalls(calls);
  try {
    const name = uniqueName('migrate-radio-proceed');
    const pipe = await pipeSourceService.create({
      name,
      type: 'radio',
      url: 'https://example.com/migrate-proceed-stream.mp3',
      reconnect: true,
      reconnectStreamed: true,
      reconnectAtEof: true,
      reconnectDelayMax: 30,
      idleThreshold: 15000,
      enabled: false,
    });
    calls.length = 0;

    const unitFilePath = `/etc/systemd/system/${getSystemdServiceName(name)}.service`;
    const oldFifo = oldFifoPathFor(name);
    const newFifo = getFifoPath(name);
    const restoreReadText = stubReadTextFile({
      [unitFilePath]: `ExecStartPre=/bin/bash -c 'test -p ${oldFifo} || mkfifo -m 666 ${oldFifo}'\n`,
    });
    const regenerateArgs: any[] = [];
    const restoreRegenerate = stubProtoFn('regenerateService', async (id: string) => {
      regenerateArgs.push(id);
    });

    try {
      await pipeSourceService.migrateFifoPaths();

      assert.deepEqual(regenerateArgs, [pipe.id]);

      const removeCalls = calls.filter(c => c.kind === 'config.removeStreamSourceByFifo');
      assert.equal(removeCalls.length, 1);
      assert.deepEqual(removeCalls[0].args, [oldFifo]);

      const addCalls = calls.filter(c => c.kind === 'config.addStreamSource');
      assert.equal(addCalls.length, 1);
      assert.ok((addCalls[0].args[0] as string).includes(newFifo), `expected new URI to include ${newFifo}`);
      assert.ok(!(addCalls[0].args[0] as string).includes(oldFifo), 'new URI must not reference the old path');
    } finally {
      restoreReadText();
      restoreRegenerate();
    }
  } finally {
    restorePlatform();
  }
});

test('migrateFifoPaths() skips an mpd pipe whose mpd.conf no longer references the old /tmp path (idempotent)', async () => {
  const calls: Call[] = [];
  const restorePlatform = stubAllPlatformCalls(calls);
  const restoreFs = stubFsPromises({
    access: async (p: string) => {
      if (p !== '/etc/mpd.conf') {
        const err: any = new Error('ENOENT');
        err.code = 'ENOENT';
        throw err;
      }
    },
    readFile: async () => 'existing mpd.conf content\n',
  });
  try {
    const name = uniqueName('migrate-mpd-skip');
    await pipeSourceService.create({
      name,
      type: 'mpd',
      url: '',
      reconnect: true,
      reconnectStreamed: true,
      reconnectAtEof: true,
      reconnectDelayMax: 30,
      idleThreshold: 15000,
      enabled: true,
    });
    calls.length = 0;

    const restoreReadText = stubReadTextFile({
      '/etc/mpd.conf': `audio_output {\n\ttype\t\t"fifo"\n\tpath\t\t"${getFifoPath(name)}"\n}\n`,
    });
    let writeMpdCalls = 0;
    let removeMpdCalls = 0;
    const restoreWriteMpd = stubProtoFn('writeMpdOutput', async () => {
      writeMpdCalls += 1;
    });
    const restoreRemoveMpd = stubProtoFn('removeMpdOutput', async () => {
      removeMpdCalls += 1;
    });

    try {
      await pipeSourceService.migrateFifoPaths();
      assert.equal(writeMpdCalls, 0);
      assert.equal(removeMpdCalls, 0);
    } finally {
      restoreReadText();
      restoreWriteMpd();
      restoreRemoveMpd();
    }
  } finally {
    restorePlatform();
    restoreFs();
  }
});

test('migrateFifoPaths() migrates an mpd pipe still on the old /tmp path: calls removeMpdOutput(old) then writeMpdOutput(name, new) and restarts mpd', async () => {
  const calls: Call[] = [];
  const restorePlatform = stubAllPlatformCalls(calls);
  const restoreFs = stubFsPromises({
    access: async (p: string) => {
      if (p !== '/etc/mpd.conf') {
        const err: any = new Error('ENOENT');
        err.code = 'ENOENT';
        throw err;
      }
    },
    readFile: async () => 'existing mpd.conf content\n',
  });
  try {
    const name = uniqueName('migrate-mpd-proceed');
    await pipeSourceService.create({
      name,
      type: 'mpd',
      url: '',
      reconnect: true,
      reconnectStreamed: true,
      reconnectAtEof: true,
      reconnectDelayMax: 30,
      idleThreshold: 15000,
      enabled: true,
    });
    calls.length = 0;

    const oldFifo = oldFifoPathFor(name);
    const newFifo = getFifoPath(name);
    const restoreReadText = stubReadTextFile({
      '/etc/mpd.conf': `audio_output {\n\ttype\t\t"fifo"\n\tpath\t\t"${oldFifo}"\n}\n`,
    });
    const removeArgs: any[] = [];
    const writeArgs: any[] = [];
    const restoreRemoveMpd = stubProtoFn('removeMpdOutput', async (fifo: string) => {
      removeArgs.push(fifo);
    });
    const restoreWriteMpd = stubProtoFn('writeMpdOutput', async (n: string, fifo: string) => {
      writeArgs.push([n, fifo]);
    });

    try {
      await pipeSourceService.migrateFifoPaths();

      assert.deepEqual(removeArgs, [oldFifo]);
      assert.deepEqual(writeArgs, [[name, newFifo]]);

      const mpdRestarts = calls.filter(c => c.kind === 'systemd.control' && c.args[0] === 'mpd.service' && c.args[1] === 'restart');
      assert.equal(mpdRestarts.length, 1);
    } finally {
      restoreReadText();
      restoreRemoveMpd();
      restoreWriteMpd();
    }
  } finally {
    restorePlatform();
    restoreFs();
  }
});

test('migrateFifoPaths() continues past one pipe throwing during migration and still migrates the rest, without itself throwing', async () => {
  const calls: Call[] = [];
  const restorePlatform = stubAllPlatformCalls(calls);
  try {
    const failName = uniqueName('migrate-fail-pipe');
    const okName = uniqueName('migrate-ok-pipe');
    const failPipe = await pipeSourceService.create({
      name: failName,
      type: 'radio',
      url: 'https://example.com/fail-stream.mp3',
      reconnect: true,
      reconnectStreamed: true,
      reconnectAtEof: true,
      reconnectDelayMax: 30,
      idleThreshold: 15000,
      enabled: false,
    });
    const okPipe = await pipeSourceService.create({
      name: okName,
      type: 'radio',
      url: 'https://example.com/ok-stream.mp3',
      reconnect: true,
      reconnectStreamed: true,
      reconnectAtEof: true,
      reconnectDelayMax: 30,
      idleThreshold: 15000,
      enabled: false,
    });
    calls.length = 0;

    const failUnitPath = `/etc/systemd/system/${getSystemdServiceName(failName)}.service`;
    const okUnitPath = `/etc/systemd/system/${getSystemdServiceName(okName)}.service`;
    const restoreReadText = stubReadTextFile({
      [failUnitPath]: `ExecStartPre=/bin/bash -c 'mkfifo -m 666 ${oldFifoPathFor(failName)}'\n`,
      [okUnitPath]: `ExecStartPre=/bin/bash -c 'mkfifo -m 666 ${oldFifoPathFor(okName)}'\n`,
    });
    const regenerateArgs: any[] = [];
    const restoreRegenerate = stubProtoFn('regenerateService', async (id: string) => {
      regenerateArgs.push(id);
    });
    const restoreRemoveSource = stubModuleFn(
      configModule.configService,
      'removeStreamSourceByFifo',
      async (fifo: string) => {
        calls.push({ kind: 'config.removeStreamSourceByFifo', args: [fifo] });
        if (fifo === oldFifoPathFor(failName)) {
          throw new Error('simulated snapserver.conf write failure for the failing pipe');
        }
      },
    );

    try {
      // The whole migration run must resolve (not reject) even though one
      // pipe's migration throws partway through.
      await pipeSourceService.migrateFifoPaths();

      // The failing pipe never got as far as regenerateService()...
      assert.ok(!regenerateArgs.includes(failPipe.id), 'the failing pipe must not have reached regenerateService()');
      // ...but the OK pipe, processed after it in the same loop, still did.
      assert.ok(regenerateArgs.includes(okPipe.id), 'the healthy pipe after the failing one must still be migrated');
    } finally {
      restoreReadText();
      restoreRegenerate();
      restoreRemoveSource();
    }
  } finally {
    restorePlatform();
  }
});
