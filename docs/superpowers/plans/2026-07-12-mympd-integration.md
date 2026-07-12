# myMPD Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users control MPD (playback, playlists, library, config) from Snapcast Manager by managing [myMPD](https://github.com/jcorporation/myMPD) as a package and opening its web UI in a new tab.

**Architecture:** Extend the existing package/service management in `system.ts` + `routes/system.ts` to treat `mympd` as one more managed package (install via OBS APT repo, service control, version). The frontend gains a myMPD Dashboard card and an "Open myMPD" button that launches `http://<host>:<port>`. No proxy, no iframe, no native player.

**Tech Stack:** Node + Express 5 + TypeScript (backend), Vue 3 + Pinia + Tailwind (frontend), `node:test` for unit tests. Zero new npm dependencies.

## Global Constraints

- **No new npm dependencies** — reuse existing patterns (`execAsync`, `getLatestGitHubRelease`, job system).
- **All API routes** sit behind `authenticateToken` (already applied at the router level in `routes/system.ts`).
- **Follow the existing package pattern** verbatim (mirror how `mpd`/`shairport-sync` are handled).
- **Default myMPD port** 8080 (HTTP); SSL not handled this iteration.
- Tests run with `cd server && npm test`; builds with `npm run build` in `server/` and `client/`.

---

### Task 1: `mympdObsRepoDir` pure helper (TDD)

**Files:**
- Modify: `server/src/services/system.ts` (add exported helper near `normalizeVersion`)
- Test: `server/src/services/system.mympd.test.ts`

**Interfaces:**
- Produces: `export function mympdObsRepoDir(id: string, versionId: string): string | null`

- [ ] **Step 1: Write the failing test**

```ts
// server/src/services/system.mympd.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mympdObsRepoDir } from './system';

test('mympdObsRepoDir maps debian to Debian_<major>', () => {
  assert.equal(mympdObsRepoDir('debian', '12'), 'Debian_12');
  assert.equal(mympdObsRepoDir('debian', '12.5'), 'Debian_12');
});

test('mympdObsRepoDir maps raspbian', () => {
  assert.equal(mympdObsRepoDir('raspbian', '11'), 'Raspbian_11');
});

test('mympdObsRepoDir maps ubuntu to xUbuntu_<versionId>', () => {
  assert.equal(mympdObsRepoDir('ubuntu', '24.04'), 'xUbuntu_24.04');
});

test('mympdObsRepoDir is case-insensitive', () => {
  assert.equal(mympdObsRepoDir('Debian', '12'), 'Debian_12');
});

test('mympdObsRepoDir returns null for unsupported/empty', () => {
  assert.equal(mympdObsRepoDir('fedora', '40'), null);
  assert.equal(mympdObsRepoDir('', ''), null);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && npm test`
Expected: FAIL — `mympdObsRepoDir` is not exported.

- [ ] **Step 3: Write minimal implementation**

```ts
// server/src/services/system.ts — add below normalizeVersion()
export function mympdObsRepoDir(id: string, versionId: string): string | null {
  const norm = (id || '').trim().toLowerCase();
  const version = (versionId || '').trim();
  const major = version.split('.')[0];
  if (!major) return null;
  if (norm === 'debian') return `Debian_${major}`;
  if (norm === 'raspbian') return `Raspbian_${major}`;
  if (norm === 'ubuntu') return `xUbuntu_${version}`;
  return null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && npm test`
Expected: PASS (all 5 tests).

- [ ] **Step 5: Commit**

```bash
git add server/src/services/system.ts server/src/services/system.mympd.test.ts
git commit -m "feat(mympd): add OBS repo dir helper with tests"
```

---

### Task 2: Wire myMPD into the system service

**Files:**
- Modify: `server/src/services/system.ts`

**Interfaces:**
- Consumes: `mympdObsRepoDir` (Task 1), existing `runCommand`, `isInstalled`, `getServiceStatus`, `getLatestGitHubRelease`.
- Produces: `installMympd()`, `getMympdInfo(): Promise<{ installed: boolean; running: boolean; port: number }>`; `'mympd'` accepted by all service methods and `PackageName`.

- [ ] **Step 1: Add `'mympd'` to `PackageName`**

```ts
export type PackageName = 'snapserver' | 'snapclient' | 'ffmpeg' | 'shairport-sync' | 'snap-ctrl' | 'node' | 'mpd' | 'mympd';
```

