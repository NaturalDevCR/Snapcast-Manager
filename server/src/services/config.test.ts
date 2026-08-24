// eslint-disable-next-line @typescript-eslint/ban-ts-comment -- deliberate, see explanation below
// @ts-nocheck
//
// Why: see server/src/platform/systemd.test.ts's identical header for the
// full investigation into the `node --test --import ts-node/register`
// type-stripping bug this pragma works around -- this file's mocking
// helpers (delaying/overriding fsPromisesDefault.readFile, stubbing
// filesModule.writeFileAtomic/installPrivilegedFile) bind name-bound
// function values, which is exactly the fingerprint that trips it.
// Correctness is independently confirmed with real type-checking via:
//   npx tsc --noEmit --strict --target es2020 --module commonjs \
//     --esModuleInterop --skipLibCheck src/services/config.test.ts
// This does not affect `npm run build` (test files are excluded from
// tsconfig's project) or the production `services/config.ts` file, which
// has no such pragma and is fully type-checked.
//
// Path isolation: services/config.ts reads SNAPSERVER_CONFIG_PATH/_BASE/_DIR
// from process.env (falling back to the real /etc paths in production),
// exactly the same env-override-at-module-load pattern database.ts uses for
// DB_PATH -- see database.test.ts's header. These env vars are set to a
// fresh temp directory BELOW, BEFORE importing '../services/config'
// (TypeScript compiles `import` to a `require()` emitted at this exact
// source position under commonjs, so textual placement matters). This lets
// these tests exercise the REAL filesystem code path (real writeFileAtomic,
// real fs.readFile) against a throwaway directory instead of the real
// /etc/snapserver.conf* paths, which this process has no permission to
// write in a test/CI environment anyway.
//
// `installPrivilegedFile()` mocking (review fix, post-Task-24): as of the
// fix for the EACCES bug (writeFileAtomic() needs write access to the
// CONTAINING DIRECTORY, which snapmanager does not have on /etc -- see
// services/config.ts's top-of-file comment for the full writeup),
// SNAPSERVER_CONFIG_PATH/_BASE/_BAK now write via
// `platform/files.ts`'s `installPrivilegedFile()`, which in production
// shells out to `cp`/`sudo cp`. That subprocess is neither available nor
// desirable in a test process (a non-root test runner would hang on a sudo
// password prompt, or need a working passwordless-sudo CI setup). So this
// file installs ONE default stub for `installPrivilegedFile()` at module
// scope, below, that performs the OBSERVABLE effect of the real function
// (content lands at destPath with the given mode) via a plain, synchronous
// `fs.writeFileSync`/`fs.chmodSync` -- no subprocess. This keeps every
// existing test's `fs.readFileSync(masterPath, ...)`-style assertion
// working unchanged. Individual tests override this default stub
// temporarily (following this file's pre-existing `stubModuleFn` +
// try/finally pattern) when they need to simulate a failure or record
// calls -- see the regression tests near the bottom of this file.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import fsPromisesDefault from 'fs/promises';
import * as os from 'os';
import * as path from 'path';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'config-test-'));
const masterPath = path.join(tmpDir, 'snapserver.conf');
const basePath = path.join(tmpDir, 'snapserver.conf.base');
const dirPath = path.join(tmpDir, 'snapserver.conf.d');
const bakPath = `${masterPath}.bak`;

process.env.SNAPSERVER_CONFIG_PATH = masterPath;
process.env.SNAPSERVER_CONFIG_BASE = basePath;
process.env.SNAPSERVER_CONFIG_DIR = dirPath;

import { ConfigService } from './config';
import * as filesModule from '../platform/files';

function stubModuleFn(mod: any, key: string, impl: (...args: any[]) => any): () => void {
  const original = mod[key];
  mod[key] = impl;
  return () => {
    mod[key] = original;
  };
}

/**
 * The default `installPrivilegedFile()` behavior used throughout this file:
 * a real (synchronous) filesystem write, standing in for the real
 * function's `mkdtemp` + `sudo cp` + `sudo chmod` dance. See the file
 * header for why a real subprocess isn't used in tests.
 */
