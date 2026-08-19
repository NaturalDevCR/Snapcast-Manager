// Shell-free helpers for routes/tools.ts, plus the path-validation logic
// that closes design-spec finding #3 -- the single most severe
// vulnerability in this codebase (Task 9).
//
// PRE-TASK-9 BUG: `POST /api/tools/scripts` accepted ANY absolute
// filesystem path as a "managed script" (the only check was
// `path.startsWith('/')` plus a quote/newline blacklist), and
// `POST /api/tools/script` then wrote attacker-controlled content to that
// path as root (`sudo cp` + `sudo chmod +x`). Combined, any authenticated
// user could register `/etc/sudoers.d/pwn`, `/etc/cron.d/pwn`,
// `/etc/systemd/system/anything.service`, or `/root/.ssh/authorized_keys`
// and then write arbitrary root-owned file content to it -- a two-request
// root-RCE/persistence primitive needing no other bug. `validateManaged
// ScriptPath()` below is the single choke point that now stands between
// user-supplied paths and both the registration INSERT and the write.

import * as fs from 'fs';
import * as path from 'path';
import { run, ExecError } from '../platform/exec';

/**
 * The only directory this application will register scripts inside of, or
 * write script content to. Created/owned by this app (not a
 * user-arbitrary path) -- see docs/superpowers/sdd/task-9-brief.md.
 */
export const MANAGED_SCRIPTS_DIR = '/var/lib/snapcast-manager/scripts';

export interface PathValidationResult {
  ok: boolean;
  /** `path.resolve()`'d candidate, always populated (even when !ok) for logging/error messages. */
  resolvedPath: string;
  /** Populated when !ok: a human-readable reason suitable for an HTTP error body. */
  reason?: string;
}

/**
 * Validates that `candidatePath` names a location strictly INSIDE
 * `managedDir` (defaults to the real `MANAGED_SCRIPTS_DIR` -- tests pass a
 * substitute temp directory here so the exact same logic can be exercised
 * without needing root / write access to `/var/lib` on a dev machine or CI
 * runner; production code never overrides this parameter).
 *
 * Two-layer check:
 *
 *  1. String/boundary check: `path.resolve(candidatePath)` must equal
 *     `managedDir` itself's resolved form (rejected -- a directory is not a
 *     script) or start with `resolve(managedDir) + path.sep`. This alone
 *     defeats plain traversal (`../../../etc/passwd`) and paths outside the
 *     tree entirely (`/etc/sudoers.d/pwn`).
 *
 *  2. Symlink-aware check: because the target file may not exist yet (this
 *     function is also used to validate a BRAND NEW script name that
 *     hasn't been written to disk -- see routes/tools.ts's POST /scripts,
 *     which must keep working for a not-yet-existing file, mirroring the
 *     pre-existing UX where GET /script returns `{ content: '' }` for a
 *     registered-but-absent path), we cannot simply `fs.realpath()` the
 *     whole candidate -- that throws ENOENT for anything not yet created.
 *     Instead we walk from the resolved candidate UP to `managedDir`,
 *     `fs.lstatSync`-ing each path segment. A segment that does not exist
 *     yet is fine (ENOENT -> skip, keep climbing: this is what allows
 *     registering a new filename, or a new subdirectory, under the managed
 *     dir). A segment that DOES exist and is a symlink is resolved via
 *     `fs.realpathSync` and rejected unless ITS target also resolves inside
 *     `managedDir` -- this catches both "a subdirectory of the managed dir
 *     is itself a symlink planted to escape it" and "the exact target
 *     filename is itself a symlink pointing elsewhere" (the walk starts at
 *     the candidate itself, not just its parent).
 *
 * RESIDUAL RISK (documented honestly, not overclaiming): this is a
 * TOCTOU-adjacent check, not a kernel-enforced guarantee. Between this
 * validation returning `ok: true` and the caller's subsequent write (via
 * `installPrivilegedFile`), a local attacker with write access to a
 * directory *inside* `managedDir` (e.g. because a previous, now-fixed bug,
 * or a misconfigured deployment, granted them one) could race in a new
 * symlink at the exact validated path between the check and the write. This
 * app has no other principal capable of writing inside `managedDir` in the
 * first place under normal operation (only this process creates
 * directories/files there), so the practical exploit window requires an
 * attacker who ALREADY has local write access to `managedDir` -- at which
 * point they can write executable content there directly and do not need
 * this endpoint at all. A fully TOCTOU-proof implementation would open the
 * destination with `O_NOFOLLOW` and walk/verify each component while
 * holding open directory file descriptors (`openat`-style) all the way
 * down, which Node's `fs` module does not expose a convenient primitive
 * for; that level of defense was judged not worth the complexity for a
 * directory this application exclusively owns. What this DOES fully close
 * is the actual reported vulnerability: an arbitrary, attacker-chosen path
 * ANYWHERE on the filesystem is no longer reachable at all, symlink or not.
 */
