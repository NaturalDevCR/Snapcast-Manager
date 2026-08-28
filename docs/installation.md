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
| `--port <n>` / `--port=<n>` | Web interface port (default `3000` if unspecified and not interactively prompted). |
| `--mode <client\|server\|both>` / `--mode=<...>` | Installation mode (see below). Defaults to `both` under `-y`. |
| `--restore <path>` / `--restore=<path>` | Restore a backup archive (see [Update/upgrade path](#updateupgrade-path) below) as part of this run. |

If run with no TTY and no flags at all (e.g. piped from a script with no
`-y`), prompts that can't be answered fall back to their stated default
automatically rather than hanging.

### Phase 0 — consent and installation mode

The script prints a banner, explains what it's about to install (the
manager itself, Node.js, and system tools like `ffmpeg`/`build-essential`
— explicitly *not* Snapserver/Snapclient), and asks for confirmation
(skipped entirely under `-y`). It then asks you to choose a mode:

1. **Snapclient Manager Only** — manage audio output clients.
2. **Snapserver Manager Only** — manage the audio server.
3. **Snapcast Manager (both)** — full server + client management (the
   default, and what `-y` selects).

### Phase 1 — source detection (remote install vs. local source)

If you run the script from a directory that doesn't already contain
`server/` and `client/` (true for the curl-piped one-liner), it treats this
as a **remote install**:

- If `/opt/snapcast-manager` already exists, it detects the installed
  version and offers an interactive menu — see
  [Update/upgrade path](#updateupgrade-path) below; this whole
  detection/menu step is skipped if you're installing from a local checked-out
  copy of the repo that already has `server/`/`client/` present (the "local
  source" flow), since there's nothing to download in that case.
- Otherwise, it downloads the latest tagged release (or falls back to the
  tagged source archive if no pre-built `.zip` asset exists), extracts it to
  `/opt/snapcast-manager`, and re-executes itself from that location with
  the same flags you originally passed.

### Phase 2 — system checks (Steps 1–3 in the script's own numbering)

- **Step 1**: checks for `curl`, `ffmpeg`, `lsb-release`; offers to install
  any that are missing via `apt-get`.
- **Step 2**: checks for `make`/`build-essential`; offers to install it
  (needed for `better-sqlite3`'s native compilation step).
- **Step 3**: checks for Node.js; if missing, offers to install Node 22 via
  NodeSource. If a different version is already present, it's left alone —
  the script only reports what it detected.

Each of these is a `y/n` prompt defaulting to "yes"; `-y` accepts all of
them automatically.

### Phase 3 — dependencies and build (Step 4)

- If `server/dist` and `client/dist` already exist (a pre-built release,
  the normal case for the remote-download path) and there's no
  `.rebuilding` flag file, it skips the build entirely and only runs
  `npm install --omit=dev` in `server/` — this is the fast path the
  project's release process exists to enable.
- Otherwise (source checkout, or a source-archive fallback download that
  set the `.rebuilding` flag) it runs a full build: `npm install` and
  `npm run build` in both `server/` and `client/`. The script's own output
  warns this "may take several minutes."
- If `--restore <path>` was passed, the specified backup archive is
  extracted and its database/`snapserver.conf` are restored at this point
  (Step 4.5).

### Phase 4 — web interface configuration (Step 5)

Prompts for the port the web UI should listen on (default `3000`, skipped
if `--port` was already passed or under `-y`), then writes
`/opt/snapcast-manager/server/.env` with `PORT`, `SNAPCAST_MODE`, and
`NODE_ENV=production`.

### Phase 5 — systemd service setup (Step 6)

This is the privilege-hardening step described in detail in
[`SECURITY.md`](../SECURITY.md#privilege-model-task-16). Offered as a
`y/n` prompt (default yes; `-y` accepts). If accepted, the installer:

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
   `SECURITY.md`).
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

The script prints the URL to open (`http://<detected-local-ip>:<port>`)
and a note that the Setup Wizard will greet you on first visit.

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
`/opt/snapcast-manager` triggers a version check and an interactive menu
(skipped, with different behavior, under `-y` — see below):

- **If a newer version is available** (or the installed version couldn't
  be determined): choose between **Update/Upgrade** (preserves the
  database and `snapserver.conf`, recommended), **Force Re-install**
  (wipes the installed bundle but still backs up data first), **Clean
  Re-install** (wipes everything, starting fresh), **Uninstall**, or
  **Abort**. Under `-y`, this always resolves to **Update/Upgrade** —
  data is preserved automatically.
- **If you're already on the latest version**: the menu instead offers
  **Update/Force Re-install**, **Clean Re-install**, **Uninstall**, or
  **Abort**. Under `-y`, this case **aborts immediately** rather than
  doing anything — re-running the non-interactive installer against an
  already-up-to-date install is a deliberate no-op, not a forced
  reinstall.
- When an update proceeds, the existing service is stopped, the database
  (`data/` or the legacy `server/data/` path) and `/etc/snapserver.conf`
  are backed up to `/tmp`, the install directory is wiped and
  re-populated from the newly downloaded release, and the backups are
  restored into place before the build/systemd steps re-run.

This update flow only applies to the **remote** (curl-piped) install
path. Re-running `scripts/install.sh` from a local checked-out copy of
the repository (where `server/`/`client/` already exist) skips this
detection entirely and goes straight to the build/systemd steps against
whatever is on disk in that checkout — useful for local development, not
the mechanism for updating a production install.

Separately, the **systemd/privilege-hardening step (Phase 5 above) is
itself idempotent and safe to re-run on its own**: re-running the
installer against an already-migrated install detects the unit is
already up to date and makes no changes, and re-running it against an
older, pre-hardening install (unit file missing `User=snapmanager`, or
running as `root`/some other user) migrates it in place with no data
loss.

## Uninstall path

There is no dedicated `--uninstall` command-line flag. Uninstalling is
reached interactively, by re-running the remote one-liner against an
existing install and choosing the **Uninstall** option from the
update-detection menu described above (not available under `-y`, since
`-y` never selects that menu option). Confirming uninstall:

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

## Where to go next

- **[`SECURITY.md`](../SECURITY.md)** — the full privilege model (what the
  `snapmanager` user can and can't do, the sudoers grants, the systemd
  sandbox, and currently-known, disclosed limitations), and the
  real-hardware validation checklist recommended before production use.
- **Troubleshooting** — a dedicated `docs/troubleshooting.md` is planned
  as follow-up work and doesn't exist yet at the time of writing; until
  then, `SECURITY.md` and this document's step-by-step breakdown above
  are the best reference for what a given install phase is supposed to
  do, and the installer's own console output (plus, for the systemd step,
  `journalctl -u snapmanager -n 50 --no-pager`, which the installer runs
  automatically on a failed restart) is the primary diagnostic tool today.
