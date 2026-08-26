// eslint-disable-next-line @typescript-eslint/ban-ts-comment -- deliberate, see explanation below
// @ts-nocheck
//
// Why: see server/src/platform/systemd.test.ts's identical header for the
// full investigation into the `node --test --import ts-node/register`
// parameter-type-stripping bug this pragma works around. This file's
// mocking helpers (stubModuleFn/stubFetch/etc) bind parameterized functions
// to module-exports properties and to `globalThis.fetch`, which hits the
// same bug. Correctness is independently confirmed with real type-checking
// via:
//   npx tsc --noEmit --strict --target es2020 --module commonjs \
//     --esModuleInterop --skipLibCheck src/services/system.test.ts
// This does not affect `npm run build` (test files are excluded from
// tsconfig's project) or the production `services/system.ts` file, which
// has no such pragma and is fully type-checked.
//
// TASK 11 -- migrates most of services/system.ts off child_process.exec()
// string interpolation (and, in several places, off shelling out at all)
// onto platform/exec.ts's argv-based run(), platform/systemd.ts,
// platform/apt.ts, platform/files.ts, and native fetch(). Six functions were
// explicitly OUT OF SCOPE for Task 11 (deferred to Task 12):
// updateSnapserverFromGitHub, updateSnapclientFromGitHub, executeDebUpdate,
// installShairportSync, installSnapCtrl, getDistroCodename.
//
// TASK 12 -- migrates those six remaining functions, closing out this
// file's shell-injection-prone-pattern matches entirely (see
// scripts/check-no-shell-injection.sh). See the "TASK 12" test sections
// below for the new coverage.
//
// Design: most tests stub only the LOWEST layer -- platform/exec.ts's
// run()/needsSudo() and global fetch() -- and let the REAL platform/apt.ts,
// platform/systemd.ts, platform/files.ts code execute against that mock.
// This gives genuine end-to-end exact-argv assertions for the full command
// that would reach the OS (including the sudo split), rather than merely
// asserting system.ts calls some wrapper with the right-looking arguments.
// fs/promises mocking follows services/pipeSources.test.ts's/backup.test.ts's
// established pattern: a DEFAULT import of the 'fs/promises' builtin
// (`fsPromisesDefault` below), which unwraps to the real, mutable,
// process-wide fs/promises module object -- the exact one platform/files.ts's
// readTextFile()/installPrivilegedFile() and this file's own `fs.promises.*`
// calls read from at call time.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import fsPromisesDefault from 'fs/promises';
import * as execModule from '../platform/exec';
import * as aptModule from '../platform/apt';
import * as filesModule from '../platform/files';
import * as backupModule from './backup';
import * as systemdModule from '../platform/systemd';
import * as snapclientInstancesModule from './snapclientInstances';
import * as jobsModule from './jobs';
import * as configModule from './config';
import { SystemService, selectSnapCtrlDownloadUrl } from './system';

type RunFn = typeof execModule.run;
type NeedsSudoFn = typeof execModule.needsSudo;
type Call = { bin: string; args: string[]; opts?: unknown };

function stubModuleFn(mod: any, key: string, impl: (...args: any[]) => any): () => void {
  const original = mod[key];
  mod[key] = impl;
  return () => {
    mod[key] = original;
  };
}

function stubRun(impl: RunFn): () => void {
  return stubModuleFn(execModule, 'run', impl);
}

function stubNeedsSudo(value: boolean): () => void {
  return stubModuleFn(execModule, 'needsSudo', () => value);
}

function stubRunRecording(calls: Call[]): () => void {
  return stubRun(async (bin: string, args: string[], opts?: unknown) => {
    calls.push({ bin, args, opts });
    return { stdout: '', stderr: '' };
  });
}

/** Every install/update/uninstall test stubs this away so services/backup.ts's
 * own real (unstubbed) `mkdir -p /var/backups/snapmanager` call doesn't
 * pollute this file's exact-argv assertions with an unrelated run() call. */
function stubNoBackup(): () => void {
  return stubModuleFn(backupModule.backupService, 'createPreUpdateBackup', async () => ({
    path: '', fileName: '', size: 0, timestamp: '', components: [], files: [],
  }));
}

/** Task 59: installPackage()'s new post-install verification (see
 * verifyServiceOrRollback() in system.ts) polls platform/systemd.ts's
 * isActive() after the 5 known-service install branches. Stubbing it
 * directly here (rather than making the generic run()/stubRunRecording()
 * stub return "active" for a `systemctl is-active` call) keeps this file's
 * many pre-existing exact-argv assertions unaffected -- those tests are
 * about the install COMMAND SEQUENCE, not this task's rollback logic
 * (covered by its own dedicated tests further below). */
function stubServiceUp(): () => void {
  return stubModuleFn(systemdModule, 'isActive', async () => true);
}

/**
 * Records every jobService.log() call made during a test. jobService.log()
 * is normally a no-op unless a job is currently running (see jobs.ts's
 * `if (!this.currentJobId) return;`) -- these tests call SystemService
 * methods directly, bypassing jobService.start(), so without this stub every
 * jobService.log() call in system.ts would silently no-op and there would be
 * nothing to assert on. Mirrors this file's other stubModuleFn()-based
 * stubs (stubRun/stubNeedsSudo/etc).
 */
function stubJobLog(): { calls: string[]; restore: () => void } {
  const calls: string[] = [];
  const restore = stubModuleFn(jobsModule.jobService, 'log', (line: string) => {
    calls.push(line);
  });
  return { calls, restore };
}

function stubFetch(impl: typeof fetch): () => void {
  const original = globalThis.fetch;
  (globalThis as any).fetch = impl;
  return () => {
    (globalThis as any).fetch = original;
  };
}

function jsonResponse(status: number, body: any): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

function textResponse(status: number, body: string): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => JSON.parse(body),
    text: async () => body,
  } as unknown as Response;
}

/** Stubs a fixed set of fs/promises functions, restoring all of them
 * together. Mirrors pipeSources.test.ts's/backup.test.ts's stubFsPromises. */
function stubFsPromises(overrides: Record<string, (...args: any[]) => any>): () => void {
  const restores = Object.keys(overrides).map(key => stubModuleFn(fsPromisesDefault, key, overrides[key]));
  return () => restores.forEach(r => r());
}

/** Stubs fs.promises.readFile ONLY for the given fixed paths (path -> fixed
 * string content); every other path (e.g. dearmorGpgKey()'s own real temp
 * files) falls through to the REAL fs.promises.readFile untouched. Needed
 * because several installMympd() tests below stub the /etc/os-release read
 * while installMympd() itself ALSO drives real (unmocked) temp-file I/O via
 * dearmorGpgKey() -- a path-blind readFile stub would incorrectly intercept
 * that unrelated real file too. */
function stubReadFileForPaths(fixedContents: Record<string, string>): () => void {
  const original = fsPromisesDefault.readFile;
  return stubModuleFn(fsPromisesDefault, 'readFile', async (p: string, ...rest: any[]) => {
    if (Object.prototype.hasOwnProperty.call(fixedContents, p)) return fixedContents[p];
    return (original as any)(p, ...rest);
  });
}

function freshService(): SystemService {
  return new SystemService();
}

// ============================================================
// getLatestGitHubRelease() (private) -- native fetch() replacing `curl`
// ============================================================

test('getLatestGitHubRelease() fetches the GitHub API URL and returns the parsed release on success', async () => {
  const calls: { url: string; opts: any }[] = [];
  const restoreFetch = stubFetch(async (url: any, opts: any) => {
    calls.push({ url: String(url), opts });
    return jsonResponse(200, { tag_name: 'v1.2.3', assets: [] });
  });
  try {
    const service = freshService();
    const release = await (service as any).getLatestGitHubRelease('badaix', 'snapcast');
    assert.equal(release.tag_name, 'v1.2.3');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, 'https://api.github.com/repos/badaix/snapcast/releases/latest');
    assert.ok(calls[0].opts?.signal, 'expected an AbortSignal (timeout) to be passed');
  } finally {
    restoreFetch();
  }
});

test('getLatestGitHubRelease() throws a clear error on a non-ok HTTP status', async () => {
  const restoreFetch = stubFetch(async () => jsonResponse(404, {}));
  try {
    const service = freshService();
    await assert.rejects(
      () => (service as any).getLatestGitHubRelease('badaix', 'snapcast'),
      /404/,
    );
  } finally {
    restoreFetch();
  }
});

test('getLatestGitHubRelease() throws when the response has no tag_name', async () => {
  const restoreFetch = stubFetch(async () => jsonResponse(200, { assets: [] }));
  try {
    const service = freshService();
    await assert.rejects(() => (service as any).getLatestGitHubRelease('badaix', 'snapcast'));
  } finally {
    restoreFetch();
  }
});

test('getLatestGitHubRelease() caches within the TTL: two calls within the window only fetch once', async () => {
  let fetchCount = 0;
  const restoreFetch = stubFetch(async () => {
    fetchCount++;
    return jsonResponse(200, { tag_name: 'v9.9.9', assets: [] });
  });
  try {
    const service = freshService();
    const first = await (service as any).getLatestGitHubRelease('owner', 'repo');
    const second = await (service as any).getLatestGitHubRelease('owner', 'repo');
    assert.equal(fetchCount, 1);
    assert.equal(first.tag_name, 'v9.9.9');
    assert.equal(second.tag_name, 'v9.9.9');
  } finally {
    restoreFetch();
  }
});

test('getLatestGitHubRelease() caches per owner/repo independently', async () => {
  let fetchCount = 0;
  const restoreFetch = stubFetch(async (url: any) => {
    fetchCount++;
    return jsonResponse(200, { tag_name: String(url).includes('snap-ctrl') ? 'v1' : 'v2', assets: [] });
  });
  try {
    const service = freshService();
    await (service as any).getLatestGitHubRelease('badaix', 'snapcast');
    await (service as any).getLatestGitHubRelease('NaturalDevCR', 'snap-ctrl');
    assert.equal(fetchCount, 2);
  } finally {
    restoreFetch();
  }
});

// ============================================================
// getLatestAvailableVersion() -- apt-cache policy pipe elimination
// ============================================================

test('getLatestAvailableVersion() parses the Candidate: line from full `apt-cache policy` output (no shell pipe)', async () => {
  const calls: Call[] = [];
  const restoreRun = stubRunRecording(calls);
  const restoreSudo = stubNeedsSudo(false);
  const restoreRunImpl = stubRun(async (bin: string, args: string[]) => {
    calls.push({ bin, args });
    return {
      stdout: `mpd:\n  Installed: 0.23.5-1\n  Candidate: 0.23.5-1\n  Version table:\n *** 0.23.5-1 500\n        500 http://deb.debian.org/debian bookworm/main amd64 Packages\n`,
      stderr: '',
    };
  });
  try {
    const service = freshService();
    const version = await service.getLatestAvailableVersion('mpd' as any);
    assert.equal(version, '0.23.5-1');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].bin, 'apt-cache');
    assert.deepEqual(calls[0].args, ['policy', 'mpd']);
  } finally {
    restoreRunImpl();
    restoreSudo();
  }
});

test('getLatestAvailableVersion() returns "unknown" for the "(none)" candidate case', async () => {
  const restoreSudo = stubNeedsSudo(false);
  const restoreRun = stubRun(async () => ({
    stdout: `ffmpeg:\n  Installed: (none)\n  Candidate: (none)\n  Version table:\n`,
    stderr: '',
  }));
  try {
    const service = freshService();
    const version = await service.getLatestAvailableVersion('ffmpeg' as any);
    assert.equal(version, 'unknown');
  } finally {
    restoreRun();
    restoreSudo();
  }
});

test('getLatestAvailableVersion() never shells through `grep`/`awk` -- run() is called with a plain argv, never a template string containing "|"', async () => {
  const calls: Call[] = [];
  const restoreSudo = stubNeedsSudo(false);
  const restoreRun = stubRunRecording(calls);
  try {
    const service = freshService();
    await service.getLatestAvailableVersion('ffmpeg' as any);
    assert.equal(calls.length, 1);
    for (const arg of calls[0].args) {
      assert.ok(!arg.includes('|'), `unexpected shell pipe character in argv: ${JSON.stringify(arg)}`);
    }
  } finally {
    restoreRun();
    restoreSudo();
  }
});

// ============================================================
// updateNodeJs() (Task 17) -- replaces the `curl | sudo bash -` pattern
// (which needed a general-purpose bash/shell sudoers grant Task 16's
// sudoers.d/snapcast-manager deliberately does NOT provide, so this feature
// failed outright on a migrated non-root install) with the SAME
// architecture already shipped for installMympd() above: native fetch()
// for the GPG key, dearmorGpgKey() (reused directly, not duplicated),
// installPrivilegedFile() for the keyring + APT source-list files, and
// apt.update()/apt.install() -- zero new sudoers surface, every primitive
// (gpg, mkdir, installPrivilegedFile's cp/chmod, apt-get) is already
// granted.
// ============================================================

const NODESOURCE_KEY_URL = 'https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key';
const FAKE_ARMORED_KEY = '-----BEGIN PGP PUBLIC KEY BLOCK-----\nfake\n-----END PGP PUBLIC KEY BLOCK-----\n';

/** Stubs platform/apt.ts's install()/update() and platform/files.ts's
 * installPrivilegedFile() directly (per task-17-brief.md's testing
 * guidance), recording every call into a single shared `order` array so
 * ordering across the three can be asserted precisely. `run()`/`needsSudo()`
 * are stubbed separately (via stubGpgDearmor below) since dearmorGpgKey()
 * and the `mkdir -p /etc/apt/keyrings` step are real code driving real
 * (stubbed) run() calls. */
function stubUpdateNodeJsDeps(): {
  order: string[];
  installFileCalls: { destPath: string; content: any; opts: any }[];
  aptInstallCalls: string[][];
  aptUpdateCalls: number;
  restore: () => void;
} {
  const order: string[] = [];
  const installFileCalls: { destPath: string; content: any; opts: any }[] = [];
  const aptInstallCalls: string[][] = [];
  const state = { aptUpdateCalls: 0 };
  const restoreAptInstall = stubModuleFn(aptModule, 'install', async (pkgs: string[]) => {
    order.push(`apt-install:${pkgs.join(',')}`);
    aptInstallCalls.push(pkgs);
  });
  const restoreAptUpdate = stubModuleFn(aptModule, 'update', async () => {
    order.push('apt-update');
    state.aptUpdateCalls++;
  });
  const restoreInstallFile = stubModuleFn(filesModule, 'installPrivilegedFile', async (destPath: string, content: any, opts?: any) => {
    order.push(`install-file:${destPath}`);
    installFileCalls.push({ destPath, content, opts });
  });
  return {
    order,
    installFileCalls,
    aptInstallCalls,
    get aptUpdateCalls() { return state.aptUpdateCalls; },
    restore: () => { restoreAptInstall(); restoreAptUpdate(); restoreInstallFile(); },
  } as any;
}

