# Scheduled disaster-recovery backups — design

Date: 2026-09-20
Source: user request — snapserver state (`server.json`) is missing from
some existing backups, and there is no way to schedule recurring
backups; both matter for disaster recovery.

## Goal

1. Every backup this app produces — pre-update, manual export, and the
   new scheduled backups — always carries snapserver's persistent state
   (`/var/lib/snapserver`, i.e. `server.json` plus its rotating `.bak`),
   regardless of which component triggered the backup.
2. A configurable daily/weekly scheduled backup, covering everything
   relevant for a full disaster-recovery restore (state + all managed
   component config + the manager's own data/config), runnable from the
   Snapcast Manager UI.

## Non-goals

- No off-box backup destinations (S3, remote host, etc.) — local
  `/var/backups/snapmanager` only, same as today.
- No new archive format or encryption — plain `tar.gz`, same as
  existing backups.
- No systemd timer/cron unit generation on the host — the scheduler
  runs in-process (Node `setInterval`), matching the existing
  `WatchdogService` pattern. Simpler, no extra sudoers surface, and
  every existing install already runs the Node process continuously.
- Does not change `restoreBackup()`'s staged-`cp` restore mechanism —
  scheduled backups restore through the exact same code path as
  pre-update backups.

## 1. Always include state

`BackupService.collectSources()` ([backup.ts](../../../server/src/services/backup.ts))
currently puts `/var/lib/snapserver` in the `snapserver`-only branch, so
a pre-update backup for `mpd`, `mympd`, `shairport-sync`, `snapclient`,
etc. never carries it. Fix: move `/var/lib/snapserver` into the
cross-cutting block (alongside `dbDir` and `WATCHDOGS_CONFIG_DIR`) that
every component includes, regardless of `component`. `/etc/snapserver.conf*`
stays in the `snapserver`-specific branch — it's config, not state, and
irrelevant to e.g. an mpd backup.

`GET /api/system/export` ([system.ts](../../../server/src/routes/system.ts))
is a second, independent code path (manual "download everything" export,
not routed through `BackupService` at all) that only tars
`/opt/snapcast-manager/data` + `/etc/snapserver.conf`. Add
`/var/lib/snapserver` as a third conditional target, same
`fs.existsSync` guard pattern already used for the other two.

## 2. Scheduled backup content

New `BackupService.createScheduledBackup()`, built on the existing
`collectSources('general')` path (the same "union of every component"
scope `'general'` already produces for an unrecognized package) — full
disaster-recovery coverage: snapserver config + state, snapclient
config, mpd/mympd/shairport-sync config, snap-ctrl, the manager's own
SQLite database and `/etc/snapcast-manager` config directory, and the
dynamic `snapclient-manager-*`/`snapcast-radio-*` systemd units.

Naming: `scheduled-<YYYYMMDD-HHMMSS>.tar.gz` (UTC, same `formatTimestamp()`
helper reused). Stored under a dedicated subdirectory,
`/var/backups/snapmanager/scheduled/`, so scheduled backups have their
own retention pool, independent of the pre-update pool's existing
`MAX_BACKUPS = 15` cap — a burst of scheduled runs never evicts a
recent pre-update backup and vice versa.

Retention: user-configured count (`retainCount`, default `7`). After
each scheduled run, prune oldest files in the `scheduled/` subdirectory
beyond that count — same sort-by-filename-then-slice approach as
`cleanupOldBackups()`.

## 3. Schedule config + scheduler service

New config file, `/etc/snapcast-manager/backup-schedule.json` — same
directory `WatchdogService` already uses for `watchdogs.json`
(`WATCHDOGS_CONFIG_DIR`), which means it's automatically covered by
every backup's existing cross-cutting `WATCHDOGS_CONFIG_DIR` source
(the schedule config itself survives a disaster-recovery restore).

```ts
interface BackupScheduleConfig {
  enabled: boolean;
  frequency: 'daily' | 'weekly';
  dayOfWeek?: number;   // 0 (Sun) – 6 (Sat); required when frequency === 'weekly'
  time: string;         // 'HH:mm', server's local time
  retainCount: number;  // default 7
  lastRunAt?: string;   // ISO 8601
  nextRunAt?: string;   // ISO 8601
}
```

New `BackupScheduleService`, mirroring `WatchdogService`'s
constructor-load-then-interval shape:

- Constructor loads the config (creating a disabled default if absent),
  and if `enabled` and `nextRunAt` is missing, computes it.
- A `setInterval` tick (every 60s — cheap, matches the granularity a
  `'HH:mm'` schedule needs) checks `enabled && nextRunAt <= now`; if
  due, runs `createScheduledBackup()`, sets `lastRunAt = now`,
  recomputes `nextRunAt` from `frequency`/`dayOfWeek`/`time`, persists.
- **Catch-up on startup:** if the process was down past `nextRunAt`
  when it starts, the first tick after construction treats it as due
  immediately and runs once, rather than silently skipping straight to
  the next period — for disaster recovery, a slightly-late backup beats
  a silently-skipped one. Ordinary ticks otherwise only fire backups at
  their scheduled time, not on every tick.
- Updating the config (`enabled`, `frequency`, `dayOfWeek`, `time`,
  `retainCount`) always recomputes `nextRunAt` from the new settings.
- "Run now" calls `createScheduledBackup()` directly and does **not**
  touch `lastRunAt`/`nextRunAt` — it's an out-of-band manual run, not a
  reschedule.

Next-run computation: given `time = 'HH:mm'` and (for weekly)
`dayOfWeek`, find the next local-time occurrence strictly after `now`
(today at that time if it hasn't passed yet; otherwise the next
matching day).

## 4. API

All under `server/src/routes/system.ts`, `authenticateToken`-gated like
the existing `/backups*` routes:

- `GET /api/system/backup-schedule` → current `BackupScheduleConfig`.
- `PUT /api/system/backup-schedule` → body `{ enabled, frequency,
  dayOfWeek?, time, retainCount }`; validates (`time` matches
  `HH:mm`, `dayOfWeek` present and in range when `frequency ===
  'weekly'`, `retainCount >= 1`), saves, recomputes `nextRunAt`, returns
  the updated config.
- `POST /api/system/backup-schedule/run-now` → triggers
  `createScheduledBackup()` synchronously (same as the pre-update path
  awaits today), returns the `BackupResult`.
- `GET /api/system/backups` (existing route, extended): returns both
  pools — pre-update (`BACKUP_DIR/pre-*.tar.gz`) and scheduled
  (`BACKUP_DIR/scheduled/scheduled-*.tar.gz`) — each entry gains a
  `type: 'pre-update' | 'scheduled'` field. Sorted by `mtime` like
  today, pools merged into one list.
- `POST /api/system/backups/restore`, `DELETE /api/system/backups/:name`,
  `GET /api/system/backups/download/:name` (existing routes,
  unchanged behavior): the name-validation regex widens from just
  `^pre-[a-z\-]+-\d{8}-\d{6}\.tar\.gz$` to also accept
  `^scheduled-\d{8}-\d{6}\.tar\.gz$`, and path resolution picks
  `BACKUP_DIR` vs `BACKUP_DIR/scheduled` based on which pattern
  matched. The existing `pre-*` regex and its resolved path are
  unchanged — this is a pure addition, not a rewrite of the hardened
  Task 65 restore logic.

## 5. UI

`client/src/views/Tools.vue`, Backups tab:

- Existing backup list rows gain a small type badge ("pre-update" /
  "programado").
- New panel above the list, "Backups programados": enable toggle,
  frequency select (Diario/Semanal), day-of-week select (shown only
  when Semanal), time input, retention number input, "Guardar" button,
  "Ejecutar ahora" button, and a line showing last/next run
  (formatted with the existing `formatDate()` helper already used for
  backup entries).
- New i18n keys under `tools.*` in `client/src/locales/{en,es}/tools.json`
  (schedule labels, frequency options, save/run-now confirmations,
  toast messages), following the existing key-naming convention in that
  file.

## 6. Testing

- `server/src/services/backup.test.ts`: `/var/lib/snapserver` present
  in cross-cutting sources regardless of `component`; `export` route's
  new target (route-level, or a focused unit test if the export logic
  gets extracted); `createScheduledBackup()` writes to the `scheduled/`
  subdirectory with the right name pattern; retention prunes only
  within that subdirectory; `restoreBackup()`/`deleteBackup()` accept
  `scheduled-*` names against the `scheduled/` path, `pre-*` behavior
  unchanged.
- New `server/src/services/backupSchedule.test.ts`: default config when
  file absent; `nextRunAt` computation for daily and weekly (including
  "time already passed today" vs "still upcoming today"); catch-up run
  on construction when `nextRunAt` is in the past; interval tick fires
  exactly at/after `nextRunAt` and reschedules; config update
  recomputes `nextRunAt`; "run now" doesn't mutate `lastRunAt`/`nextRunAt`.
