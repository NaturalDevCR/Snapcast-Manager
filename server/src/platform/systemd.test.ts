// eslint-disable-next-line @typescript-eslint/ban-ts-comment -- deliberate, see explanation below
// @ts-nocheck
//
// Why: `node --test --import ts-node/register` (the exact command `npm
// test` runs) has a pre-existing environment bug in this repo, unrelated to
// this task -- reproducible with a completely trivial file, e.g.:
//   const obj = { run: (x: number) => x };
//   test('t', async () => { obj.run = (x) => x + 1; });
// gives `error TS7006: Parameter 'x' implicitly has an 'any' type` on the
// FIRST line, despite the explicit `: number` annotation. This only
// happens under `node --test` (never under `npx ts-node file.ts`, nor
// `node --import ts-node/register -e "require(...)"`), and only for a
// function/arrow VALUE that gets bound to a name (const/let, a property
// assignment, a class method) anywhere in the file -- an inline arrow
// passed directly as a call argument (e.g. `arr.map((x: number) => ...)`)
// is unaffected. That fingerprint (annotations vanishing specifically
// under the test-runner's own file loading, never via ts-node's own CLI or
// a plain require) points at Node 24's built-in TypeScript type-stripping
// (`--experimental-strip-types`, on by default for .ts under `node --test`)
// racing/conflicting with the `ts-node/register` hook this project relies
// on for full type-checking -- ts-node 10.9.2 predates that Node feature.
// `assertValidUnitName`'s own tests above (pure value-in/error-out, no
// stored function values) aren't affected; the mocking helpers below
// (`stubRun`/`stubNeedsSudo`) are, since they by nature bind a parameterized
// function to `execModule.run`/`execModule.needsSudo`. This file's
// correctness is independently confirmed with real type-checking via:
//   npx tsc --noEmit --strict --target es2020 --module commonjs \
//     --esModuleInterop --skipLibCheck src/platform/systemd.test.ts
// which reports zero errors. See task-4-report.md for the full
// investigation and a minimal repro. This does not affect `npm run build`
// (test files are excluded from tsconfig's project) or the production
// `platform/exec.ts` / `platform/systemd.ts` files, which have no such
// pragma and are fully type-checked.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as execModule from './exec';
import { ExecError } from './exec';
import { assertValidUnitName, control, isActive, activeState, daemonReload, logs } from './systemd';

// ---- assertValidUnitName: syntax-only validation ----
// Checked against systemd.unit(5) (man7.org mirror, checked 2026-08-19):
// unit name prefix = one or more of ASCII letters, digits, ':', '-', '_',
// '.', '\', total length (incl. suffix) <= 255 chars, valid suffixes are
// .service .socket .device .mount .automount .swap .target .path .timer
// .slice .scope. Template units add exactly one '@' + instance name before
// the suffix (e.g. getty@tty1.service).

test('assertValidUnitName accepts syntactically valid unit names', () => {
  const valid = [
    'snapserver.service',
    'mpd.service',
    'snapclient-manager-42.service',
    'snapcast-radio-jazz.service',
    'getty@tty1.service',
    'foo.socket',
    'foo.device',
    'foo.mount',
    'foo.automount',
    'foo.swap',
    'foo.target',
    'foo.path',
    'foo.timer',
    'foo.slice',
    'foo.scope',
    'a.service',
    'A_b:c.service',
  ];
  for (const name of valid) {
    assert.doesNotThrow(() => assertValidUnitName(name), `expected accept: ${JSON.stringify(name)}`);
  }
});

test('assertValidUnitName rejects injection attempts and malformed names', () => {
  const bad = [
    '',
    'foo; rm -rf /.service',
    'foo`whoami`.service',
    'foo$(whoami).service',
    '../../etc/passwd',
    '../../etc/passwd.service',
    'foo\nbar.service',
    'foo.service\n',
    '\nfoo.service',
    'foo bar.service',
    'foo.service; rm -rf /',
    'foo.exe',
    'foo',
    'foo.',
    '.service',
    'foo/bar.service',
    'foo|bar.service',
    'foo&&bar.service',
    'a'.repeat(260) + '.service',
  ];
  for (const name of bad) {
    assert.throws(() => assertValidUnitName(name), `expected reject: ${JSON.stringify(name)}`);
  }
});