test('updateNodeJs() fetches the NodeSource GPG key from the documented, dedicated key URL (not the old setup_N.x script URL)', async () => {
  const fetchCalls: string[] = [];
  const restoreFetch = stubFetch(async (url: any) => {
    fetchCalls.push(String(url));
    return textResponse(200, FAKE_ARMORED_KEY);
  });
  const restoreSudo = stubNeedsSudo(false);
  const calls: Call[] = [];
  const restoreRun = stubGpgDearmor(Buffer.from([0x99, 0x01, 0x02]))(calls);
  const deps = stubUpdateNodeJsDeps();
  try {
    const service = freshService();
    await service.updateNodeJs('20');
    assert.deepEqual(fetchCalls, [NODESOURCE_KEY_URL]);
  } finally {
    restoreFetch();
    restoreRun();
    restoreSudo();
    deps.restore();
  }
});

test('updateNodeJs() performs the exact NodeSource APT-repo sequence in order: install gpg -> keyring install -> source-list install -> single apt update -> nodejs install', async () => {
  const restoreFetch = stubFetch(async () => textResponse(200, FAKE_ARMORED_KEY));
  const restoreSudo = stubNeedsSudo(false);
  const calls: Call[] = [];
  const restoreRun = stubGpgDearmor(Buffer.from([0x99, 0x01, 0x02]))(calls);
  const deps = stubUpdateNodeJsDeps();
  try {
    const service = freshService();
    await service.updateNodeJs('20');
    assert.deepEqual(deps.order, [
      'apt-install:gpg',
      'install-file:/etc/apt/keyrings/nodesource.gpg',
      'install-file:/etc/apt/sources.list.d/nodesource.list',
      'apt-update',
      'apt-install:nodejs',
    ]);
    // Only ONE apt.update() -- unlike installMympd()'s two-update
    // structure, this feature only needs a single update, right before the
    // nodejs install, after the new repo has been added.
    assert.equal(deps.aptUpdateCalls, 1);
  } finally {
    restoreFetch();
    restoreRun();
    restoreSudo();
    deps.restore();
  }
});

test('updateNodeJs() creates /etc/apt/keyrings (sudo-prefixed via argv when needsSudo() is true) before installing the keyring, mirroring installMympd()', async () => {
  const restoreFetch = stubFetch(async () => textResponse(200, FAKE_ARMORED_KEY));
  const restoreSudo = stubNeedsSudo(true);
  const calls: Call[] = [];
  const restoreRun = stubGpgDearmor(Buffer.from([1, 2, 3]))(calls);
  const deps = stubUpdateNodeJsDeps();
  try {
    const service = freshService();
    await service.updateNodeJs('20');
    const mkdirCall = calls.find(c => c.bin === 'sudo' && c.args[0] === 'mkdir');
    assert.ok(mkdirCall, 'expected a sudo-prefixed mkdir -p /etc/apt/keyrings');
    assert.deepEqual(mkdirCall!.args, ['mkdir', '-p', '/etc/apt/keyrings']);
  } finally {
    restoreFetch();
    restoreRun();
    restoreSudo();
    deps.restore();
  }
});

test('updateNodeJs() installs the dearmored key at /etc/apt/keyrings/nodesource.gpg with mode 0o644, bytes matching gpg --dearmor\'s real output', async () => {
  const restoreFetch = stubFetch(async () => textResponse(200, FAKE_ARMORED_KEY));
  const restoreSudo = stubNeedsSudo(false);
  const dearmoredBytes = Buffer.from([0x99, 0x01, 0xff, 0x00, 0x47, 0x50, 0x47]);
  const calls: Call[] = [];
  const restoreRun = stubGpgDearmor(dearmoredBytes)(calls);
  const deps = stubUpdateNodeJsDeps();
  try {
    const service = freshService();
    await service.updateNodeJs('20');
    const keyringInstall = deps.installFileCalls.find(f => f.destPath === '/etc/apt/keyrings/nodesource.gpg');
    assert.ok(keyringInstall, 'expected the dearmored keyring to be installed to /etc/apt/keyrings/nodesource.gpg');
    assert.ok((keyringInstall!.content as Buffer).equals(dearmoredBytes), 'installed keyring bytes must exactly match gpg --dearmor\'s output');
    assert.equal(keyringInstall!.opts?.mode, 0o644);

    const gpgCall = calls.find(c => c.bin === 'gpg');
    assert.ok(gpgCall, 'expected gpg --dearmor to be invoked (reusing dearmorGpgKey(), not duplicated)');
    assert.equal(gpgCall!.args[0], '--dearmor');
  } finally {
    restoreFetch();
    restoreRun();
    restoreSudo();
    deps.restore();
  }
});

test('updateNodeJs() writes the source-list entry with EXACTLY the right content for the given major version (node_20.x, not node_20 or 20.x alone)', async () => {
  const restoreFetch = stubFetch(async () => textResponse(200, FAKE_ARMORED_KEY));
  const restoreSudo = stubNeedsSudo(false);
  const calls: Call[] = [];
  const restoreRun = stubGpgDearmor(Buffer.from([1, 2, 3]))(calls);
  const deps = stubUpdateNodeJsDeps();
  try {
    const service = freshService();
    await service.updateNodeJs('20');
    const sourcesInstall = deps.installFileCalls.find(f => f.destPath === '/etc/apt/sources.list.d/nodesource.list');
    assert.ok(sourcesInstall, 'expected a sources.list.d entry to be installed');
    assert.equal(
      sourcesInstall!.content,
      'deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_20.x nodistro main\n',
    );
    assert.equal(sourcesInstall!.opts?.mode, 0o644);
  } finally {
    restoreFetch();
    restoreRun();
    restoreSudo();
    deps.restore();
  }
});

test('updateNodeJs() interpolates the requested major version into the repo URL, not a hardcoded one (version 18 case)', async () => {
  const restoreFetch = stubFetch(async () => textResponse(200, FAKE_ARMORED_KEY));
  const restoreSudo = stubNeedsSudo(false);
  const calls: Call[] = [];
  const restoreRun = stubGpgDearmor(Buffer.from([1, 2, 3]))(calls);
  const deps = stubUpdateNodeJsDeps();
  try {
    const service = freshService();
    await service.updateNodeJs('18');
    const sourcesInstall = deps.installFileCalls.find(f => f.destPath === '/etc/apt/sources.list.d/nodesource.list');
    assert.equal(
      sourcesInstall!.content,
      'deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_18.x nodistro main\n',
    );
  } finally {
    restoreFetch();
    restoreRun();
    restoreSudo();
    deps.restore();
  }
});

test('updateNodeJs() installs nodejs via platform/apt.ts install() as the final step', async () => {
  const restoreFetch = stubFetch(async () => textResponse(200, FAKE_ARMORED_KEY));
  const restoreSudo = stubNeedsSudo(false);
  const calls: Call[] = [];
  const restoreRun = stubGpgDearmor(Buffer.from([1, 2, 3]))(calls);
  const deps = stubUpdateNodeJsDeps();
  try {
    const service = freshService();
    await service.updateNodeJs('20');
    assert.deepEqual(deps.aptInstallCalls[deps.aptInstallCalls.length - 1], ['nodejs']);
  } finally {
    restoreFetch();
    restoreRun();
    restoreSudo();
    deps.restore();
  }
});

test('updateNodeJs() never invokes bash or any general-purpose shell (regression guard: the whole point of this fix)', async () => {
  const restoreFetch = stubFetch(async () => textResponse(200, FAKE_ARMORED_KEY));
  const restoreSudo = stubNeedsSudo(true);
  const calls: Call[] = [];
  const restoreRun = stubGpgDearmor(Buffer.from([1, 2, 3]))(calls);
  const deps = stubUpdateNodeJsDeps();
  try {
    const service = freshService();
    await service.updateNodeJs('20');
    for (const call of calls) {
      assert.notEqual(call.bin, 'bash');
      assert.ok(!call.args.includes('bash'), `unexpected bash invocation via argv: ${JSON.stringify(call)}`);
    }
  } finally {
    restoreFetch();
    restoreRun();
    restoreSudo();
    deps.restore();
  }
});

test('updateNodeJs() rejects an invalid version without ever calling fetch()', async () => {
  let fetchCalled = false;
  const restoreFetch = stubFetch(async () => {
    fetchCalled = true;
    return textResponse(200, '');
  });
  try {
    const service = freshService();
    await assert.rejects(() => service.updateNodeJs('not-a-version'));
    assert.equal(fetchCalled, false);
  } finally {
    restoreFetch();
  }
});

test('updateNodeJs() throws a clear error when the NodeSource GPG key fetch is not ok', async () => {
  const restoreFetch = stubFetch(async () => textResponse(404, ''));
  const restoreSudo = stubNeedsSudo(false);
  const restoreRun = stubRun(async () => ({ stdout: '', stderr: '' }));
  const deps = stubUpdateNodeJsDeps();
  try {
    const service = freshService();
    await assert.rejects(() => service.updateNodeJs('20'), /404/);
    assert.equal(deps.installFileCalls.length, 0, 'must not install any files after a failed key fetch');
  } finally {
    restoreFetch();
    restoreRun();
    restoreSudo();
    deps.restore();
  }
});

test('updateNodeJs() logs progress at every real step, not just once at the end', async () => {
  const restoreFetch = stubFetch(async () => textResponse(200, FAKE_ARMORED_KEY));
  const restoreSudo = stubNeedsSudo(false);
  const calls: Call[] = [];
  const restoreRun = stubGpgDearmor(Buffer.from([1, 2, 3]))(calls);
  const deps = stubUpdateNodeJsDeps();
  const { calls: logCalls, restore: restoreJobLog } = stubJobLog();
  try {
    const service = freshService();
    await service.updateNodeJs('20');
    assert.ok(logCalls.length > 3, `expected multiple progress log lines, got ${logCalls.length}: ${JSON.stringify(logCalls)}`);
    for (const fragment of ['gpg', 'keyring', 'repository', 'package lists', 'nodejs']) {
      assert.ok(logCalls.some(l => l.toLowerCase().includes(fragment)), `expected a log line mentioning "${fragment}", got: ${JSON.stringify(logCalls)}`);
    }
  } finally {
    restoreFetch();
    restoreRun();
    restoreSudo();
    deps.restore();
    restoreJobLog();
  }
});

// ============================================================
// isInstalled()
// ============================================================

test('isInstalled("snap-ctrl") returns true when the install directory is non-empty (fs.readdir, no shell test)', async () => {
  const restoreFs = stubFsPromises({
    readdir: async (p: string) => {
      assert.equal(p, '/usr/share/snapserver/snap-ctrl');
      return ['index.html', 'assets'];
    },
  });
  try {
    const service = freshService();
    assert.equal(await service.isInstalled('snap-ctrl'), true);
  } finally {
    restoreFs();
  }
});

test('isInstalled("snap-ctrl") returns false when the directory is empty or missing', async () => {
  const restoreFsEmpty = stubFsPromises({ readdir: async () => [] });
  try {
    const service = freshService();
    assert.equal(await service.isInstalled('snap-ctrl'), false);
  } finally {
    restoreFsEmpty();
  }

  const restoreFsMissing = stubFsPromises({
    readdir: async () => { const e: any = new Error('ENOENT'); e.code = 'ENOENT'; throw e; },
  });
  try {
    const service = freshService();
    assert.equal(await service.isInstalled('snap-ctrl'), false);
  } finally {
    restoreFsMissing();
  }
});

test('isInstalled("shairport-sync") returns true when /usr/local/bin/shairport-sync exists', async () => {
  const restoreFs = stubFsPromises({ access: async (p: string) => { assert.equal(p, '/usr/local/bin/shairport-sync'); } });
  try {
    const service = freshService();
    assert.equal(await service.isInstalled('shairport-sync'), true);
  } finally {
    restoreFs();
  }
});

test('isInstalled("shairport-sync") falls back to a real `which` invocation (not the "command" shell builtin) when the fixed path is missing', async () => {
  const calls: Call[] = [];
  const restoreFs = stubFsPromises({ access: async () => { throw new Error('ENOENT'); } });
  const restoreRun = stubRunRecording(calls);
  try {
    const service = freshService();
    const result = await service.isInstalled('shairport-sync');
    assert.equal(result, true);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].bin, 'which');
    assert.deepEqual(calls[0].args, ['shairport-sync']);
  } finally {
    restoreFs();
    restoreRun();
  }
});

test('isInstalled("shairport-sync") returns false when both the fixed path and `which` fail', async () => {
  const restoreFs = stubFsPromises({ access: async () => { throw new Error('ENOENT'); } });
  const restoreRun = stubRun(async () => { throw new Error('not found'); });
  try {
    const service = freshService();
    assert.equal(await service.isInstalled('shairport-sync'), false);
  } finally {
    restoreFs();
    restoreRun();
  }
});

test('isInstalled("node") runs `node -v` via argv and returns true on success, false on failure', async () => {
  const calls: Call[] = [];
  const restoreRun = stubRunRecording(calls);
  try {
    const service = freshService();
    assert.equal(await service.isInstalled('node'), true);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].bin, 'node');
    assert.deepEqual(calls[0].args, ['-v']);
  } finally {
    restoreRun();
  }

  const restoreRunFail = stubRun(async () => { throw new Error('not found'); });
  try {
    const service = freshService();
    assert.equal(await service.isInstalled('node'), false);
  } finally {
    restoreRunFail();
  }
});

test('isInstalled() delegates ordinary apt packages to platform/apt.ts isInstalled() (dpkg -s, already tested there)', async () => {
  const seen: string[] = [];
  const restoreAptIsInstalled = stubModuleFn(aptModule, 'isInstalled', async (pkg: string) => {
    seen.push(pkg);
    return true;
  });
  try {
    const service = freshService();
    assert.equal(await service.isInstalled('mpd'), true);
    assert.deepEqual(seen, ['mpd']);
  } finally {
    restoreAptIsInstalled();
  }
});

// ============================================================
// getServiceStatus / restartService / startService / stopService /
// enableService / disableService -- thin platform/systemd.ts wrappers
// ============================================================

