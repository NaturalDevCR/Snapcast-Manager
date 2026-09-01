#!/usr/bin/env bash
#
# install-shairport-sync.sh -- builds and installs shairport-sync (AirPlay 2
# receiver) and its companion nqptp (PTP clock sync daemon) from source.
#
# Invoked by server/src/services/system.ts's installShairportSync() via
# `run('bash', [<path to this script>], ...)` (server/src/platform/exec.ts's
# argv-based run()) -- a plain argv invocation, never a shell string built
# from runtime-interpolated data. This script takes no arguments and reads no
# external input beyond the SNAPMGR_SUDO environment variable described
# below; it is a static, versioned, shellcheck-able artifact, not something
# assembled at runtime from untrusted data, so the real shell features used
# below (command substitution, conditionals, `2>/dev/null || true`
# tolerance) are fine here -- see docs/superpowers/sdd/task-12-brief.md for
# the full rationale on why this extraction does NOT reintroduce the
# shell-injection class Stage 1 of the hardening plan otherwise eliminates.
#
# Privilege handling (fixed post-Task-12, see task-12-report.md's "Fix
# report" section): this script is invoked WITHOUT its own sudo/root
# wrapper -- `services/system.ts`'s installShairportSync() runs it as
# `run('bash', [scriptPath], { env: { SNAPMGR_SUDO: ... }, ... })`, i.e. as
# whatever user the Node process itself runs as. Only the specific
# PRIVILEGED lines below (apt-get, the cleanup-of-old-installs systemctl/rm
# lines, `make install` for both nqptp and shairport-sync,
# useradd/groupadd, and the systemd daemon-reload/enable/restart calls) are
# prefixed with `$SUDO`, exactly mirroring how the ORIGINAL (pre-Task-12)
# TypeScript implementation individually prefixed only those same lines
# with `${this.SUDO}`. The BUILD/COMPILE phase -- `git clone`,
# `autoreconf -fvi`, `./configure`, `make -j"$(nproc)"`, for both nqptp and
# shairport-sync -- deliberately runs WITHOUT escalation, as the script's
# own invoking (non-root) user, same as the original. This matters because
# compiling freshly-cloned, unpinned third-party source is the highest-risk
# phase to run as root: `autoreconf`/`./configure`/`make` can and do
# execute arbitrary shell via Makefile rules, `config.guess`/`config.sub`
# scripts, and autotools macros -- containing that risk to the invoking,
# unprivileged user (escalating only for the narrow, well-understood
# install-time operations) is the whole point of this privilege
# separation, not a style preference.
#
# `SNAPMGR_SUDO` ("1" or "0", default "0" if unset): computed in Node by
# `services/system.ts` via `platform/exec.ts`'s `needsSudo()` (true when
# the Node process itself is NOT running as root) and passed in as an
# environment variable so this script can replicate that same decision for
# its own privileged lines, without re-implementing `needsSudo()`'s uid
# check in shell. When `SNAPMGR_SUDO=1`, `$SUDO` expands to `sudo`;
# otherwise it expands to nothing (the invoking user is assumed to already
# have the needed privileges, e.g. Node itself already running as root).
#
# `set -euo pipefail`: the original code ran this whole chain as a single
# `&&`-joined shell command string via one exec() call, so ANY step failing
# aborted the entire chain -- `set -e` (abort on any command's non-zero
# exit), `-u` (abort on use of an unset variable), and `-o pipefail` (a
# failing command inside a pipeline fails the whole pipeline, not just its
# last stage) reproduce that same "any step failing aborts everything"
# semantic here, while lines that were originally tolerant of failure
# (`... 2>/dev/null || true`) keep that same explicit tolerance.

set -euo pipefail

SUDO=""
if [ "${SNAPMGR_SUDO:-0}" = "1" ]; then
  SUDO="sudo"
fi

echo "Installing build dependencies..."
$SUDO apt-get update
$SUDO apt-get install -y --no-install-recommends systemd-dev 2>/dev/null || true
$SUDO apt-get install -y --no-install-recommends build-essential git autoconf automake libtool \
  libpopt-dev libconfig-dev libasound2-dev avahi-daemon libavahi-client-dev \
  libssl-dev libsoxr-dev libplist-dev libsodium-dev uuid-dev libgcrypt-dev xxd \
  libplist-utils libavutil-dev libavcodec-dev libavformat-dev

