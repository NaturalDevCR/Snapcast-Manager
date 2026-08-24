// eslint-disable-next-line @typescript-eslint/ban-ts-comment -- deliberate, see explanation below
// @ts-nocheck
//
// Why: see server/src/platform/systemd.test.ts's identical header for the
// full investigation into the `node --test --import ts-node/register`
// type-stripping bug this pragma works around -- this file's mocking
// helpers (delaying/overriding fsPromisesDefault.readFile, stubbing
// filesModule.writeFileAtomic) bind name-bound function values, which is
// exactly the fingerprint that trips it. Correctness is independently
// confirmed with real type-checking via:
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
// `node --test` runs each test file in its own process, and tests within a
// file run sequentially by default (confirmed by this repo's existing
// database.test.ts, which relies on the same assumption) -- so every test
// below shares ONE fixed set of config paths for the whole file, and each
// test explicitly (re)seeds the files it needs at its own start rather than
// relying on a fresh directory per test.

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

const SAMPLE_STREAM = '[stream]\nsampleformat = 48000:16:2\ncodec = flac\nbuffer = 1000\n\n[server]\nthreads = -1\n';

test.after(() => {
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

// ---- atomic-write failure leaves the original intact ----

test('writeServerConfig: if the underlying atomic write throws partway, the original master file is left fully intact', async () => {
  const svc = new ConfigService();
  await svc.writeServerConfig(SAMPLE_STREAM);

  const restore = stubModuleFn(filesModule, 'writeFileAtomic', async () => {
    throw new Error('simulated disk failure mid-write');
  });
  try {
    await assert.rejects(() => svc.writeServerConfig('[server]\nthreads = 99\n'), /simulated disk failure/);
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
