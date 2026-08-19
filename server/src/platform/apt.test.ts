// eslint-disable-next-line @typescript-eslint/ban-ts-comment -- deliberate, see explanation below
// @ts-nocheck
//
// Why: see server/src/platform/systemd.test.ts's identical header for the
// full investigation. Short version: `node --test --import ts-node/register`
// (the exact command `npm test` runs) has a pre-existing environment bug,
// unrelated to this task, where a function/arrow VALUE bound to a name
// (const/let, a property assignment) loses its explicit parameter type
// annotations under the test runner's own file loading (Node 24's built-in
// `--experimental-strip-types` racing `ts-node/register`). The mocking
// helpers below (`stubRun`/`stubNeedsSudo`) bind parameterized functions to
// `execModule.run`/`execModule.needsSudo`, so they hit it; the plain
// value-in/error-out tests don't need it but the pragma applies file-wide.
// Correctness is independently confirmed with real type-checking via:
//   npx tsc --noEmit --strict --target es2020 --module commonjs \
//     --esModuleInterop --skipLibCheck src/platform/apt.test.ts
// This does not affect `npm run build` (test files are excluded from
// tsconfig's project) or the production `platform/apt.ts` file, which has
// no such pragma and is fully type-checked.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as execModule from './exec';
import { ExecError } from './exec';
import { assertValidPackageName, update, install, upgrade, remove, isInstalled } from './apt';

// ---- assertValidPackageName: syntax-only validation ----
// Checked against the Debian Policy Manual §5.6.7 "Package"
// (https://www.debian.org/doc/debian-policy/ch-controlfields.html#package,
// checked 2026-08-19): "Package names (both source and binary...) must
// consist only of lower case letters (a-z), digits (0-9), plus (+) and
// minus (-) signs, and periods (.). They must be at least two characters
// long and must start with an alphanumeric character." Uppercase letters
// are explicitly NOT in the allowed set, so uppercase-containing names are
// rejected (confirmed against the policy text, not assumed).

test('assertValidPackageName accepts syntactically valid Debian package names', () => {
  const valid = [
    'ffmpeg',
    'build-essential',
    'libssl-dev',
    'snapserver',
    'snapclient',
    'g++',
    'a1',
    'x.y',
    'lib32gcc-s1',
    '0ad', // real Debian package, starts with a digit
  ];
  for (const name of valid) {
    assert.doesNotThrow(
      () => assertValidPackageName(name),
      `expected accept: ${JSON.stringify(name)}`,
    );
  }
});

test('assertValidPackageName rejects injection attempts and malformed names', () => {
  const bad = [
    '',
    'a', // too short: policy requires at least two characters
    '; rm -rf /',
    '$(whoami)',
    '`whoami`',
    'has a space',
    '../../etc/passwd',
    'foo/bar',
    'foo;bar',
    'foo|bar',
    'foo&&bar',
    'foo\nbar',
    '\nfoo',
    'foo\n',
    '-foo', // must start with alphanumeric, not a sign
    '.foo', // must start with alphanumeric, not a period
    'Ffmpeg', // uppercase forbidden by policy
    'FFMPEG',
    'foo_bar', // underscore not in the allowed character set
  ];
  for (const name of bad) {
    assert.throws(() => assertValidPackageName(name), `expected reject: ${JSON.stringify(name)}`);
  }
});

// ---- update / install / upgrade / remove / isInstalled ----
// Exercised against a stubbed `platform/exec.ts` `run()`/`needsSudo()`, same
// mocking approach as systemd.test.ts: plain property reassignment +
// try/finally restore, not node:test's `t.mock` API.

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

// ---- update() ----

test('update() calls apt-get update via argv, unprefixed when needsSudo() is false', async () => {
  const calls: Call[] = [];
  const restoreRun = stubRunRecording(calls);
  const restoreSudo = stubNeedsSudo(() => false);
  try {
    await update();
    assert.equal(calls.length, 1);
    assert.equal(calls[0].bin, 'apt-get');
    assert.deepEqual(calls[0].args, ['update']);
  } finally {
    restoreRun();
    restoreSudo();
  }
});

test('update() prefixes with sudo via argv (not string concatenation) when needsSudo() is true', async () => {
  const calls: Call[] = [];
  const restoreRun = stubRunRecording(calls);
  const restoreSudo = stubNeedsSudo(() => true);
  try {
    await update();
    assert.equal(calls.length, 1);
    assert.equal(calls[0].bin, 'sudo');
    assert.deepEqual(calls[0].args, ['apt-get', 'update']);
  } finally {
    restoreRun();
    restoreSudo();
  }
});

