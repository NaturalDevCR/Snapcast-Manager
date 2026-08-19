// Shell-free wrapper around `systemctl` / `journalctl`, built on top of
// `platform/exec.ts`'s `run()` (argv arrays only, no shell — see that
// file's header).
//
// IMPORTANT — scope of this module: `assertValidUnitName` validates unit
// name SYNTAX only (is this a string systemd would accept as a unit name).
// It does NOT know, and must never be extended to know, which specific
// units this application is allowed to manage (e.g. the
// `snapclient-manager-*` / `snapcast-radio-*` prefixes, or the fixed list
// `snapserver`, `mpd`, ...). That is an application-level authorization
// decision that belongs in the calling service, which must apply its own
// allowlist/prefix check *in addition to* calling `assertValidUnitName`
// here. Do not treat "assertValidUnitName didn't throw" as "this caller is
// allowed to touch this unit".

import { run, needsSudo, ExecError } from './exec';

export type SystemdAction = 'start' | 'stop' | 'restart' | 'enable' | 'disable';

// Verified against systemd.unit(5) (checked via the man7.org mirror,
// 2026-08-19, https://www.man7.org/linux/man-pages/man5/systemd.unit.5.html
// -- freedesktop.org's own copy returned HTTP 403 to automated fetches):
//   "The 'unit name prefix' must consist of one or more valid characters
//    (ASCII letters, digits, ':', '-', '_', '.', and '\\')"
//   "The total length of the unit name including the suffix must not
//    exceed 255 characters."
//   Valid suffixes: .service .socket .device .mount .automount .swap
//   .target .path .timer .slice .scope
// Template units (e.g. getty@tty1.service) insert exactly one '@' plus an
// instance name -- built from the same character set -- between the
// template prefix and the suffix.
const UNIT_CHARS = "a-zA-Z0-9:_.\\\\-"; // ASCII letters, digits, ':', '-', '_', '.', '\'
const UNIT_SUFFIXES =
  'service|socket|device|mount|automount|swap|target|path|timer|slice|scope';
const UNIT_NAME_RE = new RegExp(
  `^[${UNIT_CHARS}]+(@[${UNIT_CHARS}]+)?\\.(${UNIT_SUFFIXES})$`,
);
const MAX_UNIT_NAME_LENGTH = 255;

/** Throws if `unit` is not a syntactically valid systemd unit name. */
export function assertValidUnitName(unit: string): void {
  if (
    typeof unit !== 'string' ||
    unit.length === 0 ||
    unit.length > MAX_UNIT_NAME_LENGTH ||
    !UNIT_NAME_RE.test(unit)
  ) {
    throw new Error(`Invalid systemd unit name: ${JSON.stringify(unit)}`);
  }
}

// ---- sudo split ----
// Mirrors the pre-existing pattern elsewhere in this codebase (e.g.
// server/src/services/pipeSources.ts): mutating `systemctl` subcommands
// (start/stop/restart/enable/disable, daemon-reload) get a `sudo` prefix
// when `needsSudo()` is true, but `systemctl is-active` never does. This
// lets a deployment grant passwordless sudo scoped only to the mutating
// subcommands while leaving status checks unprefixed -- a real, sensible
// hardening pattern. `journalctl` (used by `logs()`) is a read-only command
// too, but reading privileged units' logs typically does require sudo, so
// it follows `needsSudo()` like the mutating systemctl calls do.
//
// `systemctl()` below takes an explicit `sudo` boolean rather than calling
// `needsSudo()` itself, precisely so each caller states its own sudo
// requirement instead of silently inheriting one shared default.
function systemctl(args: string[], sudo: boolean) {
  return sudo ? run('sudo', ['systemctl', ...args]) : run('systemctl', args);
}

function journalctl(args: string[]) {
  return needsSudo() ? run('sudo', ['journalctl', ...args]) : run('journalctl', args);
}

export async function control(unit: string, action: SystemdAction): Promise<void> {
  assertValidUnitName(unit);
  await systemctl([action, unit], needsSudo());
}

/**
 * Raw `systemctl is-active` result string ('active' | 'inactive' | 'failed'
 * | ...). `systemctl is-active` exits non-zero for inactive/failed units --
 * that is the normal "not running" result, not a real execution failure.
 * `run()`'s contract is still "reject on non-zero exit" (it has no way to
 * know this is an expected outcome for this particular command), so this
 * function catches the resulting `ExecError` and, when it carries a usable
 * state string on stdout, returns that string instead of propagating the
 * throw. Only a *real* failure (run() rejecting with something other than
 * an ExecError -- e.g. systemctl not being installed) still throws.
 *
 * Sudo: unlike `control()`/`daemonReload()`, this NEVER applies a `sudo`
 * prefix, regardless of `needsSudo()` -- `systemctl is-active` is a
 * read-only status query, and this mirrors the pre-existing codebase
 * pattern where `is-active` calls are never sudo-prefixed while mutating
 * calls are (see server/src/services/pipeSources.ts). A deployment can
 * grant passwordless sudo scoped only to the mutating subcommands; keeping
 * status checks unprefixed means they keep working under that setup.
 */
export async function activeState(unit: string): Promise<string> {
  assertValidUnitName(unit);
  try {
    const { stdout } = await systemctl(['is-active', unit], false);
    return stdout.trim();
  } catch (err) {
    if (err instanceof ExecError) {
      const state = err.stdout.trim();
      return state.length > 0 ? state : 'inactive';
    }
    throw err;
  }
}

/** See `activeState()` -- never sudo-prefixed, same as the call it wraps. */
export async function isActive(unit: string): Promise<boolean> {
  return (await activeState(unit)) === 'active';
}

export async function daemonReload(): Promise<void> {
  await systemctl(['daemon-reload'], needsSudo());
}

/** `journalctl -u <unit> -n <lines> --no-pager`. `lines` defaults to 100. */
export async function logs(unit: string, lines: number = 100): Promise<string> {
  assertValidUnitName(unit);
  const { stdout } = await journalctl(['-u', unit, '-n', String(lines), '--no-pager']);
  return stdout;
}
