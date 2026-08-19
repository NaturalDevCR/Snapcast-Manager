// eslint-disable-next-line @typescript-eslint/ban-ts-comment -- deliberate, see explanation below
// @ts-nocheck
//
// Why: see server/src/platform/systemd.test.ts's identical header for the
// full investigation of the `node --test --import ts-node/register`
// environment quirk this project has (Node 24's built-in
// `--experimental-strip-types` racing `ts-node/register` for files that
// bind a parameterized function value to a name). The mocking helpers below
// (`stubRun`) hit it. Correctness is independently confirmed with real
// type-checking via:
//   npx tsc --noEmit --strict --target es2020 --module commonjs \
//     --esModuleInterop --skipLibCheck src/platform/files.test.ts
// This does not affect `npm run build` (test files are excluded from
// tsconfig's project) or the production `platform/files.ts` file, which has
// no such pragma and is fully type-checked.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as execModule from './exec';
import { writeFileAtomic, installPrivilegedFile, readTextFile } from './files';

type RunFn = typeof execModule.run;
type NeedsSudoFn = typeof execModule.needsSudo;
type Call = { bin: string; args: string[]; opts?: unknown };

function stubRun(impl: RunFn): () => void {
  const original = execModule.run;
  (execModule as unknown as { run: RunFn }).run = impl;
  return () => {
    (execModule as unknown as { run: RunFn }).run = original;
  };
}

function stubNeedsSudo(impl: NeedsSudoFn): () => void {
  const original = execModule.needsSudo;
  (execModule as unknown as { needsSudo: NeedsSudoFn }).needsSudo = impl;
  return () => {
    (execModule as unknown as { needsSudo: NeedsSudoFn }).needsSudo = original;
  };
}

function stubRunRecording(calls: Call[]): () => void {
  return stubRun(async (bin: string, args: string[], opts?: unknown) => {
    calls.push({ bin, args, opts });
    return { stdout: '', stderr: '' };
  });
}

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'snapmanager-test-'));
}

// ---- writeFileAtomic() : real filesystem, no mocks ----

