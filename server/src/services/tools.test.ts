// eslint-disable-next-line @typescript-eslint/ban-ts-comment -- deliberate, see explanation below
// @ts-nocheck
//
// Why: see server/src/platform/systemd.test.ts's identical header for the
// full investigation into the `node --test --import ts-node/register`
// parameter-type-stripping bug this pragma works around. The `readCrontab`
// mocking test below binds a parameterized function to `execModule.run`,
// which hits the same bug. Correctness is independently confirmed with
// real type-checking via:
//   npx tsc --noEmit --strict --target es2020 --module commonjs \
//     --esModuleInterop --skipLibCheck src/services/tools.test.ts
// This does not affect `npm run build` (test files are excluded from
// tsconfig's project) or the production `services/tools.ts` /
// `routes/tools.ts` files, which have no such pragma.
//
// TASK 9 -- the highest-severity fix in the hardening plan: prior to this
// task, `POST /api/tools/scripts` accepted ANY absolute path (only
// `path.startsWith('/')` + a quote/newline blacklist), and
// `POST /api/tools/script` then wrote attacker content to it as root. The
// tests below are the ones that must be RED against the pre-fix code (they
// import functions that don't exist yet) and GREEN once
// `validateManagedScriptPath()`/`isPathInsideManagedDir()` land in
// `services/tools.ts` and are wired into routes/tools.ts.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as execModule from '../platform/exec';
import { ExecError } from '../platform/exec';
import { installPrivilegedFile } from '../platform/files';
import {
  MANAGED_SCRIPTS_DIR,
  validateManagedScriptPath,
  isPathInsideManagedDir,
  readCrontab,
  ensureManagedScriptsDir,
} from './tools';

function stubModuleFn(mod: any, key: string, impl: (...args: any[]) => any): () => void {
  const original = mod[key];
  mod[key] = impl;
  return () => {
    mod[key] = original;
  };
}

/**
 * `fs.mkdtempSync(os.tmpdir())` PLUS an immediate `fs.realpathSync()`. On
 * macOS, `os.tmpdir()` lives under `/var`, which is itself a symlink to
 * `/private/var` -- so the freshly-created directory's own literal path
 * has a symlink ABOVE it, unrelated to anything this test is deliberately
 * planting. `validateManagedScriptPath()`'s boundary check compares a
 * `path.resolve()`'d candidate against a `path.resolve()`'d `managedDir`
 * (neither side calls `realpath` on the boundary itself -- only on
 * symlink COMPONENTS it walks through, by design, since the real
 * `MANAGED_SCRIPTS_DIR` in production has no such ambient symlink
 * ancestor). Realpath-ing the substitute managed dir once, up front, here
 * in the test fixture keeps `managedDir` and every path built from it
 * self-consistent for the rest of the test, matching production's
 * assumption that `MANAGED_SCRIPTS_DIR`'s own ancestry is symlink-free.
 */
function mkTmpManagedRoot(): string {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'snapmanager-test-managed-')));
}

// ---- MANAGED_SCRIPTS_DIR ----

test('MANAGED_SCRIPTS_DIR is the app-owned managed directory', () => {
  assert.equal(MANAGED_SCRIPTS_DIR, '/var/lib/snapcast-manager/scripts');
});

// ---- ensureManagedScriptsDir(): closes the "MANAGED_SCRIPTS_DIR is never
// actually created anywhere" gap found in review of Task 9. Nothing in this
// codebase or the installer created this directory, so a fresh/real install
// could register a brand-new script successfully (registration tolerates a
// not-yet-existing path) and then always fail to write its content (`cp`
// fails with ENOENT on the missing parent directory). Mirrors
// services/pipeSources.ts's ensureRuntimeDir() test style: mock
// platform/exec.ts's run()/needsSudo(), assert the exact argv used. ----

test('ensureManagedScriptsDir() runs mkdir -p -m 0750 on MANAGED_SCRIPTS_DIR when not running as root', async () => {
  const calls: { bin: string; args: string[] }[] = [];
  const restoreRun = stubModuleFn(execModule, 'run', async (bin: string, args: string[]) => {
    calls.push({ bin, args });
    return { stdout: '', stderr: '' };
  });
  const restoreSudo = stubModuleFn(execModule, 'needsSudo', () => false);
  try {
    await ensureManagedScriptsDir();
    assert.equal(calls.length, 1);
    assert.equal(calls[0].bin, 'mkdir');
    assert.deepEqual(calls[0].args, ['-p', '-m', '0750', MANAGED_SCRIPTS_DIR]);
  } finally {
    restoreRun();
    restoreSudo();
  }
});