echo "Cleaning up any legacy installations..."
# Post-v0.3.4 fix, found live: every systemctl call in this script below
# used to omit the trailing `.service` unit-type suffix (e.g. `systemctl
# stop shairport-sync`, not `systemctl stop shairport-sync.service`).
# `systemctl` itself treats those as equivalent (it appends `.service` by
# default when no unit type is given), but `scripts/sudoers.d/
# snapcast-manager`'s NOPASSWD grants are written with the explicit
# `.service` suffix, and sudoers matches the literal command LINE, not
# systemctl's own unit-name normalization -- so every one of these calls
# was silently rejected as "command not allowed" on a real hardened
# install (confirmed live via `journalctl -t sudo`: `pam_unix(sudo:auth):
# auth could not identify password for [snapmanager]` immediately followed
# by `command not allowed`), leaving shairport-sync/nqptp installs stuck
# in a stop/disable-fails -> rm-binaries -> rebuild -> enable-fails loop
# that never reached a genuinely running service. Every systemctl
# invocation below now names the unit with its `.service` suffix
# explicitly, matching the sudoers grant exactly.
$SUDO apt-get remove --purge -y shairport-sync 2>/dev/null || true
$SUDO systemctl stop shairport-sync.service 2>/dev/null || true
$SUDO systemctl disable shairport-sync.service 2>/dev/null || true
$SUDO systemctl stop nqptp.service 2>/dev/null || true
$SUDO systemctl disable nqptp.service 2>/dev/null || true
$SUDO rm -f /usr/local/bin/shairport-sync /usr/bin/shairport-sync /usr/local/bin/nqptp /usr/bin/nqptp
$SUDO rm -f /etc/systemd/system/shairport-sync.service /etc/systemd/system/nqptp.service
$SUDO rm -f /lib/systemd/system/shairport-sync.service /lib/systemd/system/nqptp.service

echo "Building and installing nqptp..."
NQPTP_BUILD_DIR=/tmp/nqptp-build
rm -rf "$NQPTP_BUILD_DIR"
git clone https://github.com/mikebrady/nqptp.git "$NQPTP_BUILD_DIR"
cd "$NQPTP_BUILD_DIR"
autoreconf -fvi
./configure --with-systemd-startup
# Fix-pass note (Critical #2, post-Task-16 review): `-C "$NQPTP_BUILD_DIR"`
# is passed explicitly on both `make` invocations below rather than relying
# solely on the preceding `cd` -- `sudo make` is a GTFOBins-class
# arbitrary-code-execution primitive when combined with a controllable
# Makefile/CWD, and sudoers cannot restrict *which* CWD a granted `make`
# runs against. Pinning `-C` here removes this script's own dependency on
# ambient CWD state at the moment `sudo make install` runs; it does NOT
# fully close the risk, since sudoers still cannot pin the `-C` argument's
# value itself (see scripts/sudoers.d/snapcast-manager and SECURITY.md for
# the full, honest disclosure of this residual gap).
make -C "$NQPTP_BUILD_DIR" -j"$(nproc)"
$SUDO make -C "$NQPTP_BUILD_DIR" install
$SUDO systemctl daemon-reload
$SUDO systemctl enable nqptp.service
$SUDO systemctl restart nqptp.service

echo "Building and installing shairport-sync..."
SPS_BUILD_DIR=/tmp/shairport-sync-build
rm -rf "$SPS_BUILD_DIR"
git clone https://github.com/mikebrady/shairport-sync.git "$SPS_BUILD_DIR"
cd "$SPS_BUILD_DIR"
autoreconf -fvi
./configure --sysconfdir=/etc --with-alsa --with-soxr --with-avahi --with-ssl=openssl --with-systemd-startup --with-airplay-2 --with-metadata
# Same `-C` hardening as nqptp above -- see the note there.
make -C "$SPS_BUILD_DIR" -j"$(nproc)"
$SUDO make -C "$SPS_BUILD_DIR" install

echo "Setting up systemd service and user access..."
if ! getent group "shairport-sync" >/dev/null 2>&1; then
  $SUDO groupadd -r shairport-sync || true
fi
if ! id "shairport-sync" >/dev/null 2>&1; then
  $SUDO useradd -r -M -g shairport-sync -s /usr/sbin/nologin -G audio shairport-sync || true
fi

$SUDO systemctl daemon-reload
$SUDO systemctl enable shairport-sync.service
$SUDO systemctl restart shairport-sync.service
echo "Shairport-sync and nqptp installed successfully."
