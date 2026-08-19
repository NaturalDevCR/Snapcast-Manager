// eslint-disable-next-line @typescript-eslint/ban-ts-comment -- deliberate, see explanation below
// @ts-nocheck
//
// Why: see server/src/platform/systemd.test.ts's identical header for the
// full investigation into the `node --test --import ts-node/register`
// parameter-type-stripping bug this pragma works around. This file's
// `stubModuleFn` helper binds parameterized functions to module-exports
// properties (execModule.run/needsSudo, and fs/promises's
// access/readdir/stat), which hits the same bug. Correctness is
// independently confirmed with real type-checking via:
//   npx tsc --noEmit --strict --target es2020 --module commonjs \
//     --esModuleInterop --skipLibCheck src/services/backup.test.ts
// This does not affect `npm run build` (test files are excluded from
// tsconfig's project) or the production `services/backup.ts` file, which
// has no such pragma.
//
// TASK 10 -- migrates services/backup.ts off child_process.exec() string
// interpolation onto platform/exec.ts's argv-based run(). These tests must
// be RED against the pre-migration code (private methods/behavior below
// don't exist in that shape yet -- e.g. resolveExistingSources() built its
// glob results via a shell `ls` call, not fs.readdir()) and GREEN once the
// migration lands.
//
// `fs/promises` mocking note: `backup.ts` does `import fs from 'fs/promises'`
// (a DEFAULT import of a Node builtin). A namespace (`import * as`) import
// of a builtin gets wrapped by TS's `__importStar` into a fresh object with
// non-writable getter bindings, so reassigning `fsPromises.readdir = mock`
// would throw. This file therefore also uses a DEFAULT import of
// `fs/promises` (`fsPromisesDefault` below) -- which for a non-`__esModule`
// module unwraps to `{ default: <the real, mutable, process-wide fs/promises
// module object> }` -- the exact same live object `backup.ts`'s own import
// reads from at call time. Mirrors `services/pipeSources.test.ts`'s
// identical `fsPromises` default-import mocking pattern.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as execModule from '../platform/exec';
import { BackupService } from './backup';
import fsPromisesDefault from 'fs/promises';

const SYSTEMD_DIR = '/etc/systemd/system';
const BACKUP_DIR = '/var/backups/snapmanager';

function stubModuleFn(mod: any, key: string, impl: (...args: any[]) => any): () => void {
  const original = mod[key];
  mod[key] = impl;
  return () => {
    mod[key] = original;
  };
}

type Call = { bin: string; args: string[] };

function stubRun(calls: Call[]): () => void {
  return stubModuleFn(execModule, 'run', async (bin: string, args: string[]) => {
    calls.push({ bin, args });
    return { stdout: '', stderr: '' };
  });
}

function stubNeedsSudo(value: boolean): () => void {
  return stubModuleFn(execModule, 'needsSudo', () => value);
}

// ---- resolveExistingSources(): the shell-glob -> fs.readdir replacement ----
//
// Per the Task 10 brief, this uses a REAL temp directory with REAL files
// (fs.mkdtemp) rather than a purely mocked array -- the most convincing
// proof this exact kind of glob-replacement logic isn't subtly wrong. Since
// production hardcodes the literal directory `/etc/systemd/system` (which a
// test process cannot write into), `fs.readdir` itself is stubbed to point
// at the temp directory instead of mocking the directory *listing* --
// `fs.readdirSync(tmpDir)` below is real filesystem I/O against real files.

function mkTmpSystemdDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'snapmanager-test-systemd-'));
  fs.writeFileSync(path.join(dir, 'snapclient-manager-foo.service'), '');
  fs.writeFileSync(path.join(dir, 'snapclient-manager-bar.service'), '');
  fs.writeFileSync(path.join(dir, 'snapserver.service'), '');
  fs.writeFileSync(path.join(dir, 'not-a-service-file.txt'), '');
  return dir;
}

