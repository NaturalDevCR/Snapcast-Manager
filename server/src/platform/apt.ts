// Shell-free wrapper around `apt-get` / `dpkg`, built on top of
// `platform/exec.ts`'s `run()` (argv arrays only, no shell -- see that
// file's header).
//
// IMPORTANT -- scope of this module: `assertValidPackageName` validates
// package name SYNTAX only (is this a string apt/dpkg would accept as a
// Debian package name). It does NOT know, and must never be extended to
// know, which specific packages this application is allowed to install,
// upgrade, or remove. That is an application-level authorization decision
// that belongs in the calling service, which must apply its own closed
// allowlist *in addition to* calling `assertValidPackageName` here. Do not
// treat "assertValidPackageName didn't throw" as "this caller is allowed to
// install this package".

import { run, needsSudo, ExecError } from './exec';
import type { RunOptions } from './exec';

// Verified against the Debian Policy Manual, section 5.6.7 "Package"
// (https://www.debian.org/doc/debian-policy/ch-controlfields.html#package,
// checked 2026-08-19):
//   "Package names (both source and binary, see Package) must consist only
//    of lower case letters (a-z), digits (0-9), plus (+) and minus (-)
//    signs, and periods (.). They must be at least two characters long and
//    must start with an alphanumeric character."
// Uppercase letters and underscores are NOT in that allowed set (confirmed
// against the policy text, not assumed) -- both are rejected below. The
// first character class matches "must start with an alphanumeric
// character"; the second (one-or-more) matches "at least two characters
// long" together with the first.
const PACKAGE_NAME_RE = /^[a-z0-9][a-z0-9+.-]+$/;

/** Throws if `name` is not a syntactically valid Debian package name. */
export function assertValidPackageName(name: string): void {
  if (typeof name !== 'string' || !PACKAGE_NAME_RE.test(name)) {
    throw new Error(`Invalid Debian package name: ${JSON.stringify(name)}`);
  }
}

/**
 * Validates every name in `names` with `assertValidPackageName`, rejecting
 * the WHOLE call (throwing before any name is used) if any single name is
 * invalid -- never silently drops a bad name and proceeds with the rest.
 * Also rejects an empty array, since an `apt-get install -y` with no
 * packages is not a meaningful call for any current caller.
 */
function assertValidPackageNames(names: string[]): void {
  if (!Array.isArray(names) || names.length === 0) {
    throw new Error('Package name list must be a non-empty array');
  }
  for (const name of names) {
    assertValidPackageName(name);
  }
}

// `apt-get install`/`--only-upgrade` can legitimately take minutes on a
// Raspberry Pi (e.g. installing build-essential and its ~15 transitive
// build dependencies, or compiling something as part of a postinst
// script) -- these calls today have no timeout at all. 10 minutes is long
// enough to cover that real-world case while still bounding a genuinely
// hung/interactive apt-get (e.g. one waiting on a debconf prompt this
// non-interactive caller can never answer).
const INSTALL_TIMEOUT_MS = 600_000;

function aptGet(args: string[], sudo: boolean, opts?: RunOptions) {
  return sudo ? run('sudo', ['apt-get', ...args], opts) : run('apt-get', args, opts);
}

export async function update(): Promise<void> {
  await aptGet(['update'], needsSudo());
}

export async function install(packages: string[]): Promise<void> {
  assertValidPackageNames(packages);
  await aptGet(['install', '-y', ...packages], needsSudo(), { timeoutMs: INSTALL_TIMEOUT_MS });
}

export async function upgrade(packages: string[]): Promise<void> {
  assertValidPackageNames(packages);
  await aptGet(['install', '-y', '--only-upgrade', ...packages], needsSudo(), {
    timeoutMs: INSTALL_TIMEOUT_MS,
  });
}

export async function remove(packages: string[]): Promise<void> {
  assertValidPackageNames(packages);
  await aptGet(['remove', '--purge', '-y', ...packages], needsSudo());
}

/**
 * `dpkg -s <pkg>`, true on a zero exit (installed), false when `dpkg`
 * actually ran and exited non-zero (not installed / unknown package). This
 * is a read, so unlike the four mutating functions above it is NEVER
 * sudo-prefixed, regardless of `needsSudo()` -- mirrors the
 * `activeState()`/`control()` split in `platform/systemd.ts`.
 *
 * Distinguishing "not installed" from "couldn't even run dpkg": `run()`
 * (see `platform/exec.ts`) wraps EVERY `execFile` callback error into an
 * `ExecError`, including a spawn failure (e.g. `dpkg` missing from PATH,
 * `ENOENT`) -- so `err instanceof ExecError` alone does NOT distinguish "not
 * installed" from "dpkg itself couldn't be launched". `ExecError.exitCode`
 * does: `exec.ts` only sets a numeric `exitCode` when Node's callback
 * `error.code` is itself a number, which happens when the child process
 * actually ran and exited with that code. A spawn failure surfaces a
 * string `error.code` (`'ENOENT'`, `'EACCES'`, ...), which `exec.ts` maps to
 * `exitCode: null`. So:
 *   - `ExecError` with `exitCode !== null` -- dpkg ran and said no. Expected
 *     "not installed" outcome -- return `false`.
 *   - `ExecError` with `exitCode === null` -- dpkg never actually ran
 *     (spawn failure, timeout, or maxBuffer kill). Genuine execution
 *     failure -- rethrow, don't silently report "not installed".
 *   - Anything not an `ExecError` at all -- can only happen from a
 *     synchronous throw inside `run()`'s own `Promise` executor (e.g. a
 *     caller passing malformed argument types to `execFile`), never from a
 *     real dpkg invocation. Also rethrown, for the same reason.
 */
export async function isInstalled(pkg: string): Promise<boolean> {
  assertValidPackageName(pkg);
  try {
    await run('dpkg', ['-s', pkg]);
    return true;
  } catch (err) {
    if (err instanceof ExecError && err.exitCode !== null) {
      return false;
    }
    throw err;
  }
}