- [ ] **Step 2: Dispatch install + add `installMympd()`**

In `installPackage`, after the `mpd` branch:

```ts
    if (pkg === 'mympd') {
      return this.installMympd();
    }
```

Add the method (after `installMpd`):

```ts
  private async installMympd(): Promise<string> {
    const { stdout: osRelease } = await execAsync('cat /etc/os-release');
    const id = (osRelease.match(/^ID=(.*)$/m)?.[1] || '').replace(/"/g, '').trim();
    const versionId = (osRelease.match(/^VERSION_ID=(.*)$/m)?.[1] || '').replace(/"/g, '').trim();
    const repoDir = mympdObsRepoDir(id, versionId);
    if (!repoDir) {
      throw new Error(`Unsupported distro for automatic myMPD install (ID=${id}, VERSION_ID=${versionId}). See https://jcorporation.github.io/myMPD/#/010-installation`);
    }
    const baseUrl = `https://download.opensuse.org/repositories/home:/jcorporation/${repoDir}`;
    const cmd = `
      ${this.SUDO}apt-get update && \
      ${this.SUDO}apt-get install -y curl gpg && \
      ${this.SUDO}mkdir -p /etc/apt/keyrings && \
      curl -fsSL ${baseUrl}/Release.key | gpg --dearmor | ${this.SUDO}tee /etc/apt/keyrings/mympd.gpg >/dev/null && \
      echo "deb [signed-by=/etc/apt/keyrings/mympd.gpg] ${baseUrl}/ /" | ${this.SUDO}tee /etc/apt/sources.list.d/mympd.list >/dev/null && \
      ${this.SUDO}apt-get update && \
      ${this.SUDO}apt-get install -y mympd && \
      ${this.SUDO}systemctl enable mympd && \
      ${this.SUDO}systemctl restart mympd && \
      echo "myMPD installed and started successfully."
    `;
    return this.runCommand(cmd);
  }
```

- [ ] **Step 3: Uninstall branch**

In `uninstallPackage`, after the `mpd` branch:

```ts
    if (pkg === 'mympd') {
      const cmd = `
        ${this.SUDO}systemctl stop mympd 2>/dev/null || true && \
        ${this.SUDO}systemctl disable mympd 2>/dev/null || true && \
        ${this.SUDO}apt-get remove --purge -y mympd && \
        ${this.SUDO}rm -f /etc/apt/sources.list.d/mympd.list /etc/apt/keyrings/mympd.gpg && \
        echo "myMPD removed successfully."
      `;
      return this.runCommand(cmd);
    }
```

- [ ] **Step 4: Version detection**

In `getPackageVersion`'s switch, add:

```ts
        case 'mympd':
          cmd = 'mympd --version 2>&1 | head -n 1';
          break;
```

In `getLatestAvailableVersion`, before the `apt-cache policy` fallback:

```ts
      if (pkg === 'mympd') {
        const release = await this.getLatestGitHubRelease('jcorporation', 'myMPD');
        return normalizeVersion(release.tag_name);
      }
```

- [ ] **Step 5: Service-method unions + dashboard arrays**

Add `| 'mympd'` to the `service:` param union in: `getServiceStatus`, `getServiceLogs`, `restartService`, `startService`, `stopService`, `enableService`, `disableService`.

In `getDashboardMetrics`:

```ts
    const packages: PackageName[] = ['snapserver', 'snapclient', 'ffmpeg', 'shairport-sync', 'snap-ctrl', 'node', 'mpd', 'mympd'];
    const services = ['snapserver', 'snapclient', 'shairport-sync', 'mpd', 'mympd'] as const;
```

- [ ] **Step 6: `getMympdInfo()`**

Add (near `getServiceStatus`):

```ts
  async getMympdInfo(): Promise<{ installed: boolean; running: boolean; port: number }> {
    const installed = await this.isInstalled('mympd');
    const running = installed ? (await this.getServiceStatus('mympd')) === 'active' : false;
    let port = 8080;
    try {
      const { stdout } = await execAsync('cat /var/lib/mympd/config/http_port 2>/dev/null');
      const parsed = parseInt(stdout.trim(), 10);
      if (Number.isFinite(parsed) && parsed > 0) port = parsed;
    } catch { /* keep default 8080 */ }
    return { installed, running, port };
  }