test('resolveExistingSources() lists a real directory and returns only snapclient-manager-*.service files, mapped to /etc/systemd/system full paths', async () => {
  const tmpDir = mkTmpSystemdDir();
  const restoreReaddir = stubModuleFn(fsPromisesDefault, 'readdir', async (dir: string) => {
    assert.equal(dir, SYSTEMD_DIR);
    return fs.readdirSync(tmpDir); // real fs I/O against the real temp directory
  });
  const restoreAccess = stubModuleFn(fsPromisesDefault, 'access', async () => {
    throw new Error('ENOENT'); // none of the fixed sources exist in this test
  });
  try {
    const service = new BackupService();
    const result = await (service as any).resolveExistingSources(['/etc/snapserver.conf']);
    assert.deepEqual(
      [...result].sort(),
      [
        `${SYSTEMD_DIR}/snapclient-manager-bar.service`,
        `${SYSTEMD_DIR}/snapclient-manager-foo.service`,
      ].sort(),
    );
  } finally {
    restoreReaddir();
    restoreAccess();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('resolveExistingSources() treats a missing/unreadable systemd directory as "found nothing" (matches the original `ls ... || true` swallow)', async () => {
  const restoreReaddir = stubModuleFn(fsPromisesDefault, 'readdir', async (dir: string) => {
    if (dir === SYSTEMD_DIR) {
      const err: any = new Error('ENOENT: no such file or directory');
      err.code = 'ENOENT';
      throw err;
    }
    throw new Error(`unexpected readdir(${dir})`);
  });
  const restoreAccess = stubModuleFn(fsPromisesDefault, 'access', async (p: string) => {
    if (p === '/etc/snapserver.conf') return; // this one "exists"
    throw new Error('ENOENT');
  });
  try {
    const service = new BackupService();
    const result = await (service as any).resolveExistingSources([
      '/etc/snapserver.conf',
      '/etc/snapclient-manager',
    ]);
    // The fixed source that does exist is still included; the glob part
    // contributes nothing when the directory can't be listed, but does not
    // throw or drop the sources already found.
    assert.deepEqual(result, ['/etc/snapserver.conf']);
  } finally {
    restoreReaddir();
    restoreAccess();
  }
});

// ---- createPreUpdateBackup(): tar argv correctness ----
//
// Proves the old manual-quoting bug class (`a.includes(' ') ? \`'${a}'\` :
// a`) is now structurally impossible: an argv array element containing a
// space is just an array element, passed to execFile as-is, no quoting
// needed or possible to get wrong.

function stubCreatePreUpdateBackupFs(opts: {
  existingFixedSources: string[];
  systemdEntries: string[];
  backupDirEntries?: string[];
}): () => void {
  const restores = [
    stubModuleFn(fsPromisesDefault, 'access', async (p: string) => {
      if (opts.existingFixedSources.includes(p)) return;
      throw new Error('ENOENT');
    }),
    stubModuleFn(fsPromisesDefault, 'readdir', async (dir: string) => {
      if (dir === SYSTEMD_DIR) return opts.systemdEntries;
      if (dir === BACKUP_DIR) return opts.backupDirEntries ?? [];
      throw new Error(`unexpected readdir(${dir})`);
    }),
    stubModuleFn(fsPromisesDefault, 'stat', async () => ({ size: 4096 })),
  ];
  return () => restores.forEach(r => r());
}

test('createPreUpdateBackup() invokes tar with each source as a SEPARATE argv element, including one containing a space', async () => {
  const calls: Call[] = [];
  const restoreRun = stubRun(calls);
  const restoreSudo = stubNeedsSudo(false);
  const restoreFs = stubCreatePreUpdateBackupFs({
    existingFixedSources: ['/etc/snapserver.conf'],
    systemdEntries: ['snapclient-manager-my station.service', 'snapserver.service'],
  });
  try {
    const service = new BackupService();
    const result = await service.createPreUpdateBackup('snapclient');

    const tarCalls = calls.filter(c => c.bin === 'tar');
    assert.equal(tarCalls.length, 1);
    const tarArgs = tarCalls[0].args;

    assert.equal(tarArgs[0], 'czf');
    assert.match(tarArgs[1], /^\/var\/backups\/snapmanager\/pre-snapclient-\d{8}-\d{6}\.tar\.gz$/);
    assert.equal(tarArgs[2], '--absolute-names');
    // Sources appear as separate argv elements, unmodified (no quoting, no
    // joining) -- including the one with a space in it.
    assert.deepEqual(tarArgs.slice(3), [
      '/etc/snapserver.conf',
      `${SYSTEMD_DIR}/snapclient-manager-my station.service`,
    ]);

    assert.deepEqual(result.files, [
      '/etc/snapserver.conf',
      `${SYSTEMD_DIR}/snapclient-manager-my station.service`,
    ]);
  } finally {
    restoreRun();
    restoreSudo();
    restoreFs();
  }
});

test('createPreUpdateBackup() sudo-gates BOTH the tar and chmod calls via argv when needsSudo() is true', async () => {
  const calls: Call[] = [];
  const restoreRun = stubRun(calls);
  const restoreSudo = stubNeedsSudo(true);
  const restoreFs = stubCreatePreUpdateBackupFs({
    existingFixedSources: ['/etc/snapserver.conf'],
    systemdEntries: [],
  });
  try {
    const service = new BackupService();
    await service.createPreUpdateBackup('snapclient');

    const tarCalls = calls.filter(c => c.args[0] === 'tar');
    const chmodCalls = calls.filter(c => c.args[0] === 'chmod');
    assert.equal(tarCalls.length, 1);
    assert.equal(chmodCalls.length, 1);
    assert.equal(tarCalls[0].bin, 'sudo');
    assert.equal(chmodCalls[0].bin, 'sudo');
    assert.deepEqual(chmodCalls[0].args.slice(0, 2), ['chmod', '600']);
  } finally {
    restoreRun();
    restoreSudo();
    restoreFs();
  }
});

test('createPreUpdateBackup() does NOT sudo-gate tar/chmod when needsSudo() is false', async () => {
  const calls: Call[] = [];
  const restoreRun = stubRun(calls);
  const restoreSudo = stubNeedsSudo(false);
  const restoreFs = stubCreatePreUpdateBackupFs({
    existingFixedSources: ['/etc/snapserver.conf'],
    systemdEntries: [],
  });
  try {
    const service = new BackupService();
    await service.createPreUpdateBackup('snapclient');

    assert.equal(calls.some(c => c.bin === 'sudo'), false);
    assert.equal(calls.some(c => c.bin === 'tar'), true);
    assert.equal(calls.some(c => c.bin === 'chmod'), true);
  } finally {
    restoreRun();
    restoreSudo();
    restoreFs();
  }
});

test('createPreUpdateBackup() skips tar entirely when no sources exist (no files to back up)', async () => {
  const calls: Call[] = [];
  const restoreRun = stubRun(calls);
  const restoreSudo = stubNeedsSudo(false);
  const restoreFs = stubCreatePreUpdateBackupFs({
    existingFixedSources: [],
    systemdEntries: [],
  });
  try {
    const service = new BackupService();
    const result = await service.createPreUpdateBackup('snapclient');

    assert.equal(calls.some(c => c.bin === 'tar' || c.args?.[0] === 'tar'), false);
    assert.equal(result.path, '');
    assert.deepEqual(result.files, []);
  } finally {
    restoreRun();
    restoreSudo();
    restoreFs();
  }
});

// ---- sudo/non-sudo argv split: exact-argv discipline (Task 4's caught bug
// class -- a claimed-but-untested sudo split turned out false; the fix was
// requiring exact-argv assertions, not just "doesn't throw"). ----

test('ensureBackupDir() runs mkdir -p on BACKUP_DIR via argv (no sudo) when needsSudo() is false', async () => {
  const calls: Call[] = [];
  const restoreRun = stubRun(calls);
  const restoreSudo = stubNeedsSudo(false);
  try {
    const service = new BackupService();
    await (service as any).ensureBackupDir();
    assert.equal(calls.length, 1);
    assert.equal(calls[0].bin, 'mkdir');
    assert.deepEqual(calls[0].args, ['-p', BACKUP_DIR]);
  } finally {
    restoreRun();
    restoreSudo();
  }
});

test('ensureBackupDir() sudo-gates the mkdir call via argv when needsSudo() is true', async () => {
  const calls: Call[] = [];
  const restoreRun = stubRun(calls);
  const restoreSudo = stubNeedsSudo(true);
  try {
    const service = new BackupService();
    await (service as any).ensureBackupDir();
    assert.equal(calls.length, 1);
    assert.equal(calls[0].bin, 'sudo');
    assert.deepEqual(calls[0].args, ['mkdir', '-p', BACKUP_DIR]);
  } finally {
    restoreRun();
    restoreSudo();
  }
});

test('deleteBackup() runs rm -f on the full path via argv (no sudo) when needsSudo() is false', async () => {
  const calls: Call[] = [];
  const restoreRun = stubRun(calls);
  const restoreSudo = stubNeedsSudo(false);
  try {
    const service = new BackupService();
    await service.deleteBackup('pre-general-20260101-120000.tar.gz');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].bin, 'rm');
    assert.deepEqual(calls[0].args, ['-f', `${BACKUP_DIR}/pre-general-20260101-120000.tar.gz`]);
  } finally {
    restoreRun();
    restoreSudo();
  }
});

test('deleteBackup() sudo-gates the rm call via argv when needsSudo() is true', async () => {
  const calls: Call[] = [];
  const restoreRun = stubRun(calls);
  const restoreSudo = stubNeedsSudo(true);
  try {
    const service = new BackupService();
    await service.deleteBackup('pre-general-20260101-120000.tar.gz');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].bin, 'sudo');
    assert.deepEqual(calls[0].args, ['rm', '-f', `${BACKUP_DIR}/pre-general-20260101-120000.tar.gz`]);
  } finally {
    restoreRun();
    restoreSudo();
  }
});

