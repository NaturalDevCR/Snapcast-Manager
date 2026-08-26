# Security Policy

## Supported Versions

This project releases continuously via git tags. Only the latest release is officially supported for security updates and bug fixes.

## Reporting a Vulnerability

To report a security vulnerability privately, please use GitHub's private vulnerability reporting feature:

1. Navigate to the [Security tab](https://github.com/NaturalDevCR/Snapcast-Manager/security) of the repository
2. Click "Report a vulnerability"
3. Provide details of the vulnerability through the GitHub Security Advisory

This ensures your report reaches the maintainers confidentially and allows time for a fix before public disclosure.

## Threat Model

Snapcast Manager is designed for **trusted local/LAN environments only**. The application runs with elevated system privileges (typically root or sudo) to manage services and packages on the host system.

**Important security considerations:**

- This application should **not** be exposed directly to the public internet without a reverse proxy and TLS encryption
- It is intended for use on trusted networks where all users are authorized to manage system services
- In multi-tenant or untrusted network scenarios, place the application behind a reverse proxy with strong authentication and TLS

A broader security-hardening effort is tracked in [`docs/superpowers/plans/2026-08-18-professional-hardening.md`](docs/superpowers/plans/2026-08-18-professional-hardening.md) (Stage 1), which includes additional security improvements planned for future releases.

## Privilege model (Task 16)

As of the version that ships `scripts/install.sh`'s Task-16 changes, Snapcast
Manager no longer runs its own service as root (or as whatever user happened
to run the installer). It runs as a dedicated, unprivileged system account,
`snapmanager`, created by the installer as:

```
useradd --system --no-create-home --shell /usr/sbin/nologin --groups audio snapmanager
```

`--system` places it in the system UID range (not a regular login account).
`--no-create-home`/`--shell /usr/sbin/nologin` mean it cannot be logged into
interactively. It is a member of the `audio` group only because the ALSA/FIFO
paths this app manages (`/run/snapcast-manager`'s FIFOs, `alsactl store`)
already expect group-`audio` access.

### What `snapmanager` can and cannot do

**Directly (no elevation, plain filesystem access), because the installer
`chown`s these paths to `snapmanager:snapmanager`:**
- The entire `/opt/snapcast-manager` install tree, including `server/data/`
  (the SQLite database) and `server/snapshots/` (config snapshots).
- `/etc/snapserver.conf.d/` -- written directly via `writeFileAtomic()`
  (`platform/files.ts`) in `server/src/services/config.ts`, never through
  `sudo`. The installer `chown -R`s this DIRECTORY (not just files in it)
  to `snapmanager`, and `writeFileAtomic()` needs write access to the
  containing directory (it creates its temp file there before renaming it
  into place), which this directory genuinely has.
- `/etc/snapcast-manager/` (watchdog config) -- same pattern (directory
  `chown -R`'d, `writeFileAtomic()`), in `server/src/services/watchdog.ts`.
- `/etc/default/snapclient` -- writes directly via `fs.writeFile` in
  `server/src/routes/config.ts`; this one file's containing directory
  (`/etc`) is not `snapmanager`-writable, but `fs.writeFile` truncates the
  already-`chown`'d file in place rather than creating a new inode next to
  it, so it needs no directory permission.

**Via the scoped `sudo` grants in `/etc/sudoers.d/snapcast-manager`
(installed with `visudo -c` validation, mode `0440`, owned `root:root`):**
- `/etc/snapserver.conf`, `/etc/snapserver.conf.base`, and
  `/etc/snapserver.conf.bak` -- written via `installPrivilegedFile()`
  (`platform/files.ts`, sudo-elevated `cp`/`chmod`) in
  `server/src/services/config.ts`. **This changed from the row above** in a
  post-Task-24 review fix: the installer `chown`s these three paths
  INDIVIDUALLY, not their containing directory (`/etc` itself stays
  root-owned by design -- see `scripts/install.sh`'s comment above its
  `chown` loop for these three paths), so the plain-`fs.writeFile`-derived
  `writeFileAtomic()` (which needs to create a temp file IN THAT DIRECTORY
  before renaming it into place) fails with `EACCES` on a real install even
  though `snapmanager` owns the files themselves. `installPrivilegedFile()`
  stages the new content in a private, process-owned scratch directory and
  installs it via `sudo cp`/`sudo chmod`, which -- being root -- can write
  into `/etc` regardless of the directory's own permissions. `cp` onto an
  EXISTING destination file opens and overwrites that file's existing
  inode rather than unlinking/recreating it, so these three files remain
  `snapmanager`-owned after every write (verified empirically: `cp`'s
  destination inode number is unchanged before/after copying onto an
  existing file) -- this fix does not require broadening the installer's
  directory-ownership grants.
- Start/stop/restart/enable/disable exactly the systemd units this app
  manages: `snapserver.service`, `snapclient.service`, `shairport-sync.service`,
  `nqptp.service`, `mpd.service`, `mpd.socket`, `mympd.service`,
  `librespot.service`, plus the per-instance units it generates itself
  (`snapclient-manager-*.service`, `snapcast-radio-*.service`).
- `systemctl daemon-reload`, `systemctl unmask mpd.service`,
  `journalctl -u * -n * --no-pager` (read-only logs, sudo-gated because
  reading a privileged unit's journal typically requires it).
- Installing/removing Debian packages (`apt-get`, `dpkg`) and the general
  filesystem/user-management tools the installer and in-app package flows
  use (`mkdir`, `chmod`, `chown`, `rm`, `cp`, `mv`, `gpg`,
  `wget`, `useradd`, `groupadd`, `usermod`, `make`, `ss -K *`,
  `alsactl store`, `systemd-analyze verify *`), and exactly one specific,
  versioned script: `bash /opt/snapcast-manager/server/scripts/install-shairport-sync.sh`.
  (`find` and `tee` were removed from this grant in a post-Task-16 fix pass
  -- see "Package-management is intentionally NOT narrowly restricted"
  below.)

**What it explicitly CANNOT do:** run an arbitrary shell (`/bin/bash *` /
`/bin/sh *` are never granted -- the one bash grant above is a single
literal, versioned script path, not a wildcard), run an arbitrary binary as
root outside the list above, or write as root to any path outside the
`ReadWritePaths=` list in its own systemd unit (see below) even via one of
the granted tools, because `ProtectSystem=strict` enforces that at the
kernel mount-namespace level, independent of and in addition to `sudo`.

### The systemd sandbox (`snapmanager.service`'s own unit)

```
NoNewPrivileges=yes
ProtectSystem=strict
ProtectHome=yes
PrivateTmp=yes
ReadWritePaths=/opt/snapcast-manager/data /opt/snapcast-manager/server/snapshots /etc/snapserver.conf /etc/snapserver.conf.base /etc/snapserver.conf.bak /etc/snapserver.conf.d /etc/snapcast-manager /run/snapcast-manager /var/lib/snapcast-manager/scripts /var/backups/snapmanager /etc/mpd.conf /var/lib/mpd /etc/systemd/system /etc/default/snapclient /etc/snapclient-manager /var/lib/snapserver /etc/apt/keyrings /etc/apt/sources.list.d /usr/share/snapserver/snap-ctrl /var/lib/dpkg /var/cache/apt /var/lib/apt/lists /usr/local/bin /usr/bin /etc/passwd /etc/group /etc/shadow /etc/gshadow
```

The last three groups above (`/var/lib/dpkg /var/cache/apt /var/lib/apt/lists`,
`/usr/local/bin /usr/bin`, `/etc/passwd /etc/group /etc/shadow /etc/gshadow`)
were added in a post-Task-16 fix pass -- see "Fix-pass additions (post-Task-16
review)" below for the reasoning behind each.

`ProtectSystem=strict` makes the ENTIRE filesystem read-only to this
process except `/dev`, `/proc`, `/sys`, and the paths explicitly listed in
`ReadWritePaths=`. This applies at the mount-namespace level, so it also
constrains child processes spawned via `sudo` (a compromised process
cannot write outside this list even by invoking one of its granted `sudo`
tools) -- this is the SECOND, independent containment layer beyond `sudo`
scoping itself.

### Package-management is intentionally NOT narrowly restricted -- read this carefully

`apt-get` and `dpkg` are granted broadly (no argument wildcarding) in the
sudoers file, and this is a deliberate, accepted limitation, not an
oversight:

1. `apt-get install <path-to-local.deb>` runs that package's arbitrary
   root-executed `postinst` script. A wildcard like `apt-get install -y *`
   cannot distinguish "a real Debian package name" from "a path to an
   attacker-planted local `.deb`", because sudoers pattern-matches the
   command **line**, not semantic argument types.
2. This app's own legitimate purpose includes installing arbitrary
   downloaded packages -- `executeDebUpdate()` in
   `server/src/services/system.ts` genuinely does `dpkg -i <downloaded-file>`
   as part of normal "update snapserver/snapclient from GitHub" operation.
   There is no sudoers-level way to distinguish "a `.deb` this app
   downloaded from GitHub" from "a `.deb` an attacker planted" -- the real
   mitigation for that risk is the existing TLS-certificate validation +
   minimal size check (already shipped), and the still-outstanding future
   work of full artifact signature verification (explicitly out of scope
   here, as it was when first flagged during the download-pipeline
   hardening work).
3. **Therefore, this sudoers file's actual, honest security property is:**
   it prevents a compromised `snapmanager` process from acting as root for
   anything OUTSIDE this specific toolset (no shell, no arbitrary binary
   execution, no writing to arbitrary files as root via some other
   command) -- but it does **NOT** prevent a compromised `snapmanager`
   process from eventually reaching root through the package-management
   tools it is deliberately granted, if it can also control what those
   tools are pointed at. This is a real, deliberately-documented
   limitation. Do not read this sudoers file as full root containment --
   it is scoped containment, with package management as the known,
   accepted gap.

### `make` is a separate, disclosed GTFOBins-class risk (fix-pass addition)

`/usr/bin/make` is granted broadly (no argument wildcarding), and this is a
**different risk category** from the `apt-get`/`dpkg` `.deb`-ambiguity
problem documented above, not the same one restated:

- `make` is a documented [GTFOBins](https://gtfobins.github.io/gtfobins/make/)
  arbitrary-code-execution primitive: `sudo make -s --eval='x:\n\t/bin/sh'`
  (or any Makefile with a rule that shells out) grants a full root shell to
  anyone who can run `sudo make` from a directory containing (or pointing
  `-C`/`-f` at) a controllable Makefile. Sudoers pattern-matches the command
  **line**, so it cannot restrict `make` to a specific working directory or
  inspect a Makefile's contents.
- It is granted anyway because `server/scripts/install-shairport-sync.sh`
  genuinely needs to build third-party source: `make install` (twice, for
  `nqptp` and `shairport-sync`) against a Makefile generated by
  `autoreconf`/`./configure` from freshly cloned, unpinned upstream source.
  There is no narrower sudoers-level alternative that still allows this.
- As a mitigation (not a fix), the script's own `make`/`make install`
  invocations were hardened in the same fix pass to pass `-C <build-dir>`
  explicitly rather than relying on the script's `cd`, removing the
  script's own dependency on ambient CWD state. This does **not** close the
  underlying gap -- sudoers still cannot pin the `-C` argument's value
  itself, so a compromised process that can still influence what ends up in
  `/tmp/nqptp-build` or `/tmp/shairport-sync-build` before `sudo make
  install` runs retains the same root-shell primitive.
- This is an **accepted, disclosed limitation** of this design, exactly
  like the apt-get/dpkg gap above -- it exists because
  `install-shairport-sync.sh` genuinely needs to build third-party source,
  and it is not fixed further in this task.

### Account-database write access is broad by necessity (fix-pass addition)

`ReadWritePaths=` (above) includes `/etc/passwd /etc/group /etc/shadow
/etc/gshadow`, added in a post-Task-16 fix pass. `sudo` does not create a
new mount namespace, so `useradd`/`groupadd`/`usermod` -- run as `sudo`
children of this `ProtectSystem=strict` unit, whether from
`install-shairport-sync.sh`'s `groupadd -r shairport-sync`/`useradd -r -M
-g shairport-sync ...` or from `executeDebUpdate()`'s `usermod -d
/var/lib/snapserver snapserver` -- need to write the account database
directly, and stay inside this unit's read-only view without this grant.
This is the **same category** of reasoning already applied to
`apt-get`/`dpkg`/`make` above: it is broad by necessity because the
sudoers-granted tools (`useradd`/`groupadd`/`usermod`) themselves already
carry root-equivalent trust once granted at all -- not a new, separate risk
category introduced by this path addition. Architecturally moving user
creation out of the running service (so it never needs this write access at
all) is a larger redesign, deliberately deferred to a follow-up task rather
than attempted in this fix pass.

### Migration for existing (pre-Task-16) installs

Re-running `scripts/install.sh` (interactively or with `-y`) against an
existing install detects a unit file whose `User=` is unset, `root`, or any
value other than `snapmanager`, and migrates it: creates the `snapmanager`
user if missing, `chown`s the install tree and the `/etc` paths listed
above, installs/validates the sudoers file, rewrites the unit with the
hardening directives, and restarts. It is idempotent (a second run against
an already-migrated install performs no writes and no restart) and
transactional against the live unit file: if the new configuration fails to
start, the previous unit file is restored and the service is restarted
under it, rather than being left down.

### Real-hardware validation checklist (REQUIRED before production use)

This entire privilege model was implemented and reasoned about on a macOS
development machine with **no** real `systemd`, `sudo`/`sudoers.d`
semantics, Debian package manager, or matching user/group model to test
against. It compiles, its unit tests pass, `bash -n` and `visudo -c` both
pass, but **none of that proves it works end-to-end on a real target
host.** The following MUST be manually verified on real Debian/Raspberry Pi
OS hardware before this is considered production-ready:

1. A fresh install completes end-to-end and the resulting service is
   confirmed running as `snapmanager`, not root
   (`systemctl show snapmanager -p User`, `ps -o user= -p $(pgrep -f dist/index.js)`).
2. Install `mpd` via the UI and confirm it succeeds (package install,
   `mpd.socket`/`mpd.service` control, and `/etc/mpd.conf` (or
   `/var/lib/mpd/mpd.conf`) writes all working under the new user).
3. Install `mympd` via the UI and confirm it succeeds (the
   `/etc/apt/keyrings`, `/etc/apt/sources.list.d` GPG-key/repo-file writes).
4. Install/update `snapclient` and `snapserver` via the GitHub-release
   `.deb` path (`executeDebUpdate()`) and confirm both succeed, including
   the `--clean` reinstall path that removes and recreates
   `/var/lib/snapserver`.
5. Install `shairport-sync` (build-from-source path) and confirm it
   succeeds end-to-end, INCLUDING the script's own internal `sudo`
   calls -- `server/scripts/install-shairport-sync.sh` is invoked directly
   (not itself wrapped in an outer `sudo`), so its internal
   `$SUDO systemctl ...`/`$SUDO apt-get ...` lines are the actual sudo
   calls being tested here, each individually covered by this sudoers
   file's broad tool grants.
6. Install `snap-ctrl` via the UI and confirm the
   `/usr/share/snapserver/snap-ctrl` install (rm -rf/mkdir/cp -rT, all
   sudo'd) succeeds.
7. Edit a pipe source's raw config via the UI (`PUT /:id/config`) and
   confirm the `systemd-analyze verify` + install path works for both a
   `radio` pipe (unit file) and an `mpd` pipe (audio_output block).
8. Confirm ALSA volume control (`alsactl store`) works given
   `snapmanager`'s `audio` group membership.
9. Confirm the migration path correctly converts an existing root-run (or
   arbitrary-user-run) install: stop the service, hand-edit its unit file
   to remove `User=` (or set `User=root`), re-run `install.sh -y`, and
   confirm it ends up running as `snapmanager` with no data loss and no
   extended downtime.
10. Run `visudo -c` on the installed `/etc/sudoers.d/snapcast-manager` and
    confirm no syntax warnings (this was checked at write time; confirm it
    still holds after being copied onto the real host's actual `sudo`
    version).
11. Confirm every binary path referenced in the sudoers file
    (`/usr/bin/systemctl`, `/usr/bin/journalctl`, `/usr/bin/apt-get`,
    `/usr/bin/dpkg`, `/usr/sbin/ss`, `/usr/sbin/alsactl`, `/usr/sbin/useradd`,
    `/usr/sbin/groupadd`, `/usr/sbin/usermod`, etc.) actually resolves to
    that exact absolute path on the target distro/image -- `sudo` matches
    sudoers rules against the RESOLVED absolute path of the command being
    run, not the bare name the application passes, and usr-merge / symlink
    differences between Debian point releases could cause a silent
    mismatch (the grant simply never matches, and the call fails with
    "sudo: a password is required" instead of running).
12. Confirm `sudo DEBIAN_FRONTEND=noninteractive apt-get install -f ...`
    (the `dpkg -i` dependency-fix fallback in `aptGetInstallFix()`) is not
    rejected by `sudo`'s `env_reset` policy despite the
    `Defaults:snapmanager env_keep += "DEBIAN_FRONTEND"` line added for it.
13. Confirm a host with `Defaults requiretty` set globally does not block
    this service's `sudo` calls despite the
    `Defaults:snapmanager !requiretty` line added for it (this daemon never
    has a controlling TTY).
14. Confirm no feature silently broke that this task's grep pass may have
    missed. In particular: install/update Node.js via the UI and confirm
    it succeeds end-to-end on a migrated (non-root `snapmanager`) install.
    `updateNodeJs()` (`server/src/services/system.ts`) formerly piped a
    remotely-fetched NodeSource setup script into `sudo -E bash -` via
    stdin -- a general-purpose-shell-wildcard hole this design explicitly
    forbids, which this task's sudoers file deliberately did not grant, so
    the feature failed outright on a migrated install. Task 17 replaced
    that with NodeSource's own APT-repo method (native `fetch()` for the
    GPG key, `dearmorGpgKey()`, `installPrivilegedFile()` for the keyring +
    source-list files, `apt.update()`/`apt.install()`), mirroring
    `installMympd()`'s already-shipped pattern -- zero new sudoers surface
    was needed. Confirm the installed keyring (`/etc/apt/keyrings/nodesource.gpg`)
    and source-list entry (`/etc/apt/sources.list.d/nodesource.list`) are
    present and correct, and that `apt-get install -y nodejs` actually
    installs the requested major version.