test('getServiceStatus() is a thin wrapper over platform/systemd.ts activeState()', async () => {
  const calls: string[] = [];
  const restoreSudo = stubNeedsSudo(false);
  const restoreRun = stubRun(async (bin: string, args: string[]) => {
    calls.push(`${bin} ${args.join(' ')}`);
    return { stdout: 'active\n', stderr: '' };
  });
  try {
    const service = freshService();
    const status = await service.getServiceStatus('mpd');
    assert.equal(status, 'active');
    assert.deepEqual(calls, ['systemctl is-active mpd.service']);
  } finally {
    restoreRun();
    restoreSudo();
  }
});

for (const [method, action] of [
  ['restartService', 'restart'],
  ['startService', 'start'],
  ['stopService', 'stop'],
  ['enableService', 'enable'],
  ['disableService', 'disable'],
] as const) {
  test(`${method}() calls systemctl ${action} via argv, unprefixed when needsSudo() is false`, async () => {
    const calls: Call[] = [];
    const restoreSudo = stubNeedsSudo(false);
    const restoreRun = stubRunRecording(calls);
    try {
      const service = freshService();
      await (service as any)[method]('mpd');
      assert.equal(calls.length, 1);
      assert.equal(calls[0].bin, 'systemctl');
      assert.deepEqual(calls[0].args, [action, 'mpd.service']);
    } finally {
      restoreRun();
      restoreSudo();
    }
  });

  test(`${method}() prefixes with sudo via argv (not string concatenation) when needsSudo() is true`, async () => {
    const calls: Call[] = [];
    const restoreSudo = stubNeedsSudo(true);
    const restoreRun = stubRunRecording(calls);
    try {
      const service = freshService();
      await (service as any)[method]('snapclient');
      assert.equal(calls.length, 1);
      assert.equal(calls[0].bin, 'sudo');
      assert.deepEqual(calls[0].args, ['systemctl', action, 'snapclient.service']);
    } finally {
      restoreRun();
      restoreSudo();
    }
  });
}

// ============================================================
// getServiceLogs() -- platform/systemd.ts logs() already sudo-gates
// internally; the old manual sudo-then-fallback retry is dropped
// ============================================================

test('getServiceLogs() returns journalctl output via platform/systemd.ts logs()', async () => {
  const calls: Call[] = [];
  const restoreSudo = stubNeedsSudo(false);
  const restoreRun = stubRun(async (bin: string, args: string[]) => {
    calls.push({ bin, args });
    return { stdout: 'log line 1\nlog line 2\n', stderr: '' };
  });
  try {
    const service = freshService();
    const logs = await service.getServiceLogs('mpd');
    assert.equal(logs, 'log line 1\nlog line 2\n');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].bin, 'journalctl');
    assert.deepEqual(calls[0].args, ['-u', 'mpd.service', '-n', '100', '--no-pager']);
  } finally {
    restoreRun();
    restoreSudo();
  }
});

test('getServiceLogs() does NOT retry without sudo on failure -- logs() is called exactly once', async () => {
  let callCount = 0;
  const restoreRun = stubRun(async () => {
    callCount++;
    throw new Error('journalctl: permission denied');
  });
  try {
    const service = freshService();
    const result = await service.getServiceLogs('mpd');
    assert.equal(callCount, 1, 'getServiceLogs() must not manually retry -- logs() already handles sudo internally');
    assert.match(result, /Failed to retrieve logs/);
  } finally {
    restoreRun();
  }
});

// ============================================================
// installMpd() (private, via installPackage('mpd')) -- systemctl chain +
// apt install, exact-argv sudo-gating
// ============================================================

test('installMpd() runs apt install then the systemctl chain (stop/disable socket, unmask, enable, restart), unprefixed when needsSudo() is false', async () => {
  const calls: Call[] = [];
  const restoreSudo = stubNeedsSudo(false);
  const restoreRun = stubRunRecording(calls);
  const restoreBackup = stubNoBackup();
  const restoreServiceUp = stubServiceUp();
  try {
    const service = freshService();
    const result = await service.installPackage('mpd');
    assert.match(result, /MPD installed and started successfully/);

    const bins = calls.map(c => `${c.bin} ${c.args.join(' ')}`);
    assert.deepEqual(bins, [
      'apt-get update',
      'apt-get install -y mpd',
      'systemctl stop mpd.socket',
      'systemctl disable mpd.socket',
      'systemctl unmask mpd.service',
      'systemctl enable mpd.service',
      'systemctl restart mpd.service',
    ]);
  } finally {
    restoreRun();
    restoreSudo();
    restoreBackup();
    restoreServiceUp();
  }
});

test('installMpd() prefixes every mutating call with sudo via argv when needsSudo() is true', async () => {
  const calls: Call[] = [];
  const restoreSudo = stubNeedsSudo(true);
  const restoreRun = stubRunRecording(calls);
  const restoreBackup = stubNoBackup();
  const restoreServiceUp = stubServiceUp();
  try {
    const service = freshService();
    await service.installPackage('mpd');
    for (const call of calls) {
      assert.equal(call.bin, 'sudo', `expected sudo prefix, got bin=${call.bin} args=${JSON.stringify(call.args)}`);
    }
    const argvs = calls.map(c => c.args.join(' '));
    assert.deepEqual(argvs, [
      'apt-get update',
      'apt-get install -y mpd',
      'systemctl stop mpd.socket',
      'systemctl disable mpd.socket',
      'systemctl unmask mpd.service',
      'systemctl enable mpd.service',
      'systemctl restart mpd.service',
    ]);
  } finally {
    restoreRun();
    restoreSudo();
    restoreBackup();
    restoreServiceUp();
  }
});

test('installMpd() tolerates the socket stop/disable/unmask steps failing (mirrors the original `2>/dev/null || true`)', async () => {
  const restoreSudo = stubNeedsSudo(false);
  const restoreRun = stubRun(async (bin: string, args: string[]) => {
    if (args[0] === 'stop' || args[0] === 'disable' || args[0] === 'unmask') {
      throw new Error('unit not found');
    }
    return { stdout: '', stderr: '' };
  });
  const restoreBackup = stubNoBackup();
  const restoreServiceUp = stubServiceUp();
  try {
    const service = freshService();
    const result = await service.installPackage('mpd');
    assert.match(result, /MPD installed and started successfully/);
  } finally {
    restoreRun();
    restoreSudo();
    restoreBackup();
    restoreServiceUp();
  }
});

// ============================================================
// installMympd() (private, via installPackage('mympd')) -- os-release file
// read, fetch()-based GPG key download, gpg --dearmor binary handling,
// installPrivilegedFile() for the keyring + sources list, apt/systemd chain
// ============================================================

const OS_RELEASE_DEBIAN = 'PRETTY_NAME="Debian GNU/Linux 12 (bookworm)"\nID=debian\nVERSION_ID="12"\n';

function stubGpgDearmor(fakeDearmoredBytes: Buffer): (calls: Call[]) => () => void {
  return (calls: Call[]) => stubRun(async (bin: string, args: string[], opts?: unknown) => {
    calls.push({ bin, args, opts });
    if (bin === 'gpg') {
      // Simulate the real gpg binary: it reads args[4] (the armored input
      // file) and writes DEARMORED bytes to args[3] (the -o output file) --
      // exactly the file-based I/O installMympd()'s dearmorGpgKey() relies
      // on to avoid ever piping binary bytes through run()'s UTF-8-decoded
      // stdout.
      const outFile = args[3];
      fs.writeFileSync(outFile, fakeDearmoredBytes);
    }
    return { stdout: '', stderr: '' };
  });
}

test('installMympd() reads /etc/os-release directly via fs.readFile (no `cat` shell-out)', async () => {
  const readCalls: string[] = [];
  const original = fsPromisesDefault.readFile;
  const restoreFs = stubModuleFn(fsPromisesDefault, 'readFile', async (p: string, ...rest: any[]) => {
    readCalls.push(p);
    if (p === '/etc/os-release') {
      assert.equal(rest[0], 'utf-8');
      return OS_RELEASE_DEBIAN;
    }
    return (original as any)(p, ...rest);
  });
  const restoreSudo = stubNeedsSudo(false);
  const calls: Call[] = [];
  const restoreRun = stubGpgDearmor(Buffer.from([0x99, 0x01, 0x02]))(calls);
  const restoreFetch = stubFetch(async () => textResponse(200, '-----BEGIN PGP PUBLIC KEY BLOCK-----\nfake\n-----END PGP PUBLIC KEY BLOCK-----\n'));
  const restoreBackup = stubNoBackup();
  const restoreServiceUp = stubServiceUp();
  try {
    const service = freshService();
    await service.installPackage('mympd');
    assert.ok(readCalls.includes('/etc/os-release'));
  } finally {
    restoreFs();
    restoreRun();
    restoreSudo();
    restoreFetch();
    restoreBackup();
    restoreServiceUp();
  }
});

test('installMympd() throws a clear error for an unsupported distro (no repoDir) without touching the network', async () => {
  const restoreFs = stubFsPromises({
    readFile: async () => 'ID=fedora\nVERSION_ID="40"\n',
  });
  let fetchCalled = false;
  const restoreFetch = stubFetch(async () => { fetchCalled = true; return textResponse(200, ''); });
  const restoreBackup = stubNoBackup();
  try {
    const service = freshService();
    await assert.rejects(() => service.installPackage('mympd'), /Unsupported distro/);
    assert.equal(fetchCalled, false);
  } finally {
    restoreFs();
    restoreFetch();
    restoreBackup();
  }
});

test('installMympd() fetches the OBS repo GPG key over HTTPS (no `curl` shell-out) and dearmors it via a real gpg file-based invocation, never through run()\'s UTF-8 stdout', async () => {
  const restoreFs = stubReadFileForPaths({ '/etc/os-release': OS_RELEASE_DEBIAN });
  const restoreSudo = stubNeedsSudo(false);
  const fetchCalls: string[] = [];
  const restoreFetch = stubFetch(async (url: any) => {
    fetchCalls.push(String(url));
    if (String(url).endsWith('/Release.key')) {
      return textResponse(200, '-----BEGIN PGP PUBLIC KEY BLOCK-----\nfake-armored-key\n-----END PGP PUBLIC KEY BLOCK-----\n');
    }
    throw new Error(`unexpected fetch(${url})`);
  });
  const dearmoredBytes = Buffer.from([0x99, 0x01, 0xff, 0x00, 0x47, 0x50, 0x47]);
  const calls: Call[] = [];
  const restoreRun = stubGpgDearmor(dearmoredBytes)(calls);
  const restoreBackup = stubNoBackup();
  const restoreServiceUp = stubServiceUp();
  const installedFiles: { destPath: string; content: any; opts: any }[] = [];
  // installPrivilegedFile is real here (not stubbed) EXCEPT its internal
  // run() calls (cp/chmod) are captured by the same stubbed run() above --
  // so we assert on those cp destinations plus the real temp-file content
  // written just before each cp.
  const restoreCpCapture = (() => {
    const original = execModule.run;
    (execModule as any).run = async (bin: string, args: string[], opts?: unknown) => {
      calls.push({ bin, args, opts });
      if (bin === 'gpg') {
        fs.writeFileSync(args[3], dearmoredBytes);
      }
      if (bin === 'cp') {
        installedFiles.push({ destPath: args[1], content: fs.readFileSync(args[0]), opts: undefined });
      }
      return { stdout: '', stderr: '' };
    };
    return () => { (execModule as any).run = original; };
  })();
  try {
    const service = freshService();
    await service.installPackage('mympd');

    assert.ok(fetchCalls.some(u => u === 'https://download.opensuse.org/repositories/home:/jcorporation/Debian_12/Release.key'));

    const gpgCall = calls.find(c => c.bin === 'gpg');
    assert.ok(gpgCall, 'expected gpg --dearmor to be invoked');
    assert.equal(gpgCall!.args[0], '--dearmor');
    assert.equal(gpgCall!.args[2], '-o');
    // gpg is never given the armored key via run()'s `input` stdin option --
    // it reads/writes real files, sidestepping run()'s UTF-8-forced stdio
    // entirely for the binary side.
    assert.equal((gpgCall!.opts as any)?.input, undefined);

    const keyringInstall = installedFiles.find(f => f.destPath === '/etc/apt/keyrings/mympd.gpg');
    assert.ok(keyringInstall, 'expected the dearmored keyring to be installed to /etc/apt/keyrings/mympd.gpg');
    assert.ok((keyringInstall!.content as Buffer).equals(dearmoredBytes), 'installed keyring bytes must exactly match what gpg --dearmor produced');

    const sourcesInstall = installedFiles.find(f => f.destPath === '/etc/apt/sources.list.d/mympd.list');
    assert.ok(sourcesInstall, 'expected a sources.list.d entry to be installed');
    const sourcesText = (sourcesInstall!.content as Buffer).toString('utf-8');
    assert.match(sourcesText, /^deb \[signed-by=\/etc\/apt\/keyrings\/mympd\.gpg\] https:\/\/download\.opensuse\.org\/repositories\/home:\/jcorporation\/Debian_12\/ \/$/m);
  } finally {
    restoreCpCapture();
    restoreRun();
    restoreSudo();
    restoreFs();
    restoreFetch();
    restoreBackup();
    restoreServiceUp();
  }
});

test('installMympd() throws when the GPG key fetch is not ok', async () => {
  const restoreFs = stubReadFileForPaths({ '/etc/os-release': OS_RELEASE_DEBIAN });
  const restoreSudo = stubNeedsSudo(false);
  const restoreRun = stubRun(async () => ({ stdout: '', stderr: '' }));
  const restoreFetch = stubFetch(async () => textResponse(404, ''));
  const restoreBackup = stubNoBackup();
  try {
    const service = freshService();
    await assert.rejects(() => service.installPackage('mympd'), /404/);
  } finally {
    restoreFs();
    restoreRun();
    restoreSudo();
    restoreFetch();
    restoreBackup();
  }
});

test('installMympd() creates /etc/apt/keyrings and finishes with the apt/systemd chain, sudo-prefixed via argv when needsSudo() is true', async () => {
  const restoreFs = stubReadFileForPaths({ '/etc/os-release': OS_RELEASE_DEBIAN });
  const restoreSudo = stubNeedsSudo(true);
  const restoreFetch = stubFetch(async () => textResponse(200, '-----BEGIN PGP PUBLIC KEY BLOCK-----\nkey\n-----END PGP PUBLIC KEY BLOCK-----\n'));
  const calls: Call[] = [];
  const restoreRun = stubGpgDearmor(Buffer.from([1, 2, 3]))(calls);
  const restoreBackup = stubNoBackup();
  const restoreServiceUp = stubServiceUp();
  try {
    const service = freshService();
    await service.installPackage('mympd');

    const mkdirCall = calls.find(c => c.bin === 'sudo' && c.args[0] === 'mkdir');
    assert.ok(mkdirCall, 'expected a sudo-prefixed mkdir -p /etc/apt/keyrings');
    assert.deepEqual(mkdirCall!.args, ['mkdir', '-p', '/etc/apt/keyrings']);

    const bins = calls.filter(c => c.bin === 'systemctl' || (c.bin === 'sudo' && c.args[0] === 'systemctl'));
    assert.ok(bins.some(c => c.bin === 'sudo' && c.args.join(' ') === 'systemctl enable mympd.service'));
    assert.ok(bins.some(c => c.bin === 'sudo' && c.args.join(' ') === 'systemctl restart mympd.service'));
  } finally {
    restoreRun();
    restoreSudo();
    restoreFs();
    restoreFetch();
    restoreBackup();
    restoreServiceUp();
  }
});

