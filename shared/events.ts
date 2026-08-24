// Task 25: the SSE message envelope for `GET /api/events`, shared so a later
// Stage 4 client task consuming it via `EventSource` gets the exact shape
// server/src/routes/events.ts actually serializes, instead of guessing.
//
// Wire format (see server/src/routes/events.ts's writeSseEvent()): one SSE
// message per update, `event: <type>` followed by `data: <JSON of the
// matching payload type below>`, e.g.
//
//   event: snapcast
//   data: {"server":{"server":{"version":"0.27.0"},"groups":[...],"streams":[...]}}
//
//   event: service-status
//   data: [{"service":"snapserver","status":"active"}, ...]
//
//   event: job
//   data: {"id":"...","label":"Install snapserver","status":"running","log":[...],"startedAt":...}
//
// This is deliberately three narrowly-scoped event types (per the task
// brief: "don't build a general pub/sub framework") -- not an extensible
// generic envelope.

import type { SnapcastGetStatusResult } from './snapcast';

export type SseEventType = 'snapcast' | 'service-status' | 'job';

/**
 * Current snapserver state, straight from snapcastLive.ts's cache. `null`
 * when the WebSocket connection to snapserver has never yet completed a
 * successful `Server.GetStatus` (e.g. snapserver isn't running/reachable) --
 * a client seeing `null` should treat this the same way `GET
 * /api/snapcast/status` failing would (nothing known yet), not as "there is
 * a real, empty status".
 */
export interface SnapcastSseEvent {
  type: 'snapcast';
  data: SnapcastGetStatusResult | null;
}

/** One monitored systemd unit's current `systemctl is-active` result string. */
export interface ServiceStatusEntry {
  /** Bare service name, e.g. "snapserver" -- NOT unit-suffixed ("snapserver.service"). */
  service: string;
  /** Raw `systemctl is-active` output: "active" | "inactive" | "failed" | ... */
  status: string;
}

/**
 * The full, current snapshot of every monitored service's status. Emitted
 * only when at least one entry actually changed since the last poll/emit
 * (see events.ts's `pollIntervalMs`-driven diffing) -- never emitted purely
 * because a poll tick happened with no change, to avoid pointless
 * client-side re-renders (this is what design-spec finding #20's "polling
 * storm" was about).
 */
export interface ServiceStatusSseEvent {
  type: 'service-status';
  data: ServiceStatusEntry[];
}

/**
 * Mirrors server/src/services/jobs.ts's `Job` interface field-for-field.
 * Duplicated here (rather than imported) because shared/ is consumed BY the
 * server, not the other way around -- server/src/services/jobs.ts keeps
 * being the source of truth for the real `Job` type; this is the
 * cross-boundary copy of its shape, same pattern shared/pipeSources.ts
 * already uses for `services/pipeSources.ts`'s types.
 */
export interface JobSnapshot {
  id: string;
  label: string;
  status: 'running' | 'done' | 'error' | 'interrupted';
  log: string[];
  output?: string;
  error?: string;
  startedAt: number;
  finishedAt?: number;
}

/** Emitted whenever the current (or most-recently-finished) job's state changes -- start, each log() line, and its terminal done/error/interrupted transition. */
export interface JobSseEvent {
  type: 'job';
  data: JobSnapshot;
}

export type SseEvent = SnapcastSseEvent | ServiceStatusSseEvent | JobSseEvent;
