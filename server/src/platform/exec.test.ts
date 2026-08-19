import { test } from 'node:test';
import assert from 'node:assert/strict';
import { run, needsSudo, ExecError } from './exec';

// Use `/usr/bin/env <name>` to locate real, harmless binaries via PATH
// instead of hardcoding distro-specific paths like /bin/echo, which differ
// between macOS and Linux CI runners. /usr/bin/env itself is present on
// every Unix-like system (it's the universal shebang interpreter).
const ENV = '/usr/bin/env';

test('run() never lets args be reinterpreted by a shell', async () => {
  const injection = '; rm -rf /tmp/nonexistent-marker-file';
  const { stdout } = await run(ENV, ['echo', injection]);
  // If this were shell-interpreted, the `;` would separate commands and
  // the literal string would never appear in stdout. Because execFile
  // passes argv directly (no /bin/sh -c), echo receives it as one literal
  // argument and prints it back unchanged.
  assert.equal(stdout.trim(), injection);
});

test('run() never lets args be reinterpreted by a shell (backticks/$())', async () => {
  const injection = '`whoami` $(whoami)';
  const { stdout } = await run(ENV, ['echo', injection]);
  assert.equal(stdout.trim(), injection);
});

test('run() enforces timeoutMs and rejects quickly', async () => {
  const start = Date.now();
  await assert.rejects(() => run(ENV, ['sleep', '5'], { timeoutMs: 100 }));
  const elapsed = Date.now() - start;
  // Generous upper bound to avoid CI flakiness, but must be nowhere near
  // the 5s the process would otherwise run for.
  assert.ok(elapsed < 3000, `expected fast rejection, took ${elapsed}ms`);
});

test('run() rejects with ExecError carrying the exit code on non-zero exit', async () => {
  await assert.rejects(
    () => run(ENV, ['false']),
    (err: unknown) => {
      if (!(err instanceof ExecError)) return false;
      assert.equal(err.bin, ENV);
      assert.deepEqual(err.args, ['false']);
      assert.equal(err.exitCode, 1);
      return true;
    },
  );
});

test('run() resolves with stdout/stderr on success', async () => {
  const { stdout, stderr } = await run(ENV, ['echo', 'hello']);
  assert.equal(stdout.trim(), 'hello');
  assert.equal(stderr, '');
});

test('ExecError.message does not leak stdout/stderr content', async () => {
  await assert.rejects(
    () => run(ENV, ['cat', '/nonexistent-path-for-exec-test-xyz']),
    (err: unknown) => {
      if (!(err instanceof ExecError)) return false;
      // cat writes something like "No such file or directory" to stderr —
      // that must land on the typed .stderr property, never in .message.
      assert.ok(err.stderr.length > 0, 'expected cat to write to stderr');
      assert.ok(
        !err.message.includes(err.stderr.trim()),
        `.message leaked stderr content: ${err.message}`,
      );
      assert.match(err.message, /exited with code/);
      return true;
    },
  );
});

test('run() wires up stdin when input is provided', async () => {
  const { stdout } = await run(ENV, ['cat'], { input: 'hello stdin\n' });
  assert.equal(stdout, 'hello stdin\n');
});

test('run() does not hang when no input is provided and the process reads stdin', async () => {
  // cat with no args reads stdin until EOF; if run() never closes stdin
  // this would hang until timeoutMs. Use a short timeout as a safety net
  // and assert we get a prompt (empty) result, not a timeout.
  const { stdout } = await run(ENV, ['cat'], { timeoutMs: 3000 });
  assert.equal(stdout, '');
});

test('run() enforces maxBuffer', async () => {
  await assert.rejects(() =>
    run(process.execPath, ['-e', "process.stdout.write('a'.repeat(2_000_000))"], {
      maxBuffer: 1000,
    }),
  );
});

test('needsSudo() returns true when getuid is unavailable', () => {
  const original = (process as any).getuid;
  delete (process as any).getuid;
  try {
    assert.equal(needsSudo(), true);
  } finally {
    if (original !== undefined) (process as any).getuid = original;
  }
});

test('needsSudo() returns false when running as uid 0', () => {
  const original = (process as any).getuid;
  (process as any).getuid = () => 0;
  try {
    assert.equal(needsSudo(), false);
  } finally {
    if (original !== undefined) (process as any).getuid = original;
    else delete (process as any).getuid;
  }
});

test('needsSudo() returns true when running as a non-root uid', () => {
  const original = (process as any).getuid;
  (process as any).getuid = () => 1000;
  try {
    assert.equal(needsSudo(), true);
  } finally {
    if (original !== undefined) (process as any).getuid = original;
    else delete (process as any).getuid;
  }
});
