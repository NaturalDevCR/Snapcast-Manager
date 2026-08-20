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
 * Constructs a WatchdogService without letting the real constructor start
 * its 4-second auto-cleanup setInterval() (out of scope for this task per
 * the brief, and a live interval referencing a real fs-backed load() would
 * both pollute run()-call assertions if a test happens to straddle a tick
 * and keep this test file's `node --test` child process alive after the
 * test run finishes). startAutoCleanup() itself is not modified -- only
 * stubbed out for the duration of construction.
 */
function newService(): WatchdogService {
  const proto = WatchdogService.prototype as any;
  const original = proto.startAutoCleanup;
  proto.startAutoCleanup = async () => {};
  try {
    return new WatchdogService();
  } finally {
    proto.startAutoCleanup = original;
  }
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
