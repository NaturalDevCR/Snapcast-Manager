# Troubleshooting

This guide is organized **by symptom**, not by internal implementation
detail. Every specific failure mode below traces to something that was
actually encountered and fixed (or explicitly disclosed as a known
limitation) in this project's history — not generic "check your logs"
advice. The two built-in, automated self-diagnosis tools come first; most
of the time they will tell you exactly what is wrong before you need any
manual step.

## 1. Start here: built-in health & diagnostics

Before doing anything by hand, open the app's own diagnostics:

- **Diagnostics page** — `/diagnostics` (nav group **Sistema → Diagnostics**).
  It runs 5 real, independent checks and only reports *things to fix*:
  `unmanaged-config` (a pipe source in `snapserver.conf` the app isn't
  tracking), `orphaned-unit` (a leftover systemd unit with no matching pipe
  source), `fifo-no-producer` (a FIFO with nothing feeding it),
  `snapserver-down`, and `port-occupied`. Every finding that has a safe,
  automated fix shows a **Repair** button backed by a real existing API
  endpoint; the rest show honest manual instructions. An empty findings
  list means healthy.
- **System Health card** — on the Dashboard, fed by `GET /api/health/detail`.
  It shows two deliberately distinct snapserver signals (systemd unit
  active vs. live RPC connected — a restart can briefly have one but not
  the other), config parseability, disk space, and uptime/error metrics.

The same data is available over the API:

```bash
# Public liveness probe (no auth): "is the process up and reaching its DB"
curl -s http://<your-server-ip>:3000/api/health
# {"status":"ok"}

# Full report (authenticated — send the JWT you got from POST /api/auth/login):
curl -s -H "Authorization: Bearer <token>" http://<your-server-ip>:3000/api/health/detail

# Diagnostics findings (authenticated):
curl -s -H "Authorization: Bearer <token>" http://<your-server-ip>:3000/api/diagnostics
```

Both `/api/health/detail` and `/api/diagnostics` are authenticated; the
panels in the UI already carry that token for you.

---

## 2. Installation issues

`scripts/install.sh` fails loudly (it runs under `set -e`), so a non-zero
exit or an aborted run is a real failure, not a soft warning. Common
cases:

**"This script requires root privileges or sudo to be installed."**
Run it as root or as a user with passwordless `sudo`. The installer needs
elevation for everything it does.

**"This script is intended for Linux systems only."**
It is written for Debian/Ubuntu/Raspberry Pi OS (`apt`-based, `systemd`).
There is no supported macOS/Windows path.

**"[!] No TTY available for input. Aborting."**
The interactive menu needs a terminal. On a fully headless box use the
non-interactive flag:

```bash
curl -sL https://raw.githubusercontent.com/NaturalDevCR/Snapcast-Manager/main/scripts/install.sh | bash -s -- -y
```

**Missing prerequisites (`curl`, `ffmpeg`, `lsb-release`, `build-essential`, and on the remote flow `wget`/`unzip`).**
The installer detects each and prompts to install it via `apt-get`. If you
decline, it aborts — re-run with `-y` to accept every default. Node.js is
handled the same way: if `node` isn't found it offers to install Node 22
via NodeSource.

**Already-installed detection / upgrade flow.**
A re-run against an existing remote install detects the old version and
presents a menu: **Update/Force Re-install** (preserves database and
settings), **Clean Re-install** (wipes everything), **Uninstall**, or
**Abort**. Two non-obvious behaviors worth knowing:

- Under `-y`, the "already running the latest version" branch **aborts**
  rather than reinstalling — `-y` does not force a refresh of an
  up-to-date install.
- This whole menu only exists on the remote (curl-piped) flow. Running
  `install.sh` from a local source checkout skips it.

**"Pre-built asset \<version\> not found. Falling back to tagged source code..."**
The GitHub release for that tag has no attached `.zip`; the installer
falls back to the tagged source archive. If that also fails, the tag
doesn't exist — the version came from the latest-release API, so check
network/GitHub reachability from the host.