// ---- control / isActive / activeState / daemonReload / logs ----
// These are exercised against a stubbed `platform/exec.ts`'s `run()` /
// `needsSudo()` so no real systemd is required. Plain property
// reassignment + try/finally restore is used rather than node:test's
// built-in `t.mock` API, to match this repo's existing plain
// node:test + node:assert/strict style (see snapConfigEdit.test.ts) and to
// keep the mocking mechanism dependency-free.

type RunFn = typeof execModule.run;
type NeedsSudoFn = typeof execModule.needsSudo;
type Call = { bin: string; args: string[] };

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

/** Stubs run() to record every call and resolve with an empty success result. */
function stubRunRecording(calls: Call[]): () => void {
  return stubRun(async (bin: string, args: string[]) => {
    calls.push({ bin, args });
    return { stdout: '', stderr: '' };
  });
}

test('control() validates the unit name before calling run()', async () => {
  await assert.rejects(() => control('not a valid unit; rm -rf /', 'start'));
});

test('control() calls systemctl via an argv array (never a shell string)', async () => {
  const calls: Call[] = [];
  const restoreRun = stubRunRecording(calls);
  const restoreSudo = stubNeedsSudo(() => false);
  try {
    await control('snapserver.service', 'restart');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].bin, 'systemctl');
    assert.deepEqual(calls[0].args, ['restart', 'snapserver.service']);
  } finally {
    restoreRun();
    restoreSudo();
  }
});

test('control() prefixes with sudo via argv (not string concatenation) when needsSudo() is true', async () => {
  const calls: Call[] = [];
  const restoreRun = stubRunRecording(calls);
  const restoreSudo = stubNeedsSudo(() => true);
  try {
    await control('snapserver.service', 'stop');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].bin, 'sudo');
    assert.deepEqual(calls[0].args, ['systemctl', 'stop', 'snapserver.service']);
  } finally {
    restoreRun();
    restoreSudo();
  }
});

test('daemonReload() calls systemctl daemon-reload', async () => {
  const calls: Call[] = [];
  const restoreRun = stubRunRecording(calls);
  const restoreSudo = stubNeedsSudo(() => false);
  try {
    await daemonReload();
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0], { bin: 'systemctl', args: ['daemon-reload'] });
  } finally {
    restoreRun();
    restoreSudo();
  }
});

// ---- the systemctl is-active quirk ----
// `systemctl is-active <unit>` exits non-zero for inactive/failed units --
// that's the normal "not running" result, not an execution failure. run()
// still rejects with ExecError in that case (its contract is "reject on
// non-zero exit", full stop); activeState()/isActive() must catch that
// ExecError and, when it carries usable stdout (a known state string like
// "inactive" or "failed"), return it instead of propagating the throw.

test('activeState() returns "active" on a zero exit', async () => {
  const restoreRun = stubRun(async () => ({ stdout: 'active\n', stderr: '' }));
  const restoreSudo = stubNeedsSudo(() => false);
  try {
    assert.equal(await activeState('snapserver.service'), 'active');
  } finally {
    restoreRun();
    restoreSudo();
  }
});

test('activeState() returns "inactive" when systemctl exits non-zero with that stdout', async () => {
  const restoreRun = stubRun(async () => {
    throw new ExecError('systemctl', ['is-active', 'snapserver.service'], 3, 'inactive\n', '');
  });
  const restoreSudo = stubNeedsSudo(() => false);
  try {
    assert.equal(await activeState('snapserver.service'), 'inactive');
  } finally {
    restoreRun();
    restoreSudo();
  }
});