```

- [ ] **Step 7: Build + commit**

Run: `cd server && npm run build`
Expected: no TypeScript errors.

```bash
git add server/src/services/system.ts
git commit -m "feat(mympd): manage myMPD as a package in system service"
```

---

### Task 3: System routes — allowlists + `/mympd-info`

**Files:**
- Modify: `server/src/routes/system.ts`

**Interfaces:**
- Consumes: `systemService.getMympdInfo()` (Task 2).
- Produces: `GET /system/mympd-info` → `{ installed, running, port }`.

- [ ] **Step 1: Add `'mympd'` to every allowlist**

- `/status/:service` and `/logs/:service`: add `&& service !== 'mympd'` to the guard.
- `/service/:action/:service`: add `&& service !== 'mympd'`.
- `/installed/:pkg`, `/install/:pkg`, `/update/:pkg`, `/uninstall/:pkg`: add `&& pkg !== 'mympd'`.
- `VALID_PACKAGES`: append `'mympd'`.

Example (status guard):

```ts
    if (service !== 'snapserver' && service !== 'snapclient' && service !== 'shairport-sync' && service !== 'snapmanager' && service !== 'librespot' && service !== 'mpd' && service !== 'mympd') {
        return res.status(400).json({ error: 'Invalid service name' });
    }