test('ensureManagedScriptsDir() sudo-gates the mkdir call via argv when needsSudo() is true', async () => {
  const calls: { bin: string; args: string[] }[] = [];
  const restoreRun = stubModuleFn(execModule, 'run', async (bin: string, args: string[]) => {
    calls.push({ bin, args });
    return { stdout: '', stderr: '' };
  });
  const restoreSudo = stubModuleFn(execModule, 'needsSudo', () => true);
  try {
    await ensureManagedScriptsDir();
    assert.equal(calls.length, 1);
    assert.equal(calls[0].bin, 'sudo');
    assert.deepEqual(calls[0].args, ['mkdir', '-p', '-m', '0750', MANAGED_SCRIPTS_DIR]);
  } finally {
    restoreRun();
    restoreSudo();
  }
});

test('ensureManagedScriptsDir() is best-effort: a failing mkdir is logged and swallowed, not thrown', async () => {
  const restoreRun = stubModuleFn(execModule, 'run', async () => {
    throw new ExecError('mkdir', ['-p', '-m', '0750', MANAGED_SCRIPTS_DIR], 1, '', 'mkdir: permission denied');
  });
  const restoreSudo = stubModuleFn(execModule, 'needsSudo', () => false);
  try {
    // Must not reject -- mirrors ensureRuntimeDir()'s best-effort behavior,
    // so a directory-creation hiccup never blocks script registration.
    // (If mkdir genuinely fails, the subsequent installPrivilegedFile()
    // write will surface its own clear error instead.)
    await ensureManagedScriptsDir();
  } finally {
    restoreRun();
    restoreSudo();
  }
});

// ---- validateManagedScriptPath / isPathInsideManagedDir: the critical
// vulnerability tests. These use the REAL MANAGED_SCRIPTS_DIR constant
// (default param) for the pure boundary/traversal checks -- none of these
// require the directory to actually exist on disk, since a nonexistent
// ancestor is tolerated (that's what lets registration of a brand-new
// filename succeed). Symlink-escape tests use a substitute temp directory
// (the function's optional `managedDir` param) since creating a symlink
// under the real /var/lib path would require root on a dev machine / CI
// runner -- the validation LOGIC exercised is identical either way; only
// the boundary constant differs. ----

test('rejects registering /etc/sudoers.d/pwn (root-RCE primitive #1)', () => {
  const result = validateManagedScriptPath('/etc/sudoers.d/pwn');
  assert.equal(result.ok, false);
  assert.equal(isPathInsideManagedDir('/etc/sudoers.d/pwn'), false);
});

test('rejects registering /etc/cron.d/pwn (root-RCE primitive #2)', () => {
  const result = validateManagedScriptPath('/etc/cron.d/pwn');
  assert.equal(result.ok, false);
});

test('rejects registering /etc/systemd/system/anything.service', () => {
  assert.equal(isPathInsideManagedDir('/etc/systemd/system/anything.service'), false);
});

test('rejects registering /root/.ssh/authorized_keys', () => {
  assert.equal(isPathInsideManagedDir('/root/.ssh/authorized_keys'), false);
});

test('rejects a path-traversal attempt that resolves outside the managed dir', () => {
  const result = validateManagedScriptPath('../../../etc/passwd');
  assert.equal(result.ok, false);
  // Whatever it resolves to (relative to cwd), it must not land inside
  // MANAGED_SCRIPTS_DIR.
  assert.equal(result.resolvedPath.startsWith(MANAGED_SCRIPTS_DIR + path.sep), false);
});

test('rejects a traversal attempt embedded inside an otherwise-plausible managed-dir-prefixed string', () => {
  // MANAGED_SCRIPTS_DIR + '/../../../etc/passwd' resolves OUTSIDE the
  // managed dir even though the raw string starts with the right prefix --
  // this is exactly why the check must be on the RESOLVED path, not a
  // naive string prefix match on the given path.
  const crafted = `${MANAGED_SCRIPTS_DIR}/../../../etc/passwd`;
  const result = validateManagedScriptPath(crafted);
  assert.equal(result.ok, false);
});

test('accepts registering a brand-new filename inside the managed dir (file need not exist yet)', () => {
  const candidate = path.join(MANAGED_SCRIPTS_DIR, 'my-script.sh');
  const result = validateManagedScriptPath(candidate);
  assert.equal(result.ok, true);
  assert.equal(result.resolvedPath, candidate);
});

test('rejects the managed directory itself (not a file)', () => {
  const result = validateManagedScriptPath(MANAGED_SCRIPTS_DIR);
  assert.equal(result.ok, false);
});

