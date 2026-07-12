# myMPD Integration — Design Spec

**Date:** 2026-07-12
**Status:** Approved
**Branch:** `feat/mympd-integration`

## Goal

Let users manage MPD from Snapcast Manager beyond install/uninstall/update:
control playback, view playlists/queue, browse the library, and configure it —
by **delegating the rich player experience to [myMPD](https://github.com/jcorporation/myMPD)**,
a mature, lightweight MPD web client, and managing it as one more package.

This is "Approach ③" (delegate to an existing MPD web client) chosen as the fast,
low-risk first step. Building a native player (Approach ①/②) is explicitly out of scope.

## Context: what already exists

MPD is already partially managed in the codebase; the new work is small:

- **Install / uninstall / update / version** — `server/src/services/system.ts`
  (`installMpd`, `uninstallPackage`, `getPackageVersion`).
- **Service control** (start/stop/restart/enable/disable/status/logs) — already
  accepts `'mpd'` across those methods; surfaced via `systemStore.controlService(...)`.
- **Raw `mpd.conf` editor** — `client/src/views/Tools.vue` "mpd-config" tab, via
  `/tools/mpd-config`.

What MPD lacks today and myMPD provides out of the box: **playback control, queue,
playlists, and library browsing with cover art.**

## Decisions

| Question | Decision |
|---|---|
| How to manage MPD control/playlists | Delegate to **myMPD** (Approach ③) |
| Delivery | **All at once** (single plan) |
| How to surface the myMPD UI | **"Open myMPD" button** → opens `http://<host>:<port>` in a new tab |

## Scope

### In scope

1. **Manage myMPD as a package** (backend), mirroring the existing package pattern.
2. **A myMPD card** in the Dashboard (install / version / update / service control).
3. **An "Open myMPD" button** (shown only when installed **and** service active).
4. **A `GET /system/mympd-info` endpoint** returning `{ installed, running, port }`.

### Out of scope

- Reverse-proxy or iframe embedding of myMPD.
- Building a native player / MPD-protocol client.
- HTTPS/SSL detection for myMPD (assume default HTTP on port 8080; note as future work).
- Editing `mpd.conf` beyond the existing raw editor.

## Architecture

### Backend — `server/src/services/system.ts`

- Add `'mympd'` to the `PackageName` union and to **every** service-name union
  (`getServiceStatus`, `getServiceLogs`, `restartService`, `startService`,
  `stopService`, `enableService`, `disableService`).
- Add `'mympd'` to the `packages` and `services` arrays in `getDashboardMetrics`.
- `installPackage` dispatch: `if (pkg === 'mympd') return this.installMympd()`.
- **`installMympd()`**: add myMPD's official openSUSE Build Service (OBS) APT repo,
  `apt-get install -y mympd`, then enable + start `mympd.service`. Mirrors the
  repo-add style of `updateNodeJs()`.
  - The OBS repo path is derived from `/etc/os-release` `ID` + `VERSION_ID` via a
    **pure helper** `mympdObsRepoDir(id, versionId)`:
    - `debian` → `Debian_<major>` (e.g. `Debian_12`)
    - `raspbian` → `Raspbian_<major>`
    - `ubuntu` → `xUbuntu_<versionId>` (e.g. `xUbuntu_24.04`)
    - anything else → `null` (installMympd throws a clear "unsupported distro,
      see myMPD docs" error).
  - Raspberry Pi OS reports `ID=debian`; that maps to `Debian_<major>`, whose OBS
    project publishes armhf/arm64 builds, so it works on the Pi.
  - Base repo URL: `https://download.opensuse.org/repositories/home:/jcorporation/<dir>/`.
    Key: `<baseurl>/Release.key`. **The exact repo layout must be verified against
    myMPD's current install docs during implementation** (OBS paths can change).
- `uninstallPackage` dispatch: `mympd` → stop + disable `mympd.service`, `apt-get
  remove --purge -y mympd`.
- `mapToComponent('mympd')` → `'general'` (myMPD keeps its own config; not part of
  the snapserver/snapclient backup set).
- `getPackageVersion('mympd')` → `mympd --version` (normalized by existing logic).
- `getLatestAvailableVersion('mympd')` → `getLatestGitHubRelease('jcorporation','myMPD')`
  `tag_name`.
- `isInstalled('mympd')` → falls through to the generic `dpkg -s mympd` path.
- **`getMympdInfo()`**: returns `{ installed, running, port }`.
  - `installed` = `isInstalled('mympd')`.
  - `running` = `getServiceStatus('mympd') === 'active'`.
  - `port` = integer read from `/var/lib/mympd/config/http_port`, trimmed; fallback `8080`.

### Backend — `server/src/routes/system.ts`

- Add `'mympd'` to the allowlists in: `/status/:service`, `/logs/:service`,
  `/service/:action/:service`, `/installed/:pkg`, `/install/:pkg`, `/update/:pkg`,
  `/uninstall/:pkg`, and the `VALID_PACKAGES` array (covers `/version` and
  `/check-updates`).
- New route `GET /mympd-info` → `res.json(await systemService.getMympdInfo())`.
  (Behind the existing `authenticateToken` middleware applied at the router level.)

### Frontend — `client/src/stores/system.ts`

- Add `mympd: false` to `installedPackages`, and `mympd: ''` to `packageVersions`
  and `availableVersions`.
- Add `mympdStatus = ref('unknown')`; populate it in `checkStatus`, `controlService`,
  and `refreshAll` (from `data.statuses['mympd']`).
- Widen the `service`/`pkg` union types in `checkStatus`, `checkInstalled`,
  `controlService`, `installPackage`, `updatePackage`, `uninstallPackage` to include
  `'mympd'`, and add friendly labels ("myMPD").
- Add `mympdPort = ref(8080)` and `mympdRunning = ref(false)`; a `fetchMympdInfo()`
  action that GETs `/system/mympd-info`; and a `mympdUrl` getter that returns
  `http://${window.location.hostname}:${mympdPort.value}`.

### Frontend — `client/src/views/Dashboard.vue`

- Add a **myMPD package card** cloned from the existing pattern (e.g. the
  shairport-sync / mpd cards): installed badge, version, update button (uses
  `handleUpdate`/`handleUninstall` — extend their `pkg` union types to include
  `'mympd'`), and start/stop/restart via `systemStore.controlService(..., 'mympd')`.
- On the card, an **"Open myMPD ↗"** button, shown only when
  `installedPackages.mympd && mympdRunning`, that does
  `window.open(systemStore.mympdUrl, '_blank', 'noopener')`.
- Call `fetchMympdInfo()` where the dashboard refreshes.

### Frontend — `client/src/views/Tools.vue`

- In the existing **mpd-config** tab, next to "Restart MPD", add the same
  **"Open myMPD ↗"** button (same visibility rule) so it sits where users manage MPD.

## Data flow

```
User clicks "Install myMPD"
  → POST /system/install/mympd  → job: installMympd() (adds OBS repo, apt install, enable+start)
User sees card: installed=yes, service=active, version
  → GET /system/mympd-info → { installed:true, running:true, port:8080 }
User clicks "Open myMPD ↗"
  → window.open("http://<host>:8080") → myMPD's own UI handles playback/playlists/library
```

## "Configure it" coverage

- **Runtime MPD settings** (outputs enable/disable, crossfade, replaygain, DB update,
  volume): handled inside myMPD's own settings UI via the MPD protocol.
- **Static `mpd.conf`** (music_directory, `audio_output` blocks, bind): stays in the
  existing Tools → mpd-config raw editor.

## Security note (accepted tradeoff)

myMPD listens on `:8080` and is reachable on the LAN **without** Snapcast Manager's
JWT — the "Open in new tab" surface does not proxy through our auth. myMPD ships its
own optional session/PIN + ACL. We document that users on untrusted networks should
enable myMPD's protection. (Reverse-proxy — Approach's option that puts myMPD behind
our JWT — remains available as future work.)

## Testing

- **Unit test** (`server/src/services/system.mympd.test.ts`, `node:test` style like
  `snapConfigEdit.test.ts`) for the pure helper `mympdObsRepoDir(id, versionId)`:
  - `('debian','12')` → `'Debian_12'`
  - `('raspbian','11')` → `'Raspbian_11'`
  - `('ubuntu','24.04')` → `'xUbuntu_24.04'`
  - `('debian','12.5')` → `'Debian_12'` (major only)
  - `('fedora','40')` → `null`
- **Type/build check**: `cd server && npm run build`; `cd client && npm run build`.
- **Manual smoke** (documented, not run in CI): on a Debian test host, install myMPD
  from the card, confirm service active, "Open myMPD" opens the client.

## Assumptions

- A single MPD + single myMPD instance on the same host as Snapcast Manager.
- Everything behind the existing JWT auth for the Snapcast Manager API surface.
- Live updates keep using polling (no new websocket infra) — consistent with the app.
