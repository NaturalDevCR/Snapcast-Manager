// Shell-free process execution primitives.
//
// Every privileged command this application runs against the host (systemctl,
// journalctl, apt, file operations, ...) must go through `run()` below, which
// invokes the target binary directly via `child_process.execFile`. It NEVER
// sets `shell: true` and NEVER builds a command string that gets handed to
// `/bin/sh -c`. `args` is always passed as a plain string array, so its
// content can never be reinterpreted as shell syntax (no `;`, `` ` ``,
// `$()`, `|`, `&&`, globbing, word-splitting, etc.).
//
// DO NOT add `shell: true` to the execFile call below. If a future caller
// needs shell features (pipes, redirection, globbing), that is a sign the
// caller should be decomposed into multiple `run()` calls or fixed
// arguments, not a reason to reintroduce a shell here.

import { execFile } from 'child_process';

export interface RunResult {
  stdout: string;
  stderr: string;
}

export interface RunOptions {
  /** Milliseconds before the child process is killed. Default 30_000. */
  timeoutMs?: number;
  /** Max combined stdout/stderr bytes before the child is killed. Default 10 MiB. */
  maxBuffer?: number;
  /** Optional data written to the child's stdin, then stdin is closed (EOF). */
  input?: string;
  /**
   * Extra environment variables for the child process, MERGED on top of the
   * current process's own `process.env` (never a wholesale replacement --
   * that would also strip PATH and everything else the child needs to run
   * at all). Added in Task 12 for `services/system.ts`'s `executeDebUpdate()`,
   * which needs `DEBIAN_FRONTEND=noninteractive` set for the `apt-get
   * install -f` fallback path when the current process is already root (no
   * `sudo` in the way). When `sudo` IS the direct child, prefer passing
   * `VAR=value` as a literal argv element before the target command instead
   * (sudo parses that itself and applies it to the command it execs,
   * independent of sudo's own env_reset policy) -- this `env` option only
   * reliably affects the directly-spawned child, not a grandchild sudo
   * execs, since sudo does not inherit/forward its own environment to the
   * command it invokes unless configured to (`-E` / `env_keep`).
   */
  env?: Record<string, string>;
}

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_BUFFER = 10 * 1024 * 1024; // 10 MiB

/**
 * Thrown by `run()` when the child process exits with a non-zero code (or is
 * killed by timeout/maxBuffer). `.message` is intentionally generic — it
 * never contains the process's stdout/stderr — so that naive upstream code
 * doing `res.json({ error: err.message })` can't leak internal command
 * output (which may include paths, service names, or other operational
 * details) into an HTTP response. Callers that want the raw output for
 * logging or a controlled response must read `.stdout` / `.stderr`
 * explicitly.
 */
export class ExecError extends Error {
  constructor(
    public readonly bin: string,
    public readonly args: string[],
    public readonly exitCode: number | null,
    public readonly stdout: string,
    public readonly stderr: string,
  ) {
    super(`${bin} exited with code ${exitCode}`);
    this.name = 'ExecError';
  }
}

/**
 * Run `bin` with `args`, never through a shell. Resolves with stdout/stderr
 * on a zero exit code; rejects with `ExecError` otherwise (including on
 * timeout or maxBuffer overflow).
 */
export function run(bin: string, args: string[], opts: RunOptions = {}): Promise<RunResult> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxBuffer = opts.maxBuffer ?? DEFAULT_MAX_BUFFER;
  const input = opts.input;
  // `undefined` (not merging at all) when the caller didn't ask for extra
  // env vars, so execFile falls back to its own default of inheriting
  // `process.env` unchanged -- only build a merged object when there's
  // actually something to merge.
  const env = opts.env ? { ...process.env, ...opts.env } : undefined;

  return new Promise<RunResult>((resolve, reject) => {
    // NOTE: no `shell` option here, ever — see file header. execFile spawns
    // `bin` directly with `args` as argv; there is no shell in the middle to
    // reinterpret any of this.
    const child = execFile(
      bin,
      args,
      { timeout: timeoutMs, maxBuffer, encoding: 'utf8', env },
      (error, stdout, stderr) => {
        const out = typeof stdout === 'string' ? stdout : '';
        const err = typeof stderr === 'string' ? stderr : '';
        if (error) {
          const exitCode = typeof (error as NodeJS.ErrnoException).code === 'number'
            ? ((error as unknown) as { code: number }).code
            : null;
          reject(new ExecError(bin, args, exitCode, out, err));
          return;
        }
        resolve({ stdout: out, stderr: err });
      },
    );

    // Always terminate stdin so a child that reads from it (e.g. `cat`)
    // doesn't hang forever when no input was provided.
    if (child.stdin) {
      if (input !== undefined) {
        child.stdin.write(input);
      }
      child.stdin.end();
    }
  });
}

/**
 * Whether the current process needs `sudo` to run privileged commands.
 * Same semantics as the `(process as any).getuid?.() === 0 ? '' : 'sudo '`
 * checks scattered across the existing services, but returns a boolean
 * instead of a string prefix — callers decide how to apply it, e.g.:
 *   needsSudo() ? run('sudo', [bin, ...args]) : run(bin, args)
 */
export function needsSudo(): boolean {
  return (process as { getuid?: () => number }).getuid?.() !== 0;
}
