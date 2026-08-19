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
// platform/apt.ts, platform/files.ts, and native fetch(). Six functions are
// explicitly OUT OF SCOPE (Task 12): updateSnapserverFromGitHub,
// updateSnapclientFromGitHub, executeDebUpdate, installShairportSync,
// installSnapCtrl, getDistroCodename -- untouched, not exercised here.
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
import * as backupModule from './backup';
import * as snapclientInstancesModule from './snapclientInstances';
import { SystemService } from './system';

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
// updateNodeJs() -- curl | sudo bash - pipe eliminated via fetch + stdin
// ============================================================

test('updateNodeJs() fetches the NodeSource setup script for the given major version', async () => {
  const fetchCalls: { url: string }[] = [];
  const restoreFetch = stubFetch(async (url: any) => {
    fetchCalls.push({ url: String(url) });
    return textResponse(200, '#!/bin/bash\necho setup\n');
  });
  const restoreSudo = stubNeedsSudo(false);
  const restoreRun = stubRun(async () => ({ stdout: '', stderr: '' }));
  const restoreAptInstall = stubModuleFn(aptModule, 'install', async () => {});
  try {
    const service = freshService();
    await service.updateNodeJs('20');
    assert.equal(fetchCalls.length, 1);
    assert.equal(fetchCalls[0].url, 'https://deb.nodesource.com/setup_20.x');
  } finally {
    restoreFetch();
    restoreRun();
    restoreSudo();
    restoreAptInstall();
  }
});

test('updateNodeJs() runs the fetched script via `bash -` on stdin -- no shell pipe -- unprefixed when needsSudo() is false', async () => {
  const scriptText = '#!/bin/bash\necho hello-nodesource\n';
  const calls: Call[] = [];
  const restoreFetch = stubFetch(async () => textResponse(200, scriptText));
  const restoreSudo = stubNeedsSudo(false);
  const restoreRun = stubRunRecording(calls);
  const restoreAptInstall = stubModuleFn(aptModule, 'install', async () => {});
  try {
    const service = freshService();
    await service.updateNodeJs('20');
    const bashCall = calls.find(c => c.bin === 'bash');
    assert.ok(bashCall, 'expected a bash call');
    assert.deepEqual(bashCall!.args, ['-']);
    assert.equal((bashCall!.opts as any)?.input, scriptText);
  } finally {
    restoreFetch();
    restoreRun();
    restoreSudo();
    restoreAptInstall();
  }
});

test('updateNodeJs() prefixes with `sudo -E` via argv (not string concatenation) when needsSudo() is true', async () => {
  const scriptText = '#!/bin/bash\necho hello\n';
  const calls: Call[] = [];
  const restoreFetch = stubFetch(async () => textResponse(200, scriptText));
  const restoreSudo = stubNeedsSudo(true);
  const restoreRun = stubRunRecording(calls);
  const restoreAptInstall = stubModuleFn(aptModule, 'install', async () => {});
  try {
    const service = freshService();
    await service.updateNodeJs('20');
    const bashCall = calls.find(c => c.bin === 'sudo');
    assert.ok(bashCall, 'expected a sudo-prefixed call');
    assert.deepEqual(bashCall!.args, ['-E', 'bash', '-']);
    assert.equal((bashCall!.opts as any)?.input, scriptText);
  } finally {
    restoreFetch();
    restoreRun();
    restoreSudo();
    restoreAptInstall();
  }
});

test('updateNodeJs() installs nodejs via platform/apt.ts install() after running the setup script', async () => {
  const installCalls: string[][] = [];
  const restoreFetch = stubFetch(async () => textResponse(200, '#!/bin/bash\n'));
  const restoreSudo = stubNeedsSudo(false);
  const restoreRun = stubRun(async () => ({ stdout: '', stderr: '' }));
  const restoreAptInstall = stubModuleFn(aptModule, 'install', async (pkgs: string[]) => {
    installCalls.push(pkgs);
  });
  try {
    const service = freshService();
    await service.updateNodeJs('20');
    assert.deepEqual(installCalls, [['nodejs']]);
  } finally {
    restoreFetch();
    restoreRun();
    restoreSudo();
    restoreAptInstall();
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

test('updateNodeJs() throws when the NodeSource setup script fetch is not ok', async () => {
  const restoreFetch = stubFetch(async () => textResponse(500, ''));
  try {
    const service = freshService();
    await assert.rejects(() => service.updateNodeJs('20'), /500/);
  } finally {
    restoreFetch();
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
  }
});

test('installMpd() prefixes every mutating call with sudo via argv when needsSudo() is true', async () => {
  const calls: Call[] = [];
  const restoreSudo = stubNeedsSudo(true);
  const restoreRun = stubRunRecording(calls);
  const restoreBackup = stubNoBackup();
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
  try {
    const service = freshService();
    const result = await service.installPackage('mpd');
    assert.match(result, /MPD installed and started successfully/);
  } finally {
    restoreRun();
    restoreSudo();
    restoreBackup();
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
// Out-of-scope guard: sanity-check that the six Task-12 functions still
// exist with their original names/behavior shape (not exercised further --
// they are explicitly untouched by this task).
// ============================================================

test('sanity: Task-12 functions are still present (untouched by Task 11)', () => {
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