test('activeState() returns "failed" when systemctl exits non-zero with that stdout', async () => {
  const restoreRun = stubRun(async () => {
    throw new ExecError('systemctl', ['is-active', 'snapserver.service'], 3, 'failed\n', '');
  });
  const restoreSudo = stubNeedsSudo(() => false);
  try {
    assert.equal(await activeState('snapserver.service'), 'failed');
  } finally {
    restoreRun();
    restoreSudo();
  }
});

test('activeState() falls back to "inactive" when the ExecError has empty stdout', async () => {
  const restoreRun = stubRun(async () => {
    throw new ExecError('systemctl', ['is-active', 'snapserver.service'], 4, '', '');
  });
  const restoreSudo = stubNeedsSudo(() => false);
  try {
    assert.equal(await activeState('snapserver.service'), 'inactive');
  } finally {
    restoreRun();
    restoreSudo();
  }
});

test('activeState() rethrows non-ExecError failures (real execution errors)', async () => {
  const restoreRun = stubRun(async () => {
    throw new Error('ENOENT: systemctl not found');
  });
  const restoreSudo = stubNeedsSudo(() => false);
  try {
    await assert.rejects(() => activeState('snapserver.service'), /ENOENT/);
  } finally {
    restoreRun();
    restoreSudo();
  }
});

test('activeState() validates the unit name before calling run()', async () => {
  await assert.rejects(() => activeState('bad; rm -rf /'));
});

test('isActive() returns true only when activeState() is "active"', async () => {
  const restoreRun = stubRun(async () => ({ stdout: 'active\n', stderr: '' }));
  const restoreSudo = stubNeedsSudo(() => false);
  try {
    assert.equal(await isActive('snapserver.service'), true);
  } finally {
    restoreRun();
    restoreSudo();
  }
});

test('isActive() returns false for inactive', async () => {
  const restoreRun = stubRun(async () => {
    throw new ExecError('systemctl', ['is-active', 'snapserver.service'], 3, 'inactive\n', '');
  });
  const restoreSudo = stubNeedsSudo(() => false);
  try {
    assert.equal(await isActive('snapserver.service'), false);
  } finally {
    restoreRun();
    restoreSudo();
  }
});

test('logs() validates the unit name and calls journalctl with -u/-n/--no-pager', async () => {
  const calls: Call[] = [];
  const restoreRun = stubRun(async (bin: string, args: string[]) => {
    calls.push({ bin, args });
    return { stdout: 'log line 1\nlog line 2\n', stderr: '' };
  });
  const restoreSudo = stubNeedsSudo(() => false);
  try {
    const out = await logs('snapserver.service', 50);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].bin, 'journalctl');
    assert.deepEqual(calls[0].args, ['-u', 'snapserver.service', '-n', '50', '--no-pager']);
    assert.equal(out, 'log line 1\nlog line 2\n');
  } finally {
    restoreRun();
    restoreSudo();
  }
});

test('logs() defaults to 100 lines', async () => {
  const calls: Call[] = [];
  const restoreRun = stubRunRecording(calls);
  const restoreSudo = stubNeedsSudo(() => false);
  try {
    await logs('snapserver.service');
    assert.deepEqual(calls[0].args, ['-u', 'snapserver.service', '-n', '100', '--no-pager']);
  } finally {
    restoreRun();
    restoreSudo();
  }
});

test('logs() rejects an invalid unit name without calling run()', async () => {
  let called = false;
  const restoreRun = stubRun(async (_bin: string, _args: string[]) => {
    called = true;
    return { stdout: '', stderr: '' };
  });
  try {
    await assert.rejects(() => logs('bad; rm -rf /'));
    assert.equal(called, false);
  } finally {
    restoreRun();
  }
});

test('logs() applies sudo the same way control()/daemonReload() do', async () => {
  const calls: Call[] = [];
  const restoreRun = stubRunRecording(calls);
  const restoreSudo = stubNeedsSudo(() => true);
  try {
    await logs('snapserver.service', 10);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].bin, 'sudo');
    assert.deepEqual(calls[0].args, ['journalctl', '-u', 'snapserver.service', '-n', '10', '--no-pager']);
  } finally {
    restoreRun();
    restoreSudo();
  }
});