// ============================================================
// installPackage() / updatePackage() / uninstallPackage() -- generic apt
// branches and the explicit uninstall branches, sudo-gated exact argv
// ============================================================

test('installPackage() generic branch (ffmpeg) runs apt update + install via platform/apt.ts, unprefixed', async () => {
  const calls: Call[] = [];
  const restoreSudo = stubNeedsSudo(false);
  const restoreRun = stubRunRecording(calls);
  const restoreBackup = stubNoBackup();
  try {
    const service = freshService();
    const result = await service.installPackage('ffmpeg');
    assert.match(result, /ffmpeg installed successfully/);
    assert.deepEqual(calls.map(c => `${c.bin} ${c.args.join(' ')}`), [
      'apt-get update',
      'apt-get install -y ffmpeg',
    ]);
  } finally {
    restoreRun();
    restoreSudo();
    restoreBackup();
  }
});

test('updatePackage() generic branch (ffmpeg) runs apt update + --only-upgrade via platform/apt.ts', async () => {
  const calls: Call[] = [];
  const restoreSudo = stubNeedsSudo(false);
  const restoreRun = stubRunRecording(calls);
  const restoreBackup = stubNoBackup();
  try {
    const service = freshService();
    const result = await service.updatePackage('ffmpeg' as any, false);
    assert.match(result, /ffmpeg updated successfully/);
    assert.deepEqual(calls.map(c => `${c.bin} ${c.args.join(' ')}`), [
      'apt-get update',
      'apt-get install -y --only-upgrade ffmpeg',
    ]);
  } finally {
    restoreRun();
    restoreSudo();
    restoreBackup();
  }
});

test('uninstallPackage("snapclient") stops/disables the systemd service then dpkg --purge via argv, unprefixed when needsSudo() is false', async () => {
  const calls: Call[] = [];
  const restoreSudo = stubNeedsSudo(false);
  const restoreRun = stubRunRecording(calls);
  const restoreBackup = stubNoBackup();
  try {
    const service = freshService();
    const result = await service.uninstallPackage('snapclient');
    assert.match(result, /snapclient removed successfully/);
    assert.deepEqual(calls.map(c => `${c.bin} ${c.args.join(' ')}`), [
      'systemctl stop snapclient.service',
      'systemctl disable snapclient.service',
      'dpkg --purge snapclient',
    ]);
  } finally {
    restoreRun();
    restoreSudo();
    restoreBackup();
  }
});

test('uninstallPackage("snapclient") prefixes the dpkg --purge call with sudo via argv when needsSudo() is true', async () => {
  const calls: Call[] = [];
  const restoreSudo = stubNeedsSudo(true);
  const restoreRun = stubRunRecording(calls);
  const restoreBackup = stubNoBackup();
  try {
    const service = freshService();
    await service.uninstallPackage('snapclient');
    const dpkgCall = calls.find(c => c.bin === 'sudo' && c.args[0] === 'dpkg');
    assert.ok(dpkgCall, 'expected a sudo-prefixed dpkg --purge call');
    assert.deepEqual(dpkgCall!.args, ['dpkg', '--purge', 'snapclient']);
  } finally {
    restoreRun();
    restoreSudo();
    restoreBackup();
  }
});

test('uninstallPackage("mympd") stops the service, apt removes it, then removes the repo files via argv', async () => {
  const calls: Call[] = [];
  const restoreSudo = stubNeedsSudo(false);
  const restoreRun = stubRunRecording(calls);
  const restoreBackup = stubNoBackup();
  try {
    const service = freshService();
    const result = await service.uninstallPackage('mympd');
    assert.match(result, /myMPD removed successfully/);
    const bins = calls.map(c => `${c.bin} ${c.args.join(' ')}`);
    assert.deepEqual(bins, [
      'systemctl stop mympd.service',
      'systemctl disable mympd.service',
      'apt-get remove --purge -y mympd',
      'rm -f /etc/apt/sources.list.d/mympd.list /etc/apt/keyrings/mympd.gpg',
    ]);
  } finally {
    restoreRun();
    restoreSudo();
    restoreBackup();
  }
});

test('uninstallPackage() generic branch (ffmpeg) runs apt remove --purge via platform/apt.ts', async () => {
  const calls: Call[] = [];
  const restoreSudo = stubNeedsSudo(false);
  const restoreRun = stubRunRecording(calls);
  const restoreBackup = stubNoBackup();
  try {
    const service = freshService();
    const result = await service.uninstallPackage('ffmpeg');
    assert.match(result, /ffmpeg removed successfully/);
    assert.deepEqual(calls.map(c => `${c.bin} ${c.args.join(' ')}`), [
      'apt-get remove --purge -y ffmpeg',
    ]);
  } finally {
    restoreRun();
    restoreSudo();
    restoreBackup();
  }
});

// ============================================================
// jobService.log() progress visibility -- regression tests for the Important
// review finding on commit 346e73f: before this fix, installPackage()'s
// generic branch, installMpd(), installMympd(), updatePackage()'s generic
// branch, and most of uninstallPackage()'s branches called jobService.log()
// exactly ONCE (a fixed final string) instead of at each meaningful step,
// leaving the frontend's loading overlay (client/src/stores/system.ts's
// runJob(), which polls the job log every 2s) frozen on a single static
// label for the whole multi-minute apt-get operation. These tests assert
// jobService.log() is called MULTIPLE times, proving real progress is
// surfaced again.
// ============================================================

test('installMpd() (via installPackage) logs progress at every step, not just once at the end', async () => {
  const restoreSudo = stubNeedsSudo(false);
  const restoreRun = stubRunRecording([]);
  const restoreBackup = stubNoBackup();
  const restoreServiceUp = stubServiceUp();
  const { calls: logCalls, restore: restoreJobLog } = stubJobLog();
  try {
    const service = freshService();
    await service.installPackage('mpd');
    assert.ok(logCalls.length > 3, `expected multiple progress log lines, got ${logCalls.length}: ${JSON.stringify(logCalls)}`);
    assert.equal(logCalls[logCalls.length - 1], 'MPD installed and started successfully.');
    // At least the five real systemd steps described in the review finding
    // (stop-socket, disable-socket, unmask-service, enable-service,
    // restart-service) must each produce a distinguishable log line.
    for (const fragment of ['Stopping mpd.socket', 'Disabling mpd.socket', 'Unmasking mpd.service', 'Enabling mpd.service', 'Restarting mpd.service']) {
      assert.ok(logCalls.some(l => l.includes(fragment)), `expected a log line mentioning "${fragment}", got: ${JSON.stringify(logCalls)}`);
    }
  } finally {
    restoreRun();
    restoreSudo();
    restoreBackup();
    restoreServiceUp();
    restoreJobLog();
  }
});

test('installMympd() (via installPackage) logs progress at every step, not just once at the end', async () => {
  const restoreFs = stubReadFileForPaths({ '/etc/os-release': OS_RELEASE_DEBIAN });
  const restoreSudo = stubNeedsSudo(false);
  const restoreFetch = stubFetch(async () => textResponse(200, '-----BEGIN PGP PUBLIC KEY BLOCK-----\nfake\n-----END PGP PUBLIC KEY BLOCK-----\n'));
  const calls: Call[] = [];
  const restoreRun = stubGpgDearmor(Buffer.from([0x99, 0x01, 0x02]))(calls);
  const restoreBackup = stubNoBackup();
  const restoreServiceUp = stubServiceUp();
  const { calls: logCalls, restore: restoreJobLog } = stubJobLog();
  try {
    const service = freshService();
    await service.installPackage('mympd');
    assert.ok(logCalls.length > 3, `expected multiple progress log lines, got ${logCalls.length}: ${JSON.stringify(logCalls)}`);
    assert.equal(logCalls[logCalls.length - 1], 'myMPD installed and started successfully.');
    for (const fragment of ['Installing gpg', 'Downloading myMPD repository key', 'Installing myMPD APT keyring', 'Enabling mympd.service', 'Restarting mympd.service']) {
      assert.ok(logCalls.some(l => l.includes(fragment)), `expected a log line mentioning "${fragment}", got: ${JSON.stringify(logCalls)}`);
    }
  } finally {
    restoreRun();
    restoreSudo();
    restoreFs();
    restoreFetch();
    restoreBackup();
    restoreServiceUp();
    restoreJobLog();
  }
});

test('uninstallPackage("mpd") logs progress at every step, not just once at the end', async () => {
  const restoreSudo = stubNeedsSudo(false);
  const restoreRun = stubRunRecording([]);
  const restoreBackup = stubNoBackup();
  const { calls: logCalls, restore: restoreJobLog } = stubJobLog();
  try {
    const service = freshService();
    await service.uninstallPackage('mpd');
    assert.ok(logCalls.length > 3, `expected multiple progress log lines, got ${logCalls.length}: ${JSON.stringify(logCalls)}`);
    assert.equal(logCalls[logCalls.length - 1], 'MPD removed successfully.');
  } finally {
    restoreRun();
    restoreSudo();
    restoreBackup();
    restoreJobLog();
  }
});

test('uninstallPackage("mympd") logs progress at every step, not just once at the end', async () => {
  const restoreSudo = stubNeedsSudo(false);
  const restoreRun = stubRunRecording([]);
  const restoreBackup = stubNoBackup();
  const { calls: logCalls, restore: restoreJobLog } = stubJobLog();
  try {
    const service = freshService();
    await service.uninstallPackage('mympd');
    assert.ok(logCalls.length > 3, `expected multiple progress log lines, got ${logCalls.length}: ${JSON.stringify(logCalls)}`);
    assert.equal(logCalls[logCalls.length - 1], 'myMPD removed successfully.');
  } finally {
    restoreRun();
    restoreSudo();
    restoreBackup();
    restoreJobLog();
  }
});

test('uninstallPackage("snapclient") logs progress at every step, not just once at the end', async () => {
  const restoreSudo = stubNeedsSudo(false);
  const restoreRun = stubRunRecording([]);
  const restoreBackup = stubNoBackup();
  const { calls: logCalls, restore: restoreJobLog } = stubJobLog();
  try {
    const service = freshService();
    await service.uninstallPackage('snapclient');
    assert.ok(logCalls.length > 1, `expected multiple progress log lines, got ${logCalls.length}: ${JSON.stringify(logCalls)}`);
    assert.equal(logCalls[logCalls.length - 1], 'snapclient removed successfully.');
  } finally {
    restoreRun();
    restoreSudo();
    restoreBackup();
    restoreJobLog();
  }
});

test('installPackage() generic branch (ffmpeg) logs progress before and after apt install, not just once at the end', async () => {
  const restoreSudo = stubNeedsSudo(false);
  const restoreRun = stubRunRecording([]);
  const restoreBackup = stubNoBackup();
  const { calls: logCalls, restore: restoreJobLog } = stubJobLog();
  try {
    const service = freshService();
    await service.installPackage('ffmpeg');
    assert.ok(logCalls.length > 1, `expected multiple progress log lines, got ${logCalls.length}: ${JSON.stringify(logCalls)}`);
    assert.equal(logCalls[logCalls.length - 1], 'ffmpeg installed successfully.');
  } finally {
    restoreRun();
    restoreSudo();
    restoreBackup();
    restoreJobLog();
  }
});

test('updatePackage() generic branch (ffmpeg) logs progress before and after apt upgrade, not just once at the end', async () => {
  const restoreSudo = stubNeedsSudo(false);
  const restoreRun = stubRunRecording([]);
  const restoreBackup = stubNoBackup();
  const { calls: logCalls, restore: restoreJobLog } = stubJobLog();
  try {
    const service = freshService();
    await service.updatePackage('ffmpeg' as any, false);
    assert.ok(logCalls.length > 1, `expected multiple progress log lines, got ${logCalls.length}: ${JSON.stringify(logCalls)}`);
    assert.equal(logCalls[logCalls.length - 1], 'ffmpeg updated successfully.');
  } finally {
    restoreRun();
    restoreSudo();
    restoreBackup();
    restoreJobLog();
  }
});

test('uninstallPackage() generic branch (ffmpeg) logs progress before and after apt remove, not just once at the end', async () => {
  const restoreSudo = stubNeedsSudo(false);
  const restoreRun = stubRunRecording([]);
  const restoreBackup = stubNoBackup();
  const { calls: logCalls, restore: restoreJobLog } = stubJobLog();
  try {
    const service = freshService();
    await service.uninstallPackage('ffmpeg');
    assert.ok(logCalls.length > 1, `expected multiple progress log lines, got ${logCalls.length}: ${JSON.stringify(logCalls)}`);
    assert.equal(logCalls[logCalls.length - 1], 'ffmpeg removed successfully.');
  } finally {
    restoreRun();
    restoreSudo();
    restoreBackup();
    restoreJobLog();
  }
});

// ============================================================
// postSnapclientInstall() (private) -- stop/disable the default package
// service, tolerating failure, then delegate to snapclientInstanceService
// ============================================================

test('postSnapclientInstall() stops/disables the default snapclient service (tolerating failure) then calls postInstallSetup()', async () => {
  const calls: Call[] = [];
  const restoreSudo = stubNeedsSudo(false);
  const restoreRun = stubRun(async (bin: string, args: string[]) => {
    calls.push({ bin, args });
    throw new Error('unit not found'); // both stop/disable "fail" -- must be tolerated
  });
  let postInstallSetupCalled = false;
  const restoreSetup = stubModuleFn(snapclientInstancesModule.snapclientInstanceService, 'postInstallSetup', async () => {
    postInstallSetupCalled = true;
  });
  try {
    const service = freshService();
    await (service as any).postSnapclientInstall();
    assert.deepEqual(calls.map(c => `${c.bin} ${c.args.join(' ')}`), [
      'systemctl stop snapclient.service',
      'systemctl disable snapclient.service',
    ]);
    assert.equal(postInstallSetupCalled, true);
  } finally {
    restoreRun();
    restoreSudo();
    restoreSetup();
  }
});

// ============================================================
// getPackageVersion() -- shell `| head -n1` pipes eliminated
// ============================================================

