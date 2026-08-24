// eslint-disable-next-line @typescript-eslint/ban-ts-comment -- deliberate, see explanation below
// @ts-nocheck
//
// Why: see server/src/platform/systemd.test.ts's identical header for the
// full investigation into the `node --test --import ts-node/register`
// parameter-type-stripping bug this pragma works around. This file's
// `stubModuleFn` helper binds parameterized functions to module-exports
// properties (execModule.run/needsSudo), which hits the same bug.
// Correctness is independently confirmed with real type-checking via:
//   npx tsc --noEmit --strict --target es2020 --module commonjs \
//     --esModuleInterop --skipLibCheck src/services/watchdog.test.ts
// This does not affect `npm run build` (test files are excluded from
// tsconfig's project) or the production `services/watchdog.ts` file, which
// has no such pragma.
//
// TASK 13 -- migrates services/watchdog.ts's two remaining shell call
// sites (getStats()'s `ss` query, getFallbackStatsMac()'s `lsof` query, and
// killConnection()'s `ss -K`) off child_process.exec() string interpolation
// onto platform/exec.ts's argv-based run()/needsSudo(). This is the LAST
// file with scripts/check-no-shell-injection.sh matches -- see that
// script's output going from non-empty to empty as this migration's
// external proof.
//
// killConnection() sudo-pattern decision: the ORIGINAL code always tried
// `sudo ss -K ...` first, and on ANY failure (including a plain permission
// failure that sudo itself would also hit) fell back to a bare `ss -K ...`
// without sudo. This migration STANDARDIZES to the single-decision
// `needsSudo()` pattern used everywhere else in this codebase
// (platform/systemd.ts's control(), services/backup.ts, services/system.ts)
// -- see the report for the concrete reasoning (this app's systemd unit,
// scripts/install.sh, grants the service process no ambient capabilities
// and no passwordless-sudo carve-out for `ss` specifically, so there is no
// real deployment shape in this repo where needsSudo()'s single decision
// and the original's blind "try both" would actually diverge in outcome).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, unlinkSync } from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as execModule from '../platform/exec';
import { ExecError } from '../platform/exec';
import { WatchdogService, Watchdog } from './watchdog';

function stubModuleFn(mod: any, key: string, impl: (...args: any[]) => any): () => void {
  const original = mod[key];
  mod[key] = impl;
  return () => {
    mod[key] = original;
  };
}

type Call = { bin: string; args: string[] };

function stubRun(impl: (bin: string, args: string[]) => Promise<{ stdout: string; stderr: string }>): () => void {
  return stubModuleFn(execModule, 'run', impl);
}

function stubRunRecording(calls: Call[], stdout = ''): () => void {
  return stubRun(async (bin: string, args: string[]) => {
    calls.push({ bin, args });
    return { stdout, stderr: '' };
  });
}

function stubNeedsSudo(value: boolean): () => void {
  return stubModuleFn(execModule, 'needsSudo', () => value);
}

/**
 * Constructs a WatchdogService without letting the real constructor's
 * Task-26 construction-time load()-and-decide pass (see
 * applyAutoCleanupState() in watchdog.ts) see any real, disk-backed
 * watchdog config -- a live interval referencing a real fs-backed load()
 * would both pollute run()-call assertions if a test happens to straddle a
 * tick and keep this test file's `node --test` child process alive after
 * the test run finishes. Stubs load() (returning an empty list, so
 * applyAutoCleanupState() finds nothing qualifying and never starts the
 * timer) at the PROTOTYPE level for the duration of construction only --
 * the constructor calls this.load() synchronously as part of dispatching
 * its promise chain, so by the time `new WatchdogService()` returns the
 * stub has already been captured; restoring the prototype right after is
 * safe (same reasoning the pre-existing stubLoad() below documents for
 * instance-level overrides). Neither load() nor startAutoCleanup() /
 * applyAutoCleanupState() themselves are modified -- only stubbed out for
 * the duration of construction.
 */
function newService(): WatchdogService {
  const proto = WatchdogService.prototype as any;
  const original = proto.load;
  proto.load = async () => [];
  try {
    return new WatchdogService();
  } finally {
    proto.load = original;
  }
}

