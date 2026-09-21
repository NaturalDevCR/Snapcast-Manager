# Scheduled Disaster-Recovery Backups Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every backup this app produces always includes snapserver's persistent state (`server.json`), and admins can configure a recurring daily/weekly backup from the UI that captures everything needed for a full disaster-recovery restore.

**Architecture:** `BackupService` (`server/src/services/backup.ts`) gains a cross-cutting state source and a second, independently-retained backup type (`createScheduledBackup()`, `scheduled-*.tar.gz` under its own subdirectory). A new `BackupScheduleService` (`server/src/services/backupSchedule.ts`), built on the same load/save/interval shape as `WatchdogService`, owns the schedule config, computes the next run time, and ticks a `setInterval` that calls `createScheduledBackup()` when due. New routes expose config CRUD + a manual "run now"; the existing `/backups` list, restore, delete, and download routes are extended to understand both backup types. `Tools.vue` gets a schedule panel next to the existing backup list.

**Tech Stack:** TypeScript (Node/Express backend, Vue 3 + vue-i18n frontend), `node --test` (via `ts-node/register`), no new dependencies.

## Global Constraints

- No new npm dependencies — plain `Date` arithmetic for scheduling, `setInterval` for the timer, matching `WatchdogService`.
- Every privileged filesystem command goes through `platform/exec.ts`'s argv-based `run()`, sudo-gated via `needsSudo()` — no shell string interpolation anywhere (repo-wide rule; enforced by `scripts/check-no-shell-injection.sh`).
- Test files that stub module-exported functions (`execModule.run`/`needsSudo`, or bind functions onto `fs`/`fs/promises` module objects) need the `// @ts-nocheck` + explanatory header, per `backup.test.ts`'s and `watchdog.test.ts`'s existing header comment (a `node --test --import ts-node/register` type-stripping bug). Test files that only use plain function calls and object literals do **not** need it.
- Commit messages use Conventional Commits prefixes (`feat:`, `fix:`, `test:`, `chore:`) per `CONTRIBUTING.md`.
- Run `cd server && npm test` and `npm run lint` (repo root) before every commit that touches `server/src` or `client/src`.

---

### Task 1: Always include snapserver state in every backup

