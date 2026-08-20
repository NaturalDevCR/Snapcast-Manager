#!/usr/bin/env bash
#
# install-shairport-sync.sh -- builds and installs shairport-sync (AirPlay 2
# receiver) and its companion nqptp (PTP clock sync daemon) from source.
#
# Invoked by server/src/services/system.ts's installShairportSync() via
# `run('bash', [<path to this script>], ...)` (server/src/platform/exec.ts's
# argv-based run()) -- a plain argv invocation, never a shell string built
# from runtime-interpolated data. This script takes no arguments and reads no
# external input; it is a static, versioned, shellcheck-able artifact, not
# something assembled at runtime from untrusted data, so the real shell
# features used below (command substitution, conditionals, `2>/dev/null ||
# true` tolerance) are fine here -- see
# docs/superpowers/sdd/task-12-brief.md for the full rationale on why this
# extraction does NOT reintroduce the shell-injection class Stage 1 of the
# hardening plan otherwise eliminates.
#
# Privilege handling: unlike the original TypeScript template-literal
# version (which prefixed only individual privileged sub-commands with a
# per-line `${this.SUDO}`, leaving the build steps -- git clone, autoreconf,
# configure, make -- running as the invoking user), this script assumes it
# is invoked ALREADY elevated as a single whole: services/system.ts's
# installShairportSync() runs it via `runPrivileged(['bash', scriptPath],
# ...)`, the same `needsSudo() ? run('sudo', [...]) : run(...)` idiom this
# file already sudo-gates every other privileged multi-step operation with
# (installMpd(), installMympd(), executeDebUpdate(), etc.) -- so no command
# in this script needs its own `sudo` prefix. This is a deliberate
# simplification over the original's finer-grained per-line escalation: the
# build steps (git clone / autoreconf / configure / make, not just `make
# install`) now also run with whatever privilege the whole script was
# invoked with. Since this whole pipeline already downloads and compiles
# third-party source that is then installed with root privileges regardless
# (`make install`, systemd unit management), this does not introduce a new
# trust boundary -- but it is a real narrowing of the previous
# build-vs-install privilege separation, called out explicitly in
# task-12-report.md as a concern rather than silently changed.
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

echo "Installing build dependencies..."
apt-get update
apt-get install -y --no-install-recommends systemd-dev 2>/dev/null || true
apt-get install -y --no-install-recommends build-essential git autoconf automake libtool \
  libpopt-dev libconfig-dev libasound2-dev avahi-daemon libavahi-client-dev \
  libssl-dev libsoxr-dev libplist-dev libsodium-dev uuid-dev libgcrypt-dev xxd \
  libplist-utils libavutil-dev libavcodec-dev libavformat-dev

echo "Cleaning up any legacy installations..."
apt-get remove --purge -y shairport-sync 2>/dev/null || true
systemctl stop shairport-sync 2>/dev/null || true
systemctl disable shairport-sync 2>/dev/null || true
systemctl stop nqptp 2>/dev/null || true
systemctl disable nqptp 2>/dev/null || true
rm -f /usr/local/bin/shairport-sync /usr/bin/shairport-sync /usr/local/bin/nqptp /usr/bin/nqptp
rm -f /etc/systemd/system/shairport-sync.service /etc/systemd/system/nqptp.service
rm -f /lib/systemd/system/shairport-sync.service /lib/systemd/system/nqptp.service

echo "Building and installing nqptp..."
rm -rf /tmp/nqptp-build
git clone https://github.com/mikebrady/nqptp.git /tmp/nqptp-build
cd /tmp/nqptp-build
autoreconf -fvi
./configure --with-systemd-startup
make -j"$(nproc)"
make install
systemctl daemon-reload
systemctl enable nqptp
systemctl restart nqptp

echo "Building and installing shairport-sync..."
rm -rf /tmp/shairport-sync-build
git clone https://github.com/mikebrady/shairport-sync.git /tmp/shairport-sync-build
cd /tmp/shairport-sync-build
autoreconf -fvi
./configure --sysconfdir=/etc --with-alsa --with-soxr --with-avahi --with-ssl=openssl --with-systemd-startup --with-airplay-2 --with-metadata
make -j"$(nproc)"
make install

echo "Setting up systemd service and user access..."
if ! getent group "shairport-sync" >/dev/null 2>&1; then
  groupadd -r shairport-sync || true
fi
if ! id "shairport-sync" >/dev/null 2>&1; then
  useradd -r -M -g shairport-sync -s /usr/sbin/nologin -G audio shairport-sync || true
fi

systemctl daemon-reload
systemctl enable shairport-sync
systemctl restart shairport-sync
echo "Shairport-sync and nqptp installed successfully."