// ---- install() ----

test('install() calls apt-get install -y <packages> via argv', async () => {
  const calls: Call[] = [];
  const restoreRun = stubRunRecording(calls);
  const restoreSudo = stubNeedsSudo(() => false);
  try {
    await install(['ffmpeg', 'build-essential']);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].bin, 'apt-get');
    assert.deepEqual(calls[0].args, ['install', '-y', 'ffmpeg', 'build-essential']);
  } finally {
    restoreRun();
    restoreSudo();
  }
});

test('install() prefixes with sudo via argv when needsSudo() is true', async () => {
  const calls: Call[] = [];
  const restoreRun = stubRunRecording(calls);
  const restoreSudo = stubNeedsSudo(() => true);
  try {
    await install(['ffmpeg']);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].bin, 'sudo');
    assert.deepEqual(calls[0].args, ['apt-get', 'install', '-y', 'ffmpeg']);
  } finally {
    restoreRun();
    restoreSudo();
  }
});

test('install() passes a long timeout (not the 30s default) for the potentially slow apt-get call', async () => {
  const calls: Call[] = [];
  const restoreRun = stubRunRecording(calls);
  const restoreSudo = stubNeedsSudo(() => false);
  try {
    await install(['ffmpeg']);
    assert.equal(calls.length, 1);
    const opts = calls[0].opts as { timeoutMs?: number } | undefined;
    assert.ok(opts && typeof opts.timeoutMs === 'number' && opts.timeoutMs >= 600_000);
  } finally {
    restoreRun();
    restoreSudo();
  }
});

test('install() rejects the whole call (without calling run()) if any package name is invalid', async () => {
  let called = false;
  const restoreRun = stubRun(async () => {
    called = true;
    return { stdout: '', stderr: '' };
  });
  try {
    await assert.rejects(() => install(['ffmpeg', 'ok; rm -rf /']));
    assert.equal(called, false);
  } finally {
    restoreRun();
  }
});

test('install() rejects an empty package array without calling run()', async () => {
  let called = false;
  const restoreRun = stubRun(async () => {
    called = true;
    return { stdout: '', stderr: '' };
  });
  try {
    await assert.rejects(() => install([]));
    assert.equal(called, false);
  } finally {
    restoreRun();
  }
});

// ---- upgrade() ----

test('upgrade() calls apt-get install -y --only-upgrade <packages> via argv', async () => {
  const calls: Call[] = [];
  const restoreRun = stubRunRecording(calls);
  const restoreSudo = stubNeedsSudo(() => false);
  try {
    await upgrade(['ffmpeg', 'snapserver']);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].bin, 'apt-get');
    assert.deepEqual(calls[0].args, ['install', '-y', '--only-upgrade', 'ffmpeg', 'snapserver']);
  } finally {
    restoreRun();
    restoreSudo();
  }
});

test('upgrade() prefixes with sudo via argv when needsSudo() is true', async () => {
  const calls: Call[] = [];
  const restoreRun = stubRunRecording(calls);
  const restoreSudo = stubNeedsSudo(() => true);
  try {
    await upgrade(['ffmpeg']);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].bin, 'sudo');
    assert.deepEqual(calls[0].args, ['apt-get', 'install', '-y', '--only-upgrade', 'ffmpeg']);
  } finally {
    restoreRun();
    restoreSudo();
  }
});

test('upgrade() passes a long timeout for the potentially slow apt-get call', async () => {
  const calls: Call[] = [];
  const restoreRun = stubRunRecording(calls);
  const restoreSudo = stubNeedsSudo(() => false);
  try {
    await upgrade(['ffmpeg']);
    const opts = calls[0].opts as { timeoutMs?: number } | undefined;
    assert.ok(opts && typeof opts.timeoutMs === 'number' && opts.timeoutMs >= 600_000);
  } finally {
    restoreRun();
    restoreSudo();
  }
});

test('upgrade() rejects the whole call (without calling run()) if any package name is invalid', async () => {
  let called = false;
  const restoreRun = stubRun(async () => {
    called = true;
    return { stdout: '', stderr: '' };
  });
  try {
    await assert.rejects(() => upgrade(['ffmpeg', '$(whoami)']));
    assert.equal(called, false);
  } finally {
    restoreRun();
  }
});

test('upgrade() rejects an empty package array without calling run()', async () => {
  let called = false;
  const restoreRun = stubRun(async () => {
    called = true;
    return { stdout: '', stderr: '' };
  });
  try {
    await assert.rejects(() => upgrade([]));
    assert.equal(called, false);
  } finally {
    restoreRun();
  }
});