**Files:**
- Modify: `server/src/services/backup.ts:170-192` (`collectSources()`)
- Test: `server/src/services/backup.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `collectSources()`'s cross-cutting sources array now always contains `/var/lib/snapserver` (used by every later task that lists/creates backups).

- [ ] **Step 1: Write the failing test**

Add to `server/src/services/backup.test.ts`, near the existing `collectSources()`-behavior tests (search the file for `CROSS_CUTTING_SOURCES` to find that section):

```ts
test('collectSources() includes /var/lib/snapserver for every component, not just snapserver', async () => {
  const service = new BackupService();
  const nonSnapserverComponents: BackupComponent[] = ['mpd', 'mympd', 'shairport-sync', 'snapclient', 'snap-ctrl', 'ffmpeg', 'node'];
  for (const component of nonSnapserverComponents) {
    const { sources } = (service as any).collectSources(component);
    assert.ok(
      sources.includes('/var/lib/snapserver'),
      `component '${component}' must include /var/lib/snapserver (snapserver state) in its backup sources`,
    );
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && npm test -- --test-name-pattern "collectSources"`
Expected: FAIL — `/var/lib/snapserver` is only present for `component === 'snapserver'`/`'general'` today, not for `mpd`/`mympd`/etc.

- [ ] **Step 3: Move `/var/lib/snapserver` into the cross-cutting block**

In `server/src/services/backup.ts`, change:

```ts
    // ---- cross-cutting: every component ----
    sources.push(dbDir);
    components.push('snapmanager-data');
    sources.push(WATCHDOGS_CONFIG_DIR);
    components.push('snapmanager-config');
    dynamicUnitPatterns.push(/^snapcast-radio-.*\.service$/);

    // ---- snapserver: /etc/snapserver.conf* (already there) plus the
    // daemon's own persistent data directory (server.json -- volumes,
    // client/group state) and its single-slot rotating backup file, both
    // confirmed real via system.ts's own executeDebUpdate()/setup code,
    // which creates, chowns, and purges /var/lib/snapserver, and
    // config.ts's SNAPSERVER_CONFIG_BAK. ----
    if (component === 'snapserver' || includeAll) {
      sources.push(
        '/etc/snapserver.conf',
        '/etc/snapserver.conf.base',
        '/etc/snapserver.conf.d',
        '/etc/snapserver.conf.bak',
        '/var/lib/snapserver',
      );
      components.push('snapserver-config');
    }
```

to:

```ts
    // ---- cross-cutting: every component ----
    sources.push(dbDir);
    components.push('snapmanager-data');
    sources.push(WATCHDOGS_CONFIG_DIR);
    components.push('snapmanager-config');
    // snapserver's own persistent data directory (server.json -- volumes,
    // client/group state -- plus its single-slot rotating backup file),
    // confirmed real via system.ts's own executeDebUpdate()/setup code,
    // which creates, chowns, and purges /var/lib/snapserver. Moved out of
    // the snapserver-only branch below: this is STATE, and every backup
    // (whatever component triggered it) should be able to restore it --
    // losing zone/group/volume state to a same-day mpd update would be a
    // silent regression a user would only discover much later.
    sources.push('/var/lib/snapserver');
    components.push('snapmanager-data');
    dynamicUnitPatterns.push(/^snapcast-radio-.*\.service$/);

    // ---- snapserver: /etc/snapserver.conf* only -- /var/lib/snapserver
    // (state) moved to the cross-cutting block above. ----
    if (component === 'snapserver' || includeAll) {
      sources.push(
        '/etc/snapserver.conf',
        '/etc/snapserver.conf.base',
        '/etc/snapserver.conf.d',
        '/etc/snapserver.conf.bak',
      );
      components.push('snapserver-config');
    }
```

Note: `components.push('snapmanager-data')` is called a second time here (once for `dbDir`, once for `/var/lib/snapserver`) — harmless, `collectSources()` already de-dupes via `Array.from(new Set(components))` before returning. Reusing the existing `'snapmanager-data'` label (rather than inventing a new one) keeps `listBackups()`'s `components` array free of a component tag `verifyServiceOrRollback()` in `system.ts` doesn't already know about.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && npm test -- --test-name-pattern "collectSources"`
Expected: PASS

- [ ] **Step 5: Run the full backup test suite to check for regressions**

Run: `cd server && npm test -- --test-name-pattern "backup"`
Expected: PASS — in particular, any existing test asserting the exact `sources`/`components` array for `component: 'snapserver'` must still pass (the set of paths for `'snapserver'` is unchanged, just reorganized between the two blocks).

- [ ] **Step 6: Commit**

```bash
git add server/src/services/backup.ts server/src/services/backup.test.ts
git commit -m "$(cat <<'EOF'
fix(backup): always include snapserver state in every backup

/var/lib/snapserver (server.json + its rotating .bak) was only backed
up when the triggering component was snapserver/general. Move it into
collectSources()'s cross-cutting block so a pre-update backup for any
component (mpd, mympd, snapclient, ...) carries the current state too.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Include snapserver state in the manual export endpoint

**Files:**
- Modify: `server/src/routes/system.ts` (the `GET /export` handler, currently around line 236)
- Test: `server/src/routes/system.export.test.ts` (new)

**Interfaces:**
- Consumes: nothing new.
- Produces: `buildExportTargets(opts: { dataDirExists: boolean; confFileExists: boolean; snapserverStateExists: boolean }): string[]` — exported pure function, used by both the route and its test.

`GET /api/system/export` builds its `tar` argv from three independent `fs.existsSync` checks. Pulling the "which targets given what exists" decision into its own pure function makes it unit-testable without a real filesystem, an Express app, or spawning `tar` — matching the pattern `computeNextRunAt()` uses in Task 4.

- [ ] **Step 1: Write the failing test**

Create `server/src/routes/system.export.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildExportTargets } from './system';

test('buildExportTargets() includes /var/lib/snapserver (state) when it exists', () => {
  const targets = buildExportTargets({ dataDirExists: true, confFileExists: true, snapserverStateExists: true });
  assert.deepEqual(targets, [
    '-C', '/opt/snapcast-manager', 'data',
    '-C', '/etc', 'snapserver.conf',
    '-C', '/var', 'lib/snapserver',
  ]);
});

test('buildExportTargets() omits /var/lib/snapserver when it does not exist', () => {
  const targets = buildExportTargets({ dataDirExists: true, confFileExists: true, snapserverStateExists: false });
  assert.deepEqual(targets, [
    '-C', '/opt/snapcast-manager', 'data',
    '-C', '/etc', 'snapserver.conf',
  ]);
});

test('buildExportTargets() returns an empty array when nothing exists', () => {
  const targets = buildExportTargets({ dataDirExists: false, confFileExists: false, snapserverStateExists: false });
  assert.deepEqual(targets, []);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && npm test -- --test-name-pattern "buildExportTargets"`
Expected: FAIL — `buildExportTargets` is not exported from `./system` yet.

- [ ] **Step 3: Extract and export `buildExportTargets()`, and use it in the route**

In `server/src/routes/system.ts`, replace the `GET /export` handler body:

```ts
router.get('/export', authenticateToken, (req: Request, res: Response) => {
    const backupName = `snapcast-backup-${Date.now()}.tar.gz`;
    res.setHeader('Content-disposition', `attachment; filename="${backupName}"`);
    res.setHeader('Content-type', 'application/gzip');
    
    // We want to tar /opt/snapcast-manager/data and /etc/snapserver.conf
    const dataDir = '/opt/snapcast-manager/data';
    const confFile = '/etc/snapserver.conf';
    
    const targets: string[] = [];
    if (fs.existsSync(dataDir)) {
        targets.push('-C', '/opt/snapcast-manager', 'data');
    }
    if (fs.existsSync(confFile)) {
        targets.push('-C', '/etc', 'snapserver.conf');
    }

    if (targets.length === 0) {
        return res.status(404).json({ error: 'No backup data found.' });
    }
```

with:

```ts
// Pure decision function ("which tar -C targets, given what exists on
// disk"), pulled out of the route handler so it's unit-testable without a
// real filesystem or a spawned tar process -- see system.export.test.ts.
export function buildExportTargets(opts: {
    dataDirExists: boolean;
    confFileExists: boolean;
    snapserverStateExists: boolean;
}): string[] {
    const targets: string[] = [];
    if (opts.dataDirExists) {
        targets.push('-C', '/opt/snapcast-manager', 'data');
    }
    if (opts.confFileExists) {
        targets.push('-C', '/etc', 'snapserver.conf');
    }
    if (opts.snapserverStateExists) {
        // snapserver's persistent state directory (server.json -- volumes,
        // client/group state). Same path services/backup.ts's
        // collectSources() backs up cross-cuttingly (Task 1) -- the manual
        // export was a second, independent code path that missed it.
        targets.push('-C', '/var', 'lib/snapserver');
    }
    return targets;
}

router.get('/export', authenticateToken, (req: Request, res: Response) => {
    const backupName = `snapcast-backup-${Date.now()}.tar.gz`;
    res.setHeader('Content-disposition', `attachment; filename="${backupName}"`);
    res.setHeader('Content-type', 'application/gzip');

    const targets = buildExportTargets({
        dataDirExists: fs.existsSync('/opt/snapcast-manager/data'),
        confFileExists: fs.existsSync('/etc/snapserver.conf'),
        snapserverStateExists: fs.existsSync('/var/lib/snapserver'),
    });

    if (targets.length === 0) {
        return res.status(404).json({ error: 'No backup data found.' });
    }
```

The rest of the handler (the `spawn('tar', ...)` call onward) is unchanged.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && npm test -- --test-name-pattern "buildExportTargets"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/src/routes/system.ts server/src/routes/system.export.test.ts
git commit -m "$(cat <<'EOF'
fix(backup): include snapserver state in manual export

GET /api/system/export only tarred /opt/snapcast-manager/data and
/etc/snapserver.conf, missing /var/lib/snapserver (server.json).
Extracts the target-selection logic into a pure, unit-tested
buildExportTargets() and adds the state directory as a third target.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Scheduled backup creation, retention, and backup-name resolution

**Files:**
- Modify: `server/src/services/backup.ts`
- Test: `server/src/services/backup.test.ts`

**Interfaces:**
- Consumes: `collectSources('general')`, `resolveExistingSources()`, `this.privileged()` (all existing, unchanged).
- Produces (used by Task 4 and Task 5):
  - `BackupService.createScheduledBackup(retainCount: number): Promise<BackupResult>`
  - `BackupService.listBackups(): Promise<BackupEntry[]>` — `BackupEntry` gains `type: 'pre-update' | 'scheduled'`.
  - `BackupService.restoreBackup(name: string): Promise<string>` and `deleteBackup(name: string): Promise<void>` — unchanged signatures, now accept `scheduled-*` names too.
  - `resolveBackupPath(name: string): string` — exported standalone function, throws `Error('Invalid backup name format')` on no match. Used by Task 5's download route.

- [ ] **Step 1: Write the failing tests**

Add to `server/src/services/backup.test.ts` (uses the existing `stubRun`/`stubNeedsSudo`/`stubModuleFn` helpers already defined near the top of the file):

```ts
import { resolveBackupPath } from './backup';

test('resolveBackupPath() resolves a pre-update name under BACKUP_DIR', () => {
  assert.equal(
    resolveBackupPath('pre-snapserver-20260101-120000.tar.gz'),
    `${BACKUP_DIR}/pre-snapserver-20260101-120000.tar.gz`,
  );
});

test('resolveBackupPath() resolves a scheduled name under BACKUP_DIR/scheduled', () => {
  assert.equal(
    resolveBackupPath('scheduled-20260101-120000.tar.gz'),
    `${BACKUP_DIR}/scheduled/scheduled-20260101-120000.tar.gz`,
  );
});

test('resolveBackupPath() rejects a name matching neither pattern', () => {
  assert.throws(() => resolveBackupPath('../../etc/passwd'), /Invalid backup name format/);
  assert.throws(() => resolveBackupPath('scheduled-not-a-timestamp.tar.gz'), /Invalid backup name format/);
});

// createScheduledBackup() drives collectSources('general') -- the
// union-of-everything scope -- so unlike a single-component
// createPreUpdateBackup() test, it isn't worth enumerating every fixed
// source individually here (that's already covered per-component by the
// existing createPreUpdateBackup() tests above, and 'general' is proven to
// be their union by the collectSources() tests near the top of this file).
// This helper just pretends every fixed source exists so resolveExistingSources()
// finds a non-empty set and createScheduledBackup() actually reaches tar --
// same "pretend everything exists" shape as the /^pre-/ tests' `access`
// stub, minus needing to enumerate which specific paths satisfy the assertion.
function stubGeneralBackupFs(scheduledDirEntries: string[] = []): () => void {
  const scheduledDir = `${BACKUP_DIR}/scheduled`;
  const restores = [
    stubModuleFn(fsPromisesDefault, 'access', async () => {}), // every fixed source "exists"
    stubModuleFn(fsPromisesDefault, 'readdir', async (dir: string) => {
      if (dir === SYSTEMD_DIR) return [];
      if (dir === scheduledDir) return scheduledDirEntries;
      throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    }),
    stubModuleFn(fsPromisesDefault, 'stat', async () => ({ size: 4096 })),
  ];
  return () => restores.forEach(r => r());
}

test('createScheduledBackup() tars into BACKUP_DIR/scheduled with a scheduled-* name', async () => {
  const calls: Call[] = [];
  const restoreRun = stubRun(calls);
  const restoreSudo = stubNeedsSudo(false);
  const restoreFs = stubGeneralBackupFs();
  try {
    const service = new BackupService();
    const result = await service.createScheduledBackup(7);
    assert.match(result.fileName, /^scheduled-\d{8}-\d{6}\.tar\.gz$/);
    assert.equal(result.path, `${BACKUP_DIR}/scheduled/${result.fileName}`);
    const tarCall = calls.find(c => c.bin === 'tar');
    assert.ok(tarCall, 'tar must be invoked');
    assert.ok(tarCall!.args.includes(result.path), 'tar must archive into the scheduled subdirectory');
  } finally {
    restoreFs();
    restoreRun();
    restoreSudo();
  }
});

test('createScheduledBackup() prunes only within the scheduled subdirectory, honoring retainCount', async () => {
  const scheduledDir = `${BACKUP_DIR}/scheduled`;
  const calls: Call[] = [];
  const restoreRun = stubRun(calls);
  const restoreSudo = stubNeedsSudo(false);
  const restoreFs = stubGeneralBackupFs([
    'scheduled-20260101-000000.tar.gz',
    'scheduled-20260102-000000.tar.gz',
    'scheduled-20260103-000000.tar.gz',
  ]);
  try {
    const service = new BackupService();
    await service.createScheduledBackup(2); // retain 2 of the 3 pre-existing + the new one
    const rmCalls = calls.filter(c => c.bin === 'rm');
    assert.ok(
      rmCalls.some(c => c.args.includes(`${scheduledDir}/scheduled-20260101-000000.tar.gz`)),
      'the oldest scheduled backup beyond retainCount must be removed',
    );
    assert.ok(
      !rmCalls.some(c => c.args.some(a => a.startsWith(`${BACKUP_DIR}/pre-`))),
      'pruning must never touch the pre-update pool',
    );
  } finally {
    restoreFs();
    restoreRun();
    restoreSudo();
  }
});

test('listBackups() tags entries with their type and reads both pools', async () => {
  const restoreReaddir = stubModuleFn(fsPromisesDefault, 'readdir', async (dir: string) => {
    if (dir === BACKUP_DIR) return ['pre-snapserver-20260101-120000.tar.gz'];
    if (dir === `${BACKUP_DIR}/scheduled`) return ['scheduled-20260102-090000.tar.gz'];
    throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
  });
  const restoreStat = stubModuleFn(fsPromisesDefault, 'stat', async () => ({
    size: 42,
    mtime: new Date('2026-01-01T00:00:00.000Z'),
  }));
  const restoreRun = stubRun([]);
  const restoreSudo = stubNeedsSudo(false);
  try {
    const service = new BackupService();
    const entries = await service.listBackups();
    const preUpdate = entries.find(e => e.name === 'pre-snapserver-20260101-120000.tar.gz');
    const scheduled = entries.find(e => e.name === 'scheduled-20260102-090000.tar.gz');
    assert.equal(preUpdate?.type, 'pre-update');
    assert.equal(scheduled?.type, 'scheduled');
  } finally {
    restoreReaddir();
    restoreStat();
    restoreRun();
    restoreSudo();
  }
});

test('deleteBackup() accepts a scheduled-* name and resolves it under the scheduled subdirectory', async () => {
  const calls: Call[] = [];
  const restoreRun = stubRun(calls);
  const restoreSudo = stubNeedsSudo(false);
  try {
    const service = new BackupService();
    await service.deleteBackup('scheduled-20260101-120000.tar.gz');
    const rmCall = calls.find(c => c.bin === 'rm');
    assert.ok(rmCall!.args.includes(`${BACKUP_DIR}/scheduled/scheduled-20260101-120000.tar.gz`));
  } finally {
    restoreRun();
    restoreSudo();
  }
});

test('restoreBackup() rejects a scheduled-* name whose backup file does not exist, via the same resolveBackupPath() path resolution', async () => {
  const restoreRun = stubRun([]);
  const restoreSudo = stubNeedsSudo(false);
  const restoreAccess = stubModuleFn(fsPromisesDefault, 'access', async () => {
    throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' }); // "not found" -- proves it looked in the RIGHT (scheduled) path and found nothing, not that it looked in the wrong path and got lucky
  });
  try {
    const service = new BackupService();
    await assert.rejects(
      service.restoreBackup('scheduled-20260101-120000.tar.gz'),
      /scheduled-20260101-120000\.tar\.gz not found/,
    );
  } finally {
    restoreAccess();
    restoreRun();
    restoreSudo();
  }
});
```

(`Call`, `BACKUP_DIR`, `stubRun`, `stubNeedsSudo`, `stubModuleFn`, `fsPromisesDefault` are all already defined/imported at the top of `backup.test.ts` — reuse them, don't redeclare. Add `const SCHEDULED_BACKUP_DIR = \`${BACKUP_DIR}/scheduled\`;` alongside the file's other duplicated-literal consts (`SYSTEMD_DIR`, `MYMPD_CONFIG_DIR`, etc.) if any test above references it directly instead of inlining `` `${BACKUP_DIR}/scheduled` ``.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd server && npm test -- --test-name-pattern "resolveBackupPath|createScheduledBackup|listBackups\(\) tags|deleteBackup\(\) accepts a scheduled|restoreBackup\(\) rejects a scheduled"`
Expected: FAIL — none of `resolveBackupPath`, `createScheduledBackup`, the `scheduled/` subdirectory handling, or the `type` field exist yet.

- [ ] **Step 3: Implement**

In `server/src/services/backup.ts`, add near the top (after the existing `const MAX_BACKUPS = 15;`):

```ts
const SCHEDULED_BACKUP_DIR = `${BACKUP_DIR}/scheduled`;
const MAX_SCHEDULED_BACKUPS_FALLBACK = 7; // only used if a caller ever omits retainCount

const PRE_UPDATE_NAME_RE = /^pre-[a-z\-]+-\d{8}-\d{6}\.tar\.gz$/;
const SCHEDULED_NAME_RE = /^scheduled-\d{8}-\d{6}\.tar\.gz$/;

/**
 * Resolves a backup file name to its full path, validating it against
 * BOTH known naming schemes -- the original `pre-<component>-<ts>.tar.gz`
 * (lives directly under BACKUP_DIR) and the new
 * `scheduled-<ts>.tar.gz` (lives under BACKUP_DIR/scheduled). Exported so
 * routes/system.ts's download route can resolve+validate the same way
 * restoreBackup()/deleteBackup() do below, instead of duplicating the
 * regex/path logic a third time.
 */
export function resolveBackupPath(name: string): string {
  if (PRE_UPDATE_NAME_RE.test(name)) return `${BACKUP_DIR}/${name}`;
  if (SCHEDULED_NAME_RE.test(name)) return `${SCHEDULED_BACKUP_DIR}/${name}`;
  throw new Error('Invalid backup name format');
}
```

Update the `BackupEntry` interface:

```ts
export interface BackupEntry {
  name: string;
  size: number;
  mtime: string;
  components: string[];
  type: 'pre-update' | 'scheduled';
}
```

Add `ensureScheduledBackupDir()` right after the existing `ensureBackupDir()`:

```ts
  private async ensureScheduledBackupDir(): Promise<void> {
    await this.privileged('mkdir', ['-p', SCHEDULED_BACKUP_DIR]);
  }
```

Add `createScheduledBackup()` right after `createPreUpdateBackup()`:

```ts
  /**
   * Full disaster-recovery backup: reuses collectSources('general') -- the
   * same union-of-everything scope the 'general' BackupComponent already
   * produces for an unrecognized package -- so a scheduled backup always
   * covers every managed component's config plus the manager's own
   * data/config and snapserver's state (Task 1 moved that into the
   * cross-cutting block collectSources() always includes).
   *
   * Stored under its own SCHEDULED_BACKUP_DIR subdirectory with its own
   * retainCount-based retention (caller-supplied, from
   * BackupScheduleService's persisted config), independent of
   * createPreUpdateBackup()'s MAX_BACKUPS=15 pool -- a burst of scheduled
   * runs can never evict a recent pre-update backup, or vice versa.
   */
  async createScheduledBackup(retainCount: number = MAX_SCHEDULED_BACKUPS_FALLBACK): Promise<BackupResult> {
    await this.ensureScheduledBackupDir();

    const { sources, components, dynamicUnitPatterns } = this.collectSources('general');
    const existing = await this.resolveExistingSources(sources, dynamicUnitPatterns);

    if (existing.length === 0) {
      console.warn('[backup] No existing files to back up for scheduled backup; skipping.');
      return {
        path: '',
        fileName: '',
        size: 0,
        timestamp: this.formatTimestamp(),
        components,
        files: [],
      };
    }

    const fileName = `scheduled-${this.formatTimestamp()}.tar.gz`;
    const fullPath = `${SCHEDULED_BACKUP_DIR}/${fileName}`;

    const archiveArgs: string[] = ['czf', fullPath, '--absolute-names', ...existing];
    await this.privileged('tar', archiveArgs);
    await this.privileged('chmod', ['600', fullPath]);

    const stat = await fs.stat(fullPath).catch(() => null);
    if (!stat) throw new Error(`Backup file ${fullPath} could not be stat'd`);

    await this.cleanupOldScheduledBackups(retainCount);

    console.log(`[backup] Created scheduled backup ${fullPath} (${stat.size} bytes) covering: ${components.join(', ')}`);

    return {
      path: fullPath,
      fileName,
      size: stat.size,
      timestamp: this.formatTimestamp(),
      components,
      files: existing,
    };
  }

  /** Same sort-by-filename-then-slice approach as cleanupOldBackups(),
   * scoped to SCHEDULED_BACKUP_DIR and driven by the caller-supplied
   * retainCount instead of the fixed MAX_BACKUPS. */
  private async cleanupOldScheduledBackups(retainCount: number): Promise<void> {
    try {
      const files = await fs.readdir(SCHEDULED_BACKUP_DIR);
      const backups = files.filter(f => SCHEDULED_NAME_RE.test(f)).sort();
      if (backups.length > retainCount) {
        const toDelete = backups.slice(0, backups.length - retainCount);
        for (const f of toDelete) {
          await this.privileged('rm', ['-f', `${SCHEDULED_BACKUP_DIR}/${f}`]).catch(() => {});
        }
      }
    } catch (err) {
      console.warn('[backup] Scheduled backup cleanup failed:', err);
    }
  }
```

Replace `listBackups()`:

```ts
  async listBackups(): Promise<BackupEntry[]> {
    const [preUpdate, scheduled] = await Promise.all([
      this.listBackupsIn(BACKUP_DIR, PRE_UPDATE_NAME_RE, 'pre-update'),
      this.listBackupsIn(SCHEDULED_BACKUP_DIR, SCHEDULED_NAME_RE, 'scheduled'),
    ]);
    return [...preUpdate, ...scheduled].sort((a, b) => b.mtime.localeCompare(a.mtime));
  }

  private async listBackupsIn(dir: string, nameRe: RegExp, type: BackupEntry['type']): Promise<BackupEntry[]> {
    if (type === 'pre-update') await this.ensureBackupDir();
    else await this.ensureScheduledBackupDir();
    try {
      const files = await fs.readdir(dir);
      const result: BackupEntry[] = [];
      for (const f of files) {
        if (!nameRe.test(f)) continue;
        const fullPath = `${dir}/${f}`;
        const stat = await fs.stat(fullPath).catch(() => null);
        if (!stat) continue;
        const componentMatch = f.match(/^pre-([a-z\-]+)-/);
        result.push({
          name: f,
          size: stat.size,
          mtime: stat.mtime.toISOString(),
          components: componentMatch ? [componentMatch[1]] : [],
          type,
        });
      }
      return result;
    } catch {
      return [];
    }
  }
```

Update `restoreBackup()` and `deleteBackup()` to use `resolveBackupPath()` instead of their own inline regex + string-concat path:

```ts
  async restoreBackup(backupName: string): Promise<string> {
    const fullPath = resolveBackupPath(backupName);
    if (!(await this.pathExists(fullPath))) {
      throw new Error(`Backup ${backupName} not found`);
    }
    // ... unchanged staging/tar/cp logic below ...
```

```ts
  async deleteBackup(backupName: string): Promise<void> {
    const fullPath = resolveBackupPath(backupName);
    await this.privileged('rm', ['-f', fullPath]);
  }
```

(Delete the two now-redundant `if (!/^pre-[a-z\-]+-\d{8}-\d{6}\.tar\.gz$/.test(backupName)) { throw ... }` blocks these methods had — `resolveBackupPath()` already throws the identical message on a non-match.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd server && npm test -- --test-name-pattern "backup"`
Expected: PASS — including every pre-existing `backup.test.ts` test (restore/delete/list behavior for `pre-*` names must be byte-for-byte unchanged).

- [ ] **Step 5: Commit**

```bash
git add server/src/services/backup.ts server/src/services/backup.test.ts
git commit -m "$(cat <<'EOF'
feat(backup): add scheduled backups with their own retention pool

createScheduledBackup() produces scheduled-<ts>.tar.gz under
/var/backups/snapmanager/scheduled/, scoped to collectSources('general')
for full disaster-recovery coverage, with caller-supplied retainCount
pruning independent of the pre-update pool's MAX_BACKUPS. listBackups(),
restoreBackup(), and deleteBackup() now understand both backup types via
the new exported resolveBackupPath().

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: `BackupScheduleService` — config, next-run computation, timer

**Files:**
- Create: `server/src/services/backupSchedule.ts`
- Test: `server/src/services/backupSchedule.test.ts`

**Interfaces:**
- Consumes: `WATCHDOGS_CONFIG_DIR` (from `./watchdog`), `backupService.createScheduledBackup(retainCount: number): Promise<BackupResult>` (from `./backup`, Task 3).
- Produces (used by Task 5):
  - `export interface BackupScheduleConfig { enabled: boolean; frequency: 'daily' | 'weekly'; dayOfWeek?: number; time: string; retainCount: number; lastRunAt?: string; nextRunAt?: string; }`
  - `export function computeNextRunAt(config: Pick<BackupScheduleConfig, 'frequency' | 'dayOfWeek' | 'time'>, from: Date): Date`
  - `export class BackupScheduleService` with `getConfig()`, `updateConfig(update)`, `runNow()`, `start()`, `stop()`.

- [ ] **Step 1: Write the failing tests**

Create `server/src/services/backupSchedule.test.ts`. This file's `stubModuleFn` helper binds a function onto a module-exported object (`backupModule.backupService`'s `createScheduledBackup`, and `BackupScheduleService.prototype`'s `ensureConfig`) — the same `node --test --import ts-node/register` type-stripping bug `backup.test.ts`/`watchdog.test.ts` already work around, so this file needs the identical `@ts-nocheck` header:

```ts
// eslint-disable-next-line @typescript-eslint/ban-ts-comment -- deliberate, see explanation below
// @ts-nocheck
//
// Why: see server/src/services/watchdog.test.ts's identical header for the
// full investigation into the `node --test --import ts-node/register`
// parameter-type-stripping bug this pragma works around -- this file's
// `stubModuleFn` helper (binding functions onto backupModule.backupService
// and BackupScheduleService.prototype) hits the same bug. Correctness is
// independently confirmed with real type-checking via:
//   npx tsc --noEmit --strict --target es2020 --module commonjs \
//     --esModuleInterop --skipLibCheck src/services/backupSchedule.test.ts
// This does not affect `npm run build` (test files are excluded from
// tsconfig's project) or the production `services/backupSchedule.ts` file,
// which has no such pragma.
//
// computeNextRunAt() deliberately works in the process's LOCAL time zone
// (the design's "server local time" schedule field -- see this file's
// design doc) via Date's setHours()/getDay(), not UTC. That makes this
// test's exact-ISO-string assertions dependent on whatever time zone the
// process running `npm test` happens to be in, unless pinned. Node reads
// `process.env.TZ` when it first touches local-time Date behavior, so this
// MUST be set before anything in this file (including the `./backupSchedule`
// import two lines below, transitively) constructs or reads a Date --
// pinning it here makes the test deterministic on every machine/CI runner
// regardless of its real configured time zone, while the actual production
// code still correctly uses whatever real time zone the deployed host has.
process.env.TZ = 'UTC';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, unlinkSync } from 'fs';
import * as path from 'path';
import * as os from 'os';
import { BackupScheduleService, BackupScheduleConfig, computeNextRunAt } from './backupSchedule';
import * as backupModule from './backup';

function stubModuleFn(mod: any, key: string, impl: (...args: any[]) => any): () => void {
  const original = mod[key];
  mod[key] = impl;
  return () => {
    mod[key] = original;
  };
}

// ---- computeNextRunAt(): pure function, no I/O, no service instance ----

test('computeNextRunAt() daily: returns later today when the time has not passed yet', () => {
  const from = new Date('2026-09-20T10:00:00.000Z');
  const next = computeNextRunAt({ frequency: 'daily', time: '15:30' }, from);
  assert.equal(next.toISOString(), '2026-09-20T15:30:00.000Z');
});

test('computeNextRunAt() daily: returns tomorrow when the time already passed today', () => {
  const from = new Date('2026-09-20T20:00:00.000Z');
  const next = computeNextRunAt({ frequency: 'daily', time: '03:00' }, from);
  assert.equal(next.toISOString(), '2026-09-21T03:00:00.000Z');
});

test('computeNextRunAt() weekly: returns the next matching day of week', () => {
  // 2026-09-20 is a Sunday (dayOfWeek 0).
  const from = new Date('2026-09-20T10:00:00.000Z');
  const next = computeNextRunAt({ frequency: 'weekly', dayOfWeek: 3, time: '02:00' }, from); // next Wednesday
  assert.equal(next.toISOString(), '2026-09-23T02:00:00.000Z');
});

test('computeNextRunAt() weekly: rolls to next week when today matches but the time already passed', () => {
  const from = new Date('2026-09-20T10:00:00.000Z'); // Sunday, 10:00
  const next = computeNextRunAt({ frequency: 'weekly', dayOfWeek: 0, time: '03:00' }, from);
  assert.equal(next.toISOString(), '2026-09-27T03:00:00.000Z');
});

test('computeNextRunAt() weekly: throws without a valid dayOfWeek', () => {
  assert.throws(
    () => computeNextRunAt({ frequency: 'weekly', time: '03:00' }, new Date()),
    /dayOfWeek/,
  );
});

test('computeNextRunAt() throws on a malformed time string', () => {
  assert.throws(
    () => computeNextRunAt({ frequency: 'daily', time: '9:00' }, new Date()),
    /Invalid time/,
  );
});

// ---- BackupScheduleService: real temp-file config, stubbed backupService.createScheduledBackup ----

function newServiceWithTempConfig(initial?: Partial<BackupScheduleConfig>): { service: BackupScheduleService; configPath: string; restore: () => void } {
  const configPath = path.join(
    os.tmpdir(),
    `backup-schedule-test-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.json`,
  );
  if (initial !== undefined) {
    writeFileSync(configPath, JSON.stringify(initial, null, 2), 'utf-8');
  }
  const proto = BackupScheduleService.prototype as any;
  const original = proto.ensureConfig;
  proto.ensureConfig = async () => configPath;
  const service = new BackupScheduleService();
  const restore = () => {
    proto.ensureConfig = original;
    service.stop();
    try {
      unlinkSync(configPath);
    } catch {
      // never written / already gone -- fine.
    }
  };
  return { service, configPath, restore };
}

test('getConfig() returns disabled defaults when no config file exists yet', async () => {
  const { service, restore } = newServiceWithTempConfig(undefined);
  try {
    await (service as any).ready;
    const config = await service.getConfig();
    assert.equal(config.enabled, false);
    assert.equal(config.frequency, 'daily');
    assert.equal(config.retainCount, 7);
  } finally {
    restore();
  }
});

test('updateConfig() persists settings and computes nextRunAt when enabling', async () => {
  const { service, restore } = newServiceWithTempConfig(undefined);
  try {
    await (service as any).ready;
    const updated = await service.updateConfig({ enabled: true, frequency: 'daily', time: '04:00', retainCount: 5 });
    assert.equal(updated.enabled, true);
    assert.equal(updated.retainCount, 5);
    assert.ok(updated.nextRunAt, 'nextRunAt must be set once enabled');
    const reloaded = await service.getConfig();
    assert.equal(reloaded.nextRunAt, updated.nextRunAt);
  } finally {
    restore();
  }
});

test('updateConfig() clears nextRunAt when disabling', async () => {
  const { service, restore } = newServiceWithTempConfig({ enabled: true, frequency: 'daily', time: '04:00', retainCount: 5, nextRunAt: '2026-01-01T00:00:00.000Z' });
  try {
    await (service as any).ready;
    const updated = await service.updateConfig({ enabled: false, frequency: 'daily', time: '04:00', retainCount: 5 });
    assert.equal(updated.enabled, false);
    assert.equal(updated.nextRunAt, undefined);
  } finally {
    restore();
  }
});

test('updateConfig() rejects an invalid time', async () => {
  const { service, restore } = newServiceWithTempConfig(undefined);
  try {
    await (service as any).ready;
    await assert.rejects(
      service.updateConfig({ enabled: true, frequency: 'daily', time: 'not-a-time', retainCount: 5 }),
      /Invalid time/,
    );
  } finally {
    restore();
  }
});

test('updateConfig() rejects weekly without dayOfWeek', async () => {
  const { service, restore } = newServiceWithTempConfig(undefined);
  try {
    await (service as any).ready;
    await assert.rejects(
      service.updateConfig({ enabled: true, frequency: 'weekly', time: '03:00', retainCount: 5 }),
      /dayOfWeek/,
    );
  } finally {
    restore();
  }
});

test('runNow() calls backupService.createScheduledBackup with the configured retainCount and does not touch lastRunAt/nextRunAt', async () => {
  const calls: number[] = [];
  const restoreCreate = stubModuleFn(backupModule.backupService, 'createScheduledBackup', async (retainCount: number) => {
    calls.push(retainCount);
    return { path: '/tmp/x', fileName: 'scheduled-x.tar.gz', size: 1, timestamp: 'x', components: [], files: [] };
  });
  const { service, restore } = newServiceWithTempConfig({ enabled: true, frequency: 'daily', time: '04:00', retainCount: 9, lastRunAt: 'never', nextRunAt: '2099-01-01T00:00:00.000Z' });
  try {
    await (service as any).ready;
    await service.runNow();
    assert.deepEqual(calls, [9]);
    const config = await service.getConfig();
    assert.equal(config.lastRunAt, 'never', 'runNow() must not update lastRunAt');
    assert.equal(config.nextRunAt, '2099-01-01T00:00:00.000Z', 'runNow() must not update nextRunAt');
  } finally {
    restoreCreate();
    restore();
  }
});

test('constructor catch-up: runs immediately when nextRunAt is already in the past, then reschedules', async () => {
  const calls: number[] = [];
  const restoreCreate = stubModuleFn(backupModule.backupService, 'createScheduledBackup', async (retainCount: number) => {
    calls.push(retainCount);
    return { path: '/tmp/x', fileName: 'scheduled-x.tar.gz', size: 1, timestamp: 'x', components: [], files: [] };
  });
  const pastIso = new Date(Date.now() - 60_000).toISOString();
  const { service, restore } = newServiceWithTempConfig({ enabled: true, frequency: 'daily', time: '00:00', retainCount: 3, nextRunAt: pastIso });
  try {
    await (service as any).ready;
    assert.deepEqual(calls, [3], 'a due backup must run once at construction time (catch-up)');
    const config = await service.getConfig();
    assert.ok(config.lastRunAt, 'lastRunAt must be set after the catch-up run');
    assert.ok(new Date(config.nextRunAt!).getTime() > Date.now(), 'nextRunAt must be rescheduled into the future');
  } finally {
    restoreCreate();
    restore();
  }
});

test('constructor: does nothing when disabled', async () => {
  const calls: number[] = [];
  const restoreCreate = stubModuleFn(backupModule.backupService, 'createScheduledBackup', async (retainCount: number) => {
    calls.push(retainCount);
    return { path: '/tmp/x', fileName: 'x', size: 1, timestamp: 'x', components: [], files: [] };
  });
  const pastIso = new Date(Date.now() - 60_000).toISOString();
  const { service, restore } = newServiceWithTempConfig({ enabled: false, frequency: 'daily', time: '00:00', retainCount: 3, nextRunAt: pastIso });
  try {
    await (service as any).ready;
    assert.deepEqual(calls, [], 'a disabled schedule must never run, even with a past nextRunAt');
  } finally {
    restoreCreate();
    restore();
  }
});

test('start()/stop() are idempotent and stop() actually clears the interval', async () => {
  const { service, restore } = newServiceWithTempConfig(undefined);
  try {
    await (service as any).ready;
    service.start();
    service.start(); // second call must be a no-op, not a second interval
    assert.ok((service as any).intervalId, 'interval must be running after start()');
    service.stop();
    assert.equal((service as any).intervalId, null, 'interval must be cleared after stop()');
    service.stop(); // idempotent
  } finally {
    restore();
  }
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd server && npm test -- --test-name-pattern "computeNextRunAt|BackupScheduleService|getConfig\(\)|updateConfig\(\)|runNow\(\)|catch-up|start\(\)/stop\(\)"`
Expected: FAIL — `./backupSchedule` does not exist yet.

- [ ] **Step 3: Implement `server/src/services/backupSchedule.ts`**

```ts
// Scheduled disaster-recovery backups: owns the recurring daily/weekly
// backup config, computes when the next run is due, and ticks a
// setInterval (same shape as WatchdogService's auto-cleanup timer in
// services/watchdog.ts) that calls backupService.createScheduledBackup()
// when due. See docs/superpowers/specs/2026-09-20-scheduled-backups-design.md.

import fs from 'fs/promises';
import path from 'path';
import { WATCHDOGS_CONFIG_DIR } from './watchdog';
import { backupService, BackupResult } from './backup';

const BACKUP_SCHEDULE_CONFIG_PATH = path.join(WATCHDOGS_CONFIG_DIR, 'backup-schedule.json');

export interface BackupScheduleConfig {
  enabled: boolean;
  frequency: 'daily' | 'weekly';
  /** 0 (Sunday) - 6 (Saturday). Required when frequency === 'weekly'. */
  dayOfWeek?: number;
  /** Server local time, 'HH:mm'. */
  time: string;
  /** How many scheduled-*.tar.gz files to keep before pruning the oldest. */
  retainCount: number;
  lastRunAt?: string;
  nextRunAt?: string;
}

const DEFAULT_CONFIG: BackupScheduleConfig = {
  enabled: false,
  frequency: 'daily',
  time: '03:00',
  retainCount: 7,
};

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

/**
 * Computes the next local-time occurrence of `config`'s schedule strictly
 * after `from`. Pure function (no I/O, no `new Date()` inside) so it's
 * directly unit-testable with fixed dates -- see backupSchedule.test.ts.
 */
export function computeNextRunAt(
  config: Pick<BackupScheduleConfig, 'frequency' | 'dayOfWeek' | 'time'>,
  from: Date,
): Date {
  const match = TIME_RE.exec(config.time);
  if (!match) throw new Error(`Invalid time '${config.time}', expected HH:mm`);
  const hours = Number(match[1]);
  const minutes = Number(match[2]);

  if (config.frequency === 'daily') {
    const next = new Date(from);
    next.setHours(hours, minutes, 0, 0);
    if (next <= from) next.setDate(next.getDate() + 1);
    return next;
  }

  // weekly
  const dayOfWeek = config.dayOfWeek;
  if (dayOfWeek === undefined || dayOfWeek < 0 || dayOfWeek > 6) {
    throw new Error('dayOfWeek (0-6) is required when frequency is weekly');
  }
  const next = new Date(from);
  next.setHours(hours, minutes, 0, 0);
  let dayDiff = (dayOfWeek - next.getDay() + 7) % 7;
  if (dayDiff === 0 && next <= from) dayDiff = 7;
  next.setDate(next.getDate() + dayDiff);
  return next;
}

export class BackupScheduleService {
  private configPath = BACKUP_SCHEDULE_CONFIG_PATH;
  private intervalId: NodeJS.Timeout | null = null;
  // Resolves once the constructor's initial catch-up check has run.
  // Nothing else in this class depends on it -- getConfig()/updateConfig()/
  // runNow() all read/write the file directly -- but tests use it to
  // deterministically observe the one-time construction-time catch-up
  // without polling. Same idiom as WatchdogService.ready in watchdog.ts.
  private ready: Promise<void>;

  constructor() {
    this.ready = this.checkAndRunIfDue().catch(error => {
      console.error('Backup schedule initialization error:', error);
    });
    this.start();
  }

  private async ensureConfig(): Promise<string> {
    try {
      await fs.mkdir(WATCHDOGS_CONFIG_DIR, { recursive: true });
      return this.configPath;
    } catch {
      // Fallback for local development or permission issues -- mirrors
      // WatchdogService.ensureConfig()'s identical fallback.
      const localDir = path.join(__dirname, '../../config');
      await fs.mkdir(localDir, { recursive: true });
      return path.join(localDir, 'backup-schedule.json');
    }
  }

  async getConfig(): Promise<BackupScheduleConfig> {
    return this.load();
  }

  private async load(): Promise<BackupScheduleConfig> {
    const configPath = await this.ensureConfig();
    try {
      const data = await fs.readFile(configPath, 'utf-8');
      return { ...DEFAULT_CONFIG, ...JSON.parse(data) };
    } catch {
      return { ...DEFAULT_CONFIG };
    }
  }

  private async save(config: BackupScheduleConfig): Promise<void> {
    const configPath = await this.ensureConfig();
    await fs.writeFile(configPath, JSON.stringify(config, null, 2), 'utf-8');
  }

  async updateConfig(
    update: Pick<BackupScheduleConfig, 'enabled' | 'frequency' | 'dayOfWeek' | 'time' | 'retainCount'>,
  ): Promise<BackupScheduleConfig> {
    if (!TIME_RE.test(update.time)) {
      throw new Error(`Invalid time '${update.time}', expected HH:mm`);
    }
    if (update.frequency === 'weekly' && (update.dayOfWeek === undefined || update.dayOfWeek < 0 || update.dayOfWeek > 6)) {
      throw new Error('dayOfWeek (0-6) is required when frequency is weekly');
    }
    if (!Number.isInteger(update.retainCount) || update.retainCount < 1) {
      throw new Error('retainCount must be an integer >= 1');
    }

    const current = await this.load();
    const next: BackupScheduleConfig = {
      ...current,
      enabled: update.enabled,
      frequency: update.frequency,
      dayOfWeek: update.frequency === 'weekly' ? update.dayOfWeek : undefined,
      time: update.time,
      retainCount: update.retainCount,
      nextRunAt: undefined,
    };
    if (next.enabled) {
      next.nextRunAt = computeNextRunAt(next, new Date()).toISOString();
    }
    await this.save(next);
    return next;
  }

  /** Manual "run now" -- creates a scheduled-scope backup immediately,
   * independent of the schedule (does not read/write lastRunAt/nextRunAt). */
  async runNow(): Promise<BackupResult> {
    const config = await this.load();
    return backupService.createScheduledBackup(config.retainCount);
  }

  private async checkAndRunIfDue(): Promise<void> {
    const config = await this.load();
    if (!config.enabled) return;

    if (!config.nextRunAt) {
      config.nextRunAt = computeNextRunAt(config, new Date()).toISOString();
      await this.save(config);
      return;
    }

    if (new Date(config.nextRunAt) > new Date()) return;

    await backupService.createScheduledBackup(config.retainCount);
    config.lastRunAt = new Date().toISOString();
    config.nextRunAt = computeNextRunAt(config, new Date()).toISOString();
    await this.save(config);
  }

  /** Idempotent -- a second call while already running is a no-op, same
   * `if (this.intervalId) return;` idiom as WatchdogService.startAutoCleanup(). */
  start(): void {
    if (this.intervalId) return;
    this.intervalId = setInterval(() => {
      this.checkAndRunIfDue().catch(error => {
        console.error('Backup schedule tick error:', error);
      });
    }, 60 * 1000);
  }

  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd server && npm test -- --test-name-pattern "computeNextRunAt|BackupScheduleService|getConfig\(\)|updateConfig\(\)|runNow\(\)|catch-up|start\(\)/stop\(\)"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/src/services/backupSchedule.ts server/src/services/backupSchedule.test.ts
git commit -m "$(cat <<'EOF'
feat(backup): add BackupScheduleService for recurring backups

New service, same load/save/setInterval shape as WatchdogService:
persists daily/weekly schedule config to
/etc/snapcast-manager/backup-schedule.json, computes the next run time
with computeNextRunAt(), and ticks every 60s calling
backupService.createScheduledBackup() when due. Catches up with an
immediate run at construction time if the process was down past the
scheduled time, so a slightly-late backup never silently becomes a
skipped one.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: API routes + graceful shutdown wiring

**Files:**
- Modify: `server/src/routes/system.ts`
- Modify: `server/src/shutdown.ts`
- Modify: `server/src/shutdown.test.ts`
- Modify: `server/src/index.ts`
- Test: `server/src/routes/system.backupSchedule.test.ts` (new)

**Interfaces:**
- Consumes: `BackupScheduleService` (Task 4), `resolveBackupPath()` (Task 3).
- Produces: `GET/PUT /api/system/backup-schedule`, `POST /api/system/backup-schedule/run-now`; `backupScheduleService` singleton exported from `routes/system.ts` (same convention `routes/watchdog.ts` uses for `watchdogService` — the router's own instantiation is the app's one instance, so `index.ts`'s shutdown handler can stop the same instance the routes use).

- [ ] **Step 1: Write the failing test**

Create `server/src/routes/system.backupSchedule.test.ts`, following `routes/health.test.ts`'s and `routes/diagnostics.test.ts`'s exact pattern for testing an `authenticateToken`-gated route: a real express app + `http.Server` on an ephemeral port, a JWT signed for a real seeded user row, plain `fetch()`. No `supertest` — this repo doesn't use it; `jsonwebtoken` is already a dependency (`server/package.json`).

```ts
// eslint-disable-next-line @typescript-eslint/ban-ts-comment -- deliberate, see explanation below
// @ts-nocheck
//
// Why: see routes/health.test.ts's identical header for the full
// investigation into the `node --test --import ts-node/register`
// type-stripping bug this pragma works around -- this file's raw fetch()
// response bodies hit the same issue. Does not affect `npm run build` or
// the production route file, neither of which have this pragma.

import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import http from 'http';
import jwt from 'jsonwebtoken';
import * as path from 'path';
import * as os from 'os';

// Must run before `./system` is imported below -- routes/system.ts
// transitively imports ../database (DB_PATH) and ../auth (JWT_SECRET) at
// module-load time. Same ordering as health.test.ts/diagnostics.test.ts.
process.env.DB_PATH = path.join(os.tmpdir(), `system-backup-schedule-test-${process.pid}-${Date.now()}.db`);
process.env.JWT_SECRET = 'test-only-fixed-secret-for-system-backup-schedule-test-ts';

import systemRouter, { backupScheduleService } from './system';
import db from '../database';

const JWT_SECRET = process.env.JWT_SECRET;

const ADMIN_ID = Number(
  db
    .prepare('INSERT INTO users (username, password, role, token_version) VALUES (?, ?, ?, 0)')
    .run('admin', 'unused-test-password-hash', 'admin').lastInsertRowid,
);

function makeToken(): string {
  return jwt.sign({ id: ADMIN_ID, username: 'admin', role: 'admin', tokenVersion: 0 }, JWT_SECRET!, { expiresIn: '1h' });
}

const app = express();
app.use(express.json());
app.use('/api/system', systemRouter);

let server: http.Server;
let baseUrl = '';

test.before(async () => {
  await new Promise<void>((resolve) => {
    server = app.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      baseUrl = `http://127.0.0.1:${port}`;
      resolve();
    });
  });
});

test.after(async () => {
  backupScheduleService.stop();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

async function api(method: string, urlPath: string, body?: unknown) {
  const res = await fetch(`${baseUrl}${urlPath}`, {
    method,
    headers: { Authorization: `Bearer ${makeToken()}`, 'Content-Type': 'application/json' },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const parsed = await res.json().catch(() => null);
  return { status: res.status, body: parsed };
}

test('GET /api/system/backup-schedule returns the current config', async () => {
  const { status, body } = await api('GET', '/api/system/backup-schedule');
  assert.equal(status, 200);
  assert.equal(typeof body.enabled, 'boolean');
  assert.equal(typeof body.frequency, 'string');
});

test('PUT /api/system/backup-schedule validates and persists', async () => {
  const { status, body } = await api('PUT', '/api/system/backup-schedule', {
    enabled: true,
    frequency: 'daily',
    time: '04:15',
    retainCount: 4,
  });
  assert.equal(status, 200);
  assert.equal(body.time, '04:15');
  assert.equal(body.retainCount, 4);
});

test('PUT /api/system/backup-schedule rejects an invalid time with 400', async () => {
  const { status } = await api('PUT', '/api/system/backup-schedule', {
    enabled: true,
    frequency: 'daily',
    time: 'bad',
    retainCount: 4,
  });
  assert.equal(status, 400);
});

test('POST /api/system/backup-schedule/run-now triggers a scheduled backup', async () => {
  const original = backupScheduleService.runNow;
  let called = false;
  (backupScheduleService as any).runNow = async () => {
    called = true;
    return { path: '/tmp/x', fileName: 'scheduled-x.tar.gz', size: 1, timestamp: 'x', components: [], files: [] };
  };
  try {
    const { status } = await api('POST', '/api/system/backup-schedule/run-now');
    assert.equal(status, 200);
    assert.ok(called);
  } finally {
    (backupScheduleService as any).runNow = original;
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && npm test -- --test-name-pattern "backup-schedule"`
Expected: FAIL — the routes and `backupScheduleService` export don't exist yet.

- [ ] **Step 3: Add the routes**

In `server/src/routes/system.ts`, add the import and singleton near the top (alongside the existing `import { backupService } from '../services/backup';`):

```ts
import { BackupScheduleService } from '../services/backupSchedule';

// Same convention as routes/watchdog.ts's watchdogService: this router's
// own instantiation IS the app's one BackupScheduleService instance
// (services/backupSchedule.ts has no module-level singleton of its own),
// exported so index.ts's graceful-shutdown handler can call stop() on
// this SAME instance.
export const backupScheduleService = new BackupScheduleService();
```

Add the three routes near the existing `/backups*` routes (after the `GET /backups/download/:name` handler):

```ts
router.get('/backup-schedule', async (_req: Request, res: Response) => {
    try {
        const config = await backupScheduleService.getConfig();
        res.json(config);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

router.put('/backup-schedule', async (req: Request, res: Response) => {
    const { enabled, frequency, dayOfWeek, time, retainCount } = req.body;
    if (typeof enabled !== 'boolean' || (frequency !== 'daily' && frequency !== 'weekly')) {
        return res.status(400).json({ error: 'Invalid enabled/frequency' });
    }
    try {
        const config = await backupScheduleService.updateConfig({ enabled, frequency, dayOfWeek, time, retainCount });
        res.json(config);
    } catch (error: any) {
        res.status(400).json({ error: error.message });
    }
});

router.post('/backup-schedule/run-now', async (_req: Request, res: Response) => {
    try {
        const result = await backupScheduleService.runNow();
        res.json(result);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});
```

Update the `GET /backups/download/:name` handler to use `resolveBackupPath()` instead of its own inline regex + path build:

```ts
router.get('/backups/download/:name', (req: Request, res: Response) => {
    const name = req.params.name;
    let fullPath: string;
    try {
        fullPath = resolveBackupPath(name);
    } catch {
        return res.status(400).json({ error: 'Invalid backup name' });
    }
    if (!fs.existsSync(fullPath)) {
        return res.status(404).json({ error: 'Backup not found' });
    }
    const stat = fs.statSync(fullPath);
    res.setHeader('Content-disposition', `attachment; filename="${name}"`);
    res.setHeader('Content-type', 'application/gzip');
    res.setHeader('Content-length', String(stat.size));
    fs.createReadStream(fullPath).pipe(res);
});
```

...and add `resolveBackupPath` to the existing `import { backupService } from '../services/backup';` line:

```ts
import { backupService, resolveBackupPath } from '../services/backup';
```

- [ ] **Step 4: Wire the shutdown timer**

In `server/src/shutdown.ts`, add `stopBackupSchedule` to `ShutdownDeps` right after `stopWatchdog`:

```ts
export interface ShutdownDeps {
  httpServer: { close(callback?: (err?: Error) => void): void };
  closeSse: () => void | Promise<void>;
  disconnectSnapcastLive: () => void | Promise<void>;
  stopWatchdog: () => void | Promise<void>;
  stopBackupSchedule: () => void | Promise<void>;
  closeDb: () => void | Promise<void>;
  exit: (code: number) => void;
  timeoutMs: number;
  logger: ShutdownLogger;
}
```

And add the step between `stopWatchdog` and `closeDb` inside `gracefulShutdown()`:

```ts
  await step('close SSE connections', deps.closeSse);
  await step('disconnect snapcast WebSocket', deps.disconnectSnapcastLive);
  await step('stop watchdog timer', deps.stopWatchdog);
  await step('stop backup schedule timer', deps.stopBackupSchedule);
  await step('close database', deps.closeDb);
```

`server/src/shutdown.test.ts` has 6 test cases, each constructing a full `ShutdownDeps` object; every one needs a `stopBackupSchedule` field added (`ShutdownDeps` now requires it) or `deps.stopBackupSchedule()` throws `TypeError: ... is not a function` at runtime when `gracefulShutdown()` calls it. Apply these 6 exact edits:

**Test 1** (`'gracefulShutdown runs every cleanup step in the documented order, then exits 0'`):

```ts
    stopWatchdog: () => {
      calls.push('watchdog.stop');
    },
    closeDb: () => {
```
→
```ts
    stopWatchdog: () => {
      calls.push('watchdog.stop');
    },
    stopBackupSchedule: () => {
      calls.push('backupSchedule.stop');
    },
    closeDb: () => {
```
and
```ts
  assert.deepEqual(calls, [
    'http.close',
    'sse.close',
    'ws.disconnect',
    'watchdog.stop',
    'db.close',
    'exit(0)',
  ]);
```
→
```ts
  assert.deepEqual(calls, [
    'http.close',
    'sse.close',
    'ws.disconnect',
    'watchdog.stop',
    'backupSchedule.stop',
    'db.close',
    'exit(0)',
  ]);
```

**Test 2** (`'... continues remaining steps and still exits 0 when one step throws'`) and **Test 3** (`'... continues remaining steps when an ASYNC step rejects'`) both contain this identical block — apply the same insertion in both places:

```ts
    stopWatchdog: () => {
      calls.push('watchdog');
    },
    closeDb: () => {
```
→
```ts
    stopWatchdog: () => {
      calls.push('watchdog');
    },
    stopBackupSchedule: () => {
      calls.push('backupSchedule');
    },
    closeDb: () => {
```
and, in both tests:
```ts
  assert.deepEqual(calls, ['sse', 'ws', 'watchdog', 'db', 'exit(0)']);
```
→
```ts
  assert.deepEqual(calls, ['sse', 'ws', 'watchdog', 'backupSchedule', 'db', 'exit(0)']);
```

**Test 4** (`'... force-exits with code 1 if a cleanup step hangs past the timeout, and skips the remaining steps'`) — `closeSse` hangs forever, so nothing after it (including the new step) ever runs; just add the field so the object is complete, no array change needed since `calls` stays `[]`:

```ts
    stopWatchdog: () => {
      calls.push('watchdog');
    },
    closeDb: () => {
      calls.push('db');
    },
    exit: (code: number) => {
      exitCode = code;
    },
```
→
```ts
    stopWatchdog: () => {
      calls.push('watchdog');
    },
    stopBackupSchedule: () => {
      calls.push('backupSchedule');
    },
    closeDb: () => {
      calls.push('db');
    },
    exit: (code: number) => {
      exitCode = code;
    },
```

**Test 5** (`'... never force-exits a second time after completing normally before the timeout'`) and **Test 6** (`'... logs (but tolerates) an error reported via the http.close callback'`) both contain this identical block — apply the same insertion in both places:

```ts
    stopWatchdog: () => {},
    closeDb: () => {},
```
→
```ts
    stopWatchdog: () => {},
    stopBackupSchedule: () => {},
    closeDb: () => {},
```

Verify all 6 are done: `grep -c "stopBackupSchedule" server/src/shutdown.test.ts` → expect `6`.

In `server/src/index.ts`, import the singleton and wire it in:

```ts
import systemRouter, { backupScheduleService } from './routes/system';
```

(Add `backupScheduleService` to the existing `import systemRouter from './routes/system';` line's named imports.)

```ts
    void gracefulShutdown({
      httpServer: server,
      closeSse: () => eventsRouter.closeAllConnections(),
      disconnectSnapcastLive: () => snapcastLive.stop(),
      stopWatchdog: () => watchdogService.stopAutoCleanup(),
      stopBackupSchedule: () => backupScheduleService.stop(),
      closeDb: () => {
        db.close();
      },
      exit: (code) => process.exit(code),
      timeoutMs: SHUTDOWN_TIMEOUT_MS,
      logger: log,
    });
```

- [ ] **Step 5: Run the full server test suite**

Run: `cd server && npm test`
Expected: PASS — every existing `shutdown.test.ts` case (updated in Step 4), every `system.*.test.ts`, and the new `system.backupSchedule.test.ts`.

- [ ] **Step 6: Type-check and lint**

Run: `cd server && npm run build && cd .. && npm run lint`
Expected: no errors. (`npm run build` catches anything the `@ts-nocheck`'d test files' loose typing would hide — `shutdown.ts` and `index.ts` themselves have no such pragma.)

- [ ] **Step 7: Commit**

```bash
git add server/src/routes/system.ts server/src/routes/system.backupSchedule.test.ts server/src/shutdown.ts server/src/shutdown.test.ts server/src/index.ts
git commit -m "$(cat <<'EOF'
feat(backup): expose backup-schedule API and wire shutdown

GET/PUT /api/system/backup-schedule and POST .../run-now, backed by
the new BackupScheduleService singleton (same routes/watchdog.ts
export-the-router's-own-instance convention as watchdogService). The
download route now resolves names through the shared
resolveBackupPath() instead of duplicating its regex. Graceful
shutdown stops the new timer alongside the existing watchdog one.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Client UI — schedule panel, type badge, i18n

**Files:**
- Modify: `client/src/views/Tools.vue`
- Modify: `client/src/locales/en/tools.json`
- Modify: `client/src/locales/es/tools.json`

**Interfaces:**
- Consumes: `GET/PUT /api/system/backup-schedule`, `POST /api/system/backup-schedule/run-now` (Task 5); `BackupEntry.type` (Task 3).
- Produces: nothing consumed by a later task — this is the last task.

This task has no automated test (it's a Vue template + a couple of `fetchApi` calls, consistent with the rest of `Tools.vue`, which has no component-level test file today). Verify manually per Step 4 below instead of writing a failing test first.

- [ ] **Step 1: Add i18n keys**

In `client/src/locales/en/tools.json`, add these keys (anywhere alongside the existing `configurationBackups`/`backupsDescription`/etc. keys — exact position doesn't matter, JSON key order is not significant):

```json
  "scheduledBackups": "Scheduled Backups",
  "scheduledBackupsDescription": "Automatic recurring backups covering snapserver state, all managed component config, and this app's own data — everything needed for a full disaster-recovery restore.",
  "scheduleEnabled": "Enable scheduled backups",
  "scheduleFrequency": "Frequency",
  "scheduleFrequencyDaily": "Daily",
  "scheduleFrequencyWeekly": "Weekly",
  "scheduleDayOfWeek": "Day of week",
  "scheduleDaySunday": "Sunday",
  "scheduleDayMonday": "Monday",
  "scheduleDayTuesday": "Tuesday",
  "scheduleDayWednesday": "Wednesday",
  "scheduleDayThursday": "Thursday",
  "scheduleDayFriday": "Friday",
  "scheduleDaySaturday": "Saturday",
  "scheduleTime": "Time",
  "scheduleRetainCount": "Backups to keep",
  "scheduleSave": "Save Schedule",
  "scheduleRunNow": "Run Now",
  "scheduleLastRun": "Last run",
  "scheduleNextRun": "Next run",
  "scheduleNeverRun": "Never",
  "scheduleSaved": "Backup schedule saved",
  "failedToLoadSchedule": "Failed to load backup schedule: ",
  "failedToSaveSchedule": "Failed to save backup schedule: ",
  "scheduleRunStarted": "Scheduled backup created",
  "failedToRunSchedule": "Failed to run scheduled backup: ",
  "backupTypePreUpdate": "pre-update",
  "backupTypeScheduled": "scheduled",
```

In `client/src/locales/es/tools.json`, add the matching Spanish keys:

```json
  "scheduledBackups": "Copias de Seguridad Programadas",
  "scheduledBackupsDescription": "Copias de seguridad recurrentes automáticas que cubren el estado de snapserver, la configuración de todos los componentes gestionados y los datos propios de esta app — todo lo necesario para restaurar ante una catástrofe.",
  "scheduleEnabled": "Activar copias programadas",
  "scheduleFrequency": "Frecuencia",
  "scheduleFrequencyDaily": "Diario",
  "scheduleFrequencyWeekly": "Semanal",
  "scheduleDayOfWeek": "Día de la semana",
  "scheduleDaySunday": "Domingo",
  "scheduleDayMonday": "Lunes",
  "scheduleDayTuesday": "Martes",
  "scheduleDayWednesday": "Miércoles",
  "scheduleDayThursday": "Jueves",
  "scheduleDayFriday": "Viernes",
  "scheduleDaySaturday": "Sábado",
  "scheduleTime": "Hora",
  "scheduleRetainCount": "Copias a conservar",
  "scheduleSave": "Guardar Programación",
  "scheduleRunNow": "Ejecutar Ahora",
  "scheduleLastRun": "Última ejecución",
  "scheduleNextRun": "Próxima ejecución",
  "scheduleNeverRun": "Nunca",
  "scheduleSaved": "Programación de copias guardada",
  "failedToLoadSchedule": "Error al cargar la programación de copias: ",
  "failedToSaveSchedule": "Error al guardar la programación de copias: ",
  "scheduleRunStarted": "Copia de seguridad programada creada",
  "failedToRunSchedule": "Error al ejecutar la copia programada: ",
  "backupTypePreUpdate": "pre-actualización",
  "backupTypeScheduled": "programada",
```

- [ ] **Step 2: Add schedule state + API calls to `Tools.vue`'s `<script setup>`**

In `client/src/views/Tools.vue`, update the `BackupEntry` interface and add schedule state right after the existing `// ─── Backups ──...` section header (before `const backups = ref<BackupEntry[]>([]);`):

```ts
interface BackupEntry { name: string; size: number; mtime: string; components: string[]; type: 'pre-update' | 'scheduled'; }

interface BackupScheduleConfig {
  enabled: boolean;
  frequency: 'daily' | 'weekly';
  dayOfWeek?: number;
  time: string;
  retainCount: number;
  lastRunAt?: string;
  nextRunAt?: string;
}

const schedule = ref<BackupScheduleConfig>({ enabled: false, frequency: 'daily', time: '03:00', retainCount: 7 });
const scheduleLoading = ref(false);
const scheduleSaving = ref(false);
const scheduleRunning = ref(false);

async function loadSchedule() {
  scheduleLoading.value = true;
  try {
    schedule.value = await fetchApi('/system/backup-schedule');
  } catch (e: any) {
    uiStore.showToast(t('tools.failedToLoadSchedule') + e.message, 'error');
  } finally {
    scheduleLoading.value = false;
  }
}

async function saveSchedule() {
  scheduleSaving.value = true;
  try {
    schedule.value = await fetchApi('/system/backup-schedule', {
      method: 'PUT',
      body: JSON.stringify({
        enabled: schedule.value.enabled,
        frequency: schedule.value.frequency,
        dayOfWeek: schedule.value.frequency === 'weekly' ? schedule.value.dayOfWeek ?? 0 : undefined,
        time: schedule.value.time,
        retainCount: schedule.value.retainCount,
      }),
    });
    uiStore.showToast(t('tools.scheduleSaved'), 'success');
  } catch (e: any) {
    uiStore.showToast(t('tools.failedToSaveSchedule') + e.message, 'error');
  } finally {
    scheduleSaving.value = false;
  }
}

async function runScheduleNow() {
  scheduleRunning.value = true;
  try {
    await fetchApi('/system/backup-schedule/run-now', { method: 'POST' });
    uiStore.showToast(t('tools.scheduleRunStarted'), 'success', 8000);
    await loadBackups();
  } catch (e: any) {
    uiStore.showToast(t('tools.failedToRunSchedule') + e.message, 'error');
  } finally {
    scheduleRunning.value = false;
  }
}
```

Update `switchTab()`:

```ts
function switchTab(tab: Tab) {
  activeTab.value = tab;
  if (tab === 'crontab') loadCrontab();
  if (tab === 'mpd-config') loadMpdConfig();
  if (tab === 'scripts') loadScriptPaths();
  if (tab === 'backups') { loadBackups(); loadSchedule(); }
}
```

- [ ] **Step 3: Add the schedule panel and type badge to the template**

In the `<!-- ─── Backups ─────... -->` block, insert a new panel immediately before the existing `<div class="bg-black/40 ... configurationBackups ...">` block:

```html
<div class="bg-black/40 border border-black/5 dark:border-white/5 rounded-2xl backdrop-blur-md overflow-hidden">
  <div class="px-6 py-4 border-b border-black/5 dark:border-white/5 bg-black/5 dark:bg-white/5 flex items-center space-x-3">
    <span class="material-symbols-outlined text-gray-500 text-[1.2rem]">event_repeat</span>
    <span class="text-sm font-black text-white uppercase tracking-widest">{{ t('tools.scheduledBackups') }}</span>
  </div>
  <div class="p-4 space-y-4">
    <p class="text-[10px] font-mono text-terminal-muted leading-relaxed">
      {{ t('tools.scheduledBackupsDescription') }}
    </p>
    <label class="flex items-center gap-2 text-xs font-black text-white uppercase tracking-widest">
      <input type="checkbox" v-model="schedule.enabled" class="w-4 h-4" />
      {{ t('tools.scheduleEnabled') }}
    </label>
    <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
      <div>
        <label class="block text-[10px] font-black text-terminal-muted uppercase tracking-widest mb-1">{{ t('tools.scheduleFrequency') }}</label>
        <select v-model="schedule.frequency" class="w-full bg-black/30 border border-white/10 rounded-xl px-3 py-2 text-xs text-white">
          <option value="daily">{{ t('tools.scheduleFrequencyDaily') }}</option>
          <option value="weekly">{{ t('tools.scheduleFrequencyWeekly') }}</option>
        </select>
      </div>
      <div v-if="schedule.frequency === 'weekly'">
        <label class="block text-[10px] font-black text-terminal-muted uppercase tracking-widest mb-1">{{ t('tools.scheduleDayOfWeek') }}</label>
        <select v-model.number="schedule.dayOfWeek" class="w-full bg-black/30 border border-white/10 rounded-xl px-3 py-2 text-xs text-white">
          <option :value="0">{{ t('tools.scheduleDaySunday') }}</option>
          <option :value="1">{{ t('tools.scheduleDayMonday') }}</option>
          <option :value="2">{{ t('tools.scheduleDayTuesday') }}</option>
          <option :value="3">{{ t('tools.scheduleDayWednesday') }}</option>
          <option :value="4">{{ t('tools.scheduleDayThursday') }}</option>
          <option :value="5">{{ t('tools.scheduleDayFriday') }}</option>
          <option :value="6">{{ t('tools.scheduleDaySaturday') }}</option>
        </select>
      </div>
      <div>
        <label class="block text-[10px] font-black text-terminal-muted uppercase tracking-widest mb-1">{{ t('tools.scheduleTime') }}</label>
        <input type="time" v-model="schedule.time" class="w-full bg-black/30 border border-white/10 rounded-xl px-3 py-2 text-xs text-white" />
      </div>
      <div>
        <label class="block text-[10px] font-black text-terminal-muted uppercase tracking-widest mb-1">{{ t('tools.scheduleRetainCount') }}</label>
        <input type="number" min="1" v-model.number="schedule.retainCount" class="w-full bg-black/30 border border-white/10 rounded-xl px-3 py-2 text-xs text-white" />
      </div>
    </div>
    <p class="text-[10px] font-mono text-terminal-muted">
      {{ t('tools.scheduleLastRun') }}: {{ schedule.lastRunAt ? formatDate(schedule.lastRunAt) : t('tools.scheduleNeverRun') }}
      ·
      {{ t('tools.scheduleNextRun') }}: {{ schedule.nextRunAt ? formatDate(schedule.nextRunAt) : t('tools.scheduleNeverRun') }}
    </p>
    <div class="flex items-center gap-2">
      <button @click="saveSchedule" :disabled="scheduleSaving"
        class="inline-flex items-center px-3 py-1.5 text-xs font-black text-brand-primary hover:bg-brand-primary/10 border border-brand-primary/20 rounded-xl transition-all active:scale-95 uppercase tracking-widest disabled:opacity-50">
        {{ t('tools.scheduleSave') }}
      </button>
      <button @click="runScheduleNow" :disabled="scheduleRunning"
        class="inline-flex items-center px-3 py-1.5 text-xs font-black text-white hover:bg-white/10 border border-white/20 rounded-xl transition-all active:scale-95 uppercase tracking-widest disabled:opacity-50">
        {{ t('tools.scheduleRunNow') }}
      </button>
    </div>
  </div>
</div>
```

Add a type badge to each backup row, right after the existing filename `<p>`:

```html
                <div class="min-w-0">
                  <p class="text-xs font-black text-white truncate font-mono">
                    {{ backup.name }}
                    <span class="ml-2 px-1.5 py-0.5 rounded text-[9px] font-black uppercase tracking-widest"
                      :class="backup.type === 'scheduled' ? 'bg-brand-primary/20 text-brand-primary' : 'bg-white/10 text-terminal-muted'">
                      {{ backup.type === 'scheduled' ? t('tools.backupTypeScheduled') : t('tools.backupTypePreUpdate') }}
                    </span>
                  </p>
                  <p class="text-[10px] font-mono text-terminal-muted mt-0.5">
                    {{ formatDate(backup.mtime) }} · {{ formatSize(backup.size) }}
                    <span v-if="backup.components.length"> · {{ backup.components.join(', ') }}</span>
                  </p>
                </div>
```

- [ ] **Step 4: Verify manually**

Run: `cd server && npm run dev` (or whatever the repo's existing local-dev command is — check `package.json`'s `dev` script) in one terminal, and the client dev server in another (check root `README.md`'s Local Development section for the exact commands — do not guess). Log in, go to Tools → Backups, confirm:
- The new "Scheduled Backups" panel renders above the existing list.
- Toggling frequency to Weekly reveals the day-of-week select.
- Saving persists (reload the tab, values survive).
- "Run Now" triggers a backup and it appears in the list below tagged "scheduled".
- Existing pre-update backups (if any) show the "pre-update" badge.

- [ ] **Step 5: Lint**

Run: `npm run lint` (repo root)
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add client/src/views/Tools.vue client/src/locales/en/tools.json client/src/locales/es/tools.json
git commit -m "$(cat <<'EOF'
feat(ui): add scheduled backup configuration to Tools > Backups

Panel to enable/disable recurring backups, pick daily/weekly + time +
retention, save, and run one immediately. Existing backup list rows
now show a pre-update/scheduled type badge.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Spec coverage check

- §1 (always include state): Task 1 (pre-update backups, any component) + Task 2 (manual export). ✓
- §2 (scheduled backup content/naming/retention): Task 3. ✓
- §3 (config + scheduler, catch-up, run-now not touching schedule state): Task 4. ✓
- §4 (API, widened restore/delete/download, listBackups with `type`): Task 3 (service-level) + Task 5 (routes). ✓
- §5 (UI): Task 6. ✓
- §6 (testing): a test step precedes every implementation step in Tasks 1-5; Task 6 documents why it has no automated test (no existing component-test convention for `Tools.vue`) and substitutes a manual verification step.