test('getPackageVersion("mpd") runs the binary directly and extracts the version from combined stdout+stderr (no `| head -n1` pipe)', async () => {
  const calls: Call[] = [];
  const restoreRun = stubRun(async (bin: string, args: string[]) => {
    calls.push({ bin, args });
    return { stdout: '', stderr: 'mpd (Music Player Daemon) 0.23.5\n' };
  });
  try {
    const service = freshService();
    const version = await service.getPackageVersion('mpd' as any);
    assert.equal(version, '0.23.5');
    assert.deepEqual(calls, [{ bin: 'mpd', args: ['--version'] }]);
  } finally {
    restoreRun();
  }
});

test('getPackageVersion("shairport-sync") prefers the fixed /usr/local/bin path when present', async () => {
  const restoreFs = stubFsPromises({ access: async (p: string) => { assert.equal(p, '/usr/local/bin/shairport-sync'); } });
  const calls: Call[] = [];
  const restoreRun = stubRun(async (bin: string, args: string[]) => {
    calls.push({ bin, args });
    return { stdout: 'shairport-sync 4.3.7\n', stderr: '' };
  });
  try {
    const service = freshService();
    const version = await service.getPackageVersion('shairport-sync' as any);
    assert.equal(version, '4.3.7');
    assert.deepEqual(calls, [{ bin: '/usr/local/bin/shairport-sync', args: ['-V'] }]);
  } finally {
    restoreFs();
    restoreRun();
  }
});

test('getPackageVersion("snap-ctrl") reads the version marker file directly (no `cat`/`grep` pipe)', async () => {
  const restoreFs = stubFsPromises({
    readFile: async (p: string) => {
      if (p === '/usr/share/snapserver/snap-ctrl/.snap-ctrl-version') return 'v2.4.0\n';
      throw new Error(`unexpected readFile(${p})`);
    },
  });
  try {
    const service = freshService();
    const version = await service.getPackageVersion('snap-ctrl' as any);
    assert.equal(version, 'v2.4.0');
  } finally {
    restoreFs();
  }
});

test('getPackageVersion() returns "unknown" when the underlying command fails', async () => {
  const restoreRun = stubRun(async () => { throw new Error('command not found'); });
  try {
    const service = freshService();
    assert.equal(await service.getPackageVersion('mpd' as any), 'unknown');
  } finally {
    restoreRun();
  }
});

// ============================================================
// getMympdInfo() -- direct file read, no `cat` shell-out
// ============================================================

test('getMympdInfo() reads the configured http_port directly via fs.readFile', async () => {
  const restoreAptIsInstalled = stubModuleFn(aptModule, 'isInstalled', async () => true);
  const restoreSudo = stubNeedsSudo(false);
  const restoreRun = stubRun(async () => ({ stdout: 'active\n', stderr: '' }));
  const restoreFs = stubFsPromises({
    readFile: async (p: string) => {
      if (p === '/var/lib/mympd/config/http_port') return '9090\n';
      throw new Error(`unexpected readFile(${p})`);
    },
  });
  try {
    const service = freshService();
    const info = await service.getMympdInfo();
    assert.deepEqual(info, { installed: true, running: true, port: 9090 });
  } finally {
    restoreAptIsInstalled();
    restoreRun();
    restoreSudo();
    restoreFs();
  }
});

test('getMympdInfo() falls back to port 8080 when the http_port file is missing', async () => {
  const restoreAptIsInstalled = stubModuleFn(aptModule, 'isInstalled', async () => false);
  const restoreFs = stubFsPromises({ readFile: async () => { throw new Error('ENOENT'); } });
  try {
    const service = freshService();
    const info = await service.getMympdInfo();
    assert.deepEqual(info, { installed: false, running: false, port: 8080 });
  } finally {
    restoreAptIsInstalled();
    restoreFs();
  }
});

// ============================================================
// TASK 12 -- getDistroCodename() -- `grep | cut` pipe eliminated
// ============================================================

test('getDistroCodename() uses `lsb_release -cs` via argv (no shell, no 2>/dev/null needed)', async () => {
  const calls: Call[] = [];
  const restoreRun = stubRun(async (bin: string, args: string[]) => {
    calls.push({ bin, args });
    return { stdout: 'bookworm\n', stderr: '' };
  });
  try {
    const service = freshService();
    const codename = await (service as any).getDistroCodename();
    assert.equal(codename, 'bookworm');
    assert.deepEqual(calls, [{ bin: 'lsb_release', args: ['-cs'] }]);
  } finally {
    restoreRun();
  }
});

test('getDistroCodename() falls back to parsing /etc/os-release directly when lsb_release fails (no grep|cut pipe)', async () => {
  const restoreRun = stubRun(async () => { throw new Error('lsb_release: command not found'); });
  const osRelease = 'PRETTY_NAME="Debian GNU/Linux 12 (bookworm)"\nID=debian\nVERSION_ID="12"\nVERSION_CODENAME=bookworm\n';
  const restoreFs = stubFsPromises({ readFile: async (p: string) => { assert.equal(p, '/etc/os-release'); return osRelease; } });
  try {
    const service = freshService();
    const codename = await (service as any).getDistroCodename();
    assert.equal(codename, 'bookworm');
  } finally {
    restoreRun();
    restoreFs();
  }
});

test('getDistroCodename() strips quotes from a quoted VERSION_CODENAME value in a realistic multi-line os-release file', async () => {
  const restoreRun = stubRun(async () => { throw new Error('no lsb_release'); });
  const osRelease = [
    'PRETTY_NAME="Debian GNU/Linux 12 (bookworm)"',
    'NAME="Debian GNU/Linux"',
    'VERSION_ID="12"',
    'VERSION="12 (bookworm)"',
    'VERSION_CODENAME="bookworm"',
    'ID=debian',
    'HOME_URL="https://www.debian.org/"',
    '',
  ].join('\n');
  const restoreFs = stubFsPromises({ readFile: async () => osRelease });
  try {
    const service = freshService();
    assert.equal(await (service as any).getDistroCodename(), 'bookworm');
  } finally {
    restoreRun();
    restoreFs();
  }
});

test('getDistroCodename() falls back to "bookworm" when both lsb_release and /etc/os-release fail', async () => {
  const restoreRun = stubRun(async () => { throw new Error('no lsb_release'); });
  const restoreFs = stubFsPromises({ readFile: async () => { throw new Error('ENOENT'); } });
  try {
    const service = freshService();
    assert.equal(await (service as any).getDistroCodename(), 'bookworm');
  } finally {
    restoreRun();
    restoreFs();
  }
});

test('getDistroCodename() caches the result across calls', async () => {
  let callCount = 0;
  const restoreRun = stubRun(async () => {
    callCount++;
    return { stdout: 'trixie\n', stderr: '' };
  });
  try {
    const service = freshService();
    assert.equal(await (service as any).getDistroCodename(), 'trixie');
    assert.equal(await (service as any).getDistroCodename(), 'trixie');
    assert.equal(callCount, 1);
  } finally {
    restoreRun();
  }
});

// ============================================================
// TASK 12 -- updateSnapserverFromGitHub() / updateSnapclientFromGitHub() --
// `dpkg --print-architecture` via argv; asset-matching logic unchanged
// ============================================================

test('updateSnapserverFromGitHub() runs `dpkg --print-architecture` via argv and delegates to executeDebUpdate() with the matched asset', async () => {
  const restoreFetch = stubFetch(async () => jsonResponse(200, {
    tag_name: 'v0.29.0',
    assets: [{ name: 'snapserver_0.29.0-1_amd64_bookworm.deb', browser_download_url: 'https://example.com/snapserver.deb' }],
  }));
  const calls: Call[] = [];
  const restoreRun = stubRun(async (bin: string, args: string[]) => {
    calls.push({ bin, args });
    if (bin === 'dpkg' && args[0] === '--print-architecture') return { stdout: 'amd64\n', stderr: '' };
    if (bin === 'lsb_release') return { stdout: 'bookworm\n', stderr: '' };
    return { stdout: '', stderr: '' };
  });
  const executeDebUpdateCalls: any[] = [];
  const service = freshService();
  (service as any).executeDebUpdate = async (...args: any[]) => {
    executeDebUpdateCalls.push(args);
    return 'snapserver updated successfully.';
  };
  try {
    const result = await (service as any).updateSnapserverFromGitHub(false);
    assert.equal(result, 'snapserver updated successfully.');
    assert.ok(calls.some(c => c.bin === 'dpkg' && c.args.join(' ') === '--print-architecture'));
    assert.deepEqual(executeDebUpdateCalls, [['https://example.com/snapserver.deb', 'snapserver_0.29.0-1_amd64_bookworm.deb', false]]);
  } finally {
    restoreFetch();
    restoreRun();
  }
});

test('updateSnapclientFromGitHub() runs `dpkg --print-architecture` via argv, delegates to executeDebUpdate(), then postSnapclientInstall()', async () => {
  const restoreFetch = stubFetch(async () => jsonResponse(200, {
    tag_name: 'v0.29.0',
    assets: [{ name: 'snapclient_0.29.0-1_amd64_bookworm.deb', browser_download_url: 'https://example.com/snapclient.deb' }],
  }));
  const restoreRun = stubRun(async (bin: string, args: string[]) => {
    if (bin === 'dpkg' && args[0] === '--print-architecture') return { stdout: 'amd64\n', stderr: '' };
    if (bin === 'lsb_release') return { stdout: 'bookworm\n', stderr: '' };
    return { stdout: '', stderr: '' };
  });
  const service = freshService();
  const executeDebUpdateCalls: any[] = [];
  (service as any).executeDebUpdate = async (...args: any[]) => {
    executeDebUpdateCalls.push(args);
    return 'snapclient updated successfully.';
  };
  let postInstallCalled = false;
  (service as any).postSnapclientInstall = async () => { postInstallCalled = true; };
  try {
    const result = await (service as any).updateSnapclientFromGitHub(true);
    assert.equal(result, 'snapclient updated successfully.');
    assert.deepEqual(executeDebUpdateCalls, [['https://example.com/snapclient.deb', 'snapclient_0.29.0-1_amd64_bookworm.deb', true, 'snapclient']]);
    assert.equal(postInstallCalled, true);
  } finally {
    restoreFetch();
    restoreRun();
  }
});

// ============================================================
// TASK 12 -- executeDebUpdate() -- the core .deb install pipeline, formerly
// one giant &&-chained shell string
// ============================================================

test('executeDebUpdate() happy path (dpkg succeeds): apt update, download to a private mkdtemp dir (never a predictable /tmp/<file> path), dpkg -i, then snapserver post-install chain', async () => {
  const calls: Call[] = [];
  const restoreSudo = stubNeedsSudo(false);
  let wgetDestDir = '';
  const restoreRun = stubRun(async (bin: string, args: string[]) => {
    calls.push({ bin, args });
    if (bin === 'wget') {
      wgetDestDir = path.dirname(args[1]);
    }
    return { stdout: '', stderr: '' };
  });
  try {
    const service = freshService();
    const result = await (service as any).executeDebUpdate('https://example.com/snapserver_0.29.0.deb', 'snapserver_0.29.0.deb', false, 'snapserver');
    assert.match(result, /snapserver updated successfully/);

    const bins = calls.map(c => `${c.bin} ${c.args.join(' ')}`);
    assert.deepEqual(bins, [
      'apt-get update',
      'wget -qO ' + path.join(wgetDestDir, 'snapserver_0.29.0.deb') + ' https://example.com/snapserver_0.29.0.deb',
      'dpkg -i --force-confdef --force-confold ' + path.join(wgetDestDir, 'snapserver_0.29.0.deb'),
      'mkdir -p /var/lib/snapserver',
      'chown -R snapserver:snapserver /var/lib/snapserver',
      'usermod -d /var/lib/snapserver snapserver',
      'systemctl daemon-reload',
      'systemctl restart snapserver.service',
    ]);

    // Never a fixed, predictable /tmp/<filename> path (design-spec finding #5).
    assert.notEqual(wgetDestDir, '/tmp');
    assert.ok(wgetDestDir.includes('snapmanager-deb-'), `expected an unpredictable mkdtemp dir, got ${wgetDestDir}`);
    // The temp directory must be cleaned up afterwards.
    await assert.rejects(() => fsPromisesDefault.access(wgetDestDir));
  } finally {
    restoreRun();
    restoreSudo();
  }
});

test('executeDebUpdate() snapclient happy path: post-install is just daemon-reload + restart snapclient', async () => {
  const calls: Call[] = [];
  const restoreSudo = stubNeedsSudo(false);
  const restoreRun = stubRunRecording(calls);
  try {
    const service = freshService();
    const result = await (service as any).executeDebUpdate('https://example.com/snapclient.deb', 'snapclient.deb', false, 'snapclient');
    assert.match(result, /snapclient updated successfully/);
    const bins = calls.map(c => `${c.bin} ${c.args.join(' ')}`);
    assert.deepEqual(bins.slice(-2), ['systemctl daemon-reload', 'systemctl restart snapclient.service']);
    assert.ok(!bins.some(b => b.includes('mkdir -p /var/lib/snapserver')), 'snapclient path must not run the snapserver-specific post-install steps');
  } finally {
    restoreRun();
    restoreSudo();
  }
});

test('executeDebUpdate() sudo-gates every privileged call via argv (not string concatenation) when needsSudo() is true', async () => {
  const calls: Call[] = [];
  const restoreSudo = stubNeedsSudo(true);
  const restoreRun = stubRun(async (bin: string, args: string[]) => {
    calls.push({ bin, args });
    return { stdout: '', stderr: '' };
  });
  try {
    const service = freshService();
    await (service as any).executeDebUpdate('https://example.com/snapserver.deb', 'snapserver.deb', false, 'snapserver');
    const dpkgCall = calls.find(c => c.bin === 'sudo' && c.args[0] === 'dpkg');
    assert.ok(dpkgCall, 'expected a sudo-prefixed dpkg -i call');
    assert.deepEqual(dpkgCall!.args.slice(0, 3), ['dpkg', '-i', '--force-confdef']);
    // wget itself is never sudo-prefixed (writes into a process-owned temp dir).
    assert.ok(!calls.some(c => c.bin === 'sudo' && c.args[0] === 'wget'));
    assert.ok(calls.some(c => c.bin === 'wget'));
  } finally {
    restoreRun();
    restoreSudo();
  }
});