/**
 * Task 26: constructs a WatchdogService backed by a real, isolated,
 * throwaway JSON file (in the OS temp dir, never the real
 * /etc/snapcast-manager path or the repo-local dev fallback) so the REAL
 * load()/save()/ensureConfig() chain -- and therefore the real
 * applyAutoCleanupState() wiring inside save() and the constructor -- runs
 * end-to-end for these on-demand-timer tests, rather than being
 * short-circuited by an in-memory stub. `ensureConfig()` is overridden at
 * the PROTOTYPE level (like newService() above) so the constructor's own
 * synchronous this.load() dispatch picks it up; UNLIKE newService(), the
 * override is deliberately left in place (restored only by the returned
 * `restore()`, which the caller must invoke in a `finally`) so every
 * subsequent addWatchdog()/updateWatchdog()/deleteWatchdog() call made
 * during the test keeps reading/writing the same temp file.
 */
function newServiceWithTempConfig(initial?: Watchdog[]): { service: WatchdogService; restore: () => void } {
  const configPath = path.join(
    os.tmpdir(),
    `watchdog-test-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.json`,
  );
  if (initial !== undefined) {
    writeFileSync(configPath, JSON.stringify(initial, null, 2), 'utf-8');
  }
  const proto = WatchdogService.prototype as any;
  const original = proto.ensureConfig;
  proto.ensureConfig = async () => configPath;
  const service = new WatchdogService();
  const restore = () => {
    proto.ensureConfig = original;
    (service as any).stopAutoCleanup();
    try {
      unlinkSync(configPath);
    } catch {
      // already gone / never written -- fine.
    }
  };
  return { service, restore };
}

/** Overrides the instance's own load() (shadows the prototype method) so
 * tests don't need to touch the real /etc/snapcast-manager config file. */
function stubLoad(service: WatchdogService, watchdogs: Watchdog[]): void {
  (service as any).load = async () => watchdogs;
}

function stubPlatform(value: NodeJS.Platform): () => void {
  const original = Object.getOwnPropertyDescriptor(process, 'platform')!;
  Object.defineProperty(process, 'platform', { value, configurable: true });
  return () => {
    Object.defineProperty(process, 'platform', original);
  };
}

// ---- getStats(): ss argv shape ----

test('getStats() runs ss with the filter expression as ONE argv element, no sudo', async () => {
  const calls: Call[] = [];
  const restoreRun = stubRunRecording(calls, 'State Recv-Q Send-Q Local Address:Port  Peer Address:Port\n');
  const service = newService();
  stubLoad(service, [{ id: 'wd1', name: 'Test', ports: [4953] }]);
  try {
    await service.getStats('wd1');
    assert.deepEqual(calls, [
      { bin: 'ss', args: ['-t', '-i', '-n', '-a', '( sport = :4953 or dport = :4953 )'] },
    ]);
  } finally {
    restoreRun();
  }
});

test('getStats() builds a distinct filter-expression argv element per port', async () => {
  const calls: Call[] = [];
  const restoreRun = stubRunRecording(calls);
  const service = newService();
  stubLoad(service, [{ id: 'wd1', name: 'Test', ports: [80, 443] }]);
  try {
    await service.getStats('wd1');
    assert.deepEqual(calls, [
      { bin: 'ss', args: ['-t', '-i', '-n', '-a', '( sport = :80 or dport = :80 )'] },
      { bin: 'ss', args: ['-t', '-i', '-n', '-a', '( sport = :443 or dport = :443 )'] },
    ]);
  } finally {
    restoreRun();
  }
});

// ---- getStats() -> getFallbackStatsMac(): the macOS dev fallback ----

test('getStats() falls back to lsof via argv on darwin when ss fails', async () => {
  const calls: Call[] = [];
  const restorePlatform = stubPlatform('darwin');
  const restoreRun = stubRun(async (bin: string, args: string[]) => {
    calls.push({ bin, args });
    if (bin === 'ss') throw new ExecError('ss', args, 127, '', 'ss: command not found');
    if (bin === 'lsof') {
      return {
        stdout:
          'COMMAND   PID USER   FD   TYPE DEVICE SIZE/OFF NODE NAME\n' +
          'node    1234 user   10u  IPv4 0x0      0t0      TCP 127.0.0.1:4953->127.0.0.1:51111 (ESTABLISHED)\n',
        stderr: '',
      };
    }
    throw new Error(`unexpected bin ${bin}`);
  });
  const service = newService();
  stubLoad(service, [{ id: 'wd1', name: 'Test', ports: [4953] }]);
  try {
    const stats = await service.getStats('wd1');
    assert.deepEqual(calls, [
      { bin: 'ss', args: ['-t', '-i', '-n', '-a', '( sport = :4953 or dport = :4953 )'] },
      { bin: 'lsof', args: ['-i', ':4953', '-n', '-P'] },
    ]);
    assert.equal(stats.length, 1);
    assert.equal(stats[0].peerAddress, '127.0.0.1');
    assert.equal(stats[0].peerPort, 51111);
  } finally {
    restoreRun();
    restorePlatform();
  }
});