**A failed install left something behind.**
The installer is idempotent and transactional against the live systemd
unit: on the remote flow it wipes `/opt/snapcast-manager` and re-extracts,
and if the new hardened unit fails to start it restores the previous unit
file and restarts the service under it, printing the old unit's backup
path if even that rollback fails. In every case the correct retry is
simply to **re-run the installer** — it detects whatever state exists and
continues from there.

**Uninstalling.**
There is no dedicated `--uninstall` flag; uninstall is reached through the
interactive update-detection menu described above. It removes the
`snapmanager.service` unit, the `/etc/sudoers.d/snapcast-manager` grant,
and the app files under `/opt/snapcast-manager`. It deliberately **keeps**
the `snapmanager` system account (standard practice for system accounts;
remove it manually with `userdel snapmanager` if you really want it gone)
and asks before deleting the database.

---

## 3. Everything fails with a sudo/permission error

This is the single most important failure class in this project's history,
because one past hardening change broke it *completely* and silently.

**Background.** Every privileged action this app performs — installing or
removing any package, starting/stopping any systemd unit, every privileged
config write — goes through a scoped `sudo` grant in
`/etc/sudoers.d/snapcast-manager`. One early hardening pass added
`NoNewPrivileges=yes` to the generated `snapmanager.service` unit. That
directive disables setuid-based privilege escalation for the entire
process tree — **including `sudo` itself** — so it made *every* sudo call
fail with exit code 1 and no stderr, regardless of what the sudoers file
granted. It was found by real container integration testing and removed.
If you installed an older release (or a regression ever reintroduces it),
this is what it looks like:

**Symptoms.** Every privileged action fails at once: package install/update
from the UI fails, config writes fail, service restarts fail — but the app
itself still runs fine and unprivileged things still work. The job log
typically shows a sudo failure (`sudo exited with code 1`), and nothing in
the journal explains why because `sudo` fails before it even logs.

**Verify it.** From a root shell on the host:

```bash
# 1. Is the service actually running as the unprivileged 'snapmanager' user?
systemctl show snapmanager -p User --value
#   expect:  snapmanager   (anything else = pre-Task-16 install, see below)

# 2. Can 'snapmanager' actually escalate via sudo from inside the unit's sandbox?
#    This is the exact probe this repo's own regression-guard test uses.
runuser -u snapmanager -- sudo -n systemctl daemon-reload && echo "sudo works"
```

Reading the second command's result correctly is important:

- **Exit 0** — sudo escalation works; your problem is something else.
- **Silent exit 1, no output** — the `NoNewPrivileges`-class regression:
  sudo cannot escalate at all from inside the unit. An old install, or a
  reintroduced `NoNewPrivileges=yes`.
- **`sudo: a password is required`** — a *different* problem: sudo *can*
  escalate in principle but this specific command isn't matched by the
  sudoers grant (e.g. a binary path that doesn't resolve on this distro, a
  stale sudoers file, or `Defaults requiretty` set globally). Do not
  conflate the two — the password-required message specifically means the
  NoNewPrivileges issue is *not* what's wrong.

For old-version hangs where the service won't even start, also check:

```bash
systemctl status snapmanager --no-pager -l
journalctl -u snapmanager -n 100 --no-pager
```

A *fresh* install of an older release could also fail to start with a
mount-namespace error (`Failed to set up mount namespacing: ... No such
file or directory`, `Failed at step NAMESPACE`). That's the related
pre-Task-65 bug where some `ReadWritePaths=` targets (`/etc/mpd.conf`,
`/var/lib/mpd`, `/etc/snapserver.conf.bak`, and others) were never
pre-created before the unit's first start — systemd hard-fails on a
missing target rather than auto-creating it. Current `scripts/install.sh`
pre-creates every target; older releases did not.