test('executeDebUpdate() fallback path: dpkg -i failing triggers `apt-get install -f`, unprefixed with DEBIAN_FRONTEND via real env propagation when needsSudo() is false', async () => {
  const calls: Call[] = [];
  const restoreSudo = stubNeedsSudo(false);
  const restoreRun = stubRun(async (bin: string, args: string[], opts?: unknown) => {
    calls.push({ bin, args, opts });
    if (bin === 'dpkg') throw new Error('dpkg: dependency problems prevent configuration');
    return { stdout: '', stderr: '' };
  });
  try {
    const service = freshService();
    const result = await (service as any).executeDebUpdate('https://example.com/snapserver.deb', 'snapserver.deb', false, 'snapserver');
    assert.match(result, /snapserver updated successfully/);
    const fixCall = calls.find(c => c.bin === 'apt-get' && c.args[0] === 'install' && c.args.includes('-f'));
    assert.ok(fixCall, 'expected an apt-get install -f fallback call');
    assert.deepEqual(fixCall!.args, ['install', '-f', '-y', '-o', 'Dpkg::Options::=--force-confdef', '-o', 'Dpkg::Options::=--force-confold']);
    assert.deepEqual((fixCall!.opts as any)?.env, { DEBIAN_FRONTEND: 'noninteractive' });
  } finally {
    restoreRun();
    restoreSudo();
  }
});

test('executeDebUpdate() fallback path when needsSudo() is true: DEBIAN_FRONTEND=noninteractive is passed as a literal argv element to sudo (sudo parses VAR=value itself)', async () => {
  const calls: Call[] = [];
  const restoreSudo = stubNeedsSudo(true);
  const restoreRun = stubRun(async (bin: string, args: string[], opts?: unknown) => {
    calls.push({ bin, args, opts });
    if (bin === 'sudo' && args[0] === 'dpkg') throw new Error('dpkg: dependency problems');
    return { stdout: '', stderr: '' };
  });
  try {
    const service = freshService();
    await (service as any).executeDebUpdate('https://example.com/snapserver.deb', 'snapserver.deb', false, 'snapserver');
    const fixCall = calls.find(c => c.bin === 'sudo' && c.args[1] === 'apt-get');
    assert.ok(fixCall, 'expected a sudo-prefixed apt-get install -f fallback call');
    assert.deepEqual(fixCall!.args, ['DEBIAN_FRONTEND=noninteractive', 'apt-get', 'install', '-f', '-y', '-o', 'Dpkg::Options::=--force-confdef', '-o', 'Dpkg::Options::=--force-confold']);
    // The `env` RunOptions field is NOT needed on this branch -- sudo itself
    // parses the leading VAR=value argv element.
    assert.equal((fixCall!.opts as any)?.env, undefined);
  } finally {
    restoreRun();
    restoreSudo();
  }
});

test('executeDebUpdate() rethrows when BOTH dpkg -i and the apt-get install -f fallback fail', async () => {
  const restoreSudo = stubNeedsSudo(false);
  const restoreRun = stubRun(async (bin: string) => {
    if (bin === 'dpkg' || bin === 'apt-get') throw new Error('both failed');
    return { stdout: '', stderr: '' };
  });
  try {
    const service = freshService();
    await assert.rejects(() => (service as any).executeDebUpdate('https://example.com/x.deb', 'x.deb', false, 'snapserver'));
  } finally {
    restoreRun();
    restoreSudo();
  }
});

test('executeDebUpdate() clean=true (snapclient): stops the service and purges via dpkg --purge (tolerating failure), removes /etc/default/snapclient, before the apt update/download/install chain', async () => {
  const calls: Call[] = [];
  const restoreSudo = stubNeedsSudo(false);
  const restoreRun = stubRunRecording(calls);
  try {
    const service = freshService();
    await (service as any).executeDebUpdate('https://example.com/snapclient.deb', 'snapclient.deb', true, 'snapclient');
    const bins = calls.map(c => `${c.bin} ${c.args.join(' ')}`);
    assert.deepEqual(bins.slice(0, 4), [
      'systemctl stop snapclient.service',
      'dpkg --purge snapclient',
      'rm -f /etc/default/snapclient',
      'apt-get update',
    ]);
  } finally {
    restoreRun();
    restoreSudo();
  }
});

test('executeDebUpdate() clean=true (snapclient) tolerates the stop/purge steps failing (mirrors the original `|| true`)', async () => {
  const restoreSudo = stubNeedsSudo(false);
  const restoreRun = stubRun(async (bin: string, args: string[]) => {
    if ((bin === 'systemctl' && args[0] === 'stop') || (bin === 'dpkg' && args[0] === '--purge')) {
      throw new Error('unit/package not found');
    }
    return { stdout: '', stderr: '' };
  });
  try {
    const service = freshService();
    const result = await (service as any).executeDebUpdate('https://example.com/snapclient.deb', 'snapclient.deb', true, 'snapclient');
    assert.match(result, /snapclient updated successfully/);
  } finally {
    restoreRun();
    restoreSudo();
  }
});

test('executeDebUpdate() clean=true (snapserver): stops, purges (tolerating failure), then removes config/data paths in one rm -rf', async () => {
  const calls: Call[] = [];
  const restoreSudo = stubNeedsSudo(false);
  const restoreRun = stubRunRecording(calls);
  try {
    const service = freshService();
    await (service as any).executeDebUpdate('https://example.com/snapserver.deb', 'snapserver.deb', true, 'snapserver');
    const bins = calls.map(c => `${c.bin} ${c.args.join(' ')}`);
    assert.deepEqual(bins.slice(0, 4), [
      'systemctl stop snapserver.service',
      'dpkg --purge snapserver',
      'rm -rf /etc/snapserver.conf /etc/snapserver.conf.base /etc/snapserver.conf.d /var/lib/snapserver',
      'apt-get update',
    ]);
  } finally {
    restoreRun();
    restoreSudo();
  }
});

test('executeDebUpdate() logs progress at multiple distinguishable steps, not just once at the end', async () => {
  const restoreSudo = stubNeedsSudo(false);
  const restoreRun = stubRunRecording([]);
  const { calls: logCalls, restore: restoreJobLog } = stubJobLog();
  try {
    const service = freshService();
    await (service as any).executeDebUpdate('https://example.com/snapserver.deb', 'snapserver.deb', false, 'snapserver');
    assert.ok(logCalls.length > 3, `expected multiple progress log lines, got ${logCalls.length}: ${JSON.stringify(logCalls)}`);
    assert.equal(logCalls[logCalls.length - 1], 'snapserver updated successfully.');
    for (const fragment of ['Updating package lists', 'Downloading', 'Installing', 'post-install']) {
      assert.ok(logCalls.some(l => l.includes(fragment)), `expected a log line mentioning "${fragment}", got: ${JSON.stringify(logCalls)}`);
    }
  } finally {
    restoreRun();
    restoreSudo();
    restoreJobLog();
  }
});

// ============================================================
// TASK 12 -- installShairportSync() -- thin wrapper around the extracted
// server/scripts/install-shairport-sync.sh; the script's actual build
// logic is genuinely untestable here without a real Debian build
// toolchain (DONE_WITH_CONCERNS, see task-12-report.md).
// ============================================================

test('installShairportSync() runs the extracted script directly (NOT via runPrivileged/sudo-wrapped) and passes SNAPMGR_SUDO="0" when needsSudo() is false', async () => {
  const calls: Call[] = [];
  const restoreSudo = stubNeedsSudo(false);
  const restoreRun = stubRunRecording(calls);
  try {
    const service = freshService();
    const result = await service.installShairportSync();
    assert.match(result, /Shairport-sync and nqptp installed successfully/);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].bin, 'bash');
    assert.equal(calls[0].args.length, 1);
    assert.ok(calls[0].args[0].endsWith(path.join('scripts', 'install-shairport-sync.sh')), `expected the script path, got ${calls[0].args[0]}`);
    const opts = calls[0].opts as any;
    assert.equal(opts?.env?.SNAPMGR_SUDO, '0');
  } finally {
    restoreRun();
    restoreSudo();
  }
});

test('installShairportSync() does NOT sudo-wrap the whole script invocation when needsSudo() is true -- instead passes SNAPMGR_SUDO="1" so the script escalates only its own privileged lines internally', async () => {
  const calls: Call[] = [];
  const restoreSudo = stubNeedsSudo(true);
  const restoreRun = stubRunRecording(calls);
  try {
    const service = freshService();
    await service.installShairportSync();
    assert.equal(calls.length, 1);
    // The outer `bash <script>` invocation itself must NOT be prefixed with
    // `sudo` -- that's exactly the widened-privileged-execution-surface bug
    // this fix closes (see task-12-report.md's "Fix report" section): the
    // build/compile phase inside the script must run unescalated even when
    // the invoking Node process needs sudo for its own privileged steps.
    assert.equal(calls[0].bin, 'bash');
    assert.ok(calls[0].args[0].endsWith(path.join('scripts', 'install-shairport-sync.sh')));
    const opts = calls[0].opts as any;
    assert.equal(opts?.env?.SNAPMGR_SUDO, '1');
  } finally {
    restoreRun();
    restoreSudo();
  }
});

test('installShairportSync() gives the build a generous timeout and maxBuffer (verbose, multi-minute compile)', async () => {
  const calls: Call[] = [];
  const restoreSudo = stubNeedsSudo(false);
  const restoreRun = stubRunRecording(calls);
  try {
    const service = freshService();
    await service.installShairportSync();
    const opts = calls[0].opts as any;
    assert.ok(opts?.timeoutMs >= 10 * 60 * 1000, `expected a generous timeout, got ${opts?.timeoutMs}`);
    assert.ok(opts?.maxBuffer >= 10 * 1024 * 1024, `expected a generous maxBuffer, got ${opts?.maxBuffer}`);
  } finally {
    restoreRun();
    restoreSudo();
  }
});

test('installShairportSync() logs progress before and after the build', async () => {
  const restoreSudo = stubNeedsSudo(false);
  const restoreRun = stubRunRecording([]);
  const { calls: logCalls, restore: restoreJobLog } = stubJobLog();
  try {
    const service = freshService();
    await service.installShairportSync();
    assert.ok(logCalls.length >= 2, `expected at least a start and end log line, got ${JSON.stringify(logCalls)}`);
    assert.equal(logCalls[logCalls.length - 1], 'Shairport-sync and nqptp installed successfully.');
  } finally {
    restoreRun();
    restoreSudo();
    restoreJobLog();
  }
});

// ============================================================
// TASK 12 -- selectSnapCtrlDownloadUrl() -- replicates the embedded
// `python3 -c "..."` asset-selection one-liner exactly, in TypeScript
// ============================================================

test('selectSnapCtrlDownloadUrl() prefers an asset literally named dist.zip', () => {
  const release = {
    assets: [
      { name: 'dist-ha.zip', browser_download_url: 'https://example.com/dist-ha.zip' },
      { name: 'dist.zip', browser_download_url: 'https://example.com/dist.zip' },
      { name: 'source.zip', browser_download_url: 'https://example.com/source.zip' },
    ],
  };
  assert.equal(selectSnapCtrlDownloadUrl(release), 'https://example.com/dist.zip');
});

test('selectSnapCtrlDownloadUrl() is case-insensitive for the exact dist.zip match', () => {
  const release = { assets: [{ name: 'DIST.ZIP', browser_download_url: 'https://example.com/DIST.ZIP' }] };
  assert.equal(selectSnapCtrlDownloadUrl(release), 'https://example.com/DIST.ZIP');
});

test('selectSnapCtrlDownloadUrl() falls back to the first non-"ha" .zip asset when there is no exact dist.zip', () => {
  const release = {
    assets: [
      { name: 'dist-ha.zip', browser_download_url: 'https://example.com/dist-ha.zip' },
      { name: 'snap-ctrl-frontend.zip', browser_download_url: 'https://example.com/frontend.zip' },
    ],
  };
  assert.equal(selectSnapCtrlDownloadUrl(release), 'https://example.com/frontend.zip');
});

test('selectSnapCtrlDownloadUrl() falls back to the first .zip asset at all when every zip name contains "ha"', () => {
  const release = {
    assets: [
      { name: 'dist-ha.zip', browser_download_url: 'https://example.com/first-ha.zip' },
      { name: 'other-ha.zip', browser_download_url: 'https://example.com/second-ha.zip' },
    ],
  };
  assert.equal(selectSnapCtrlDownloadUrl(release), 'https://example.com/first-ha.zip');
});

test('selectSnapCtrlDownloadUrl() falls back to release.zipball_url when there are no .zip assets at all', () => {
  const release = { assets: [{ name: 'readme.txt', browser_download_url: 'https://example.com/readme.txt' }], zipball_url: 'https://api.github.com/repos/x/y/zipball/v1.0.0' };
  assert.equal(selectSnapCtrlDownloadUrl(release), 'https://api.github.com/repos/x/y/zipball/v1.0.0');
});

test('selectSnapCtrlDownloadUrl() returns "" when there is neither a .zip asset nor a zipball_url', () => {
  assert.equal(selectSnapCtrlDownloadUrl({ assets: [] }), '');
  assert.equal(selectSnapCtrlDownloadUrl({}), '');
});

// ============================================================
// TASK 12 -- installSnapCtrl() -- python3 removed, TLS re-enabled,
// predictable /tmp paths eliminated, minimal size check added
// ============================================================

function stubInstallSnapCtrlHappyPath(overrides: { zipBytes?: number; unzipOk?: boolean; findOutputs?: string[] } = {}) {
  const calls: Call[] = [];
  const zipBytes = overrides.zipBytes ?? 1024;
  const findOutputs = overrides.findOutputs ?? ['/extract/pkg/dist/index.html\n', ''];
  let findCallCount = 0;
  const restoreRun = stubRun(async (bin: string, args: string[], opts?: unknown) => {
    calls.push({ bin, args, opts });
    if (bin === 'find') {
      const out = findOutputs[findCallCount] ?? '';
      findCallCount++;
      return { stdout: out, stderr: '' };
    }
    return { stdout: '', stderr: '' };
  });
  const restoreFs = stubFsPromises({
    stat: async () => ({ size: zipBytes } as any),
  });
  return { calls, restoreRun, restoreFs };
}