```

- [ ] **Step 2: Add the `/mympd-info` route**

After the `/dashboard` route:

```ts
router.get('/mympd-info', async (_req: Request, res: Response) => {
    try {
        const info = await systemService.getMympdInfo();
        res.json(info);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});
```

- [ ] **Step 3: Build + commit**

Run: `cd server && npm run build`
Expected: no TypeScript errors.

```bash
git add server/src/routes/system.ts
git commit -m "feat(mympd): expose mympd routes and /mympd-info"
```

---

### Task 4: Frontend system store

**Files:**
- Modify: `client/src/stores/system.ts`

**Interfaces:**
- Produces: store fields `mympdStatus`, `mympdPort`, `mympdRunning`, getter `mympdUrl`, action `fetchMympdInfo()`; `'mympd'` accepted by `checkStatus`/`checkInstalled`/`controlService`/`installPackage`/`updatePackage`/`uninstallPackage`.

- [ ] **Step 1: State**

Add `mympd` keys to `installedPackages` (`'mympd': false`), `packageVersions` (`'mympd': ''`), `availableVersions` (`'mympd': ''`). Add refs:

```ts
  const mympdStatus = ref('unknown');
  const mympdPort = ref(8080);
  const mympdRunning = ref(false);
```

- [ ] **Step 2: Widen unions + labels**

Add `| 'mympd'` to the `service`/`pkg` param unions of `checkStatus`, `checkInstalled`, `controlService`, `installPackage`, `updatePackage`, `uninstallPackage`. In `checkStatus` add `if (service === 'mympd') mympdStatus.value = data.status;`. In `controlService`, extend the label ternary with `service === 'mympd' ? 'myMPD' :`. In install/update/uninstall labels add `pkg === 'mympd' ? 'myMPD' :`.

- [ ] **Step 3: `fetchMympdInfo` + `mympdUrl`**

```ts
  async function fetchMympdInfo() {
    try {
      const data = await fetchApi('/system/mympd-info');
      if (typeof data.port === 'number') mympdPort.value = data.port;
      mympdRunning.value = !!data.running;
      installedPackages.value['mympd'] = !!data.installed;
    } catch (err) {
      console.error('Failed to fetch myMPD info:', err);
    }
  }

  const mympdUrl = computed(() => `http://${window.location.hostname}:${mympdPort.value}`);
```

Add `computed` to the `vue` import. In `refreshAll`, after the mpd status line: `if (data.statuses['mympd']) mympdStatus.value = data.statuses['mympd'];`

- [ ] **Step 4: Export**

Add `mympdStatus, mympdPort, mympdRunning, mympdUrl, fetchMympdInfo` to the store's return object.

- [ ] **Step 5: Build + commit**

Run: `cd client && npm run build`
Expected: no type errors.

```bash
git add client/src/stores/system.ts
git commit -m "feat(mympd): add myMPD state to system store"
```

---

### Task 5: Dashboard myMPD card + Open button

**Files:**
- Modify: `client/src/views/Dashboard.vue`

**Interfaces:**
- Consumes: `systemStore.installedPackages.mympd`, `mympdStatus`, `mympdRunning`, `mympdUrl`, `fetchMympdInfo`, `controlService`, `installPackage`, `updatePackage`, `uninstallPackage`.

- [ ] **Step 1: Extend the script unions + fetch**

In `handleUpdate` and `handleUninstall`, add `'mympd'` to the `pkg` union type. Ensure `fetchMympdInfo()` is called wherever the dashboard loads data (alongside `refreshAll()` in `onMounted`).

- [ ] **Step 2: Add the card**

Clone the existing `mpd`/`shairport-sync` card block, replacing the package key with `mympd`, the title with "myMPD", using `systemStore.mympdStatus` for the service badge and `systemStore.controlService('start'|'stop'|'restart', 'mympd')` for the buttons, and `systemStore.installPackage('mympd')` / `handleUpdate('mympd', ...)` / `handleUninstall('mympd')` for package actions.

- [ ] **Step 3: Add the Open button**

Inside the card, shown only when running:

```vue
<button
  v-if="systemStore.installedPackages['mympd'] && systemStore.mympdRunning"
  @click="() => window.open(systemStore.mympdUrl, '_blank', 'noopener')"
  class="w-full px-4 py-3 bg-brand-primary hover:bg-brand-primary/80 text-white rounded-xl font-black uppercase tracking-widest text-xs border border-brand-primary/50 transition-all active:scale-95">
  <span class="material-symbols-outlined text-[1rem] mr-1 align-middle">open_in_new</span>
  Open myMPD
</button>
```

(If `window` is not directly usable in template, add a `const openMympd = () => window.open(systemStore.mympdUrl, '_blank', 'noopener')` method and call `openMympd`.)

- [ ] **Step 4: Build + commit**

Run: `cd client && npm run build`
Expected: no type errors.

```bash
git add client/src/views/Dashboard.vue
git commit -m "feat(mympd): add myMPD card and Open button to dashboard"
```

---

### Task 6: "Open myMPD" in Tools mpd-config tab

**Files:**
- Modify: `client/src/views/Tools.vue`

- [ ] **Step 1: Add the button next to "Restart MPD"**

In the `mpd-config` tab, add an `openMympd` method (`window.open(systemStore.mympdUrl, '_blank', 'noopener')`) and a button shown when `systemStore.installedPackages['mympd'] && systemStore.mympdRunning`. Ensure `systemStore.fetchMympdInfo()` runs when the tab opens (in the existing `switchTab`/`loadMpdConfig` flow).

- [ ] **Step 2: Build + commit**

Run: `cd client && npm run build`
Expected: no type errors.

```bash
git add client/src/views/Tools.vue
git commit -m "feat(mympd): add Open myMPD button to Tools mpd-config tab"
```

---

### Task 7: Docs + final verification

**Files:**
- Modify: `README.md` (Features list mentions myMPD management + security note)

- [ ] **Step 1: README note**

Add a bullet under Features noting myMPD can be installed/managed and opened from the UI, and a one-line security note that myMPD on `:8080` is not behind the manager's JWT (enable myMPD's PIN/ACL on untrusted networks).

- [ ] **Step 2: Full verification**

```bash
cd server && npm test && npm run build
cd ../client && npm run build
```
Expected: tests pass, both builds succeed.

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs(mympd): document myMPD management and security note"
```

---

## Self-Review

**Spec coverage:**
- Manage myMPD as a package → Task 2 ✅
- myMPD Dashboard card → Task 5 ✅
- "Open myMPD" button (installed + active only) → Tasks 5, 6 ✅
- `GET /system/mympd-info` → Task 3 ✅
- OBS repo derivation + tests → Tasks 1, 2 ✅
- Version (installed + latest) → Task 2 ✅
- Service control free via unions → Tasks 2, 3, 4 ✅
- Security note documented → Task 7 ✅
- "Configure it" two-layer (myMPD UI + existing raw editor) → no code needed; covered by existing Tools tab ✅

**Placeholder scan:** none — all steps carry concrete code/commands.

**Type consistency:** `mympdObsRepoDir(id, versionId): string | null`, `getMympdInfo(): { installed, running, port }`, `mympdUrl` (computed string), `fetchMympdInfo()` — names consistent across backend Tasks 2–3 and frontend Tasks 4–6.