test('getStats() does NOT fall back to lsof on non-darwin when ss fails', async () => {
  const calls: Call[] = [];
  const restorePlatform = stubPlatform('linux');
  const restoreRun = stubRun(async (bin: string, args: string[]) => {
    calls.push({ bin, args });
    throw new ExecError('ss', args, 127, '', 'ss: command not found');
  });
  const service = newService();
  stubLoad(service, [{ id: 'wd1', name: 'Test', ports: [4953] }]);
  try {
    const stats = await service.getStats('wd1');
    assert.deepEqual(calls, [
      { bin: 'ss', args: ['-t', '-i', '-n', '-a', '( sport = :4953 or dport = :4953 )'] },
    ]);
    assert.deepEqual(stats, []);
  } finally {
    restoreRun();
    restorePlatform();
  }
});

// ---- killConnection(): existing validation stays exactly as-is ----

test('killConnection() rejects an invalid peerIp BEFORE calling run()', async () => {
  const calls: Call[] = [];
  const restoreRun = stubRunRecording(calls);
  const service = newService();
  stubLoad(service, [{ id: 'wd1', name: 'Test', ports: [4953] }]);
  try {
    await assert.rejects(
      () => service.killConnection('wd1', 'not an ip; rm -rf /', 51111),
      /Invalid peer IP/,
    );
    assert.deepEqual(calls, []);
  } finally {
    restoreRun();
  }
});

test('killConnection() rejects an out-of-range peerPort BEFORE calling run()', async () => {
  const calls: Call[] = [];
  const restoreRun = stubRunRecording(calls);
  const service = newService();
  stubLoad(service, [{ id: 'wd1', name: 'Test', ports: [4953] }]);
  try {
    await assert.rejects(
      () => service.killConnection('wd1', '127.0.0.1', 99999),
      /Invalid peer port/,
    );
    assert.deepEqual(calls, []);
  } finally {
    restoreRun();
  }
});

test('killConnection() rejects a non-integer peerPort BEFORE calling run()', async () => {
  const calls: Call[] = [];
  const restoreRun = stubRunRecording(calls);
  const service = newService();
  stubLoad(service, [{ id: 'wd1', name: 'Test', ports: [4953] }]);
  try {
    await assert.rejects(
      () => service.killConnection('wd1', '127.0.0.1', 1.5),
      /Invalid peer port/,
    );
    assert.deepEqual(calls, []);
  } finally {
    restoreRun();
  }
});

// ---- killConnection(): needsSudo()-gated argv ----

test('killConnection() runs `sudo ss -K ...` via argv when needsSudo() is true', async () => {
  const calls: Call[] = [];
  const restoreRun = stubRunRecording(calls);
  const restoreSudo = stubNeedsSudo(true);
  const service = newService();
  stubLoad(service, [{ id: 'wd1', name: 'Test', ports: [4953] }]);
  try {
    const result = await service.killConnection('wd1', '127.0.0.1', 51111);
    assert.equal(result, true);
    assert.deepEqual(calls, [
      { bin: 'sudo', args: ['ss', '-K', 'dst', '127.0.0.1', 'dport', '=', '51111'] },
    ]);
  } finally {
    restoreRun();
    restoreSudo();
  }
});

test('killConnection() runs bare `ss -K ...` via argv (no sudo) when needsSudo() is false', async () => {
  const calls: Call[] = [];
  const restoreRun = stubRunRecording(calls);
  const restoreSudo = stubNeedsSudo(false);
  const service = newService();
  stubLoad(service, [{ id: 'wd1', name: 'Test', ports: [4953] }]);
  try {
    const result = await service.killConnection('wd1', '127.0.0.1', 51111);
    assert.equal(result, true);
    assert.deepEqual(calls, [
      { bin: 'ss', args: ['-K', 'dst', '127.0.0.1', 'dport', '=', '51111'] },
    ]);
  } finally {
    restoreRun();
    restoreSudo();
  }
});