function writeInstallStub(destPath: string, content: string | Buffer, opts?: { mode?: number }): void {
  if (typeof content === 'string') {
    fs.writeFileSync(destPath, content, 'utf-8');
  } else {
    fs.writeFileSync(destPath, content);
  }
  if (opts?.mode !== undefined) fs.chmodSync(destPath, opts.mode);
}

const restoreDefaultInstallStub = stubModuleFn(
  filesModule,
  'installPrivilegedFile',
  async (destPath: string, content: string | Buffer, opts?: { mode?: number }) => {
    writeInstallStub(destPath, content, opts);
  },
);

const SAMPLE_STREAM = '[stream]\nsampleformat = 48000:16:2\ncodec = flac\nbuffer = 1000\n\n[server]\nthreads = -1\n';

test.after(() => {
  restoreDefaultInstallStub();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ---- .bak rotation ----

test('writeServerConfig: rotates the PREVIOUS master content into .bak before overwriting', async () => {
  const svc = new ConfigService();
  await svc.writeServerConfig(SAMPLE_STREAM);
  const secondContent = '[stream]\nsampleformat = 44100:16:2\n\n[server]\nthreads = 2\n';
  await svc.writeServerConfig(secondContent);

  assert.equal(fs.readFileSync(masterPath, 'utf-8'), secondContent, 'master must hold the NEW content');
  assert.equal(fs.readFileSync(bakPath, 'utf-8'), SAMPLE_STREAM, '.bak must hold the PREVIOUS content, not the new one');
});

test('writeServerConfig: first-ever write (no pre-existing master) does not create a .bak file', async () => {
  fs.rmSync(masterPath, { force: true });
  fs.rmSync(bakPath, { force: true });
  const svc = new ConfigService();
  await svc.writeServerConfig(SAMPLE_STREAM);
  assert.equal(fs.existsSync(bakPath), false, 'no prior content existed to back up');
});

// ---- validate-before-write ----

test('writeServerConfig: rejects content that parses to zero sections (garbage), leaving the master file untouched', async () => {
  const svc = new ConfigService();
  await svc.writeServerConfig(SAMPLE_STREAM);

  const garbage = 'this is not an ini file at all, just some prose with no [section] headers or key=value pairs';
  await assert.rejects(() => svc.writeServerConfig(garbage));

  assert.equal(fs.readFileSync(masterPath, 'utf-8'), SAMPLE_STREAM, 'a rejected write must not touch the existing master file');
});

test('writeServerConfig: accepts content with at least one recognizable [section]', async () => {
  const svc = new ConfigService();
  await svc.writeServerConfig(SAMPLE_STREAM);
  const valid = '[server]\nthreads = 4\n';
  await svc.writeServerConfig(valid);
  assert.equal(fs.readFileSync(masterPath, 'utf-8'), valid);
});

// ---- privileged write failure leaves the original intact ----

test('writeServerConfig: if the underlying installPrivilegedFile write throws partway, the original master file is left fully intact', async () => {
  const svc = new ConfigService();
  await svc.writeServerConfig(SAMPLE_STREAM);

  // Only the MASTER write fails -- the preceding .bak rotation (also
  // routed through installPrivilegedFile) still succeeds via the real
  // writeInstallStub, so this exercises "the bak was rotated but the new
  // master content never landed", not a rejection before anything ran.
  const restore = stubModuleFn(filesModule, 'installPrivilegedFile', async (destPath: string, content: any, opts: any) => {
    if (destPath === masterPath) {
      throw new Error('simulated sudo cp failure mid-write');
    }
    writeInstallStub(destPath, content, opts);
  });
  try {
    await assert.rejects(() => svc.writeServerConfig('[server]\nthreads = 99\n'), /simulated sudo cp failure/);
  } finally {
    restore();
  }

  assert.equal(fs.readFileSync(masterPath, 'utf-8'), SAMPLE_STREAM, 'original content must survive a failed write');
});

// ---- mutex: concurrent read-modify-write cycles must not lose an edit ----

test('addStreamSource: two overlapping calls both land in the final config -- neither is lost to a stale-read race', async () => {
  const svc = new ConfigService();
  await svc.writeServerConfig(SAMPLE_STREAM);

  let releaseDelayed!: () => void;
  const releaseSignal = new Promise<void>(resolve => {
    releaseDelayed = resolve;
  });
  let triggered = false;
  const originalReadFile = fsPromisesDefault.readFile;
  (fsPromisesDefault as any).readFile = async (p: any, enc?: any) => {
    if (!triggered && p === masterPath) {
      triggered = true;
      // Capture the STALE snapshot immediately (before the other call has
      // had a chance to write), then delay only the RETURN of it -- this
      // reproduces "read completed early with old data, but this request
      // was slow to act on it" without needing a real race window.
      const snapshot = await originalReadFile(p, enc);
      await releaseSignal;
      return snapshot;
    }
    return originalReadFile(p, enc);
  };

  try {
    const callA = svc.addStreamSource('pipe:///tmp/fifo-a?name=SourceA');
    const callB = svc.addStreamSource('pipe:///tmp/fifo-b?name=SourceB');

    // Give whichever call was NOT delayed plenty of real wall-clock time to
    // fully complete its own read-transform-write cycle before we let the
    // delayed one resume.
    await new Promise(resolve => setTimeout(resolve, 100));
    releaseDelayed();
    await Promise.all([callA, callB]);
  } finally {
    fsPromisesDefault.readFile = originalReadFile;
  }

  const final = fs.readFileSync(masterPath, 'utf-8');
  assert.ok(final.includes('fifo-a'), `expected source A to survive, got:\n${final}`);
  assert.ok(final.includes('fifo-b'), `expected source B to survive, got:\n${final}`);
});

test('addStreamSource + removeStreamSourceByFifo: overlapping add and remove calls both land correctly', async () => {
  const svc = new ConfigService();
  // Seed with an existing source that will be removed by the overlapping call.
  const seeded = svc.addStreamSource('pipe:///tmp/fifo-existing?name=Existing');
  await seeded;
  const seededContent = fs.readFileSync(masterPath, 'utf-8');
  assert.ok(seededContent.includes('fifo-existing'));

  let releaseDelayed!: () => void;
  const releaseSignal = new Promise<void>(resolve => {
    releaseDelayed = resolve;
  });
  let triggered = false;
  const originalReadFile = fsPromisesDefault.readFile;
  (fsPromisesDefault as any).readFile = async (p: any, enc?: any) => {
    if (!triggered && p === masterPath) {
      triggered = true;
      const snapshot = await originalReadFile(p, enc);
      await releaseSignal;
      return snapshot;
    }
    return originalReadFile(p, enc);
  };

  try {
    const addCall = svc.addStreamSource('pipe:///tmp/fifo-new?name=New');
    const removeCall = svc.removeStreamSourceByFifo('/tmp/fifo-existing');

    await new Promise(resolve => setTimeout(resolve, 100));
    releaseDelayed();
    await Promise.all([addCall, removeCall]);
  } finally {
    fsPromisesDefault.readFile = originalReadFile;
  }

  const final = fs.readFileSync(masterPath, 'utf-8');
  assert.ok(final.includes('fifo-new'), `expected the new source to be added, got:\n${final}`);
  assert.ok(!final.includes('fifo-existing'), `expected the old source to be removed, got:\n${final}`);
});

// ---- regression: master/.base/.bak must go through installPrivilegedFile, NEVER writeFileAtomic ----
//
// This is the exact bug the review finding caught: writeFileAtomic() creates
// its temp file in the SAME DIRECTORY as the destination and rename()s it
// into place -- both steps need write permission on the CONTAINING
// DIRECTORY (/etc), which install.sh deliberately does NOT grant to
// snapmanager (it only chowns the three files individually). On a real
// install this makes writeFileAtomic() fail with EACCES for these three
// paths every single time. These tests fail loudly if a future change
// accidentally routes any of these three paths back through writeFileAtomic.

test('writeServerConfig: writes /etc/snapserver.conf and its .bak via installPrivilegedFile, never via writeFileAtomic', async () => {
  const svc = new ConfigService();
  await svc.writeServerConfig(SAMPLE_STREAM); // seed so the next call's rotateMasterBak() has something to back up

  const installCalls: string[] = [];
  const atomicCalls: string[] = [];
  const restoreInstall = stubModuleFn(filesModule, 'installPrivilegedFile', async (destPath: string, content: any, opts: any) => {
    installCalls.push(destPath);
    writeInstallStub(destPath, content, opts);
  });
  const restoreAtomic = stubModuleFn(filesModule, 'writeFileAtomic', async (destPath: string) => {
    atomicCalls.push(destPath);
    throw new Error(
      `writeFileAtomic must NOT be called for ${destPath} -- on a real install this path's CONTAINING ` +
        'DIRECTORY (/etc) is not writable by snapmanager, so writeFileAtomic would fail with EACCES here',
    );
  });

  try {
    const secondContent = '[stream]\nsampleformat = 44100:16:2\n\n[server]\nthreads = 2\n';
    await svc.writeServerConfig(secondContent);
  } finally {
    restoreInstall();
    restoreAtomic();
  }

  assert.ok(installCalls.includes(masterPath), 'expected installPrivilegedFile to write the master config');
  assert.ok(installCalls.includes(bakPath), 'expected installPrivilegedFile to write the .bak rotation');
  assert.equal(atomicCalls.length, 0, `writeFileAtomic must never be called for master/.bak, got calls for: ${atomicCalls.join(', ')}`);
});

test('ensureModularStructure / resetToDefault: write /etc/snapserver.conf.base via installPrivilegedFile, never via writeFileAtomic', async () => {
  fs.rmSync(basePath, { force: true });
  const svc = new ConfigService();

  const installCalls: string[] = [];
  const atomicCalls: string[] = [];
  const restoreInstall = stubModuleFn(filesModule, 'installPrivilegedFile', async (destPath: string, content: any, opts: any) => {
    installCalls.push(destPath);
    writeInstallStub(destPath, content, opts);
  });
  const restoreAtomic = stubModuleFn(filesModule, 'writeFileAtomic', async (destPath: string, content: any, opts: any) => {
    if (destPath === basePath) {
      atomicCalls.push(destPath);
      throw new Error(`writeFileAtomic must NOT be called for ${destPath}`);
    }
    // Segment writes (unrelated to this test) are unaffected -- fall through to a real write.
    writeInstallStub(destPath, content, opts);
  });

  try {
    await svc.ensureModularStructure();
    await svc.resetToDefault();
  } finally {
    restoreInstall();
    restoreAtomic();
  }

  assert.ok(installCalls.includes(basePath), 'expected installPrivilegedFile to write the base config');
  assert.equal(atomicCalls.length, 0, `writeFileAtomic must never be called for the base config, got calls for: ${atomicCalls.join(', ')}`);
});

test('saveSegment: still writes segment files via writeFileAtomic (the /etc/snapserver.conf.d/ directory is fully process-owned), not installPrivilegedFile', async () => {
  const svc = new ConfigService();
  const segmentPath = path.join(dirPath, 'myregression.conf');

  const atomicCalls: string[] = [];
  const installSegmentCalls: string[] = [];
  const restoreAtomic = stubModuleFn(filesModule, 'writeFileAtomic', async (destPath: string, content: any, opts: any) => {
    if (destPath === segmentPath) atomicCalls.push(destPath);
    writeInstallStub(destPath, content, opts);
  });
  const restoreInstall = stubModuleFn(filesModule, 'installPrivilegedFile', async (destPath: string, content: any, opts: any) => {
    if (destPath === segmentPath) installSegmentCalls.push(destPath);
    writeInstallStub(destPath, content, opts);
  });

  try {
    await svc.saveSegment('myregression', '[stream]\nsampleformat = 48000:16:2\n\n');
  } finally {
    restoreAtomic();
    restoreInstall();
  }

  assert.ok(atomicCalls.includes(segmentPath), 'expected the segment file to be written via writeFileAtomic');
  assert.equal(installSegmentCalls.length, 0, 'installPrivilegedFile must never be called for the fully-owned segment directory');
});