// ---- remove() ----

test('remove() calls apt-get remove --purge -y <packages> via argv', async () => {
  const calls: Call[] = [];
  const restoreRun = stubRunRecording(calls);
  const restoreSudo = stubNeedsSudo(() => false);
  try {
    await remove(['ffmpeg', 'snapserver']);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].bin, 'apt-get');
    assert.deepEqual(calls[0].args, ['remove', '--purge', '-y', 'ffmpeg', 'snapserver']);
  } finally {
    restoreRun();
    restoreSudo();
  }
});

test('remove() prefixes with sudo via argv when needsSudo() is true', async () => {
  const calls: Call[] = [];
  const restoreRun = stubRunRecording(calls);
  const restoreSudo = stubNeedsSudo(() => true);
  try {
    await remove(['ffmpeg']);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].bin, 'sudo');
    assert.deepEqual(calls[0].args, ['apt-get', 'remove', '--purge', '-y', 'ffmpeg']);
  } finally {
    restoreRun();
    restoreSudo();
  }
});

test('remove() rejects the whole call (without calling run()) if any package name is invalid', async () => {
  let called = false;
  const restoreRun = stubRun(async () => {
    called = true;
    return { stdout: '', stderr: '' };
  });
  try {
    await assert.rejects(() => remove(['ffmpeg', 'foo bar']));
    assert.equal(called, false);
  } finally {
    restoreRun();
  }
});

test('remove() rejects an empty package array without calling run()', async () => {
  let called = false;
  const restoreRun = stubRun(async () => {
    called = true;
    return { stdout: '', stderr: '' };
  });
  try {
    await assert.rejects(() => remove([]));
    assert.equal(called, false);
  } finally {
    restoreRun();
  }
});

// ---- isInstalled() ----
// This is the read/write sudo-split regression test: unlike the four
// mutating functions above, isInstalled() (backed by `dpkg -s`, a read) must
// NEVER be sudo-prefixed, even when needsSudo() is true. Task 4's real bug
// was exactly this kind of claimed-but-untested split turning out false, so
// this asserts the literal argv, not just "doesn't throw".

test('isInstalled() calls dpkg -s <pkg> via argv and returns true on zero exit', async () => {
  const calls: Call[] = [];
  const restoreRun = stubRunRecording(calls);
  const restoreSudo = stubNeedsSudo(() => false);
  try {
    const result = await isInstalled('ffmpeg');
    assert.equal(result, true);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].bin, 'dpkg');
    assert.deepEqual(calls[0].args, ['-s', 'ffmpeg']);
  } finally {
    restoreRun();
    restoreSudo();
  }
});

test('isInstalled() NEVER applies sudo, even when needsSudo() is true', async () => {
  const calls: Call[] = [];
  const restoreRun = stubRunRecording(calls);
  const restoreSudo = stubNeedsSudo(() => true);
  try {
    await isInstalled('ffmpeg');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].bin, 'dpkg');
    assert.deepEqual(calls[0].args, ['-s', 'ffmpeg']);
  } finally {
    restoreRun();
    restoreSudo();
  }
});

test('isInstalled() returns false when dpkg -s exits non-zero (package not installed)', async () => {
  const restoreRun = stubRun(async () => {
    throw new ExecError(
      'dpkg',
      ['-s', 'not-a-package'],
      1,
      '',
      'dpkg-query: package not installed\n',
    );
  });
  const restoreSudo = stubNeedsSudo(() => false);
  try {
    assert.equal(await isInstalled('not-a-package'), false);
  } finally {
    restoreRun();
    restoreSudo();
  }
});

test('isInstalled() rethrows non-ExecError failures (real execution errors, e.g. dpkg missing)', async () => {
  const restoreRun = stubRun(async () => {
    throw new Error('ENOENT: dpkg not found');
  });
  const restoreSudo = stubNeedsSudo(() => false);
  try {
    await assert.rejects(() => isInstalled('ffmpeg'), /ENOENT/);
  } finally {
    restoreRun();
    restoreSudo();
  }
});

test('isInstalled() rejects an invalid package name without calling run()', async () => {
  let called = false;
  const restoreRun = stubRun(async () => {
    called = true;
    return { stdout: '', stderr: '' };
  });
  try {
    await assert.rejects(() => isInstalled('bad; rm -rf /'));
    assert.equal(called, false);
  } finally {
    restoreRun();
  }
});
