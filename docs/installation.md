# Installation Guide

This is the full installation walkthrough. If you just want the one-liner,
see the README's Quick Installation section
instead — this document covers what actually happens at each step, the
interactive prompts, the update/uninstall paths, and the first-run
experience.

For the privilege model this installer sets up (the `snapmanager` system
user, sudo grants, systemd sandboxing) and its currently-known limitations,
see [`SECURITY.md`](../SECURITY.md) — this document only describes *what*
the installer does, not *why* it's structured that way.

## Prerequisites

- **Operating system**: Linux only — `scripts/install.sh` hard-checks
  `$OSTYPE` for `linux-gnu*` and aborts otherwise. It's written and tested
  against Debian/Ubuntu/Raspberry Pi OS (`apt`-based). There is no
  documented minimum disk/RAM requirement anywhere in this repository; the
  practical floor is whatever a Raspberry Pi Zero can run Node.js 22 and
  `better-sqlite3` on, which the project's own release process (pre-built,
  pre-compiled `.zip` artifacts) is specifically designed to keep low by
  avoiding a local TypeScript/Vite build on constrained devices.
- **Node.js**: v22. The installer installs it automatically via NodeSource
  if it's missing. Neither `server/package.json` nor `client/package.json`
  declares an `engines` field, so nothing in the codebase enforces this at
  install time beyond the installer's own explicit choice of the `setup_22.x`
  NodeSource script — if you already have a different Node major version
  installed, the installer detects and keeps it rather than overriding it.
- **Privileges**: root, or a user that can `sudo`. If neither is available,
  the installer exits immediately with an error.
- **Tools installed automatically if missing**: `curl`, `ffmpeg`,
  `lsb-release`, and `build-essential` (needed to compile the
  `better-sqlite3` native module). On the remote/curl-piped install path,
  `wget` and `unzip` are also installed if missing (needed to fetch and
  extract the release archive).
- Snapserver and Snapclient themselves are **not** installed by this
  script — the installer's own banner says so explicitly. Install them
  afterward from the web UI once the manager is running.

## Step-by-step: what the installer actually does

### The one-liner

```bash
curl -sL https://raw.githubusercontent.com/NaturalDevCR/Snapcast-Manager/main/scripts/install.sh | bash
```

Non-interactive (accepts every default, no prompts):

```bash
curl -sL https://raw.githubusercontent.com/NaturalDevCR/Snapcast-Manager/main/scripts/install.sh | bash -s -- -y
```

Other flags `scripts/install.sh` accepts:

| Flag | Effect |
|---|---|
| `-y`, `--yes` | Auto-confirm every prompt, using each prompt's stated default. |
| `--port <n>` / `--port=<n>` | Web interface port. Overrides the saved port on an update. Without it, a new install asks (`3000` under `-y`). |
| `--mode <client\|server\|both>` / `--mode=<...>` | Installation mode (see below). Overrides the saved mode on an update. Without it, a new install asks (`both` under `-y`). |
| `--no-service` | Don't install the systemd service. Nothing is started, so nothing can be verified. |
| `--restore <path>` / `--restore=<path>` | Restore a backup archive (see [Update/upgrade path](#updateupgrade-path) below) as part of this run. |

If run with no TTY and no flags at all (e.g. piped from a script with no
`-y`), a new install's prompts fall back to their stated default
automatically rather than hanging. An existing install is the exception: the
installer never replaces one without an answer, so it stops with
`No TTY available for input. Aborting.` Pass `-y` to update unattended.

### Before anything changes — one summary, one confirmation

The installer looks for an existing install first, because that decides what
it needs to ask. Nothing on the system changes until you confirm.

**New install.** It explains what it's about to set up (the manager itself,
Node.js and system tools like `ffmpeg`/`build-essential` when they're missing,
explicitly *not* Snapserver/Snapclient), then asks:

1. **Installation mode**, unless `--mode` was passed:
   1. **Snapclient Manager only** — manage audio output clients.
   2. **Snapserver Manager only** — manage the audio server.
   3. **Snapcast Manager (both)** — full server + client management (the
      default, and what `-y` selects).
2. **Web interface port**, unless `--port` was passed (default `3000`).
3. **Whether to install the systemd service**, unless `--no-service` was
   passed (default yes).

It then shows a summary and asks once for confirmation. `-y` skips the
questions, using the defaults above.

```text
Ready to install
  Version     v0.4.3
  Mode        both
  Port        3000
  Service     snapmanager (systemd)

Install Snapcast Manager v0.4.3? (Y/n):
```

**Existing install.** It reuses the mode and port saved in
`/opt/snapcast-manager/server/.env` and asks nothing else. See
[Update/upgrade path](#updateupgrade-path).

### The steps

Every run then shows numbered steps in one style. The exact count depends on
the run: an update adds a step that replaces the old version, and a local
checkout has nothing to download.

| Step | Runs on |
|---|---|
| Downloading Snapcast Manager | Remote flow |
| Unpacking files | Remote flow |
| Replacing the previous version | Remote updates |
| Checking system requirements | Always |
| Installing dependencies, or building from source | Always |
| Applying configuration | Always |
| Setting up the system service | Unless skipped |
| Verifying the installation | Unless the service was skipped |

Output from `apt-get`, `npm`, and other commands goes to a temporary log, not
the screen. If something fails, the installer shows the end of that log and
prints its path, for example
`Full log: /tmp/snapcast-manager-install.a1B2c3`. The log is deleted after a
successful run.

### Remote install vs. local source

If you run the script from a directory that doesn't already contain
`server/` and `client/` (true for the curl-piped one-liner), it treats this
as a **remote install**: it downloads the latest tagged release (or falls back
to the tagged source archive if no pre-built `.zip` asset exists), verifies
the archive against the size and SHA-256 digest GitHub reports, unpacks it into
a temporary directory, moves it to `/opt/snapcast-manager`, and hands over to
the installer inside that release.
The numbering carries on across the hand-over, and you aren't asked anything
twice.

### Checking system requirements

Checks for `curl`, `ffmpeg`, `lsb-release`, `make`/`build-essential` (needed
for `better-sqlite3`'s native compilation step), and Node.js. If Node.js is
missing, it offers Node 22 via NodeSource. If a different version is already
present, it's left alone — the script only reports what it detected.

Anything missing on a new install is a `y/n` prompt defaulting to "yes", and
`-y` accepts all of them automatically. On an update, your confirmation
already covers them, so a missing package is installed without another
question.

### Dependencies and build

- If `server/dist` and `client/dist` already exist (a pre-built release,
  the normal case for the remote-download path) and there's no
  `.rebuilding` flag file, it skips the build entirely and only runs
  `npm install --omit=dev` in `server/` — this is the fast path the
  project's release process exists to enable.
- Otherwise (source checkout, or a source-archive fallback download that
  set the `.rebuilding` flag) it runs a full build: `npm install` and
  `npm run build` in both `server/` and `client/`. The script's own output
  warns this can take several minutes.

### Applying configuration

If `--restore <path>` was passed, the specified backup archive is extracted
and its database/`snapserver.conf` are restored here. The installer then
writes `/opt/snapcast-manager/server/.env` with `PORT`, `SNAPCAST_MODE`, and
`NODE_ENV=production`.

### Setting up the system service

This is the privilege-hardening step described in detail in
[`SECURITY.md`](../SECURITY.md#privilege-model-task-16). The installer:

1. Creates the dedicated, unprivileged `snapmanager` system user
   (`--system --no-create-home --shell /usr/sbin/nologin`, member of the
   `audio` group) if it doesn't already exist.
2. `chown`s the install tree, the SQLite data directory, the snapshots
   directory, and a specific list of `/etc` config paths
   (`/etc/snapserver.conf`, `.conf.base`, `.conf.bak`,
   `/etc/default/snapclient`) to `snapmanager`.
3. Pre-creates every other path the hardened systemd unit's
   `ReadWritePaths=` needs to already exist (package-manager state,
   `/etc/mpd.conf`, `/run/snapcast-manager`, etc.) so the unit's own
   mount-namespace sandboxing doesn't fail to start on a genuinely fresh
   host — a real bug found and fixed via Task 65's container tests (see
   `SECURITY.md`). As of v0.3.1, `ReadWritePaths=` also grants `/etc`,
   `/var`, `/usr`, and `/run` wholesale (not just this app's own specific
   paths under them) — needed for a REAL `apt-get install` of a package
   like `mpd`/`mympd` to actually succeed under the sandbox; see
   `SECURITY.md`'s "ReadWritePaths= widened to /etc/var/usr/run" section
   for why.
4. Validates and installs a scoped `sudoers.d` rule
   (`/etc/sudoers.d/snapcast-manager`, mode `0440`) via `visudo -c` before
   ever writing it live — a validation failure is reported loudly rather
   than silently locking out `sudo`.
5. Writes the hardened `snapmanager.service` unit
   (`ProtectSystem=strict`, `ProtectHome=yes`, `PrivateTmp=yes`, an
   explicit `ReadWritePaths=` allowlist — see `SECURITY.md` for the exact
   current list and why `NoNewPrivileges=yes` is *not* set), enables it,
   and restarts it.
6. Verifies the service actually stays running (not just that
   `systemctl restart` was accepted) before declaring success. If the new
   configuration fails to come up and a previous unit file existed, it's
   rolled back automatically and the service is restarted under the old
   configuration rather than being left down; if there was no previous
   unit (a fresh install), the installer exits non-zero instead.

There is no separately documented "expected duration" for this whole
process — in practice the pre-built-release path (no local compilation)
is fast, while a from-source build is the step the script itself warns
may take several minutes, dominated by `npm install`/`npm run build` on
constrained hardware like a Raspberry Pi.

### Completion

The final step checks that the web interface answers on `/api/health` and
that the service is active. Only then does the script report success, with
the URL to open (`http://<detected-local-ip>:<port>`) and, on a new install, a
note that the Setup Wizard will greet you on first visit. With `--no-service`,
it says plainly that nothing is running.

## First-run experience

1. **Setup Wizard** (`/setup`): the first thing you see on a fresh
   install. It creates the very first admin account (`POST
   /api/auth/setup`) — username and password, no defaults, no
   pre-seeded credentials.
2. **Onboarding wizard** (`/onboarding`): immediately after account
   creation, a 3-step guided flow:
   1. Install `snapserver` (if not already installed).
   2. Add your first audio source (pipe source dialog, opened
      automatically if you have none yet).
   3. Assign your first zone — pick a stream for the first client group
      that connects, with a live "waiting for a client" state until one
      does.
3. From there you land on the main Dashboard, with the rest of the app
   (Routing, Pipe Sources, Server Config, Tools, Watchdogs, Security,
   Logs, Diagnostics) available from the navigation.

## Update/upgrade path

Re-running the **remote** one-liner against a host that already has
`/opt/snapcast-manager` shows a summary and asks one question:

```text
Update available
  Installed   v0.4.2
  New         v0.4.3
  Mode        both (saved)
  Port        3000 (saved)
  Service     snapmanager (systemd)
  Data        database and settings are kept

Update to v0.4.3 now? (Y/n, or o for other options):
```

- **Enter or `y`** updates. Nothing else is asked: the mode and port come from
  the saved settings, and the service question only appears if no service is
  installed. `--port` and `--mode` still override the saved values.
- **`o`** opens the other options: **Force Re-install** (replaces the app,
  keeps data), **Clean Re-install** (deletes everything, then asks the
  new-install questions), **Uninstall**, or **Abort**. Clean Re-install asks
  you to confirm the deletion first.
- **`n`** stops without changing anything.
- Under `-y`, this always resolves to **Update/Upgrade** — data is preserved
  automatically.
- **If you're already on the latest version**, Enter exits and `o` opens the
  same other options. Under `-y`, this case **exits immediately** rather
  than doing anything — re-running the non-interactive installer against an
  already-up-to-date install is a deliberate no-op, not a forced reinstall.
- When an update proceeds, the new release is downloaded, verified and
  unpacked first, and a complete copy of it is prepared next to the install
  in `/opt/snapcast-manager.new.*`. The running version isn't touched during
  any of this. Only then is the service stopped, the database (`data/` or the
  legacy `server/data/` path) copied into the new copy, and the two directories
  swapped, before the build/systemd steps re-run. `/etc/snapserver.conf` is
  outside the install directory and isn't touched.

Only `PORT` and `SNAPCAST_MODE` carry over from `server/.env`. Anything else
added to that file by hand is lost on an update.

#### If an update fails

| Fails during | Result |
|---|---|
| Download, verification or unpacking | The old version keeps running, unchanged. |
| Copying the database | The old install is still whole, and the installer restarts it. |
| Any later step, such as `npm install` or starting the service | The new files are in place but the app is down. Database and settings are safe. |

In every case, fix the problem and run the installer again. After a failure in
a later step, the next run keeps the saved mode and port, says that the last
run did not finish, and completes it, even under `-y` and even when the
version already matches.

If an installer up to v0.4.3 failed during an update and left a database
backup in `/tmp/snapmgr_data_backup`, the next run restores it as long as the
install has no database of its own and root owns that directory.

This update flow only applies to the **remote** (curl-piped) install
path. Re-running `scripts/install.sh` from a local checked-out copy of
the repository (where `server/`/`client/` already exist) skips the download
and the menu, and goes straight to the build/systemd steps against whatever is
on disk in that checkout, still reusing any saved mode and port — useful for
local development, not the mechanism for updating a production install.

Separately, the **systemd/privilege-hardening step is
itself idempotent and safe to re-run on its own**: re-running the
installer against an already-migrated install detects the unit is
already up to date and makes no changes, and re-running it against an
older, pre-hardening install (unit file missing `User=snapmanager`, or
running as `root`/some other user) migrates it in place with no data
loss.

## Uninstall path

There is no dedicated `--uninstall` command-line flag. Uninstalling is
reached interactively, by re-running the remote one-liner against an
existing install, typing `o` for other options, and choosing **Uninstall**
(not available under `-y`, since `-y` never selects that menu option).
Confirming uninstall:

1. Stops and disables the `snapmanager` systemd service.
2. Removes the unit file (`/etc/systemd/system/snapmanager.service`) and
   the `sudoers.d` grant (`/etc/sudoers.d/snapcast-manager`).
3. Runs `systemctl daemon-reload`.
4. Leaves the `snapmanager` system user/group in place (standard practice
   for system accounts) — remove it manually with `userdel snapmanager`
   if you want it gone.
5. Asks whether to also delete all application data (the SQLite database
   and settings under `/opt/snapcast-manager/data`). If you decline, the
   application files are removed but your data directory is kept; if you
   confirm, everything under `/opt/snapcast-manager` is removed.

## Upgrading an existing install to v0.3.1+

If you installed any earlier version, the privilege-hardening step
(see [Setting up the system service](#setting-up-the-system-service)) is idempotent and safe to re-run on its own — no special
migration procedure, flag, or data-loss risk. Simply re-run the installer
against your existing install (the same one-liner for a remote install,
or `bash scripts/install.sh` from a local checkout) and let it detect and
migrate the existing unit/sudoers/`ReadWritePaths=` state, same as any
other update.

**One thing worth knowing before you do:** if you originally installed via
the remote (`curl | bash`) one-liner on ANY version before v0.3.1, your
`/etc/sudoers.d/snapcast-manager` grant likely never existed at all — a
real, disclosed bug (`.github/workflows/release.yml` never packaged
`scripts/sudoers.d/` into the release `.zip`, since Task 16 first
introduced the privilege model) meant `install.sh` silently skipped
installing it, rather than failing loudly. If package installs/updates
from the UI have never worked for you, this is very likely why — see
[`docs/troubleshooting.md`](troubleshooting.md#4-package-installs-fail-mpdmympdffmpegnode-even-though-sudo-works)
for how to confirm it and the fix (re-run the one-liner to fetch a
v0.3.1+ release, which includes the grant this time).

Three other real, disclosed bugs specific to installing/updating a
package (mpd, mympd, ffmpeg, Node.js) from the UI — a real `apt-get
install` failing with `Read-only file system`, and `dpkg` hanging on an
unanswerable interactive conffile prompt — were also fixed in v0.3.1; see
the same troubleshooting section for symptoms and confirmation steps if
you're upgrading from an older release and those still concern you.

## Where to go next

- **[`SECURITY.md`](../SECURITY.md)** — the full privilege model (what the
  `snapmanager` user can and can't do, the sudoers grants, the systemd
  sandbox, and currently-known, disclosed limitations), and the
  real-hardware validation checklist recommended before production use.
- **[`docs/troubleshooting.md`](troubleshooting.md)** — organized by
  symptom, covering installation issues, sudo/permission errors, package
  install failures, snapserver/snapclient, pipe sources, myMPD, and
  backup/restore. The installer's own console output is the primary
  diagnostic tool alongside it: on a failure it shows the end of its log and
  prints the log's path, and for the systemd step that log includes
  `journalctl -u snapmanager -n 50 --no-pager`.

## Snapcast beta packages

The Snapserver and Snapclient package cards include an **Installation channel**
selector. **Official Snapcast** is the default. **NaturalDevCR beta** lists
published prereleases from `NaturalDevCR/snapcast` that have a package matching
this device's Debian codename and architecture.

Choose **Latest beta** to follow the newest compatible beta, or choose a specific
version to keep it pinned. Open **Changes in this version** to see its release
notes, then click **Install beta**. The choice is saved separately for Snapserver
and Snapclient. Existing update buttons also use the saved channel and version.

To return to upstream, choose **Official Snapcast** and click **Install official
version**. This uses a package install rather than a clean reinstall, preserving
configuration. Active managed Snapclient instances restart after installation to
use the installed binary; stopped instances stay stopped.

Beta packages currently support Debian/Raspberry Pi OS Bookworm and Trixie on
amd64, arm64 and armhf. Incompatible packages are not offered. Downloads are
checked against GitHub's asset size and SHA-256 digest before installation.
Channel settings live in `data/snapcast-channels.json` alongside the Manager's
persistent data. `SNAPCAST_CHANNELS_PATH` overrides that location.