test('rejects a relative path even if textually similar to a managed-dir path', () => {
  const result = validateManagedScriptPath('var/lib/snapcast-manager/scripts/x.sh');
  assert.equal(result.ok, false);
});

// ---- symlink-escape tests, using a disposable substitute managed dir ----

test('rejects a managed-dir SUBDIRECTORY that is itself a symlink escaping the boundary', () => {
  const tmpRoot = mkTmpManagedRoot();
  const managedDir = path.join(tmpRoot, 'managed');
  const outsideDir = path.join(tmpRoot, 'outside');
  fs.mkdirSync(managedDir);
  fs.mkdirSync(outsideDir);
  try {
    // managedDir/evil-link -> outsideDir (a directory component that
    // escapes the boundary)
    fs.symlinkSync(outsideDir, path.join(managedDir, 'evil-link'));

    const candidate = path.join(managedDir, 'evil-link', 'pwn.sh');
    const result = validateManagedScriptPath(candidate, managedDir);
    assert.equal(result.ok, false);
    assert.match(result.reason ?? '', /symlink/);
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test('rejects a script file that is ITSELF a symlink pointing outside the managed dir', () => {
  const tmpRoot = mkTmpManagedRoot();
  const managedDir = path.join(tmpRoot, 'managed');
  const outsideFile = path.join(tmpRoot, 'outside-target.sh');
  fs.mkdirSync(managedDir);
  fs.writeFileSync(outsideFile, '#!/bin/sh\necho pwned\n');
  try {
    const legitLookingPath = path.join(managedDir, 'legit-looking-name.sh');
    fs.symlinkSync(outsideFile, legitLookingPath);

    const result = validateManagedScriptPath(legitLookingPath, managedDir);
    assert.equal(result.ok, false);
    assert.match(result.reason ?? '', /symlink/);
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test('accepts a symlink that resolves back inside the managed dir', () => {
  const tmpRoot = mkTmpManagedRoot();
  const managedDir = path.join(tmpRoot, 'managed');
  fs.mkdirSync(managedDir);
  try {
    const realFile = path.join(managedDir, 'real.sh');
    fs.writeFileSync(realFile, '#!/bin/sh\necho hi\n');
    const linkPath = path.join(managedDir, 'alias.sh');
    fs.symlinkSync(realFile, linkPath);

    const result = validateManagedScriptPath(linkPath, managedDir);
    assert.equal(result.ok, true);
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test('fails closed when a path component cannot be stat-ed for a reason other than "does not exist yet"', () => {
  const tmpRoot = mkTmpManagedRoot();
  const managedDir = path.join(tmpRoot, 'managed');
  fs.mkdirSync(managedDir);
  try {
    // A REGULAR FILE masquerading as a directory component produces
    // ENOTDIR when lstat-ing anything "inside" it -- not ENOENT. This must
    // be rejected, not silently treated as "doesn't exist yet, fine".
    const notADir = path.join(managedDir, 'not-a-dir');
    fs.writeFileSync(notADir, 'x');
    const candidate = path.join(notADir, 'x.sh');

    const result = validateManagedScriptPath(candidate, managedDir);
    assert.equal(result.ok, false);
    assert.match(result.reason ?? '', /could not check path component/);
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test('accepts a legitimate new path inside a substitute managed dir', () => {
  const tmpRoot = mkTmpManagedRoot();
  const managedDir = path.join(tmpRoot, 'managed');
  fs.mkdirSync(managedDir);
  try {
    const candidate = path.join(managedDir, 'new-script.sh');
    assert.equal(isPathInsideManagedDir(candidate, managedDir), true);
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

// ---- readCrontab(): crontab -l empty-crontab-is-not-an-error handling ----

test('readCrontab() returns crontab -l stdout on success', async () => {
  const restore = stubModuleFn(execModule, 'run', async (bin: string, args: string[]) => {
    assert.equal(bin, 'crontab');
    assert.deepEqual(args, ['-l']);
    return { stdout: '* * * * * echo hi\n', stderr: '' };
  });
  try {
    assert.equal(await readCrontab(), '* * * * * echo hi\n');
  } finally {
    restore();
  }
});

test('readCrontab() returns an empty string when crontab -l exits 1 (no crontab installed)', async () => {
  const restore = stubModuleFn(execModule, 'run', async () => {
    throw new ExecError('crontab', ['-l'], 1, '', 'no crontab for testuser\n');
  });
  try {
    assert.equal(await readCrontab(), '');
  } finally {
    restore();
  }
});

test('readCrontab() rethrows a real failure (non-1 exit code)', async () => {
  const restore = stubModuleFn(execModule, 'run', async () => {
    throw new ExecError('crontab', ['-l'], 2, '', 'crontab: usage error\n');
  });
  try {
    await assert.rejects(() => readCrontab());
  } finally {
    restore();
  }
});

test('readCrontab() rethrows non-ExecError failures (e.g. crontab binary missing)', async () => {
  const restore = stubModuleFn(execModule, 'run', async () => {
    throw new Error('ENOENT: spawn crontab');
  });
  try {
    await assert.rejects(() => readCrontab(), /ENOENT/);
  } finally {
    restore();
  }
});

// ---- End-to-end regression test: "register a new script, then write to
// it" on a FRESH environment where MANAGED_SCRIPTS_DIR does not exist yet.
// This is the exact gap review found: registration (validateManagedScript
// Path) tolerates a not-yet-existing target by design, but nothing ever
// created MANAGED_SCRIPTS_DIR itself, so the subsequent write (through
// installPrivilegedFile's `cp`) always failed with ENOENT on a fresh
// install. `run()` is mocked here to model a bare filesystem: `cp` only
// succeeds once `mkdir` has been called for that exact destination
// directory first -- exactly what real `cp` does when a parent directory
// is missing. `installPrivilegedFile` itself is the REAL function (only
// its `run()` dependency is mocked), consistent with
// platform/files.test.ts's own mocking style for this function -- real
// mkdtemp/write/cleanup, mocked cp/chmod. ----

/**
 * Models a bare filesystem's `mkdir`/`cp` semantics using an in-memory set
 * of "directories that exist". `cp` fails exactly like the real command
 * does when its destination's parent directory is missing.
 */
function stubFreshFilesystem(): { restore: () => void; existingDirs: Set<string> } {
  const existingDirs = new Set<string>();
  const restore = stubModuleFn(execModule, 'run', async (bin: string, args: string[]) => {
    const [cmd, ...rest] = bin === 'sudo' ? args : [bin, ...args];
    if (cmd === 'mkdir') {
      // ['-p', '-m', '0750', dir] -- the directory is always the last arg.
      existingDirs.add(rest[rest.length - 1]);
      return { stdout: '', stderr: '' };
    }
    if (cmd === 'cp') {
      const dest = rest[rest.length - 1];
      if (!existingDirs.has(path.dirname(dest))) {
        throw new ExecError('cp', rest, 1, '', `cp: cannot create regular file '${dest}': No such file or directory`);
      }
      return { stdout: '', stderr: '' };
    }
    // chmod and anything else: succeed unconditionally.
    return { stdout: '', stderr: '' };
  });
  return { restore, existingDirs };
}

test('REGRESSION: writing to a brand-new managed script fails on a fresh install without ensureManagedScriptsDir() (reproduces the reported gap)', async () => {
  const { restore } = stubFreshFilesystem();
  const restoreSudo = stubModuleFn(execModule, 'needsSudo', () => false);
  try {
    const candidate = path.join(MANAGED_SCRIPTS_DIR, 'brand-new-script.sh');
    // Registration succeeds (mirrors POST /api/tools/scripts pre-fix: no
    // directory-creation step at all).
    const validation = validateManagedScriptPath(candidate);
    assert.equal(validation.ok, true);
    // But the write (mirrors POST /api/tools/script) fails, because
    // MANAGED_SCRIPTS_DIR was never created on this fresh install.
    await assert.rejects(
      () => installPrivilegedFile(validation.resolvedPath, '#!/bin/sh\necho hi\n', { mode: 0o755 }),
      ExecError,
    );
  } finally {
    restore();
    restoreSudo();
  }
});

test('REGRESSION FIX: registering a new script then writing to it succeeds end-to-end on a fresh install once ensureManagedScriptsDir() runs first', async () => {
  const { restore } = stubFreshFilesystem();
  const restoreSudo = stubModuleFn(execModule, 'needsSudo', () => false);
  try {
    const candidate = path.join(MANAGED_SCRIPTS_DIR, 'brand-new-script.sh');
    // 1. Registration: path validation succeeds for the not-yet-existing
    //    filename (unchanged from Task 9)...
    const validation = validateManagedScriptPath(candidate);
    assert.equal(validation.ok, true);
    // 2. ...and now, as wired into POST /api/tools/scripts, the managed
    //    directory is guaranteed to exist before the registration is
    //    inserted.
    await ensureManagedScriptsDir();
    // 3. A later POST /api/tools/script write to that exact path now
    //    succeeds, because the directory exists.
    await installPrivilegedFile(validation.resolvedPath, '#!/bin/sh\necho hi\n', { mode: 0o755 });
  } finally {
    restore();
    restoreSudo();
  }
});
