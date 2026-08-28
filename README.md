# 🎧 Snapcast Manager

<div align="center">
  <img src="https://github.com/user-attachments/assets/086e14f6-6758-4c12-90d9-f31af71524dd" alt="Logo" width="120">

  **A self-hosted web interface to manage, configure, and monitor a [Snapcast](https://github.com/snapcast/snapcast) multi-room audio setup.**

  [![GitHub release (latest by date)](https://img.shields.io/github/v/release/NaturalDevCR/Snapcast-Manager?style=flat-square)](https://github.com/NaturalDevCR/Snapcast-Manager/releases/latest)
  [![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=flat-square)](https://opensource.org/licenses/MIT)
  [![Donate](https://img.shields.io/badge/Donate-PayPal-blue.svg?style=flat-square&logo=paypal)](https://www.paypal.com/paypalme/NaturalCloud)
</div>

---

## 🤔 What is this, and who is it for

Snapcast Manager is a self-hosted web dashboard for [Snapcast](https://github.com/snapcast/snapcast)
multi-room audio. It's for people running a headless Debian/Ubuntu box or a
Raspberry Pi as their audio hub who would rather click through a GUI than
hand-edit `snapserver.conf`, wire up systemd units for `snapclient`/`mpd`/
`shairport-sync` by hand, and SSH in every time something needs a restart.

It runs as a regular systemd service on the same host as your Snapcast
stack (not a cloud service, not a Docker-only tool) and gives you a login-
protected UI to install/update/control that stack, edit its configuration,
route audio sources to output zones, and back up/restore your setup.

---

## ✨ Features

- 🕸️ **Interactive Audio Matrix**: A drag-and-drop interface to route Virtual Sources to Output Zones with real-time visual "cable" animations, kept live via server-sent events.
- 🔊 **Full Snapclient Management**: Install and run multiple `snapclient` instances on the same machine, each tied to a specific ALSA audio output.
- 📦 **UI-Driven Package Manager**: Install, update, or uninstall `snapserver` and `snapclient` directly from the web interface. No terminal required!
- 🎵 **MPD & myMPD Music Player**: Install and manage MPD and the lightweight [myMPD](https://github.com/jcorporation/myMPD) web client from the UI. Open myMPD in one click to control playback, browse playlists, and manage your library. *(myMPD serves its own UI on port 8080 and is **not** behind the manager's login — enable myMPD's PIN/ACL on untrusted networks.)*
- 🎛️ **Visual Config Editor**: Never edit `snapserver.conf` manually again. Toggle all standard Snapcast properties with visual switches. Defaults are pre-populated!
- 🔌 **Audio Source Management**: Easily add, edit, or remove pipes, TCP streams, ALSA inputs, meta streams, and AirPlay sources.
- 🧭 **Guided First-Run Setup**: A Setup Wizard creates the first admin account, followed by a 3-step onboarding flow (install snapserver, add your first audio source, assign your first zone) so a brand-new install has audio playing without reading a manual.
- 🩺 **Self-Diagnostics & Health Panels**: A diagnostics panel surfaces real, actionable findings — unmanaged config entries, orphaned systemd units, FIFOs with no producer, snapserver being down, port conflicts — each with a one-click repair action where a safe one exists. A separate health panel reports snapserver reachability (both systemd and live RPC), config parseability, disk space, and uptime/error metrics.
- 📸 **Snapshots (Backups)**: Create instantly restorable backups of your instances, system state, and configurations, including component-aware backups taken automatically before package installs/updates.
- 🌍 **English/Spanish UI (partial)**: The Dashboard, Login, Setup, Onboarding, and shared layout/navigation are available in English and Spanish, switchable in-app. Most of the remaining views (Routing, Pipe Sources, Server Config, Tools, Watchdogs, Security, Logs, etc.) are still English-only — full coverage is tracked as follow-up work.
- 🛡️ **Secure Admin Access**: Setup Wizard and JWT-based authentication to keep your configuration completely safe.
- 🌓 **Premium Dark/Light UI**: Carefully crafted user experience using Vue 3 and Tailwind CSS, optimized for both desktop and mobile.

---

<img width="400" height="auto" alt="image" src="https://github.com/user-attachments/assets/a9fe0eef-cd9c-41f9-9c63-e64309a55699" />

<img width="400" height="auto" alt="image" src="https://github.com/user-attachments/assets/30ba0850-7181-44bc-b201-e74adbb5c7ec" />

<img width="400" height="auto" alt="image" src="https://github.com/user-attachments/assets/df9b71d8-af84-4726-82a8-563ee4f43ba1" />

<img width="400" height="auto" alt="image" src="https://github.com/user-attachments/assets/186525ea-6fda-4242-a6a8-40a8f3202a35" />

<img width="400" height="auto" alt="image" src="https://github.com/user-attachments/assets/56507eb1-51e4-4af5-80c2-0911e74c0dd6" />

<img width="400" height="auto" alt="image" src="https://github.com/user-attachments/assets/90928d89-339d-4ac4-a91a-4938f907f408" />

---

## 🏗️ Architecture

- **Client**: Vue 3 + Vite + Tailwind CSS, talking to the server over a JSON REST API plus a server-sent-events (SSE) stream for live Snapcast status, jobs, and metrics.
- **Server**: Express on Node.js, written in TypeScript, backed by a `better-sqlite3` database for users, pipe sources, and snapshot metadata (`server/data/snapmanager.db` in local dev; a real install's `NODE_ENV=production` puts it at `/opt/snapcast-manager/data/snapmanager.db` instead).
- **Auth**: JWT-based, issued after the one-time Setup Wizard creates the first admin account.
- **System integration**: the server drives `systemctl`, `apt`/`dpkg`, and config files for `snapserver`, `snapclient`, `mpd`/`myMPD`, and `shairport-sync` (AirPlay) — see the pipe-source/FIFO model below.
- **Audio routing**: pipe sources (radio streams, MPD output, etc.) are FIFOs (`/run/snapcast-manager/*`) each fed by their own generated systemd unit; `snapserver.conf` and the FIFOs are what actually route audio into Snapcast's stream/group model that the UI's matrix visualizes.

## 🔒 Security model

Snapcast Manager needs elevated privileges to manage system services and
packages, but it does not run as root. The installer creates a dedicated,
unprivileged `snapmanager` system account (no login shell) that the service
runs as; privileged operations (installing packages, controlling systemd
units, writing a handful of specific `/etc` config files) go through a
narrowly-scoped `sudo` grant in `/etc/sudoers.d/snapcast-manager`, and the
service's own systemd unit further restricts filesystem access with
`ProtectSystem=strict` and an explicit `ReadWritePaths=` allowlist.

This is a real, currently-imperfect security posture, not a marketing
claim — package-management commands (`apt-get`, `dpkg`, `make`) are
necessarily granted broadly rather than narrowly scoped, which is a
disclosed, accepted limitation, and a past hardening pass briefly (and
unintentionally) broke the entire sudo-based privilege model by adding
`NoNewPrivileges=yes` to the unit, since fixed and now covered by a nightly
automated container test. **Read [`SECURITY.md`](SECURITY.md)
for the full privilege model, its known limitations, and the real-hardware
validation checklist** before exposing this to anything beyond a trusted
LAN.

**This application should not be exposed directly to the public internet**
without a reverse proxy and TLS — see `SECURITY.md`'s threat model for
details.

---

## 🚀 Quick Installation

```bash
curl -sL https://raw.githubusercontent.com/NaturalDevCR/Snapcast-Manager/main/scripts/install.sh | bash
```

> **Note:** To skip all interactive prompts and use default settings, add `-y`:
> `curl -sL https://raw.githubusercontent.com/NaturalDevCR/Snapcast-Manager/main/scripts/install.sh | bash -s -- -y`

That's the quick version. For prerequisites, what each install step actually
does, the update/uninstall paths, and the first-run experience, see the full
**[Installation Guide](docs/installation.md)**.

Once finished, open your browser at `http://<YOUR-SERVER-IP>:3000` (or
whichever port you chose) — the Setup Wizard will greet you on first run.

### Requirements

- **OS**: Linux — Debian, Ubuntu, or Raspberry Pi OS (the installer hard-checks for a Linux host and is written for `apt`-based distros).
- **Node.js**: v22 (the installer installs it via NodeSource if missing; no `engines` constraint is declared in `package.json`, but `install.sh` explicitly installs and is written against Node 22).
- **Privileges**: root, or a user with `sudo`.
- `curl`, `ffmpeg`, and `build-essential` are installed automatically if missing (needed to build the `better-sqlite3` native module).
- Snapserver/Snapclient themselves are **not** installed by the script — install them afterward from the web UI.

---

## 🛠 Local Development

To contribute or test new features locally:

1. **Clone & Install Dependencies**
   ```bash
   git clone https://github.com/NaturalDevCR/Snapcast-Manager.git
   cd Snapcast-Manager

   # Install Backend
   cd server && npm install

   # Install Frontend
   cd ../client && npm install
   ```

2. **Start Development Servers**
   - **Backend**: `cd server && npm run dev` (Port 3000)
   - **Frontend**: `cd client && npm run dev` (Port 5173, proxies to 3000)

> ⚠️ **Never commit the runtime database.** The backend creates a SQLite
> database (`server/data/snapmanager.db` and its `-wal`/`-shm` companions) that
> stores your admin user and its **bcrypt password hash**. These files are
> git-ignored on purpose — committing them leaks credential hashes into the
> repository history. If you ever see a `*.db` file staged, unstage it. The same
> applies to `.env` (which holds `JWT_SECRET`).

---

## 📦 Automated Releases

This project utilizes **GitHub Actions**. Every release is automatically packaged into an optimized `.zip` artifact containing:
- Compiled TypeScript backend.
- Minified and optimized Vue 3 + Vite frontend assets.

This ensures that installation on low-resource devices like the Raspberry Pi Zero is *insanely fast*, as no local compilation is required. Installation itself is also covered by a real, automated container-based integration test (Debian 12 + systemd) that runs nightly and can be triggered on demand.

---

## ❤️ Support & Acknowledgements

Snapcast Manager is built to manage the incredible **[Snapcast](https://github.com/snapcast/snapcast)** project by badaix.

If you find this project useful, please consider supporting its development!

[![Donate via PayPal](https://www.paypalobjects.com/en_US/DK/i/btn/btn_donateCC_LG.gif)](https://www.paypal.com/paypalme/NaturalCloud)

---

## 📄 License

This project is licensed under the [MIT License](LICENSE).