test('installSnapCtrl() fetches the release via getLatestGitHubRelease() (no separate curl+python3 pipeline) and downloads WITHOUT --no-check-certificate', async () => {
  const restoreFetch = stubFetch(async (url: any) => {
    assert.equal(String(url), 'https://api.github.com/repos/NaturalDevCR/snap-ctrl/releases/latest');
    return jsonResponse(200, { tag_name: 'v3.1.0', assets: [{ name: 'dist.zip', browser_download_url: 'https://example.com/dist.zip' }] });
  });
  const { calls, restoreRun, restoreFs } = stubInstallSnapCtrlHappyPath();
  const restoreSudo = stubNeedsSudo(false);
  const restoreInstallFile = stubModuleFn(filesModule, 'installPrivilegedFile', async () => {});
  const restoreConfig = stubModuleFn(configModule.configService, 'setSnapserverDocRoot', async () => {});
  const restoreBackup = stubNoBackup();
  try {
    const service = freshService();
    await service.installSnapCtrl();
    const wgetCall = calls.find(c => c.bin === 'wget');
    assert.ok(wgetCall, 'expected a wget download call');
    assert.deepEqual(wgetCall!.args.slice(0, 1), ['-qO']);
    assert.equal(wgetCall!.args[2], 'https://example.com/dist.zip');
    for (const arg of wgetCall!.args) {
      assert.notEqual(arg, '--no-check-certificate', 'TLS certificate validation must not be disabled');
    }
  } finally {
    restoreFetch();
    restoreRun();
    restoreFs();
    restoreSudo();
    restoreInstallFile();
    restoreConfig();
    restoreBackup();
  }
});

test('installSnapCtrl() throws when the downloaded archive is zero bytes (minimal size sanity check)', async () => {
  const restoreFetch = stubFetch(async () => jsonResponse(200, { tag_name: 'v3.1.0', assets: [{ name: 'dist.zip', browser_download_url: 'https://example.com/dist.zip' }] }));
  const { restoreRun, restoreFs } = stubInstallSnapCtrlHappyPath({ zipBytes: 0 });
  const restoreSudo = stubNeedsSudo(false);
  const restoreBackup = stubNoBackup();
  try {
    const service = freshService();
    await assert.rejects(() => service.installSnapCtrl(), /empty/i);
  } finally {
    restoreFetch();
    restoreRun();
    restoreFs();
    restoreSudo();
    restoreBackup();
  }
});

test('installSnapCtrl() locates index.html via `find` with argv-safe -path filtering, falling back to an unfiltered find when the dist-path search comes up empty', async () => {
  const restoreFetch = stubFetch(async () => jsonResponse(200, { tag_name: 'v3.1.0', assets: [{ name: 'dist.zip', browser_download_url: 'https://example.com/dist.zip' }] }));
  const { calls, restoreRun, restoreFs } = stubInstallSnapCtrlHappyPath({ findOutputs: ['', '/extract/index.html\n'] });
  const restoreSudo = stubNeedsSudo(false);
  const restoreInstallFile = stubModuleFn(filesModule, 'installPrivilegedFile', async () => {});
  const restoreConfig = stubModuleFn(configModule.configService, 'setSnapserverDocRoot', async () => {});
  const restoreBackup = stubNoBackup();
  try {
    const service = freshService();
    await service.installSnapCtrl();
    const findCalls = calls.filter(c => c.bin === 'find');
    assert.equal(findCalls.length, 2);
    assert.ok(findCalls[0].args.includes('-path'), 'first find call should filter by -path */dist/*');
    assert.ok(!findCalls[1].args.includes('-path'), 'fallback find call should NOT filter by -path');
    for (const c of findCalls) {
      assert.deepEqual(c.args.slice(0, 4), [c.args[0], '-type', 'f', '-name']);
      assert.ok(c.args.includes('index.html'));
      assert.ok(c.args.includes('-print'));
      assert.ok(c.args.includes('-quit'));
    }
  } finally {
    restoreFetch();
    restoreRun();
    restoreFs();
    restoreSudo();
    restoreInstallFile();
    restoreConfig();
    restoreBackup();
  }
});

test('installSnapCtrl() throws a clear error when no index.html is found at all', async () => {
  const restoreFetch = stubFetch(async () => jsonResponse(200, { tag_name: 'v3.1.0', assets: [{ name: 'dist.zip', browser_download_url: 'https://example.com/dist.zip' }] }));
  const { restoreRun, restoreFs } = stubInstallSnapCtrlHappyPath({ findOutputs: ['', ''] });
  const restoreSudo = stubNeedsSudo(false);
  const restoreBackup = stubNoBackup();
  try {
    const service = freshService();
    await assert.rejects(() => service.installSnapCtrl(), /no built index\.html/i);
  } finally {
    restoreFetch();
    restoreRun();
    restoreFs();
    restoreSudo();
    restoreBackup();
  }
});

test('installSnapCtrl() empties the install directory via rm -rf + mkdir -p (no shell glob), then cp -rT, sudo-gated when needsSudo() is true', async () => {
  const restoreFetch = stubFetch(async () => jsonResponse(200, { tag_name: 'v3.1.0', assets: [{ name: 'dist.zip', browser_download_url: 'https://example.com/dist.zip' }] }));
  const { calls, restoreRun, restoreFs } = stubInstallSnapCtrlHappyPath({ findOutputs: ['/extract/pkg/dist/index.html\n', ''] });
  const restoreSudo = stubNeedsSudo(true);
  const restoreInstallFile = stubModuleFn(filesModule, 'installPrivilegedFile', async () => {});
  const restoreConfig = stubModuleFn(configModule.configService, 'setSnapserverDocRoot', async () => {});
  const restoreBackup = stubNoBackup();
  try {
    const service = freshService();
    await service.installSnapCtrl();
    const bins = calls.filter(c => c.bin === 'sudo').map(c => c.args.join(' '));
    const installPath = '/usr/share/snapserver/snap-ctrl';
    const docRootPath = path.join(installPath, 'dist');
    assert.ok(bins.includes(`rm -rf ${installPath}`), `expected rm -rf ${installPath}, got ${JSON.stringify(bins)}`);
    assert.ok(bins.includes(`mkdir -p ${docRootPath}`), `expected mkdir -p ${docRootPath}, got ${JSON.stringify(bins)}`);
    assert.ok(bins.some(b => b.startsWith(`cp -rT /extract/pkg/dist ${docRootPath}`)), `expected cp -rT ..., got ${JSON.stringify(bins)}`);
    // No shell-glob remnants of the old `${installPath}/* ${installPath}/.[!.]*` trick anywhere in argv.
    for (const c of calls) {
      for (const arg of c.args) {
        assert.ok(!arg.includes('.[!.]'), `unexpected shell glob in argv: ${JSON.stringify(arg)}`);
      }
    }
  } finally {
    restoreFetch();
    restoreRun();
    restoreFs();
    restoreSudo();
    restoreInstallFile();
    restoreConfig();
    restoreBackup();
  }
});

test('installSnapCtrl() records the release tag via platform/files.ts installPrivilegedFile() (no printf | tee pipe)', async () => {
  const restoreFetch = stubFetch(async () => jsonResponse(200, { tag_name: 'v3.1.0', assets: [{ name: 'dist.zip', browser_download_url: 'https://example.com/dist.zip' }] }));
  const { restoreRun, restoreFs } = stubInstallSnapCtrlHappyPath({ findOutputs: ['/extract/pkg/dist/index.html\n', ''] });
  const restoreSudo = stubNeedsSudo(false);
  const installFileCalls: { destPath: string; content: any }[] = [];
  const restoreInstallFile = stubModuleFn(filesModule, 'installPrivilegedFile', async (destPath: string, content: any) => {
    installFileCalls.push({ destPath, content });
  });
  const restoreConfig = stubModuleFn(configModule.configService, 'setSnapserverDocRoot', async () => {});
  const restoreBackup = stubNoBackup();
  try {
    const service = freshService();
    await service.installSnapCtrl();
    assert.equal(installFileCalls.length, 1);
    assert.equal(installFileCalls[0].destPath, '/usr/share/snapserver/snap-ctrl/.snap-ctrl-version');
    assert.equal(installFileCalls[0].content, 'v3.1.0');
  } finally {
    restoreFetch();
    restoreRun();
    restoreFs();
    restoreSudo();
    restoreInstallFile();
    restoreConfig();
    restoreBackup();
  }
});

test('installSnapCtrl() downloads to and extracts into unpredictable fs.mkdtemp() directories, never the fixed /tmp/snap-ctrl-download or /tmp/snap-ctrl-extract paths', async () => {
  const restoreFetch = stubFetch(async () => jsonResponse(200, { tag_name: 'v3.1.0', assets: [{ name: 'dist.zip', browser_download_url: 'https://example.com/dist.zip' }] }));
  const calls: Call[] = [];
  const findOutputs = ['/extract/pkg/dist/index.html\n', ''];
  let findCallCount = 0;
  const restoreRun = stubRun(async (bin: string, args: string[]) => {
    calls.push({ bin, args });
    if (bin === 'find') {
      const out = findOutputs[findCallCount] ?? '';
      findCallCount++;
      return { stdout: out, stderr: '' };
    }
    return { stdout: '', stderr: '' };
  });
  const restoreSudo = stubNeedsSudo(false);
  const restoreInstallFile = stubModuleFn(filesModule, 'installPrivilegedFile', async () => {});
  const restoreConfig = stubModuleFn(configModule.configService, 'setSnapserverDocRoot', async () => {});
  const restoreBackup = stubNoBackup();
  // fs.promises.stat is real here (not stubbed) -- the wget call is a no-op
  // stub, so no real zip file is written; instead we stub stat only to
  // report a non-zero size for whatever path is asked about, keeping the
  // rest of fs/promises (mkdtemp/rm) real so we can assert on real
  // directory paths/existence below.
  const restoreStat = stubFsPromises({ stat: async () => ({ size: 1024 } as any) });
  let capturedDownloadDir = '';
  let capturedExtractDir = '';
  try {
    const service = freshService();
    await service.installSnapCtrl();
    const wgetCall = calls.find(c => c.bin === 'wget');
    capturedDownloadDir = path.dirname(wgetCall!.args[1]);
    const unzipCall = calls.find(c => c.bin === 'unzip');
    capturedExtractDir = unzipCall!.args[unzipCall!.args.indexOf('-d') + 1];

    assert.notEqual(capturedDownloadDir, '/tmp/snap-ctrl-download');
    assert.notEqual(capturedExtractDir, '/tmp/snap-ctrl-extract');
    assert.ok(capturedDownloadDir.includes('snapmanager-snapctrl-dl-'));
    assert.ok(capturedExtractDir.includes('snapmanager-snapctrl-extract-'));
  } finally {
    restoreFetch();
    restoreRun();
    restoreSudo();
    restoreInstallFile();
    restoreConfig();
    restoreBackup();
    restoreStat();
    // Both temp dirs must be cleaned up afterwards.
    await assert.rejects(() => fsPromisesDefault.access(capturedDownloadDir));
    await assert.rejects(() => fsPromisesDefault.access(capturedExtractDir));
  }
});

test('installSnapCtrl() logs progress at multiple distinguishable steps, not just once at the end', async () => {
  const restoreFetch = stubFetch(async () => jsonResponse(200, { tag_name: 'v3.1.0', assets: [{ name: 'dist.zip', browser_download_url: 'https://example.com/dist.zip' }] }));
  const { restoreRun, restoreFs } = stubInstallSnapCtrlHappyPath({ findOutputs: ['/extract/pkg/dist/index.html\n', ''] });
  const restoreSudo = stubNeedsSudo(false);
  const restoreInstallFile = stubModuleFn(filesModule, 'installPrivilegedFile', async () => {});
  const restoreConfig = stubModuleFn(configModule.configService, 'setSnapserverDocRoot', async () => {});
  const restoreBackup = stubNoBackup();
  const { calls: logCalls, restore: restoreJobLog } = stubJobLog();
  try {
    const service = freshService();
    await service.installSnapCtrl();
    assert.ok(logCalls.length > 3, `expected multiple progress log lines, got ${logCalls.length}: ${JSON.stringify(logCalls)}`);
    assert.equal(logCalls[logCalls.length - 1], 'snap-ctrl installed successfully.');
  } finally {
    restoreFetch();
    restoreRun();
    restoreFs();
    restoreSudo();
    restoreInstallFile();
    restoreConfig();
    restoreBackup();
    restoreJobLog();
  }
});

// ============================================================
// Out-of-scope guard: sanity-check that the six Task-12 functions still
// exist (now migrated, exercised above -- this just guards against a
// future rename/removal going unnoticed).
// ============================================================

test('sanity: Task-12 functions are still present', () => {
  const service = freshService();
  for (const name of [
    'updateSnapserverFromGitHub',
    'updateSnapclientFromGitHub',
    'executeDebUpdate',
    'installShairportSync',
    'installSnapCtrl',
    'getDistroCodename',
  ]) {
    assert.equal(typeof (service as any)[name], 'function', `expected ${name} to still exist`);
  }
});

// ============================================================
// TASK 59 -- safeBackup() genuinely distinguishes "nothing to back up" (a
// legitimate outcome, e.g. a package's first-ever install) from a REAL
// backup failure (previously both collapsed to a silently-swallowed '' --
// this is the literal bug this task exists to fix). installPackage() and
// updatePackage() now abort BEFORE touching the system when the pre-install
// backup genuinely fails. For the 5 known-service packages
// (snapserver/snapclient/mpd/mympd/shairport-sync), installPackage() also
// verifies the service actually comes up within a short grace window
// afterward and auto-rolls-back to the pre-install backup if it doesn't.
// ============================================================

function stubCreatePreUpdateBackup(impl: (component: any) => Promise<any>): () => void {
  return stubModuleFn(backupModule.backupService, 'createPreUpdateBackup', impl);
}

function stubRestoreBackup(impl: (fileName: string) => Promise<string>): { calls: string[]; restore: () => void } {
  const calls: string[] = [];
  const restore = stubModuleFn(backupModule.backupService, 'restoreBackup', async (fileName: string) => {
    calls.push(fileName);
    return impl(fileName);
  });
  return { calls, restore };
}

function stubIsActive(impl: (unit: string) => boolean | Promise<boolean>): { calls: string[]; restore: () => void } {
  const calls: string[] = [];
  const restore = stubModuleFn(systemdModule, 'isActive', async (unit: string) => {
    calls.push(unit);
    return impl(unit);
  });
  return { calls, restore };
}

/** Makes the post-install grace-window retry loop instant in tests --
 * production keeps its own real ~1s-per-attempt timing (see system.ts'
 * postInstallCheckIntervalMs). */
function withInstantPostInstallRetries(service: SystemService): void {
  (service as any).postInstallCheckIntervalMs = 0;
}

const REAL_BACKUP_RESULT = {
  path: '/var/backups/snapmanager/pre-mpd-20260825-120000.tar.gz',
  fileName: 'pre-mpd-20260825-120000.tar.gz',
  size: 1234,
  timestamp: '20260825-120000',
  components: ['mpd'],
  files: ['/etc/snapserver.conf'],
};

const EMPTY_BACKUP_RESULT = {
  path: '', fileName: '', size: 0, timestamp: '20260825-120000', components: ['mpd'], files: [],
};

