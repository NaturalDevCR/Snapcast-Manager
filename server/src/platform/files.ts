// Shell-free primitives for writing files on disk, built on top of
// `platform/exec.ts`'s `run()` for the one case (`installPrivilegedFile`)
// that has to shell out to `cp`/`chmod` because the current process lacks
// direct write permission on the destination.
//
// This directly closes design-spec finding #5: the pre-existing codebase
// writes to predictable, fixed temp paths (e.g.
// `/tmp/snapmanager-crontab-${Date.now()}.tmp`, or literally
// `/tmp/mpd_conf_snapmgr.tmp` -- the SAME path every time) and then runs
// `sudo cp '${tmpFile}' '${dest}'`. A predictable, fixed path in a
// world-writable directory like /tmp lets a local attacker pre-create a
// symlink there and win a race before the privileged `cp` follows it,
// potentially overwriting an arbitrary root-owned file. `installPrivilegedFile`
// below instead uses `fs.mkdtemp` to create a fresh, unpredictable,
// process-owned (mode 0700 by default) directory for every single call --
// there is no fixed name for an attacker to pre-seed.

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as crypto from 'crypto';
import { run, needsSudo } from './exec';

export interface WriteOptions {
  /** Octal file permission bits, e.g. 0o644. */
  mode?: number;
}

/**
 * Atomically write `content` to `destPath`, assuming the current process
 * already has write permission on destPath's directory (no sudo).
 *
 * Writes to a temp file in the SAME directory as destPath (so the final
 * `rename()` is atomic -- rename is only atomic within a single filesystem,
 * and /tmp may be a different filesystem than destPath's directory), then
 * fsyncs the file descriptor before closing, then renames over destPath.
 * The temp file name includes randomness (`crypto.randomBytes`) even though
 * it's in a directory the process already owns -- belt and suspenders
 * against a symlink race from another process with write access to that
 * same directory. `fs.open` uses the `'wx'` flag, which fails if the
 * (randomized) temp path somehow already exists, instead of silently
 * following/truncating it.
 */
export async function writeFileAtomic(
  destPath: string,
  content: string,
  opts: WriteOptions = {},
): Promise<void> {
  const dir = path.dirname(destPath);
  const base = path.basename(destPath);
  const tmpPath = path.join(dir, `.${base}.${crypto.randomBytes(16).toString('hex')}.tmp`);

  const handle = await fs.promises.open(tmpPath, 'wx');
  try {
    await handle.writeFile(content, 'utf-8');
    if (opts.mode !== undefined) {
      // Set before fsync/rename so the mode we asserted is what actually
      // lands on destPath -- rename() preserves the mode of the source
      // inode, it doesn't reset it.
      await handle.chmod(opts.mode);
    }
    await handle.sync();
  } catch (err) {
    await handle.close().catch(() => undefined);
    await fs.promises.unlink(tmpPath).catch(() => undefined);
    throw err;
  }
  await handle.close();
  await fs.promises.rename(tmpPath, destPath);
}

/**
 * Write `content` to a path the current process cannot write directly
 * (e.g. /etc/*, a systemd unit file).
 *
 * Creates a private (mode 0700, `fs.mkdtemp`'s default) temp directory with
 * an unpredictable name -- NEVER a fixed/predictable path -- writes the
 * file there with a plain `fs.writeFile` (never exposed to shell
 * interpretation), then installs it to destPath via `platform/exec.ts`'s
 * `run()` (`cp` as an argv array, sudo-prefixed when `needsSudo()`, same
 * pattern as `apt.ts`), then a second `run()` call to `chmod` if
 * `opts.mode` is given. The temp directory is always removed
 * (`fs.rm(tmpDir, { recursive: true, force: true })`) in a `finally`,
 * whether the install succeeded or failed, so a failed privileged copy
 * never leaves file contents lingering in a temp directory.
 */
export async function installPrivilegedFile(
  destPath: string,
  content: string,
  opts: WriteOptions = {},
): Promise<void> {
  const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'snapmanager-'));
  try {
    const tmpFile = path.join(tmpDir, path.basename(destPath));
    await fs.promises.writeFile(tmpFile, content, 'utf-8');

    const sudo = needsSudo();
    if (sudo) {
      await run('sudo', ['cp', tmpFile, destPath]);
    } else {
      await run('cp', [tmpFile, destPath]);
    }

    if (opts.mode !== undefined) {
      const modeArg = opts.mode.toString(8);
      if (sudo) {
        await run('sudo', ['chmod', modeArg, destPath]);
      } else {
        await run('chmod', [modeArg, destPath]);
      }
    }
  } finally {
    await fs.promises.rm(tmpDir, { recursive: true, force: true });
  }
}

/** Thin wrapper over `fs.promises.readFile(path, 'utf-8')`. */
export async function readTextFile(filePath: string): Promise<string> {
  return fs.promises.readFile(filePath, 'utf-8');
}