test('deleteBackup() rejects an invalid backup filename BEFORE ever calling run() (existing regex guard preserved)', async () => {
  const calls: Call[] = [];
  const restoreRun = stubRun(calls);
  const restoreSudo = stubNeedsSudo(false);
  try {
    const service = new BackupService();
    await assert.rejects(() => service.deleteBackup('../../etc/passwd'), /Invalid backup name format/);
    assert.equal(calls.length, 0);
  } finally {
    restoreRun();
    restoreSudo();
  }
});

test('restoreBackup() runs tar -xPzf on the full path via argv, sudo-gated when needsSudo() is true', async () => {
  const calls: Call[] = [];
  const restoreRun = stubRun(calls);
  const restoreSudo = stubNeedsSudo(true);
  const restoreAccess = stubModuleFn(fsPromisesDefault, 'access', async () => {}); // backup "exists"
  try {
    const service = new BackupService();
    const message = await service.restoreBackup('pre-general-20260101-120000.tar.gz');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].bin, 'sudo');
    assert.deepEqual(calls[0].args, [
      'tar',
      '-xPzf',
      `${BACKUP_DIR}/pre-general-20260101-120000.tar.gz`,
    ]);
    assert.match(message, /Restored from/);
  } finally {
    restoreRun();
    restoreSudo();
    restoreAccess();
  }
});

