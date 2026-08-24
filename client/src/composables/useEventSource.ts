import { ref, type Ref } from 'vue';
import { fetchApi } from '../utils/api';
import { useSnapcastStore } from '../stores/snapcast';
import type { ServiceStatusEntry, JobSnapshot } from '@shared/events';
import type { SnapcastGetStatusResult } from '@shared/snapcast';

// Task 28: the client-side half of the SSE ticket-auth design (see
// server/src/services/sseTickets.ts and task-28-brief.md). A plain
// browser `EventSource` cannot set the `Authorization` header `fetchApi`
// normally attaches, so this: (1) mints a short-lived, single-use ticket
// via `POST /auth/sse-ticket` (through `fetchApi`, which DOES attach the
// JWT header correctly), (2) opens `EventSource('/api/events?ticket=...')`,
// (3) on any connection failure, closes the dead `EventSource` itself and
// mints a FRESH ticket before reconnecting -- `EventSource`'s own built-in
// auto-reconnect would otherwise just keep retrying the exact same URL,
// whose ticket is already consumed/expired -- and (4) reacts to the
// server's `shutdown` event (Task 27's graceful shutdown) by reconnecting
// proactively instead of waiting for the connection to error out.
//
// This is infrastructure only (Task 28) -- no view's existing polling is
// removed yet (that's Task 29). The one store this task wires up directly
// is `stores/snapcast.ts` (its `status` shape is a structural match for
// the SSE `snapcast` event's payload -- see shared/snapcast.ts), per the
// brief's explicit example. `service-status` and `job` events are exposed
// as this composable's own reactive state for a later task to consume
// (there's no existing store field that's a clean 1:1 match for either
// today).
//
// Design choice: a plain composable (module-scoped singleton state), not a
// Pinia store -- this holds transient connection machinery (an
// EventSource, timers, an attempt counter), not domain data the rest of
// the app reads/writes through actions the way stores/snapcast.ts's state
// is. There is also no existing `composables/` precedent in this codebase
// to follow either way; this establishes the pattern.

export type SseConnectionStatus = 'connecting' | 'connected' | 'reconnecting' | 'disconnected';

const INITIAL_BACKOFF_MS = 1000;
const MAX_BACKOFF_MS = 30_000;
const BACKOFF_FACTOR = 2;
const JITTER_RATIO = 0.2; // +/- 20% of the base delay -- mirrors server/src/services/snapcastLive.ts's own backoff shape (Task 25), not necessarily the exact same numbers.
/** Fixed (non-exponential) delay before reconnecting after a `shutdown` event -- the server told us it's restarting, likely within seconds, so there's no reason to treat this like a repeated failure. */
const SHUTDOWN_RECONNECT_DELAY_MS = 2000;

/** The subset of the real `EventSource` API this module actually uses -- lets tests inject a minimal fake instead of needing a real `EventSource` (jsdom, this project's Vitest environment, doesn't implement one). */
export interface EventSourceLike {
  addEventListener(type: string, listener: (event: MessageEvent) => void): void;
  close(): void;
}

export interface UseEventSourceDeps {
  /** Mints a fresh single-use ticket (via `POST /auth/sse-ticket`) and returns just the ticket string. */
  fetchTicket: () => Promise<string>;
  /** Creates a new EventSource connection attempt against the given URL. Defaults to the real `EventSource`. */
  createEventSource: (url: string) => EventSourceLike;
  setTimeoutFn: (cb: () => void, ms: number) => ReturnType<typeof setTimeout>;
  clearTimeoutFn: (t: ReturnType<typeof setTimeout>) => void;
  /** Returns a float in [0, 1) -- injectable so backoff-jitter tests are deterministic. */
  random: () => number;
  /** Applies a parsed `snapcast` SSE event's data directly to stores/snapcast.ts's state. */
  applySnapcastUpdate: (data: SnapcastGetStatusResult | null) => void;
}

const defaultDeps: UseEventSourceDeps = {
  fetchTicket: async () => {
    const res = await fetchApi<{ ticket: string; expiresAt: number }>('/auth/sse-ticket', { method: 'POST' });
    return res.ticket;
  },
  createEventSource: (url: string) => new EventSource(url) as unknown as EventSourceLike,
  setTimeoutFn: (cb, ms) => setTimeout(cb, ms),
  clearTimeoutFn: (t) => clearTimeout(t),
  random: () => Math.random(),
  applySnapcastUpdate: (data) => {
    const store = useSnapcastStore();
    store.status = data ? data.server : null;
  },
};

export interface EventSourceController {
  /** `'connecting' | 'connected' | 'reconnecting' | 'disconnected'` -- for a later Stage 4 task's "live / reconnecting" UI indicator. */
  status: Ref<SseConnectionStatus>;
  serviceStatuses: Ref<ServiceStatusEntry[]>;
  currentJob: Ref<JobSnapshot | null>;
  /** Idempotent: a no-op if already connecting/connected. */
  connect: () => void;
  /** Stops reconnection attempts and closes any live connection. */
  disconnect: () => void;
}

/**
 * Builds an independent controller instance. Production code uses the
 * app-wide singleton below (real `fetchApi`/`EventSource`); tests build
 * their own instance with fully injected fakes, matching
 * services/snapcastLive.ts's own deps-injection test style.
 */