test('killConnection() supports bracketed IPv6 peerIp addresses via argv', async () => {
  const calls: Call[] = [];
  const restoreRun = stubRunRecording(calls);
  const restoreSudo = stubNeedsSudo(false);
  const service = newService();
  stubLoad(service, [{ id: 'wd1', name: 'Test', ports: [4953] }]);
  try {
    const result = await service.killConnection('wd1', '[::1]', 51111);
    assert.equal(result, true);
    assert.deepEqual(calls, [
      { bin: 'ss', args: ['-K', 'dst', '[::1]', 'dport', '=', '51111'] },
    ]);
  } finally {
    restoreRun();
    restoreSudo();
  }
});

// ---- killConnection(): return-false-on-failure contract ----

test('killConnection() returns false (does not throw) when run() rejects', async () => {
  const restoreRun = stubRun(async (bin: string, args: string[]) => {
    throw new ExecError(bin, args, 1, '', 'RTNETLINK answers: Operation not permitted');
  });
  const restoreSudo = stubNeedsSudo(true);
  const service = newService();
  stubLoad(service, [{ id: 'wd1', name: 'Test', ports: [4953] }]);
  try {
    const result = await service.killConnection('wd1', '127.0.0.1', 51111);
    assert.equal(result, false);
  } finally {
    restoreRun();
    restoreSudo();
  }
});

test('killConnection() does NOT fall back to a second (non-sudo) run() call on failure -- single needsSudo() decision, not try-both', async () => {
  const calls: Call[] = [];
  const restoreRun = stubRun(async (bin: string, args: string[]) => {
    calls.push({ bin, args });
    throw new ExecError(bin, args, 1, '', 'Operation not permitted');
  });
  const restoreSudo = stubNeedsSudo(true);
  const service = newService();
  stubLoad(service, [{ id: 'wd1', name: 'Test', ports: [4953] }]);
  try {
    const result = await service.killConnection('wd1', '127.0.0.1', 51111);
    assert.equal(result, false);
    assert.deepEqual(calls, [
      { bin: 'sudo', args: ['ss', '-K', 'dst', '127.0.0.1', 'dport', '=', '51111'] },
    ]);
  } finally {
    restoreRun();
    restoreSudo();
  }
});

test('killConnection() throws "Watchdog not found" for an unknown id (still rejects, not a false return)', async () => {
  const calls: Call[] = [];
  const restoreRun = stubRunRecording(calls);
  const service = newService();
  stubLoad(service, []);
  try {
    await assert.rejects(
      () => service.killConnection('does-not-exist', '127.0.0.1', 51111),
      /Watchdog not found/,
    );
    assert.deepEqual(calls, []);
  } finally {
    restoreRun();
  }
});

// ============================================================================
// Task 26, Part 1: the auto-cleanup poll starts/stops on demand -- only
// while at least one persisted watchdog has `enabled && autoKillDuplicates`
// -- instead of running unconditionally for the process lifetime.
// ============================================================================

test('timer starts on construction when a qualifying watchdog is already persisted', async () => {
  const { service, restore } = newServiceWithTempConfig([
    { id: 'wd1', name: 'Already Qualifying', ports: [4953], enabled: true, autoKillDuplicates: true },
  ]);
  try {
    await (service as any).ready;
    assert.notEqual((service as any).intervalId, null, 'expected the timer to be running');
  } finally {
    restore();
  }
});

test('timer stays off on construction when the persisted watchdog is enabled but autoKillDuplicates is not set', async () => {
  const { service, restore } = newServiceWithTempConfig([
    { id: 'wd1', name: 'Enabled Only', ports: [4953], enabled: true, autoKillDuplicates: false },
  ]);
  try {
    await (service as any).ready;
    assert.equal((service as any).intervalId, null, 'expected the timer to stay off');
  } finally {
    restore();
  }
});

test('timer stays off on construction when the persisted watchdog has autoKillDuplicates set but is disabled', async () => {
  const { service, restore } = newServiceWithTempConfig([
    { id: 'wd1', name: 'AutoKill Only', ports: [4953], enabled: false, autoKillDuplicates: true },
  ]);
  try {
    await (service as any).ready;
    assert.equal((service as any).intervalId, null, 'expected the timer to stay off');
  } finally {
    restore();
  }
});

test('timer stays off on construction with an empty persisted watchdog list', async () => {
  const { service, restore } = newServiceWithTempConfig([]);
  try {
    await (service as any).ready;
    assert.equal((service as any).intervalId, null, 'expected the timer to stay off');
  } finally {
    restore();
  }
});