test('safeBackup() returns null when createPreUpdateBackup() genuinely succeeds but finds nothing to back up', async () => {
  const restoreBackup = stubCreatePreUpdateBackup(async () => EMPTY_BACKUP_RESULT);
  try {
    const service = freshService();
    const result = await (service as any).safeBackup('mpd');
    assert.equal(result, null);
  } finally {
    restoreBackup();
  }
});

test('safeBackup() returns the full BackupResult when a real backup was created', async () => {
  const restoreBackup = stubCreatePreUpdateBackup(async () => REAL_BACKUP_RESULT);
  try {
    const service = freshService();
    const result = await (service as any).safeBackup('mpd');
    assert.deepEqual(result, REAL_BACKUP_RESULT);
  } finally {
    restoreBackup();
  }
});

test('safeBackup() propagates (does not swallow) a genuine backup failure', async () => {
  const restoreBackup = stubCreatePreUpdateBackup(async () => { throw new Error('tar: disk full'); });
  try {
    const service = freshService();
    await assert.rejects(() => (service as any).safeBackup('mpd'), /disk full/);
  } finally {
    restoreBackup();
  }
});

test('installPackage() aborts BEFORE calling the installer logic when the pre-install backup genuinely fails (generic apt branch)', async () => {
  const restoreBackup = stubCreatePreUpdateBackup(async () => { throw new Error('tar: permission denied'); });
  const calls: Call[] = [];
  const restoreAptInstall = stubModuleFn(aptModule, 'install', async (pkgs: string[]) => { calls.push({ bin: 'apt.install', args: pkgs }); });
  const restoreAptUpdate = stubModuleFn(aptModule, 'update', async () => { calls.push({ bin: 'apt.update', args: [] }); });
  const { calls: logCalls, restore: restoreJobLog } = stubJobLog();
  try {
    const service = freshService();
    await assert.rejects(() => service.installPackage('ffmpeg'), /permission denied/);
    assert.equal(calls.length, 0, 'apt.update/apt.install must never be called when the backup failed');
    assert.ok(
      logCalls.some(l => l.toLowerCase().includes('backup') && l.toLowerCase().includes('abort')),
      `expected a job-log message about the aborted install, got: ${JSON.stringify(logCalls)}`,
    );
  } finally {
    restoreBackup();
    restoreAptInstall();
    restoreAptUpdate();
    restoreJobLog();
  }
});

test('updatePackage() aborts BEFORE calling the installer logic when the pre-update backup genuinely fails (generic apt branch)', async () => {
  const restoreBackup = stubCreatePreUpdateBackup(async () => { throw new Error('tar: permission denied'); });
  const calls: Call[] = [];
  const restoreAptUpgrade = stubModuleFn(aptModule, 'upgrade', async (pkgs: string[]) => { calls.push({ bin: 'apt.upgrade', args: pkgs }); });
  const restoreAptUpdate = stubModuleFn(aptModule, 'update', async () => { calls.push({ bin: 'apt.update', args: [] }); });
  const { calls: logCalls, restore: restoreJobLog } = stubJobLog();
  try {
    const service = freshService();
    await assert.rejects(() => service.updatePackage('ffmpeg' as any, false), /permission denied/);
    assert.equal(calls.length, 0, 'apt.update/apt.upgrade must never be called when the backup failed');
    assert.ok(
      logCalls.some(l => l.toLowerCase().includes('backup') && l.toLowerCase().includes('abort')),
      `expected a job-log message about the aborted update, got: ${JSON.stringify(logCalls)}`,
    );
  } finally {
    restoreBackup();
    restoreAptUpgrade();
    restoreAptUpdate();
    restoreJobLog();
  }
});

test('installPackage("mpd") succeeds and does NOT attempt a rollback when mpd.service comes up after the install', async () => {
  const restoreSudo = stubNeedsSudo(false);
  const restoreRun = stubRunRecording([]);
  const restoreBackup = stubCreatePreUpdateBackup(async () => REAL_BACKUP_RESULT);
  const { calls: restoreCalls, restore: restoreRestoreBackup } = stubRestoreBackup(async () => 'restored');
  const { restore: restoreIsActive } = stubIsActive(() => true);
  try {
    const service = freshService();
    withInstantPostInstallRetries(service);
    const result = await service.installPackage('mpd');
    assert.match(result, /MPD installed and started successfully/);
    assert.equal(restoreCalls.length, 0, 'restoreBackup() must not be called when the service came up');
  } finally {
    restoreRun();
    restoreSudo();
    restoreBackup();
    restoreRestoreBackup();
    restoreIsActive();
  }
});

// ------------------------------------------------------------------------
// Review fix pass (Task 59, Finding 1): backup.ts's collectSources() only
// ever backs up snapserver/snapclient-related files, REGARDLESS of
// `component` -- so for mpd/mympd/shairport-sync, any pre-install backup
// never contains anything specific to those packages. Restoring it after a
// failed install would be a no-op for whatever actually broke the package,
// so verifyServiceOrRollback() now treats these 3 packages the same as "no
// prior backup exists" -- it skips restoreBackup() entirely and says so
// honestly, rather than logging a misleading "rolled back successfully".
// ------------------------------------------------------------------------

test('installPackage("mpd") does NOT call restoreBackup() when mpd.service never comes up, even though a backup exists -- mpd has no package-specific backup coverage (Finding 1)', async () => {
  const restoreSudo = stubNeedsSudo(false);
  const restoreRun = stubRunRecording([]);
  const restoreBackup = stubCreatePreUpdateBackup(async () => REAL_BACKUP_RESULT);
  const { calls: restoreCalls, restore: restoreRestoreBackup } = stubRestoreBackup(
    async () => 'Restored from /var/backups/snapmanager/pre-mpd-20260825-120000.tar.gz',
  );
  const { restore: restoreIsActive } = stubIsActive(() => false);
  const { calls: logCalls, restore: restoreJobLog } = stubJobLog();
  try {
    const service = freshService();
    withInstantPostInstallRetries(service);
    await assert.rejects(() => service.installPackage('mpd'), /did not become active/i);
    assert.equal(
      restoreCalls.length, 0,
      'restoreBackup() must NOT be called for mpd -- the backup it would restore never contains mpd-specific files',
    );
    assert.ok(
      logCalls.some(l => /no rollback was attempted/i.test(l) && /mpd-specific/i.test(l)),
      `expected an honest job-log message explaining the backup is not mpd-specific and no rollback was attempted, got: ${JSON.stringify(logCalls)}`,
    );
    assert.ok(
      !logCalls.some(l => /rolled back automatically/i.test(l)),
      `must NOT claim a successful rollback occurred for mpd, got: ${JSON.stringify(logCalls)}`,
    );
  } finally {
    restoreRun();
    restoreSudo();
    restoreBackup();
    restoreRestoreBackup();
    restoreIsActive();
    restoreJobLog();
  }
});

test('installPackage("mpd") skips the rollback (never calls restoreBackup) when mpd.service never comes up and there was no prior backup', async () => {
  const restoreSudo = stubNeedsSudo(false);
  const restoreRun = stubRunRecording([]);
  const restoreBackup = stubCreatePreUpdateBackup(async () => EMPTY_BACKUP_RESULT);
  const { calls: restoreCalls, restore: restoreRestoreBackup } = stubRestoreBackup(async () => 'restored');
  const { calls: isActiveCalls, restore: restoreIsActive } = stubIsActive(() => false);
  const { calls: logCalls, restore: restoreJobLog } = stubJobLog();
  try {
    const service = freshService();
    withInstantPostInstallRetries(service);
    await assert.rejects(() => service.installPackage('mpd'), /did not become active/i);
    assert.equal(restoreCalls.length, 0, 'restoreBackup() must not be attempted when there was nothing to roll back to');
    assert.ok(
      logCalls.some(l => l.toLowerCase().includes('no') && l.toLowerCase().includes('backup')),
      `expected a job-log message noting there was no backup to roll back to, got: ${JSON.stringify(logCalls)}`,
    );
    // Finding 3: proves the retry loop genuinely polled all 5 attempts
    // (real multi-attempt polling) before giving up, not a single check.
    assert.equal(isActiveCalls.length, 5, 'expected all 5 poll attempts before giving up');
  } finally {
    restoreRun();
    restoreSudo();
    restoreBackup();
    restoreRestoreBackup();
    restoreIsActive();
    restoreJobLog();
  }
});

test('installPackage("snapclient") DOES call restoreBackup() when snapclient.service never comes up -- snapclient has genuine package-specific backup coverage, unlike mpd/mympd/shairport-sync', async () => {
  const restoreBackup = stubCreatePreUpdateBackup(async () => ({
    path: '/var/backups/snapmanager/pre-snapclient-20260825-120000.tar.gz',
    fileName: 'pre-snapclient-20260825-120000.tar.gz',
    size: 1234,
    timestamp: '20260825-120000',
    components: ['snapclient-config'],
    files: ['/etc/snapclient-manager'],
  }));
  const { calls: restoreCalls, restore: restoreRestoreBackup } = stubRestoreBackup(
    async () => 'Restored from /var/backups/snapmanager/pre-snapclient-20260825-120000.tar.gz',
  );
  const { restore: restoreIsActive } = stubIsActive(() => false);
  const { calls: logCalls, restore: restoreJobLog } = stubJobLog();
  const service = freshService();
  withInstantPostInstallRetries(service);
  (service as any).updateSnapclientFromGitHub = async () => 'snapclient updated successfully.';
  try {
    await assert.rejects(() => service.installPackage('snapclient'), /did not become active/i);
    assert.deepEqual(restoreCalls, ['pre-snapclient-20260825-120000.tar.gz']);
    assert.ok(
      logCalls.some(l => /rolled back automatically/i.test(l) && l.includes('pre-snapclient-20260825-120000.tar.gz')),
      `expected a job-log message about the genuine rollback, got: ${JSON.stringify(logCalls)}`,
    );
  } finally {
    restoreBackup();
    restoreRestoreBackup();
    restoreIsActive();
    restoreJobLog();
  }
});

// ------------------------------------------------------------------------
// Review fix pass (Task 59, Finding 2): no existing test independently
// verified isActive() was polled with the CORRECT, package-specific systemd
// unit name -- a regression that swapped two entries in KNOWN_SERVICE_UNITS
// would have passed every prior test. This exercises the real
// installPackage(pkg) call path for all 5 known-service packages (the only
// package-specific logic stubbed out is each package's OWN installer body,
// which is already covered by its own dedicated tests elsewhere in this
// file) and asserts the exact unit isActive() was called with, using
// hardcoded literal expectations (not read from KNOWN_SERVICE_UNITS itself)
// so a real swap in the map would be caught.
// ------------------------------------------------------------------------

test('installPackage() polls isActive() with the correct, package-specific systemd unit for each of the 5 known-service packages', async () => {
  const cases: { pkg: string; installerMethod: string; expectedUnit: string }[] = [
    { pkg: 'snapserver', installerMethod: 'updateSnapserverFromGitHub', expectedUnit: 'snapserver.service' },
    { pkg: 'snapclient', installerMethod: 'updateSnapclientFromGitHub', expectedUnit: 'snapclient.service' },
    { pkg: 'mpd', installerMethod: 'installMpd', expectedUnit: 'mpd.service' },
    { pkg: 'mympd', installerMethod: 'installMympd', expectedUnit: 'mympd.service' },
    { pkg: 'shairport-sync', installerMethod: 'installShairportSync', expectedUnit: 'shairport-sync.service' },
  ];

  for (const { pkg, installerMethod, expectedUnit } of cases) {
    const restoreBackup = stubNoBackup();
    const { calls: isActiveCalls, restore: restoreIsActive } = stubIsActive(() => true);
    const service = freshService();
    (service as any)[installerMethod] = async () => `${pkg} installed successfully.`;
    try {
      await service.installPackage(pkg);
      assert.deepEqual(
        isActiveCalls, [expectedUnit],
        `installPackage(${JSON.stringify(pkg)}) polled isActive() with the wrong unit: got ${JSON.stringify(isActiveCalls)}, expected [${JSON.stringify(expectedUnit)}]`,
      );
    } finally {
      restoreBackup();
      restoreIsActive();
    }
  }
});

// ------------------------------------------------------------------------
// Review fix pass (Task 59, Finding 3): no existing test exercised a
// service that comes up on a LATER poll attempt (not the first, not never)
// -- proving the retry loop genuinely treats "became active partway through
// the window" as success, not just "active immediately" or "never active".
// ------------------------------------------------------------------------

test('installPackage("mpd") succeeds with NO rollback when mpd.service only becomes active on a later poll attempt (attempt 3 of 5)', async () => {
  const restoreSudo = stubNeedsSudo(false);
  const restoreRun = stubRunRecording([]);
  const restoreBackup = stubCreatePreUpdateBackup(async () => REAL_BACKUP_RESULT);
  const { calls: restoreCalls, restore: restoreRestoreBackup } = stubRestoreBackup(async () => 'restored');
  let attempt = 0;
  // false, false, true -- becomes active on the 3rd call, well within the
  // 5-attempt window.
  const { calls: isActiveCalls, restore: restoreIsActive } = stubIsActive(() => {
    attempt++;
    return attempt >= 3;
  });
  try {
    const service = freshService();
    withInstantPostInstallRetries(service);
    const result = await service.installPackage('mpd');
    assert.match(result, /MPD installed and started successfully/);
    assert.equal(isActiveCalls.length, 3, 'expected exactly 3 polls -- 2 failures then success on the 3rd, not a single check');
    assert.equal(restoreCalls.length, 0, 'a service that came up within the retry window must NOT trigger a rollback');
  } finally {
    restoreRun();
    restoreSudo();
    restoreBackup();
    restoreRestoreBackup();
    restoreIsActive();
  }
});

test('installPackage() generic apt branch (ffmpeg) performs no post-install service check and never calls restoreBackup', async () => {
  const restoreSudo = stubNeedsSudo(false);
  const restoreRun = stubRunRecording([]);
  const restoreBackup = stubCreatePreUpdateBackup(async () => REAL_BACKUP_RESULT);
  const { calls: restoreCalls, restore: restoreRestoreBackup } = stubRestoreBackup(async () => 'restored');
  const { calls: isActiveCalls, restore: restoreIsActive } = stubIsActive(() => false);
  try {
    const service = freshService();
    const result = await service.installPackage('ffmpeg');
    assert.match(result, /ffmpeg installed successfully/);
    assert.equal(isActiveCalls.length, 0, 'no post-install service check for the generic apt fallback path');
    assert.equal(restoreCalls.length, 0);
  } finally {
    restoreRun();
    restoreSudo();
    restoreBackup();
    restoreRestoreBackup();
    restoreIsActive();
  }
});