export function createEventSourceController(overrideDeps: Partial<UseEventSourceDeps> = {}): EventSourceController {
  const deps: UseEventSourceDeps = { ...defaultDeps, ...overrideDeps };

  const status = ref<SseConnectionStatus>('disconnected');
  const serviceStatuses = ref<ServiceStatusEntry[]>([]);
  const currentJob = ref<JobSnapshot | null>(null);

  let es: EventSourceLike | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let reconnectAttempts = 0;
  let stopped = true; // connect() must be called explicitly -- nothing auto-starts on construction
  // Bumped on every connect()/disconnect(); every async callback (a ticket
  // fetch resolving, a scheduled reconnect firing) captures the generation
  // it was scheduled under and no-ops if it's since gone stale -- so a
  // disconnect() (or a fresh connect()) mid-flight can never have a late
  // callback resurrect a connection/timer that should be dead.
  let generation = 0;

  function closeCurrent(): void {
    if (reconnectTimer) {
      deps.clearTimeoutFn(reconnectTimer);
      reconnectTimer = null;
    }
    if (es) {
      es.close();
      es = null;
    }
  }

  function scheduleReconnect(fixedDelayMs?: number): void {
    if (stopped) return;
    status.value = 'reconnecting';

    let delay: number;
    if (fixedDelayMs !== undefined) {
      delay = fixedDelayMs;
    } else {
      reconnectAttempts += 1;
      const base = Math.min(INITIAL_BACKOFF_MS * Math.pow(BACKOFF_FACTOR, reconnectAttempts - 1), MAX_BACKOFF_MS);
      const jitter = base * JITTER_RATIO * (deps.random() * 2 - 1);
      delay = Math.max(0, Math.round(base + jitter));
    }

    const myGeneration = generation;
    reconnectTimer = deps.setTimeoutFn(() => {
      reconnectTimer = null;
      if (stopped || myGeneration !== generation) return;
      void openConnection();
    }, delay);
  }

  async function openConnection(): Promise<void> {
    if (stopped) return;
    status.value = reconnectAttempts > 0 ? 'reconnecting' : 'connecting';
    const myGeneration = generation;

    let ticket: string;
    try {
      ticket = await deps.fetchTicket();
    } catch {
      if (stopped || myGeneration !== generation) return;
      scheduleReconnect();
      return;
    }
    if (stopped || myGeneration !== generation) return;

    let newEs: EventSourceLike;
    try {
      newEs = deps.createEventSource(`/api/events?ticket=${encodeURIComponent(ticket)}`);
    } catch {
      // Mirrors services/snapcastLive.ts's own wsFactory() guard -- a
      // synchronous construction failure (malformed URL, browser refusing
      // for some reason) must not throw out of a fire-and-forget
      // `void openConnection()` call; just back off and retry.
      scheduleReconnect();
      return;
    }
    es = newEs;

    const isStale = () => stopped || myGeneration !== generation || es !== newEs;

    newEs.addEventListener('open', () => {
      if (isStale()) return;
      status.value = 'connected';
      reconnectAttempts = 0;
    });

    newEs.addEventListener('error', () => {
      if (isStale()) return;
      // Deliberately do NOT rely on EventSource's own built-in
      // auto-reconnect: it would retry this exact URL, whose ticket is
      // now dead (consumed or expired). Close it ourselves so the next
      // attempt goes through openConnection() again and mints a fresh one.
      newEs.close();
      es = null;
      scheduleReconnect();
    });

    newEs.addEventListener('snapcast', (event: MessageEvent) => {
      if (isStale()) return;
      deps.applySnapcastUpdate(JSON.parse(event.data));
    });

    newEs.addEventListener('service-status', (event: MessageEvent) => {
      if (isStale()) return;
      serviceStatuses.value = JSON.parse(event.data);
    });

    newEs.addEventListener('job', (event: MessageEvent) => {
      if (isStale()) return;
      currentJob.value = JSON.parse(event.data);
    });

    newEs.addEventListener('shutdown', () => {
      if (isStale()) return;
      // The server is telling us it's about to close this connection as
      // part of a graceful restart (Task 27) -- proactively close and
      // reconnect after a short fixed delay instead of waiting for the
      // connection to error out on its own first.
      newEs.close();
      es = null;
      reconnectAttempts = 0;
      scheduleReconnect(SHUTDOWN_RECONNECT_DELAY_MS);
    });
  }

  function connect(): void {
    if (!stopped) return; // already connecting/connected -- idempotent
    stopped = false;
    generation += 1;
    reconnectAttempts = 0;
    void openConnection();
  }

  function disconnect(): void {
    stopped = true;
    generation += 1; // invalidates any in-flight ticket fetch or pending timer callback
    closeCurrent();
    status.value = 'disconnected';
  }

  return { status, serviceStatuses, currentJob, connect, disconnect };
}

let singleton: EventSourceController | null = null;

/**
 * The app-wide singleton (see task-28-brief.md: one shared connection
 * updates multiple Pinia stores app-wide, not one connection per
 * view/component). Built lazily on first call, not at module load, so its
 * default deps (which call `useSnapcastStore()`) only run once Pinia is
 * actually active.
 */
export function useEventSource(): EventSourceController {
  if (!singleton) singleton = createEventSourceController();
  return singleton;
}