**Fix.** Re-run the *current* `scripts/install.sh`. It rewrites the unit
without `NoNewPrivileges=yes`, pre-creates every `ReadWritePaths=` target,
and — for a pre-Task-16 install whose unit still runs as root or another
user — migrates it to `snapmanager`, transactionally: if the new
configuration fails to start, the previous unit is restored and the
service is restarted under it rather than being left down. A second run
against an already-correct install performs no writes and no restart.

The full privilege model, its real limitations, and the real-hardware
validation checklist are documented in [`SECURITY.md`](../SECURITY.md)
("Privilege model"). Read it before treating any sudo behavior as
unexpected.

---

## 4. snapserver / snapclient not starting

Start with the **System Health card** on the Dashboard (or
`GET /api/health/detail`): it reports snapserver's systemd unit state and
live RPC-connection state as two separate signals. If either is down, the
**Diagnostics** page's `snapserver-down` finding offers a one-click
"Restart snapserver" repair.

Manual checks (root shell on the host):

```bash
systemctl status snapserver --no-pager -l
journalctl -u snapserver -n 100 --no-pager
```

If snapserver is systemd-active but the health panel shows RPC not
connected, it is mid-restart — give it a few seconds and refresh before
assuming a problem.

**snapclient nuance.** On this app, the default `snapclient.service` is
**stopped and disabled on purpose** after install — snapclient is managed
as per-instance units named `snapclient-manager-<id>.service`. Seeing
`snapclient.service` inactive is normal; check the instance units instead:

```bash
systemctl status 'snapclient-manager-*.service'
```

**Package installed but its service never became active.**
After a package install/update the app waits briefly (a few seconds of
polling) for the service to come up. If it never does, it reports the
failure and, when a real pre-install backup exists, **automatically rolls
back** the package's configuration from that backup — the job log states
exactly what happened, including whether a rollback was (or could not be)
attempted. Read the job log entry for that install; it names the unit that
failed and the backup filename if one was restored. If the rollback *also*
fails, the job log says manual intervention is required.

---

## 5. Pipe sources / audio not routing

Radio/MPD pipe sources are FIFOs under `/run/snapcast-manager/`, each fed
by its own generated systemd unit named `snapcast-radio-<name>.service`.

**The most common cause is a FIFO with no producer** — the app's own
diagnostics has a dedicated category for exactly this
(`fifo-no-producer`): the FIFO exists on disk but its unit is not active,
so nothing is writing audio into it. On the **Diagnostics** page this
finding has a one-click **"Start this pipe source"** repair
(`POST /api/pipe-sources/:id/control` with `{"action":"start"}`). Prefer
that over doing it by hand — it is the same action the UI's own pipe
source controls use.

If you want to inspect manually:

```bash
systemctl status 'snapcast-radio-*.service'
journalctl -u 'snapcast-radio-<name>.service' -n 100 --no-pager
# The FIFO directory itself:
ls -la /run/snapcast-manager/
```

Two things worth knowing:

- `/run/snapcast-manager/` is ephemeral by design (tmpfs-backed `/run`).
  The generated units recreate it (and the FIFOs) in their own
  `ExecStartPre`, so it normally reappears whenever a pipe source starts.
  Its not surviving a reboot is a disclosed, not-yet-fixed gap — if audio
  is dead right after a reboot, the Diagnostics page's `fifo-no-producer`
  finding (or a manual `systemctl start snapcast-radio-<name>.service`)
  is the way back.
- A **port-occupied** or **unmanaged-config** finding can also cause "no
  audio": another process holding snapserver's configured port, or a
  `pipe://` source in `snapserver.conf` the app doesn't track. Both appear
  on the Diagnostics page with an explanation and (for unmanaged config)
  an "Adopt this pipe source" repair.

---

## 6. myMPD

myMPD serves **its own web UI on port 8080** (configurable via
`/var/lib/mympd/config/http_port`) and that UI is **not** behind this
app's login. Anyone who can reach the host's port 8080 can reach myMPD
directly.