test('writeFileAtomic writes a new file with the given content', async () => {
  const dir = makeTmpDir();
  const dest = path.join(dir, 'out.txt');
  try {
    await writeFileAtomic(dest, 'hello world');
    assert.equal(fs.readFileSync(dest, 'utf-8'), 'hello world');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('writeFileAtomic atomically replaces an existing file (final content is fully the new content)', async () => {
  const dir = makeTmpDir();
  const dest = path.join(dir, 'out.txt');
  try {
    fs.writeFileSync(dest, 'old content that is reasonably long to notice partial overwrite');
    await writeFileAtomic(dest, 'new');
    assert.equal(fs.readFileSync(dest, 'utf-8'), 'new');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('writeFileAtomic leaves no leftover temp file in the destination directory', async () => {
  const dir = makeTmpDir();
  const dest = path.join(dir, 'out.txt');
  try {
    await writeFileAtomic(dest, 'hello');
    const entries = fs.readdirSync(dir);
    assert.deepEqual(entries, ['out.txt']);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('writeFileAtomic applies opts.mode to the final file', async () => {
  const dir = makeTmpDir();
  const dest = path.join(dir, 'out.txt');
  try {
    await writeFileAtomic(dest, 'hello', { mode: 0o640 });
    const stat = fs.statSync(dest);
    assert.equal(stat.mode & 0o777, 0o640);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('writeFileAtomic: two overlapping writes to the same path both complete and the final file is fully one write or the other, never a mix', async () => {
  const dir = makeTmpDir();
  const dest = path.join(dir, 'out.txt');
  try {
    const contentA = 'A'.repeat(50_000);
    const contentB = 'B'.repeat(50_000);
    await Promise.all([writeFileAtomic(dest, contentA), writeFileAtomic(dest, contentB)]);
    const final = fs.readFileSync(dest, 'utf-8');
    assert.ok(
      final === contentA || final === contentB,
      'final content must be fully one write, not a mix',
    );
    assert.equal(final.length, 50_000);
    assert.ok(
      /^A+$/.test(final) || /^B+$/.test(final),
      'final content must not interleave A and B',
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ---- readTextFile() : real filesystem, no mocks ----

test('readTextFile reads back what was written', async () => {
  const dir = makeTmpDir();
  const dest = path.join(dir, 'in.txt');
  try {
    fs.writeFileSync(dest, 'some content\nwith a newline');
    assert.equal(await readTextFile(dest), 'some content\nwith a newline');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ---- installPrivilegedFile() : mocked run(), real mkdtemp/cleanup ----
// `cp`/`chmod` are mocked (via platform/exec.ts's run()) since this test
// suite doesn't run as a privileged user against real system paths, but the
// temp-directory creation and cleanup are real fs I/O -- that's exactly the
// symlink-race-relevant part of this function, so it must not be mocked.

test('installPrivilegedFile writes to a private temp dir and cp/chmod it to destPath via argv', async () => {
  const calls: Call[] = [];
  const restoreRun = stubRunRecording(calls);
  const restoreSudo = stubNeedsSudo(() => false);
  const dir = makeTmpDir();
  const dest = path.join(dir, 'dest.conf');
  try {
    await installPrivilegedFile(dest, 'privileged content', { mode: 0o644 });
    assert.equal(calls.length, 2);
    assert.equal(calls[0].bin, 'cp');
    assert.equal(calls[0].args[1], dest);
    assert.equal(calls[1].bin, 'chmod');
    assert.deepEqual(calls[1].args, ['644', dest]);
  } finally {
    restoreRun();
    restoreSudo();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('installPrivilegedFile prefixes cp/chmod with sudo via argv when needsSudo() is true', async () => {
  const calls: Call[] = [];
  const restoreRun = stubRunRecording(calls);
  const restoreSudo = stubNeedsSudo(() => true);
  const dir = makeTmpDir();
  const dest = path.join(dir, 'dest.conf');
  try {
    await installPrivilegedFile(dest, 'privileged content', { mode: 0o600 });
    assert.equal(calls.length, 2);
    assert.equal(calls[0].bin, 'sudo');
    assert.equal(calls[0].args[0], 'cp');
    assert.equal(calls[0].args[2], dest);
    assert.equal(calls[1].bin, 'sudo');
    assert.deepEqual(calls[1].args, ['chmod', '600', dest]);
  } finally {
    restoreRun();
    restoreSudo();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('installPrivilegedFile skips the chmod call entirely when opts.mode is not given', async () => {
  const calls: Call[] = [];
  const restoreRun = stubRunRecording(calls);
  const restoreSudo = stubNeedsSudo(() => false);
  const dir = makeTmpDir();
  const dest = path.join(dir, 'dest.conf');
  try {
    await installPrivilegedFile(dest, 'content');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].bin, 'cp');
  } finally {
    restoreRun();
    restoreSudo();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('installPrivilegedFile creates a fresh unpredictable temp dir per call (not a fixed path)', async () => {
  const tmpDirsSeen: string[] = [];
  const restoreRun = stubRun(async (bin: string, args: string[]) => {
    if (bin === 'cp' || (bin === 'sudo' && args[0] === 'cp')) {
      const srcArg = bin === 'cp' ? args[0] : args[1];
      tmpDirsSeen.push(path.dirname(srcArg));
    }
    return { stdout: '', stderr: '' };
  });
  const restoreSudo = stubNeedsSudo(() => false);
  const dir = makeTmpDir();
  const dest = path.join(dir, 'dest.conf');
  try {
    await installPrivilegedFile(dest, 'one');
    await installPrivilegedFile(dest, 'two');
    assert.equal(tmpDirsSeen.length, 2);
    assert.notEqual(tmpDirsSeen[0], tmpDirsSeen[1]);
    // Unpredictable: neither temp dir name should be guessable from a fixed
    // template (e.g. Date.now()-based); mkdtemp's random suffix means two
    // calls made back-to-back still diverge in more than a timestamp digit.
    assert.ok(tmpDirsSeen[0].includes('snapmanager-'));
    assert.ok(tmpDirsSeen[1].includes('snapmanager-'));
  } finally {
    restoreRun();
    restoreSudo();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('installPrivilegedFile cleans up the temp dir after a successful install (real fs.existsSync check)', async () => {
  const tmpDirsSeen: string[] = [];
  const restoreRun = stubRun(async (bin: string, args: string[]) => {
    if (bin === 'cp') {
      tmpDirsSeen.push(path.dirname(args[0]));
    }
    return { stdout: '', stderr: '' };
  });
  const restoreSudo = stubNeedsSudo(() => false);
  const dir = makeTmpDir();
  const dest = path.join(dir, 'dest.conf');
  try {
    await installPrivilegedFile(dest, 'content');
    assert.equal(tmpDirsSeen.length, 1);
    assert.equal(fs.existsSync(tmpDirsSeen[0]), false, 'temp dir must be removed after install');
  } finally {
    restoreRun();
    restoreSudo();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('installPrivilegedFile cleans up the temp dir even when the mocked run() (cp) throws', async () => {
  let capturedTmpDir: string | undefined;
  const restoreRun = stubRun(async (bin: string, args: string[]) => {
    if (bin === 'cp') {
      capturedTmpDir = path.dirname(args[0]);
    }
    throw new Error('simulated cp failure');
  });
  const restoreSudo = stubNeedsSudo(() => false);
  const dir = makeTmpDir();
  const dest = path.join(dir, 'dest.conf');
  try {
    await assert.rejects(() => installPrivilegedFile(dest, 'content'));
    assert.ok(capturedTmpDir, 'expected cp to have been called with a temp path before throwing');
    assert.equal(
      fs.existsSync(capturedTmpDir as string),
      false,
      'temp dir must still be removed on failure',
    );
  } finally {
    restoreRun();
    restoreSudo();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('installPrivilegedFile cleans up the temp dir even when the mocked chmod run() throws', async () => {
  let capturedTmpDir: string | undefined;
  const restoreRun = stubRun(async (bin: string, args: string[]) => {
    if (bin === 'cp') {
      capturedTmpDir = path.dirname(args[0]);
      return { stdout: '', stderr: '' };
    }
    if (bin === 'chmod') {
      throw new Error('simulated chmod failure');
    }
    return { stdout: '', stderr: '' };
  });
  const restoreSudo = stubNeedsSudo(() => false);
  const dir = makeTmpDir();
  const dest = path.join(dir, 'dest.conf');
  try {
    await assert.rejects(() => installPrivilegedFile(dest, 'content', { mode: 0o644 }));
    assert.ok(
      capturedTmpDir,
      'expected cp to have been called with a temp path before chmod threw',
    );
    assert.equal(
      fs.existsSync(capturedTmpDir as string),
      false,
      'temp dir must still be removed on chmod failure',
    );
  } finally {
    restoreRun();
    restoreSudo();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// Sanity check that we're actually exercising crypto/mkdtemp-backed
// unpredictability, independent of the mocked run() calls above: mkdtemp
// itself is a real Node primitive, this just documents the expectation this
// module relies on.
test('sanity: fs.mkdtemp produces distinct unpredictable directories for the same prefix', () => {
  const prefix = path.join(os.tmpdir(), 'snapmanager-sanity-');
  const a = fs.mkdtempSync(prefix);
  const b = fs.mkdtempSync(prefix);
  try {
    assert.notEqual(a, b);
    assert.notEqual(path.basename(a), path.basename(b));
  } finally {
    fs.rmSync(a, { recursive: true, force: true });
    fs.rmSync(b, { recursive: true, force: true });
  }
});