test('restoreBackup() rejects an invalid backup filename BEFORE ever calling run() (existing regex guard preserved)', async () => {
  const calls: Call[] = [];
  const restoreRun = stubRun(calls);
  const restoreSudo = stubNeedsSudo(false);
  try {
    const service = new BackupService();
    await assert.rejects(() => service.restoreBackup('not-a-backup.sh'), /Invalid backup name format/);
    assert.equal(calls.length, 0);
  } finally {
    restoreRun();
    restoreSudo();
  }
});

test('restoreBackup() rejects when the backup file does not exist on disk', async () => {
  const calls: Call[] = [];
  const restoreRun = stubRun(calls);
  const restoreSudo = stubNeedsSudo(false);
  const restoreAccess = stubModuleFn(fsPromisesDefault, 'access', async () => {
    throw new Error('ENOENT');
  });
  try {
    const service = new BackupService();
    await assert.rejects(
      () => service.restoreBackup('pre-general-20260101-120000.tar.gz'),
      /not found/,
    );
    assert.equal(calls.length, 0);
  } finally {
    restoreRun();
    restoreSudo();
    restoreAccess();
  }
});

// ---- cleanupOldBackups(): retention count (MAX_BACKUPS = 15) unchanged ----

test('cleanupOldBackups() deletes only the oldest backups beyond MAX_BACKUPS=15, keeping the newest 15', async () => {
  const calls: Call[] = [];
  const restoreRun = stubRun(calls);
  const restoreSudo = stubNeedsSudo(false);

  const names: string[] = [];
  for (let i = 1; i <= 17; i++) {
    names.push(`pre-x-20260101-${String(i).padStart(6, '0')}.tar.gz`);
  }
  const restoreReaddir = stubModuleFn(fsPromisesDefault, 'readdir', async (dir: string) => {
    if (dir === BACKUP_DIR) return names;
    throw new Error(`unexpected readdir(${dir})`);
  });

  try {
    const service = new BackupService();
    await (service as any).cleanupOldBackups();

    const rmCalls = calls.filter(c => c.bin === 'rm');
    assert.equal(rmCalls.length, 2); // 17 - MAX_BACKUPS(15) = 2 deleted
    assert.deepEqual(
      rmCalls.map(c => c.args[1]).sort(),
      [
        `${BACKUP_DIR}/pre-x-20260101-000001.tar.gz`,
        `${BACKUP_DIR}/pre-x-20260101-000002.tar.gz`,
      ].sort(),
    );
  } finally {
    restoreRun();
    restoreSudo();
    restoreReaddir();
  }
});
