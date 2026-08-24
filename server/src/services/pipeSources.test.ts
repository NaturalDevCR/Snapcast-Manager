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

import { pipeSourceService, getFifoPath, getSystemdServiceName, parseProcStatState } from '../services/pipeSources';
import * as execModule from '../platform/exec';
import { ExecError } from '../platform/exec';
import * as systemdModule from '../platform/systemd';
import * as filesModule from '../platform/files';
import * as configModule from '../services/config';
import fsPromises from 'fs/promises';
import db from '../database';
import pipeSourcesRouter from '../routes/pipeSources';

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

/** Task 26, Part 2: temporarily overrides process.platform (same pattern as
 * watchdog.test.ts's identical helper) so getZombieCount()'s
 * Linux-vs-non-Linux branch can be tested on any host this suite runs on. */
function stubPlatform(value: NodeJS.Platform): () => void {
  const original = Object.getOwnPropertyDescriptor(process, 'platform')!;
  Object.defineProperty(process, 'platform', { value, configurable: true });
  return () => {
    Object.defineProperty(process, 'platform', original);
  };
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

// ============================================================================
// Task 26, Part 2: getZombieCount() via real /proc/<pid>/stat process-state
// parsing, replacing the old `ps aux` + string-match-on-"defunct" false
// positive (matched any process whose COMMAND LINE contained that word).
// ============================================================================

// ---- parseProcStatState(): the well-known parenthesized-comm gotcha ----

/** Builds a syntactically-plausible /proc/<pid>/stat line: `pid (comm)
 * state` followed by enough trailing numeric fields to look real, matching
 * the kernel's actual field count is not required for this parser (it
 * only ever reads the state field), just the shape. */
function fakeStatLine(pid: number, comm: string, state: string): string {
  const trailingFields = Array(47).fill('0').join(' '); // ppid..the rest
  return `${pid} (${comm}) ${state} ${trailingFields}\n`;
}

test('parseProcStatState() extracts the state field from a normal /proc/pid/stat line', () => {
  assert.equal(parseProcStatState(fakeStatLine(1234, 'bash', 'S')), 'S');
});

test('parseProcStatState() returns Z for an actual zombie process', () => {
  assert.equal(parseProcStatState(fakeStatLine(5678, 'defunct-child', 'Z')), 'Z');
});

test('parseProcStatState() parses past a comm field containing spaces AND parens (the well-known /proc/pid/stat gotcha)', () => {
  // A process can rename itself (prctl(PR_SET_NAME, ...)) to something
  // containing spaces and even its own parens -- naively .split(' ') and
  // indexing would grab a fragment of the comm field instead of the real
  // state. Parsing past the LAST ')' is what makes this safe regardless of
  // what's inside the parens.
  assert.equal(parseProcStatState(fakeStatLine(9999, 'some (weird) prog', 'Z')), 'Z');
});

test('parseProcStatState() does not confuse a non-zombie state for a zombie one', () => {
  assert.equal(parseProcStatState(fakeStatLine(42, 'sleeper', 'S')), 'S');
  assert.equal(parseProcStatState(fakeStatLine(43, 'runner', 'R')), 'R');
});

test('parseProcStatState() returns \'\' (not a throw) for a malformed line with no comm parens', () => {
  assert.equal(parseProcStatState('not a real stat line at all'), '');
});

// ---- getZombieCount(): platform gating + /proc scan ----

test('getZombieCount() returns 0 without ever reading /proc on a non-Linux platform', async () => {
  const restorePlatform = stubPlatform('darwin');
  const readdirCalls: string[] = [];
  const restoreFs = stubFsPromises({
    readdir: async (p: string) => {
      readdirCalls.push(p);
      return [];
    },
  });
  try {
    const count = await pipeSourceService.getZombieCount();
    assert.equal(count, 0);
    assert.deepEqual(readdirCalls, [], 'must not touch /proc on a non-Linux platform');
  } finally {
    restoreFs();
    restorePlatform();
  }
});

test('getZombieCount() counts only zombie (Z) processes among numeric /proc entries, ignoring non-numeric ones', async () => {
  const restorePlatform = stubPlatform('linux');
  const statByPid: Record<string, string> = {
    '1': fakeStatLine(1, 'init', 'S'),
    '2': fakeStatLine(2, 'zombie-one', 'Z'),
    '3': fakeStatLine(3, 'zombie-two', 'Z'),
    '4': fakeStatLine(4, 'sleeping-thing', 'S'),
  };
  const restoreFs = stubFsPromises({
    readdir: async (p: string) => {
      assert.equal(p, '/proc');
      // 'self', 'net', 'cpuinfo' are the kind of non-numeric /proc entries
      // that must be filtered out before ever attempting to read them as a
      // PID's stat file.
      return ['1', '2', '3', '4', 'self', 'net', 'cpuinfo'];
    },
    readFile: async (p: string) => {
      const match = p.match(/^\/proc\/(\d+)\/stat$/);
      if (!match || !(match[1] in statByPid)) {
        throw Object.assign(new Error(`ENOENT: no such file or directory, open '${p}'`), { code: 'ENOENT' });
      }
      return statByPid[match[1]!]!;
    },
  });
  try {
    const count = await pipeSourceService.getZombieCount();
    assert.equal(count, 2);
  } finally {
    restoreFs();
    restorePlatform();
  }
});

test('getZombieCount() skips a PID that disappears mid-scan (ENOENT on readFile) rather than failing the whole count', async () => {
  const restorePlatform = stubPlatform('linux');
  const restoreFs = stubFsPromises({
    readdir: async () => ['1', '2'],
    readFile: async (p: string) => {
      if (p === '/proc/1/stat') {
        // Simulates the process exiting between readdir() and this
        // readFile() call -- an inherent TOCTOU race scanning /proc.
        throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      }
      return fakeStatLine(2, 'survivor', 'Z');
    },
  });
  try {
    const count = await pipeSourceService.getZombieCount();
    assert.equal(count, 1);
  } finally {
    restoreFs();
    restorePlatform();
  }
});

test('getZombieCount() returns 0 (not a throw) when fs.readdir(\'/proc\') itself fails', async () => {
  const restorePlatform = stubPlatform('linux');
  const restoreFs = stubFsPromises({
    readdir: async () => {
      throw new Error('EACCES: permission denied');
    },
  });
  try {
    const count = await pipeSourceService.getZombieCount();
    assert.equal(count, 0);
  } finally {
    restoreFs();
    restorePlatform();
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

test('migrateFifoPaths() migrates an mpd pipe still on the old /tmp path: calls writeMpdOutput(name, new) BEFORE removeMpdOutput(old), then restarts mpd', async () => {
  // Order matters here (see the Critical-finding fix in
  // migrateOnePipeFifoPath()'s mpd branch, services/pipeSources.ts): the
  // NEW block must be written before the OLD one is removed, so that a
  // failure partway through never leaves mpd.conf referencing neither
  // path. This test asserts both that the two calls happen (as the older
  // version of this test already did) AND that they happen in that exact
  // order, via one shared, order-preserving array rather than two
  // independent ones.
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
    const orderedCalls: Array<{ kind: 'write' | 'remove'; args: any[] }> = [];
    const restoreRemoveMpd = stubProtoFn('removeMpdOutput', async (fifo: string) => {
      orderedCalls.push({ kind: 'remove', args: [fifo] });
    });
    const restoreWriteMpd = stubProtoFn('writeMpdOutput', async (n: string, fifo: string) => {
      orderedCalls.push({ kind: 'write', args: [n, fifo] });
    });

    try {
      await pipeSourceService.migrateFifoPaths();

      assert.deepEqual(
        orderedCalls,
        [
          { kind: 'write', args: [name, newFifo] },
          { kind: 'remove', args: [oldFifo] },
        ],
        'writeMpdOutput(new) must run BEFORE removeMpdOutput(old), not after',
      );

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

// ============================================================================
// Critical review finding fix (Task 7 follow-up): migrateOnePipeFifoPath()'s
// mpd branch used to call removeMpdOutput(oldFifo) BEFORE
// writeMpdOutput(name, newFifo). If the write then failed, mpd.conf ended up
// with NEITHER block, and detection (`content.includes(oldFifo)`) would
// wrongly conclude "already migrated" forever, permanently and silently
// losing the MPD audio output. The fix reorders to write-then-remove. These
// two tests exercise the REAL writeMpdOutput()/removeMpdOutput()
// implementations (not stubbed) against a single stateful fake mpd.conf, so
// they prove actual file-content convergence, not just call order.
// ============================================================================

test(
  'migrateOnePipeFifoPath() (mpd): removeMpdOutput failing AFTER writeMpdOutput succeeded leaves BOTH blocks ' +
  'present (old still detected, safe retry converges to just the new block)',
  async () => {
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
      const name = uniqueName('migrate-mpd-partial-fail');
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

      // A single mutable "disk" that both migrateOnePipeFifoPath()'s own
      // detection (readTextFile) and the real writeMpdOutput()/
      // removeMpdOutput() (via fs.readFile + installPrivilegedFile) read
      // from and write to -- starts on the OLD path only, as a real
      // pre-Task-7 installation's mpd.conf would.
      let mpdConfContent = `audio_output {\n\ttype\t\t"fifo"\n\tname\t\t"${name}"\n\tpath\t\t"${oldFifo}"\n}\n`;

      const restoreReadText = stubModuleFn(filesModule, 'readTextFile', async (p: string) => {
        if (p === '/etc/mpd.conf') return mpdConfContent;
        const err: any = new Error(`ENOENT: no such file or directory, open '${p}'`);
        err.code = 'ENOENT';
        throw err;
      });
      const restoreFsRead = stubModuleFn(fsPromises, 'readFile', async (p: string) => {
        if (p === '/etc/mpd.conf') return mpdConfContent;
        const err: any = new Error('ENOENT');
        err.code = 'ENOENT';
        throw err;
      });

      let installCallCount = 0;
      // One-shot: only the 2nd installPrivilegedFile call EVER (removeMpdOutput's
      // write, since writeMpdOutput's is 1st per the fix) fails. Using a
      // separate flag (rather than re-testing installCallCount, which gets
      // reset to count run 2's calls too) means run 2 genuinely succeeds
      // end-to-end instead of hitting the same simulated failure again.
      let failNextRemoveWrite = true;
      const restoreInstall = stubModuleFn(filesModule, 'installPrivilegedFile', async (destPath: string, content: string) => {
        installCallCount += 1;
        if (installCallCount === 2 && failNextRemoveWrite) {
          failNextRemoveWrite = false;
          // The 2nd installPrivilegedFile call in a migration run is
          // removeMpdOutput's write (writeMpdOutput's is 1st, per the fix).
          // Simulate it failing AFTER the 1st (write) already succeeded.
          throw new Error('simulated failure removing the old mpd.conf block');
        }
        mpdConfContent = content;
      });

      try {
        // Run 1: writeMpdOutput (install #1) succeeds and adds the NEW
        // block; removeMpdOutput (install #2) throws before removing the
        // OLD block. migrateFifoPaths()'s per-pipe try/catch swallows it
        // and does not throw.
        await pipeSourceService.migrateFifoPaths();

        assert.equal(installCallCount, 2, 'expected both the write and the (failing) remove to have been attempted');
        assert.ok(mpdConfContent.includes(oldFifo), 'old block must still be present after the failed remove');
        assert.ok(mpdConfContent.includes(newFifo), 'new block must have been written before the failure');

        // Detection must still see the old path present -- this is exactly
        // what the reorder fix guarantees: the OLD order could leave
        // NEITHER block present, and detection would wrongly conclude
        // "already migrated", permanently losing this pipe's MPD output.
        const contentAfterPartialFailure = await filesModule.readTextFile('/etc/mpd.conf');
        assert.ok(contentAfterPartialFailure.includes(oldFifo), 'detection must still see the old path after a partial failure');

        // Run 2: installPrivilegedFile now succeeds normally. Migration
        // must proceed again (old path still detected) and fully converge
        // this time to just the new block.
        installCallCount = 0;
        await pipeSourceService.migrateFifoPaths();

        assert.equal(installCallCount, 2, 'expected the successful retry to write the new block and remove the old one');
        assert.ok(!mpdConfContent.includes(oldFifo), 'old block must be gone after the successful retry converges');
        assert.ok(mpdConfContent.includes(newFifo), 'new block must still be present after the successful retry');
      } finally {
        restoreReadText();
        restoreFsRead();
        restoreInstall();
      }
    } finally {
      restorePlatform();
      restoreFs();
    }
  },
);

test(
  'migrateOnePipeFifoPath() (mpd): writeMpdOutput failing on the FIRST step leaves mpd.conf untouched and the ' +
  'old path still correctly detected as needing migration',
  async () => {
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
      const name = uniqueName('migrate-mpd-write-fail');
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
      const originalContent = `audio_output {\n\ttype\t\t"fifo"\n\tname\t\t"${name}"\n\tpath\t\t"${oldFifo}"\n}\n`;
      let mpdConfContent = originalContent;

      const restoreReadText = stubModuleFn(filesModule, 'readTextFile', async (p: string) => {
        if (p === '/etc/mpd.conf') return mpdConfContent;
        const err: any = new Error(`ENOENT: no such file or directory, open '${p}'`);
        err.code = 'ENOENT';
        throw err;
      });
      const restoreFsRead = stubModuleFn(fsPromises, 'readFile', async (p: string) => {
        if (p === '/etc/mpd.conf') return mpdConfContent;
        const err: any = new Error('ENOENT');
        err.code = 'ENOENT';
        throw err;
      });

      let installCallCount = 0;
      // One-shot: only the 1st installPrivilegedFile call EVER (writeMpdOutput's
      // write, per the fix) fails. See the sibling test above for why a
      // separate flag (not just re-testing installCallCount, which resets
      // per run) is needed for run 2 to genuinely succeed.
      let failNextWrite = true;
      const restoreInstall = stubModuleFn(filesModule, 'installPrivilegedFile', async (destPath: string, content: string) => {
        installCallCount += 1;
        if (installCallCount === 1 && failNextWrite) {
          failNextWrite = false;
          // The very first install call in a migration run is now
          // writeMpdOutput's (per the fix) -- simulate IT failing, the
          // case that used to be silently fine under the old order too,
          // confirmed still fine here.
          throw new Error('simulated mpd.conf write failure on the first step');
        }
        mpdConfContent = content;
      });

      try {
        await pipeSourceService.migrateFifoPaths();

        assert.equal(installCallCount, 1, 'removeMpdOutput must never be reached when writeMpdOutput itself fails first');
        assert.equal(mpdConfContent, originalContent, 'mpd.conf must be completely untouched when the first step fails');
        assert.ok(!mpdConfContent.includes(newFifo), 'the new block must never have been written');

        const contentAfterFailure = await filesModule.readTextFile('/etc/mpd.conf');
        assert.ok(contentAfterFailure.includes(oldFifo), 'detection must still see the old path needing migration');

        // A subsequent successful run still converges normally.
        installCallCount = 0;
        await pipeSourceService.migrateFifoPaths();
        assert.equal(installCallCount, 2, 'expected the successful retry to write the new block and remove the old one');
        assert.ok(!mpdConfContent.includes(oldFifo));
        assert.ok(mpdConfContent.includes(newFifo));
      } finally {
        restoreReadText();
        restoreFsRead();
        restoreInstall();
      }
    } finally {
      restorePlatform();
      restoreFs();
    }
  },
);

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

// ============================================================================
// Task 14: PUT /api/pipe-sources/:id/config hardening --
//   1. systemd-analyze verify (radio only) before installing new content
//   2. reject unexpected top-level unit-file sections (radio only)
//   3. backup previous content + rollbackConfig()
// ============================================================================

/** Creates a radio-type pipe with the shared platform stub already active,
 * then clears `calls` so each test only sees setConfigContent()'s own
 * platform activity. */
async function createRadioPipeForConfigTests(namePrefix: string, calls: Call[]) {
  const name = uniqueName(namePrefix);
  const pipe = await pipeSourceService.create({
    name,
    type: 'radio',
    url: 'https://example.com/task14-stream.mp3',
    reconnect: true,
    reconnectStreamed: true,
    reconnectAtEof: true,
    reconnectDelayMax: 30,
    idleThreshold: 15000,
    enabled: false,
  });
  calls.length = 0;
  return pipe;
}

const VALID_RADIO_UNIT = `[Unit]
Description=hand-edited

[Service]
Type=simple
ExecStart=/usr/bin/ffmpeg -i "https://example.com/x.mp3" -f s16le -

[Install]
WantedBy=multi-user.target
`;

function getBackupRow(pipeId: string): { pipe_id: string; content: string; saved_at: string } | undefined {
  return db.prepare('SELECT * FROM pipe_source_config_backup WHERE pipe_id = ?').get(pipeId) as any;
}

// ---- 1a. systemd-analyze verify: valid content (exit 0) -> proceeds ----

test('setConfigContent() (radio): valid content passes systemd-analyze verify (exit 0) and installs', async () => {
  const calls: Call[] = [];
  const restorePlatform = stubAllPlatformCalls(calls);
  try {
    const pipe = await createRadioPipeForConfigTests('task14-verify-valid', calls);

    await pipeSourceService.setConfigContent(pipe.id, VALID_RADIO_UNIT);

    const verifyCalls = calls.filter(c => c.kind === 'exec.run' && c.args[0] === 'systemd-analyze');
    assert.equal(verifyCalls.length, 1);
    assert.equal(verifyCalls[0].args[1][0], 'verify');
    // Argv-based -- the candidate content was written to an fs.mkdtemp-based
    // temp file, never interpolated into a shell string.
    assert.ok(typeof verifyCalls[0].args[1][1] === 'string' && verifyCalls[0].args[1][1].length > 0);

    const installCalls = calls.filter(c => c.kind === 'files.installPrivilegedFile');
    assert.equal(installCalls.length, 1);
    assert.equal(installCalls[0].args[1], VALID_RADIO_UNIT);
  } finally {
    restorePlatform();
  }
});

// ---- 1b. systemd-analyze verify: non-zero exit with real output -> INVALID, rejected ----

test('setConfigContent() (radio): systemd-analyze verify non-zero exit REJECTS the call with the verifier output, and never installs/reloads/restarts', async () => {
  const calls: Call[] = [];
  const restorePlatform = stubAllPlatformCalls(calls);
  const restoreRun = stubModuleFn(execModule, 'run', async (bin: string, args: string[]) => {
    calls.push({ kind: 'exec.run', args: [bin, args] });
    if (bin === 'systemd-analyze') {
      throw new ExecError(
        'systemd-analyze',
        args,
        1,
        '',
        '/tmp/foo.service:5: Failed to parse service type, ignoring: bogus\n',
      );
    }
    return { stdout: '', stderr: '' };
  });
  try {
    const pipe = await createRadioPipeForConfigTests('task14-verify-invalid', calls);

    await assert.rejects(
      () => pipeSourceService.setConfigContent(pipe.id, VALID_RADIO_UNIT),
      /Failed to parse service type/,
    );

    const installCalls = calls.filter(c => c.kind === 'files.installPrivilegedFile');
    assert.equal(installCalls.length, 0, 'installPrivilegedFile must NEVER be called when verification fails');
    const reloadCalls = calls.filter(c => c.kind === 'systemd.daemonReload');
    assert.equal(reloadCalls.length, 0, 'daemonReload must NEVER be called when verification fails');
    const controlCalls = calls.filter(c => c.kind === 'systemd.control');
    assert.equal(controlCalls.length, 0, 'systemdControl must NEVER be called when verification fails');
  } finally {
    restorePlatform();
    restoreRun();
  }
});

// ---- 1c. systemd-analyze missing (ENOENT-style spawn failure, exitCode null) -> warn + proceed ----

test('setConfigContent() (radio): systemd-analyze missing (ExecError exitCode: null) logs a warning and PROCEEDS to install anyway', async () => {
  const calls: Call[] = [];
  const restorePlatform = stubAllPlatformCalls(calls);
  const restoreRun = stubModuleFn(execModule, 'run', async (bin: string, args: string[]) => {
    calls.push({ kind: 'exec.run', args: [bin, args] });
    if (bin === 'systemd-analyze') {
      throw new ExecError('systemd-analyze', args, null, '', '');
    }
    return { stdout: '', stderr: '' };
  });
  const warnCalls: any[] = [];
  const originalWarn = console.warn;
  console.warn = (...args: any[]) => { warnCalls.push(args); };
  try {
    const pipe = await createRadioPipeForConfigTests('task14-verify-missing', calls);

    // Must NOT throw -- graceful degradation, same pattern as watchdog.ts's
    // macOS lsof fallback and apt.ts's isInstalled() exitCode===null rethrow
    // (mirrored here as "proceed", since this is a missing-tool fallback,
    // not a real execution failure of the file operation itself).
    await pipeSourceService.setConfigContent(pipe.id, VALID_RADIO_UNIT);

    assert.ok(warnCalls.length > 0, 'expected a warning to be logged when systemd-analyze is unavailable');

    const installCalls = calls.filter(c => c.kind === 'files.installPrivilegedFile');
    assert.equal(installCalls.length, 1, 'install must still proceed when the verifier tool itself is missing');
  } finally {
    console.warn = originalWarn;
    restorePlatform();
    restoreRun();
  }
});

// ---- 2. section allowlist ----

test('setConfigContent() (radio): content with an unexpected [Timer] section is rejected BEFORE systemd-analyze even runs, and never installs', async () => {
  const calls: Call[] = [];
  const restorePlatform = stubAllPlatformCalls(calls);
  try {
    const pipe = await createRadioPipeForConfigTests('task14-section-timer', calls);
    const badContent = `[Unit]
Description=smuggled timer

[Service]
ExecStart=/usr/bin/ffmpeg -i "https://example.com/x.mp3" -f s16le -

[Timer]
OnCalendar=daily

[Install]
WantedBy=multi-user.target
`;

    await assert.rejects(
      () => pipeSourceService.setConfigContent(pipe.id, badContent),
      /Timer/,
    );

    const verifyCalls = calls.filter(c => c.kind === 'exec.run' && c.args[0] === 'systemd-analyze');
    assert.equal(verifyCalls.length, 0, 'systemd-analyze must not even be invoked when the section check rejects first');
    const installCalls = calls.filter(c => c.kind === 'files.installPrivilegedFile');
    assert.equal(installCalls.length, 0);
  } finally {
    restorePlatform();
  }
});

test('setConfigContent() (radio): content with only [Unit]/[Service]/[Install], however unusual its directives, passes the section check', async () => {
  const calls: Call[] = [];
  const restorePlatform = stubAllPlatformCalls(calls);
  try {
    const pipe = await createRadioPipeForConfigTests('task14-section-ok', calls);
    const unusualButAllowed = `[Unit]
Description=weird but legal

[Service]
Type=simple
User=someone
Restart=on-failure
RestartSec=17
ExecStart=/usr/bin/ffmpeg -i "https://example.com/x.mp3" -f s16le -

[Install]
WantedBy=multi-user.target
`;

    await pipeSourceService.setConfigContent(pipe.id, unusualButAllowed);

    const installCalls = calls.filter(c => c.kind === 'files.installPrivilegedFile');
    assert.equal(installCalls.length, 1, 'directive freedom within allowed sections must not be restricted');
  } finally {
    restorePlatform();
  }
});

// ---- 3a. backup-then-install sequence ----

test('setConfigContent() (radio): saves the PRE-edit on-disk content to pipe_source_config_backup before installing the new content', async () => {
  const calls: Call[] = [];
  const restorePlatform = stubAllPlatformCalls(calls);
  try {
    const pipe = await createRadioPipeForConfigTests('task14-backup-existing', calls);
    const oldContent = '[Unit]\nDescription=the OLD content\n';
    const destPath = `/etc/systemd/system/${getSystemdServiceName(pipe.name)}.service`;
    const restoreFs = stubFsPromises({
      readFile: async (p: string) => {
        if (p === destPath) return oldContent;
        throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      },
    });
    try {
      await pipeSourceService.setConfigContent(pipe.id, VALID_RADIO_UNIT);

      const row = getBackupRow(pipe.id);
      assert.ok(row, 'expected a backup row to have been written');
      assert.equal(row!.content, oldContent);

      const installCalls = calls.filter(c => c.kind === 'files.installPrivilegedFile');
      assert.equal(installCalls.length, 1);
      assert.equal(installCalls[0].args[1], VALID_RADIO_UNIT, 'the NEW content, not the backed-up one, must be installed');
    } finally {
      restoreFs();
    }
  } finally {
    restorePlatform();
  }
});

test('setConfigContent() (radio): a first-time edit (no prior on-disk file) skips the backup step cleanly, without erroring', async () => {
  const calls: Call[] = [];
  const restorePlatform = stubAllPlatformCalls(calls);
  try {
    const pipe = await createRadioPipeForConfigTests('task14-backup-firsttime', calls);
    // No fs stub -- the real fs.readFile() genuinely ENOENTs against this
    // never-actually-written path, exercising the real "getConfigContent()
    // throws" path setConfigContent() must tolerate.
    await pipeSourceService.setConfigContent(pipe.id, VALID_RADIO_UNIT);

    const row = getBackupRow(pipe.id);
    assert.equal(row, undefined, 'no backup row should exist for a first-time edit with nothing to preserve');

    const installCalls = calls.filter(c => c.kind === 'files.installPrivilegedFile');
    assert.equal(installCalls.length, 1, 'the new content must still install even though backup was skipped');
  } finally {
    restorePlatform();
  }
});

test('setConfigContent() upserts the backup row (a SECOND edit overwrites the first backup, not a growing history)', async () => {
  const calls: Call[] = [];
  const restorePlatform = stubAllPlatformCalls(calls);
  try {
    const pipe = await createRadioPipeForConfigTests('task14-backup-upsert', calls);
    const destPath = `/etc/systemd/system/${getSystemdServiceName(pipe.name)}.service`;
    let currentOnDisk = '[Unit]\nDescription=version A\n';
    const restoreFs = stubFsPromises({
      readFile: async (p: string) => {
        if (p === destPath) return currentOnDisk;
        throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      },
    });
    try {
      await pipeSourceService.setConfigContent(pipe.id, '[Unit]\nDescription=version B\n');
      assert.equal(getBackupRow(pipe.id)!.content, '[Unit]\nDescription=version A\n');

      currentOnDisk = '[Unit]\nDescription=version B\n';
      await pipeSourceService.setConfigContent(pipe.id, '[Unit]\nDescription=version C\n');
      assert.equal(getBackupRow(pipe.id)!.content, '[Unit]\nDescription=version B\n');

      const allRows = db.prepare('SELECT * FROM pipe_source_config_backup WHERE pipe_id = ?').all(pipe.id);
      assert.equal(allRows.length, 1, 'exactly one backup slot per pipe -- never a growing history');
    } finally {
      restoreFs();
    }
  } finally {
    restorePlatform();
  }
});

test('setConfigContent() (mpd): the backup/rollback mechanism applies to the mpd branch too (no systemd-analyze/section-check involved)', async () => {
  const calls: Call[] = [];
  const restorePlatform = stubAllPlatformCalls(calls);
  try {
    const name = uniqueName('task14-backup-mpd');
    const restoreCreateFs = stubFsPromises({
      access: async (p: string) => {
        if (p !== '/etc/mpd.conf') throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      },
      readFile: async () => 'existing mpd.conf content\n',
    });
    const pipe = await pipeSourceService.create({
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
    restoreCreateFs();
    calls.length = 0;

    const fifoPath = getFifoPath(name);
    const oldBlock = `audio_output {\n\ttype\t\t"fifo"\n\tname\t\t"${name}"\n\tpath\t\t"${fifoPath}"\n\tformat\t\t"48000:16:2"\n\tmixer_type\t"null"\n}`;
    const mpdConfWithBlock = `some other config\n\n${oldBlock}\n`;
    const restoreFs = stubFsPromises({
      access: async (p: string) => {
        if (p !== '/etc/mpd.conf') throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      },
      readFile: async () => mpdConfWithBlock,
    });
    try {
      await pipeSourceService.setConfigContent(pipe.id, 'new audio_output block content');

      const row = getBackupRow(pipe.id);
      assert.ok(row, 'expected a backup row for the mpd branch too');
      assert.equal(row!.content, oldBlock, 'the backed-up content is the pre-edit audio_output block, extracted the same way getConfigContent() does');

      const verifyCalls = calls.filter(c => c.kind === 'exec.run' && c.args[0] === 'systemd-analyze');
      assert.equal(verifyCalls.length, 0, 'mpd content is not systemd unit syntax -- systemd-analyze must never run for it');
    } finally {
      restoreFs();
    }
  } finally {
    restorePlatform();
  }
});

// ---- 3b. rollbackConfig() ----

test('rollbackConfig(): throws a clear error and attempts no writes when there is no backup for this pipe', async () => {
  const calls: Call[] = [];
  const restorePlatform = stubAllPlatformCalls(calls);
  try {
    const pipe = await createRadioPipeForConfigTests('task14-rollback-none', calls);

    await assert.rejects(
      () => pipeSourceService.rollbackConfig(pipe.id),
      /No previous version to roll back to/,
    );

    assert.equal(calls.filter(c => c.kind === 'files.installPrivilegedFile').length, 0);
    assert.equal(calls.filter(c => c.kind === 'exec.run').length, 0);
  } finally {
    restorePlatform();
  }
});

test('rollbackConfig(): when a backup exists, routes through setConfigContent() with the backed-up content (full verify/section-check path reused)', async () => {
  const calls: Call[] = [];
  const restorePlatform = stubAllPlatformCalls(calls);
  try {
    const pipe = await createRadioPipeForConfigTests('task14-rollback-exists', calls);
    const backedUpContent = '[Unit]\nDescription=the version to restore\n';
    db.prepare(`
      INSERT INTO pipe_source_config_backup (pipe_id, content, saved_at)
      VALUES (?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(pipe_id) DO UPDATE SET content = excluded.content, saved_at = excluded.saved_at
    `).run(pipe.id, backedUpContent);

    const setConfigCalls: any[] = [];
    const restoreSetConfig = stubProtoFn('setConfigContent', async function (this: any, id: string, content: string) {
      setConfigCalls.push([id, content]);
    });
    try {
      await pipeSourceService.rollbackConfig(pipe.id);
      assert.deepEqual(setConfigCalls, [[pipe.id, backedUpContent]]);
    } finally {
      restoreSetConfig();
    }
  } finally {
    restorePlatform();
  }
});

test('rollbackConfig(): undo/redo falls out naturally -- a second rollback restores what a first rollback replaced', async () => {
  const calls: Call[] = [];
  const restorePlatform = stubAllPlatformCalls(calls);
  try {
    const pipe = await createRadioPipeForConfigTests('task14-rollback-undoredo', calls);
    const destPath = `/etc/systemd/system/${getSystemdServiceName(pipe.name)}.service`;
    let currentOnDisk = '[Unit]\nDescription=version ONE\n';
    const restoreFs = stubFsPromises({
      readFile: async (p: string) => {
        if (p === destPath) return currentOnDisk;
        throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      },
    });
    try {
      // Edit 1 -> ONE backed up, TWO installed.
      await pipeSourceService.setConfigContent(pipe.id, '[Unit]\nDescription=version TWO\n');
      currentOnDisk = '[Unit]\nDescription=version TWO\n';
      assert.equal(getBackupRow(pipe.id)!.content, '[Unit]\nDescription=version ONE\n');

      // Rollback 1 -> installs ONE (undo), backs up TWO in the process.
      await pipeSourceService.rollbackConfig(pipe.id);
      const installCallsAfterFirstRollback = calls.filter(c => c.kind === 'files.installPrivilegedFile');
      assert.equal(
        installCallsAfterFirstRollback[installCallsAfterFirstRollback.length - 1].args[1],
        '[Unit]\nDescription=version ONE\n',
      );
      currentOnDisk = '[Unit]\nDescription=version ONE\n';
      assert.equal(getBackupRow(pipe.id)!.content, '[Unit]\nDescription=version TWO\n');

      // Rollback 2 (redo) -> installs TWO again.
      await pipeSourceService.rollbackConfig(pipe.id);
      const installCallsAfterSecondRollback = calls.filter(c => c.kind === 'files.installPrivilegedFile');
      assert.equal(
        installCallsAfterSecondRollback[installCallsAfterSecondRollback.length - 1].args[1],
        '[Unit]\nDescription=version TWO\n',
      );
    } finally {
      restoreFs();
    }
  } finally {
    restorePlatform();
  }
});

// ---- 3c. route: POST /:id/config/rollback ----

/** Finds a specific route's terminal handler function directly on the
 * router's internal stack and invokes it, bypassing the router.use()
 * middleware chain (authenticateToken) entirely -- this codebase has no
 * existing supertest-style HTTP route-test harness (routes are otherwise
 * untested at the HTTP layer), and adding one is out of scope for this
 * task / would need a new dependency. This still exercises the REAL route
 * handler function exported by routes/pipeSources.ts, just invoked
 * directly with fake req/res instead of through a live HTTP server. */
function getRouteHandler(router: any, method: 'get' | 'post' | 'put' | 'delete', routePath: string) {
  const layer = router.stack.find(
    (l: any) => l.route && l.route.path === routePath && l.route.methods[method],
  );
  if (!layer) throw new Error(`Route ${method.toUpperCase()} ${routePath} not found on router`);
  return layer.route.stack[0].handle as (req: any, res: any) => Promise<void> | void;
}

function fakeRes() {
  const res: any = { statusCode: 200, body: undefined };
  res.status = (code: number) => { res.statusCode = code; return res; };
  res.json = (body: any) => { res.body = body; return res; };
  return res;
}

test('POST /:id/config/rollback maps "no previous version" to 404', async () => {
  const handler = getRouteHandler(pipeSourcesRouter, 'post', '/:id/config/rollback');
  const restoreRollback = stubModuleFn(pipeSourceService, 'rollbackConfig', async () => {
    throw new Error('No previous version to roll back to');
  });
  try {
    const req: any = { params: { id: 'some-pipe-id' }, body: {} };
    const res = fakeRes();
    await handler(req, res);
    assert.equal(res.statusCode, 404);
    assert.match(res.body.error, /No previous version to roll back to/);
  } finally {
    restoreRollback();
  }
});

test('POST /:id/config/rollback returns 200 with a clear message on success', async () => {
  const handler = getRouteHandler(pipeSourcesRouter, 'post', '/:id/config/rollback');
  const rollbackCalls: string[] = [];
  const restoreRollback = stubModuleFn(pipeSourceService, 'rollbackConfig', async (id: string) => {
    rollbackCalls.push(id);
  });
  try {
    const req: any = { params: { id: 'some-pipe-id' }, body: {} };
    const res = fakeRes();
    await handler(req, res);
    assert.equal(res.statusCode, 200);
    assert.ok(res.body && res.body.ok !== false);
    assert.ok(typeof res.body.message === 'string' && res.body.message.length > 0);
    assert.deepEqual(rollbackCalls, ['some-pipe-id']);
  } finally {
    restoreRollback();
  }
});

// ============================================================================
// Task 26, Part 3: pipe-source slug-collision prevention.
//   1. create()/adopt() reject a name whose slug would be empty.
//   2. create()/adopt() reject a name that collides (after slugging) with
//      an EXISTING pipe source's name -- both for identical raw names and
//      for names that only collide after slugging.
//   3. routes/pipeSources.ts maps both validation failures to 400, not 500.
//   4. scanForSlugCollisions() detects (without mutating) a collision that
//      already existed before this validation shipped.
// ============================================================================

let rawIdCounter = 0;
/** Direct SQL insert, bypassing pipeSourceService.create()'s validation
 * entirely -- used only to simulate a pre-existing install that already
 * has colliding names (which the NEW create()/adopt() validation would now
 * reject, so it can no longer be reached through the service). Returns the
 * generated id. */
function insertRawPipeRow(name: string): string {
  rawIdCounter += 1;
  const id = `raw-pipe-${rawIdCounter}-${Date.now()}`;
  db.prepare(`
    INSERT INTO radio_pipe_streams (id, name, type, url, reconnect, reconnect_streamed, reconnect_at_eof, reconnect_delay_max, idle_threshold, enabled)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, name, 'radio', 'https://example.com/raw-stream.mp3', 1, 1, 1, 30, 15000, 1);
  return id;
}

function baseCreateInput(overrides: Partial<any> = {}) {
  return {
    name: uniqueName('slug-test'),
    type: 'radio' as const,
    url: 'https://example.com/slug-test-stream.mp3',
    reconnect: true,
    reconnectStreamed: true,
    reconnectAtEof: true,
    reconnectDelayMax: 30,
    idleThreshold: 15000,
    enabled: true,
    ...overrides,
  };
}

// ---- create(): empty-slug rejection ----

test('create() rejects a name whose slug would be empty, before any DB row or platform call', async () => {
  const calls: Call[] = [];
  const restorePlatform = stubAllPlatformCalls(calls);
  try {
    await assert.rejects(
      () => pipeSourceService.create(baseCreateInput({ name: '!!!' })),
      /has no alphanumeric characters/,
    );
    assert.equal(calls.length, 0, `expected zero platform calls, got: ${JSON.stringify(calls)}`);
    assert.equal(pipeSourceService.list().find((p: any) => p.name === '!!!'), undefined);
  } finally {
    restorePlatform();
  }
});

// ---- create(): slug-collision rejection ----

test('create() rejects a name IDENTICAL to an existing pipe source\'s name', async () => {
  const calls: Call[] = [];
  const restorePlatform = stubAllPlatformCalls(calls);
  try {
    const existingName = uniqueName('slug-collision-identical');
    await pipeSourceService.create(baseCreateInput({ name: existingName }));
    calls.length = 0;

    await assert.rejects(
      () => pipeSourceService.create(baseCreateInput({ name: existingName })),
      /conflicting name already exists/,
    );
    assert.equal(calls.length, 0, `expected zero platform calls for the rejected create(), got: ${JSON.stringify(calls)}`);
    assert.equal(pipeSourceService.list().filter((p: any) => p.name === existingName).length, 1);
  } finally {
    restorePlatform();
  }
});

test('create() rejects a name that only collides with an existing one AFTER slugging (different raw strings)', async () => {
  const calls: Call[] = [];
  const restorePlatform = stubAllPlatformCalls(calls);
  try {
    const base = uniqueName('collide-base');
    const nameA = `My ${base}`;
    const nameB = nameA.toLowerCase().replace(/\s+/g, '-'); // e.g. "My Radio 1 ..." -> "my-radio-1-..."
    await pipeSourceService.create(baseCreateInput({ name: nameA }));
    calls.length = 0;

    await assert.rejects(
      () => pipeSourceService.create(baseCreateInput({ name: nameB })),
      /conflicting name already exists/,
    );
    assert.equal(calls.length, 0, `expected zero platform calls, got: ${JSON.stringify(calls)}`);
    assert.equal(pipeSourceService.list().find((p: any) => p.name === nameB), undefined);
  } finally {
    restorePlatform();
  }
});

test('create() accepts two names that are merely similar but slug DIFFERENTLY (sanity check -- not over-rejecting)', async () => {
  const calls: Call[] = [];
  const restorePlatform = stubAllPlatformCalls(calls);
  try {
    const base = uniqueName('distinct-slugs');
    const pipeA = await pipeSourceService.create(baseCreateInput({ name: `${base} Alpha` }));
    const pipeB = await pipeSourceService.create(baseCreateInput({ name: `${base} Beta` }));
    assert.notEqual(pipeA.id, pipeB.id);
  } finally {
    restorePlatform();
  }
});

// ---- adopt(): empty-slug and slug-collision rejection ----

test('adopt() rejects a name whose slug would be empty, before any DB row or platform call', async () => {
  const calls: Call[] = [];
  const restorePlatform = stubAllPlatformCalls(calls);
  try {
    await assert.rejects(
      () => pipeSourceService.adopt(baseAdoptInput({ name: '###' })),
      /has no alphanumeric characters/,
    );
    assert.equal(calls.length, 0, `expected zero platform calls, got: ${JSON.stringify(calls)}`);
    assert.equal(pipeSourceService.list().find((p: any) => p.name === '###'), undefined);
  } finally {
    restorePlatform();
  }
});

test('adopt() rejects a name that collides (after slugging) with an existing pipe source', async () => {
  const calls: Call[] = [];
  const restorePlatform = stubAllPlatformCalls(calls);
  try {
    const base = uniqueName('adopt-collide-base');
    const nameA = `Adopt ${base}`;
    const nameB = nameA.toLowerCase().replace(/\s+/g, '-');
    await pipeSourceService.create(baseCreateInput({ name: nameA }));
    calls.length = 0;

    await assert.rejects(
      () => pipeSourceService.adopt(baseAdoptInput({ name: nameB })),
      /conflicting name already exists/,
    );
    assert.equal(calls.length, 0, `expected zero platform calls, got: ${JSON.stringify(calls)}`);
    assert.equal(pipeSourceService.list().find((p: any) => p.name === nameB), undefined);
  } finally {
    restorePlatform();
  }
});

// ---- routes/pipeSources.ts: validation errors map to 400, not 500 ----

test('POST /api/pipe-sources maps an empty-slug validation error to 400, not 500', async () => {
  const handler = getRouteHandler(pipeSourcesRouter, 'post', '/');
  const restoreCreate = stubModuleFn(pipeSourceService, 'create', async () => {
    throw new Error('Pipe source name "!!!" has no alphanumeric characters -- choose a different name.');
  });
  try {
    const req: any = { validated: { body: baseCreateInput({ name: '!!!' }) } };
    const res = fakeRes();
    await handler(req, res);
    assert.equal(res.statusCode, 400);
  } finally {
    restoreCreate();
  }
});

test('POST /api/pipe-sources maps a slug-collision validation error to 400, not 500', async () => {
  const handler = getRouteHandler(pipeSourcesRouter, 'post', '/');
  const restoreCreate = stubModuleFn(pipeSourceService, 'create', async () => {
    throw new Error('A pipe source with a conflicting name already exists: "x" and "y" both slug the same.');
  });
  try {
    const req: any = { validated: { body: baseCreateInput() } };
    const res = fakeRes();
    await handler(req, res);
    assert.equal(res.statusCode, 400);
  } finally {
    restoreCreate();
  }
});

test('POST /api/pipe-sources/adopt maps a slug-collision validation error to 400, not 500', async () => {
  const handler = getRouteHandler(pipeSourcesRouter, 'post', '/adopt');
  const restoreAdopt = stubModuleFn(pipeSourceService, 'adopt', async () => {
    throw new Error('A pipe source with a conflicting name already exists: "x" and "y" both slug the same.');
  });
  try {
    const req: any = { validated: { body: baseAdoptInput() } };
    const res = fakeRes();
    await handler(req, res);
    assert.equal(res.statusCode, 400);
  } finally {
    restoreAdopt();
  }
});

// ---- scanForSlugCollisions(): startup detection-only scan (Task 7 style) ----

test('scanForSlugCollisions() detects and logs a pre-existing collision without crashing or mutating data', async () => {
  const uniquePart = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const nameA = `Scan Collide ${uniquePart}`;
  const nameB = nameA.toLowerCase().replace(/\s+/g, '-');
  const idA = insertRawPipeRow(nameA);
  const idB = insertRawPipeRow(nameB);

  const warnCalls: any[] = [];
  const originalWarn = console.warn;
  console.warn = (...args: any[]) => { warnCalls.push(args); };
  try {
    await pipeSourceService.scanForSlugCollisions();

    assert.ok(warnCalls.length > 0, 'expected a warning to be logged for the colliding pair');
    const loggedText = warnCalls.map(args => args.join(' ')).join('\n');
    assert.ok(loggedText.includes(nameA), `expected the warning to name "${nameA}"`);
    assert.ok(loggedText.includes(nameB), `expected the warning to name "${nameB}"`);

    // Detection-only: neither row was touched -- both names/ids unchanged.
    assert.equal(pipeSourceService.getById(idA)?.name, nameA);
    assert.equal(pipeSourceService.getById(idB)?.name, nameB);
  } finally {
    console.warn = originalWarn;
  }
});

test('scanForSlugCollisions() does not warn about pipe sources whose slugs are all distinct', async () => {
  const uniquePart = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const nameA = `Totally Distinct A ${uniquePart}`;
  const nameB = `Totally Distinct B ${uniquePart}`;
  insertRawPipeRow(nameA);
  insertRawPipeRow(nameB);

  const warnCalls: any[] = [];
  const originalWarn = console.warn;
  console.warn = (...args: any[]) => { warnCalls.push(args); };
  try {
    await pipeSourceService.scanForSlugCollisions();
    const loggedText = warnCalls.map(args => args.join(' ')).join('\n');
    assert.ok(!loggedText.includes(nameA), 'distinct-slug name A must not appear in any collision warning');
    assert.ok(!loggedText.includes(nameB), 'distinct-slug name B must not appear in any collision warning');
  } finally {
    console.warn = originalWarn;
  }
});

test('scanForSlugCollisions() never throws, even if list() itself fails', async () => {
  const restoreList = stubModuleFn(Object.getPrototypeOf(pipeSourceService), 'list', () => {
    throw new Error('DB unavailable');
  });
  try {
    await assert.doesNotReject(() => pipeSourceService.scanForSlugCollisions());
  } finally {
    restoreList();
  }
});

// ============================================================================
// Task 26 review fix: update() (PUT /:id, the rename path) must also reject a
// rename whose new slug collides with a DIFFERENT existing pipe source --
// previously only create()/adopt() called assertNoSlugCollision(), so
// renaming pipe A to collide with pipe B's slug would silently overwrite B's
// live systemd unit file via writeRadioServiceFile() (both resolve to the
// same getServiceFilePath()). The fix adds an excludeId-aware variant of the
// existing check so a no-op rename (submitting the pipe's own current name)
// is correctly NOT rejected against itself.
// ============================================================================

test('update() rejects a rename to a name IDENTICAL to a DIFFERENT existing pipe source\'s name, before any write', async () => {
  const calls: Call[] = [];
  const restorePlatform = stubAllPlatformCalls(calls);
  try {
    const nameB = uniqueName('update-collision-identical-b');
    const pipeA = await pipeSourceService.create(baseCreateInput({ name: uniqueName('update-collision-identical-a') }));
    await pipeSourceService.create(baseCreateInput({ name: nameB }));
    calls.length = 0;

    await assert.rejects(
      () => pipeSourceService.update(pipeA.id, { name: nameB }),
      /conflicting name already exists/,
    );
    assert.equal(calls.length, 0, `expected zero platform calls for the rejected update(), got: ${JSON.stringify(calls)}`);
    assert.equal(pipeSourceService.getById(pipeA.id)?.name, pipeA.name, 'pipe A must be unchanged after a rejected rename');
  } finally {
    restorePlatform();
  }
});

test('update() rejects a rename that only collides with a DIFFERENT existing pipe source AFTER slugging', async () => {
  const calls: Call[] = [];
  const restorePlatform = stubAllPlatformCalls(calls);
  try {
    const base = uniqueName('update-collide-base');
    const nameB = `My ${base}`;
    const nameBSlugCollider = nameB.toLowerCase().replace(/\s+/g, '-');

    const pipeA = await pipeSourceService.create(baseCreateInput({ name: uniqueName('update-collide-a') }));
    await pipeSourceService.create(baseCreateInput({ name: nameB }));
    calls.length = 0;

    await assert.rejects(
      () => pipeSourceService.update(pipeA.id, { name: nameBSlugCollider }),
      /conflicting name already exists/,
    );
    assert.equal(calls.length, 0, `expected zero platform calls for the rejected update(), got: ${JSON.stringify(calls)}`);
    assert.equal(pipeSourceService.getById(pipeA.id)?.name, pipeA.name, 'pipe A must be unchanged after a rejected rename');
  } finally {
    restorePlatform();
  }
});

test('update() allows renaming a pipe source to a name whose slug does not collide with anything', async () => {
  const calls: Call[] = [];
  const restorePlatform = stubAllPlatformCalls(calls);
  try {
    const pipeA = await pipeSourceService.create(baseCreateInput({ name: uniqueName('update-allow-rename-a') }));
    calls.length = 0;

    const newName = uniqueName('update-allow-rename-a-new');
    const updated = await pipeSourceService.update(pipeA.id, { name: newName });
    assert.equal(updated.name, newName);
    assert.equal(pipeSourceService.getById(pipeA.id)?.name, newName);
  } finally {
    restorePlatform();
  }
});

test('update() allows a no-op "rename" -- submitting the pipe source\'s own current name -- without rejecting it against itself', async () => {
  const calls: Call[] = [];
  const restorePlatform = stubAllPlatformCalls(calls);
  try {
    const pipeA = await pipeSourceService.create(baseCreateInput({ name: uniqueName('update-noop-rename-a') }));
    calls.length = 0;

    const updated = await pipeSourceService.update(pipeA.id, { name: pipeA.name });
    assert.equal(updated.name, pipeA.name);
    assert.equal(pipeSourceService.getById(pipeA.id)?.name, pipeA.name);
  } finally {
    restorePlatform();
  }
});

test('update() allows changing OTHER fields (not name) without spuriously rejecting due to the collision check', async () => {
  const calls: Call[] = [];
  const restorePlatform = stubAllPlatformCalls(calls);
  try {
    const pipeA = await pipeSourceService.create(baseCreateInput({ name: uniqueName('update-other-fields-a'), idleThreshold: 15000 }));
    calls.length = 0;

    const updated = await pipeSourceService.update(pipeA.id, { idleThreshold: 20000 });
    assert.equal(updated.name, pipeA.name);
    assert.equal(updated.idleThreshold, 20000);
    assert.equal(pipeSourceService.getById(pipeA.id)?.idleThreshold, 20000);
  } finally {
    restorePlatform();
  }
});