test('timer stays off on construction when no config file exists yet (load() returns [])', async () => {
  // No `initial` argument -- newServiceWithTempConfig() never writes the
  // temp file, so ensureConfig() points at a path that doesn't exist yet
  // and the real load()'s own try/catch (unmodified) returns [].
  const { service, restore } = newServiceWithTempConfig();
  try {
    await (service as any).ready;
    assert.equal((service as any).intervalId, null, 'expected the timer to stay off');
  } finally {
    restore();
  }
});

test('timer starts after updateWatchdog() enables autoKillDuplicates on the only watchdog', async () => {
  const { service, restore } = newServiceWithTempConfig([
    { id: 'wd1', name: 'To Be Upgraded', ports: [4953], enabled: true, autoKillDuplicates: false },
  ]);
  try {
    await (service as any).ready;
    assert.equal((service as any).intervalId, null, 'expected the timer to start off');

    await service.updateWatchdog('wd1', { autoKillDuplicates: true });
    assert.notEqual((service as any).intervalId, null, 'expected the timer to start after the update');
  } finally {
    restore();
  }
});

test('timer stops after the last qualifying watchdog is deleted', async () => {
  const { service, restore } = newServiceWithTempConfig([
    { id: 'wd1', name: 'The Only Qualifier', ports: [4953], enabled: true, autoKillDuplicates: true },
  ]);
  try {
    await (service as any).ready;
    assert.notEqual((service as any).intervalId, null, 'expected the timer to start on construction');

    await service.deleteWatchdog('wd1');
    assert.equal((service as any).intervalId, null, 'expected the timer to stop after deletion');
  } finally {
    restore();
  }
});

test('timer stops after the last qualifying watchdog is disabled via updateWatchdog()', async () => {
  const { service, restore } = newServiceWithTempConfig([
    { id: 'wd1', name: 'About To Be Disabled', ports: [4953], enabled: true, autoKillDuplicates: true },
  ]);
  try {
    await (service as any).ready;
    assert.notEqual((service as any).intervalId, null, 'expected the timer to start on construction');

    await service.updateWatchdog('wd1', { enabled: false });
    assert.equal((service as any).intervalId, null, 'expected the timer to stop once disabled');
  } finally {
    restore();
  }
});

test('timer stays on when one of two watchdogs stops qualifying but the other still does', async () => {
  const { service, restore } = newServiceWithTempConfig([
    { id: 'wd1', name: 'Stays Qualifying', ports: [4953], enabled: true, autoKillDuplicates: true },
    { id: 'wd2', name: 'Will Be Disabled', ports: [443], enabled: true, autoKillDuplicates: true },
  ]);
  try {
    await (service as any).ready;
    assert.notEqual((service as any).intervalId, null, 'expected the timer to start on construction');

    await service.updateWatchdog('wd2', { enabled: false });
    assert.notEqual((service as any).intervalId, null, 'expected the timer to stay on -- wd1 still qualifies');
  } finally {
    restore();
  }
});

test('timer starts after addWatchdog() adds a qualifying watchdog to an empty config', async () => {
  const { service, restore } = newServiceWithTempConfig([]);
  try {
    await (service as any).ready;
    assert.equal((service as any).intervalId, null, 'expected the timer to start off');

    await service.addWatchdog({ name: 'Freshly Added', ports: [4953], enabled: true, autoKillDuplicates: true });
    assert.notEqual((service as any).intervalId, null, 'expected the timer to start after the add');
  } finally {
    restore();
  }
});

test('timer stays off after addWatchdog() adds a non-qualifying watchdog', async () => {
  const { service, restore } = newServiceWithTempConfig([]);
  try {
    await (service as any).ready;
    await service.addWatchdog({ name: 'Not Qualifying', ports: [4953], enabled: false, autoKillDuplicates: true });
    assert.equal((service as any).intervalId, null, 'expected the timer to stay off');
  } finally {
    restore();
  }
});

test('startAutoCleanup()/stopAutoCleanup() are idempotent (calling either twice in a row is a no-op the second time)', async () => {
  const { service, restore } = newServiceWithTempConfig([]);
  try {
    await (service as any).ready;
    await service.startAutoCleanup();
    const firstHandle = (service as any).intervalId;
    await service.startAutoCleanup();
    assert.equal((service as any).intervalId, firstHandle, 'a second start must not replace the handle');

    service.stopAutoCleanup();
    assert.equal((service as any).intervalId, null);
    service.stopAutoCleanup();
    assert.equal((service as any).intervalId, null, 'a second stop on an already-stopped timer must not throw');
  } finally {
    restore();
  }
});