export function validateManagedScriptPath(
  candidatePath: string,
  managedDir: string = MANAGED_SCRIPTS_DIR,
): PathValidationResult {
  if (typeof candidatePath !== 'string' || candidatePath.length === 0) {
    return { ok: false, resolvedPath: '', reason: 'path must be a non-empty string' };
  }
  if (!path.isAbsolute(candidatePath)) {
    return { ok: false, resolvedPath: path.resolve(candidatePath), reason: 'path must be absolute' };
  }

  const managedDirResolved = path.resolve(managedDir);
  const resolved = path.resolve(candidatePath);

  if (resolved !== managedDirResolved && !resolved.startsWith(managedDirResolved + path.sep)) {
    return {
      ok: false,
      resolvedPath: resolved,
      reason: `path must resolve inside ${managedDirResolved}`,
    };
  }
  if (resolved === managedDirResolved) {
    return {
      ok: false,
      resolvedPath: resolved,
      reason: 'path must name a file inside the managed directory, not the directory itself',
    };
  }

  // Walk from the resolved candidate up to (and including) managedDirResolved,
  // rejecting any EXISTING segment that is a symlink escaping managedDir.
  let current = resolved;
  for (;;) {
    let lst: fs.Stats | null;
    try {
      lst = fs.lstatSync(current);
    } catch (err) {
      // ENOENT (component doesn't exist yet) is the ONLY error tolerated
      // here -- that's what allows registering a brand-new filename, or a
      // brand-new subdirectory, under the managed dir. Fail CLOSED on
      // anything else (EACCES, ENOTDIR, ELOOP, an invalid-argument error
      // from a malformed path such as an embedded NUL byte, ...) rather
      // than silently treating an unexpected stat failure as "safe to
      // proceed" -- an early version of this function caught everything
      // unconditionally here, which would have let a component we simply
      // couldn't inspect slide through unchecked.
      if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') {
        lst = null;
      } else {
        return {
          ok: false,
          resolvedPath: resolved,
          reason: `could not check path component ${current}: ${(err as Error)?.message ?? String(err)}`,
        };
      }
    }

    if (lst && lst.isSymbolicLink()) {
      let real: string;
      try {
        real = fs.realpathSync(current);
      } catch {
        return {
          ok: false,
          resolvedPath: resolved,
          reason: `path component ${current} is a broken symlink`,
        };
      }
      if (real !== managedDirResolved && !real.startsWith(managedDirResolved + path.sep)) {
        return {
          ok: false,
          resolvedPath: resolved,
          reason: `path component ${current} is a symlink pointing outside ${managedDirResolved}`,
        };
      }
    }

    if (current === managedDirResolved) break;
    const parent = path.dirname(current);
    if (parent === current) break; // reached filesystem root -- shouldn't happen given the prefix check above; guards against an infinite loop
    current = parent;
  }

  return { ok: true, resolvedPath: resolved };
}

/** Boolean convenience wrapper over `validateManagedScriptPath()`. */
export function isPathInsideManagedDir(
  candidatePath: string,
  managedDir: string = MANAGED_SCRIPTS_DIR,
): boolean {
  return validateManagedScriptPath(candidatePath, managedDir).ok;
}

/**
 * `crontab -l` for the invoking user, via the shell-free `platform/exec.ts`
 * `run()`. `crontab -l` exits non-zero (exit code 1, with a message like
 * "no crontab for <user>" on stderr) when the user has no crontab
 * installed at all -- that is a normal, empty result, not a real execution
 * failure, so it's caught and translated to an empty string. Mirrors the
 * exact same pattern `platform/systemd.ts`'s `activeState()` and
 * `services/pipeSources.ts`'s `findServiceForFifo()` use for their own
 * "expected non-zero exit" cases. Only `exitCode === 1` is treated as
 * "no crontab" -- any other failure (crontab not installed at all, a
 * permission error, a timeout) still propagates, since those are NOT the
 * expected empty-crontab outcome.
 */
export async function readCrontab(): Promise<string> {
  try {
    const { stdout } = await run('crontab', ['-l']);
    return stdout;
  } catch (err) {
    if (err instanceof ExecError && err.exitCode === 1) {
      return '';
    }
    throw err;
  }
}