- On a trusted LAN this is the intended design. Before exposing anything
  beyond that, follow the threat model in [`SECURITY.md`](../SECURITY.md):
  do not expose the manager (or myMPD) directly to the public internet —
  put it behind a reverse proxy with TLS. myMPD also has its own PIN/ACL
  feature (see the README's myMPD note); on untrusted networks enable it
  rather than relying on the manager's login to protect myMPD's port.
- **"Unsupported distro for automatic myMPD install"** is a real error
  from the install path: automatic install only covers distros myMPD's OBS
  repository publishes for (Debian/Raspbian/Ubuntu). For anything else,
  install myMPD by hand following its own documentation
  (`https://jcorporation.github.io/myMPD/`) and it will still be detected
  and manageable by this app.

---

## 7. Backup / restore issues

There are two distinct backup systems — know which one you're using:

**Snapshots** (UI: **Server Config → Snapshots** tab). A simple,
single-file backup of `/etc/snapserver.conf`, copied to
`server/snapshots/` on the host. Create, restore, and delete are
`POST /api/snapshots`, `POST /api/snapshots/:id/restore`,
`DELETE /api/snapshots/:id`. Real failure messages from this path:

- `Snapshot file missing or permission denied` — the snapshot file is gone
  or unreadable; restore cannot proceed.
- `Snapshot not found` — bad id (it was deleted, or a stale page).
- `Could not read /etc/snapserver.conf...` — the source config wasn't
  readable when the snapshot was created (does the file exist? are
  permissions correct?).

Note: restoring a snapshot rewrites the config file but does **not** by
itself restart snapserver. If you restore an older config, restart
snapserver (UI service control, or `POST /api/system/service/restart/snapserver`)
so the running server picks it up.

**Component-aware backups** (`/var/backups/snapmanager/`,
`pre-<component>-<timestamp>.tar.gz`). Taken automatically before package
installs/updates and used by the auto-rollback described in section 4.
Managed through the job-based package endpoints (`POST /api/system/install/:pkg`,
`/api/system/update/:pkg`) and `POST /api/system/backups/restore`.

- **A backup failure aborts the operation before it touches the system.**
  The job log will say something like "Pre-install backup for \<pkg\>
  failed; aborting the install before touching the system". That is
  deliberate: the install is cancelled because there would be nothing to
  roll back to.
- **Known, disclosed limitation (current releases):** `tar` is *not* in
  the sudoers grant, and the backup service runs `tar` through `sudo`, so
  on a hardened install component-aware backups fail with a sudo error
  (`sudo: a password is required`). The practical effect: package
  installs/updates that take a pre-install backup are **aborted before
  touching the system** ("Pre-install backup for \<pkg\> failed; aborting
  the install before touching the system"), and a manual restore via
  `POST /api/system/backups/restore` fails the same way. This is a real,
  tracked gap from the container-integration work — see the Task 65
  ledger entry and `task-65-report.md` under `.superpowers/sdd/`. The
  manager's *snapshot* mechanism above does not use `tar` and still works;
  the package auto-rollback path does not.

---

## 8. Where to get more help

- Open an issue at the GitHub repository's issues page:
  <https://github.com/NaturalDevCR/Snapcast-Manager/issues>
- [`CONTRIBUTING.md`](../CONTRIBUTING.md) — how to build, test, and
  contribute.
- [`SECURITY.md`](../SECURITY.md) — the full privilege model, its
  disclosed limitations, and the real-hardware validation checklist.
- [`docs/installation.md`](installation.md) — install/update/uninstall
  details.
- [`README.md`](../README.md) — overview, features, architecture.

**UI language note:** the interface is a bilingual *pilot* — the login,
setup wizard, onboarding wizard, Dashboard, and shared layout/navigation
are English/Spanish (switchable in-app). Most other views (Routing, Pipe
Sources, Server Config, Tools, Security, Watchdogs, Logs, Diagnostics,
etc.) are English-only; this is tracked as follow-up work, not an omission
you should report as a bug.