import { EventEmitter } from 'events';
import WebSocket from 'ws';
import { logger } from '../logger';
import { executeSnapcastRpc } from '../utils/snapcastRpc';
import type {
  SnapcastGetStatusResult,
  SnapcastClient,
  SnapcastGroup,
  SnapcastServerState,
  SnapcastStream,
} from '@shared/snapcast';

// Task 25: a long-lived WebSocket connection to snapserver's JSON-RPC
// endpoint (`ws://127.0.0.1:1780/jsonrpc` -- the exact same host:port
// server/src/utils/snapcastRpc.ts's one-shot HTTP client already talks to,
// per docs/superpowers/specs/2026-08-18-professional-hardening-design.md
// finding #20). Maintains an in-memory cache of the last-known
// `Server.GetStatus` result, kept current by applying incoming
// notifications' deltas in place rather than re-fetching full status on
// every single event.
//
// ---- Notification schema: what this was verified against ----
// The task brief points at docs/snapcast-main-docs.md in this repo for the
// exact JSON-RPC/notification payload shapes. That file (checked directly --
// see task-25-report.md) only documents `[stream]` source URIs and the
// `[http]`/`[ssl]` config sections; it does NOT contain the JSON-RPC
// control-API section (no `json_rpc_api/control.md` equivalent exists
// anywhere in this repo). The notification method names and param shapes
// below instead come from Snapcast's long-stable, publicly documented
// JSON-RPC control API (https://github.com/badaix/snapcast --
// doc/json_rpc_api/control.md upstream), which has not changed shape across
// Snapcast releases in the project's history. This could not be verified
// against a live snapserver process in this sandbox (no snapserver
// installed here -- see task-25-report.md's Concerns section). Every
// notification type NOT given a precise merge below (including if any of
// the shapes above turn out subtly wrong in the field) falls back to a full
// `Server.GetStatus` refetch instead of silently dropping the update or
// guessing at an unverified payload shape, per the brief's explicit
// fallback-refetch guidance.
//
// ---- Write-path routing: HTTP only, not WS ----
// This client is a PURE listener: it never sends JSON-RPC requests over the
// WebSocket, for either reads or writes. The one-off `Server.GetStatus`
// call this module itself needs (on every successful (re)connect, and as
// the fallback path for an unmerged notification) goes through the
// existing, already-tested `executeSnapcastRpc()` HTTP client -- exactly
// like `routes/snapcast.ts`'s write endpoints (`Group.SetStream`,
// `Client.SetVolume`, etc.) continue to. This sidesteps building any
// request/response correlation (matching a sent request's `id` back to its
// eventual WS response) entirely: the WS connection's only job is receiving
// server-pushed notifications, which are trivially distinguishable from
// responses (a notification has no `id` field, straight JSON-RPC 2.0). A
// write's own resulting state change still reaches this cache promptly --
// snapserver broadcasts the same `Client.OnVolumeChanged`/`Group.OnMute`/etc.
// notifications to every connected client (including this one) as a
// consequence of that write's own RPC-over-HTTP call, not just to callers
// who made the RPC over WS. See task-25-report.md for the full reasoning.

const WS_URL = 'ws://127.0.0.1:1780/jsonrpc';

const INITIAL_BACKOFF_MS = 1000;
const MAX_BACKOFF_MS = 30_000;
const BACKOFF_FACTOR = 2;
const JITTER_RATIO = 0.2; // +/- 20% of the base delay
/** Log a connection failure on the 1st attempt, then only every Nth after that, so a permanently-absent snapserver can't flood the console (brief requirement). */
const LOG_EVERY_N_FAILURES = 10;

/** The subset of `ws`'s `WebSocket` surface this module actually uses -- lets tests inject a minimal fake instead of mocking the `ws` module itself. */
export interface WsLike {
  on(event: 'open' | 'message' | 'close' | 'error', listener: (...args: any[]) => void): void;
  close(): void;
  removeAllListeners?(): void;
}

export interface Logger {
  error(message: string): void;
}

export interface SnapcastLiveDeps {
  /** Creates a new WS connection attempt. Defaults to a real `ws` WebSocket. */
  wsFactory: (url: string) => WsLike;
  /** Fetches a full `Server.GetStatus` result. Defaults to the existing HTTP client. */
  fetchStatus: () => Promise<SnapcastGetStatusResult>;
  setTimeoutFn: (cb: () => void, ms: number) => NodeJS.Timeout;
  clearTimeoutFn: (t: NodeJS.Timeout) => void;
  /** Returns a float in [0, 1) -- injectable so backoff-jitter tests are deterministic. */
  random: () => number;
  logger: Logger;
}

// Task 27: a pino child logger satisfies this module's own minimal `Logger`
// interface (just `.error(message: string)`) with no wrapper needed -- pino
// accepts a plain string as its sole argument exactly like console.error
// did. Tests never use this default (see snapcastLive.test.ts's own fake
// `logger` passed via SnapcastLiveDeps), so swapping it out here doesn't
// touch any test's behavior.
const defaultDeps: SnapcastLiveDeps = {
  wsFactory: (url: string) => new WebSocket(url) as unknown as WsLike,
  fetchStatus: () => executeSnapcastRpc<SnapcastGetStatusResult>('Server.GetStatus'),
  setTimeoutFn: (cb, ms) => setTimeout(cb, ms),
  clearTimeoutFn: (t) => clearTimeout(t),
  random: () => Math.random(),
  logger: logger.child({ component: 'snapcastLive' }),
};

/** Notification methods this module applies as a precise in-place cache merge, without a full refetch. Anything else falls back to fetchStatus(). */
const PRECISE_MERGE_METHODS = new Set([
  'Server.OnUpdate',
  'Client.OnConnect',
  'Client.OnDisconnect',
  'Client.OnVolumeChanged',
  'Client.OnNameChanged',
  'Group.OnStreamChanged',
  'Group.OnMute',
  'Group.OnNameChanged',
  'Stream.OnUpdate',
]);

/**
 * Structural guard for a `Server.OnUpdate` replacement `server` object.
 * `applyPreciseMerge`'s OTHER handlers all dereference `status.server.groups`
 * / `status.server.streams` as arrays (`.find`, `.findIndex`, `.push`) --
 * accepting a `server` replacement without checking those are actually
 * arrays leaves a landmine for the very next notification to step on and
 * throw uncaught (reproduced live: a `Server.OnUpdate` missing `groups`
 * followed by a `Group.OnMute` threw `Cannot read properties of undefined
 * (reading 'find')`). This checks exactly the substructure this file's own
 * merge logic depends on -- not a full deep schema validation.
 */
function isValidServerState(server: any): server is SnapcastServerState {
  return !!server && typeof server === 'object' && Array.isArray(server.groups) && Array.isArray(server.streams);
}

/**
 * Structural guard for a `client` object accepted wholesale by
 * `Client.OnConnect`/`Client.OnDisconnect`. Nothing in the merge itself
 * dereferences these subfields, but an under-validated object here would
 * sit in the cache and be served verbatim to `GET /api/snapcast/status`
 * callers, and would then be exactly the kind of malformed shape that could
 * crash a LATER `Client.OnVolumeChanged`/`OnNameChanged` merge (which does
 * write into `client.config.volume`/`client.config.name`). Mirrors
 * `SnapcastClient`'s shape in shared/snapcast.ts.
 */
function isValidClient(client: any): client is SnapcastClient {
  return (
    !!client &&
    typeof client === 'object' &&
    typeof client.id === 'string' &&
    !!client.host &&
    typeof client.host === 'object' &&
    !!client.config &&
    typeof client.config === 'object' &&
    typeof client.config.name === 'string' &&
    !!client.config.volume &&
    typeof client.config.volume === 'object' &&
    typeof client.config.volume.percent === 'number' &&
    typeof client.config.volume.muted === 'boolean' &&
    typeof client.connected === 'boolean'
  );
}

/**
 * Structural guard for a `stream` object accepted wholesale by
 * `Stream.OnUpdate`. Same rationale as `isValidClient` above -- mirrors
 * `SnapcastStream`'s shape in shared/snapcast.ts.
 */
function isValidStream(stream: any): stream is SnapcastStream {
  return (
    !!stream &&
    typeof stream === 'object' &&
    typeof stream.id === 'string' &&
    typeof stream.status === 'string' &&
    !!stream.uri &&
    typeof stream.uri === 'object' &&
    typeof stream.uri.scheme === 'string'
  );
}

export class SnapcastLiveClient extends EventEmitter {
  private deps: SnapcastLiveDeps;
  private ws: WsLike | null = null;
  private cache: SnapcastGetStatusResult | null = null;
  private reconnectAttempts = 0;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private stopped = true;
  // Task 57: tracks whether the WS is genuinely OPEN right now, for the
  // health-check endpoint's `snapserver.rpcConnected` field. Deliberately
  // NOT derived from `this.ws !== null` -- `connect()` below assigns
  // `this.ws` the moment the socket is constructed, before its 'open'
  // event fires, so a bare null-check would report "connected" during the
  // in-flight connection attempt too. `WsLike` (this module's minimal
  // injectable WebSocket surface -- see its interface above) exposes no
  // `readyState`, so an own flag, flipped exactly on 'open'/'close', is the
  // correct and simplest signal here.
  private connected = false;

  constructor(deps: Partial<SnapcastLiveDeps> = {}) {
    super();
    // Concurrent SSE clients each add an 'update' listener to this SAME
    // singleton instance (see routes/events.ts) -- EventEmitter's default
    // cap of 10 listeners would otherwise print a spurious
    // MaxListenersExceededWarning well within this app's normal multi-tab
    // usage.
    this.setMaxListeners(0);
    this.deps = { ...defaultDeps, ...deps };
  }

  /** Begins connecting (idempotent -- safe to call again after stop()). */
  start(): void {
    this.stopped = false;
    this.connect();
  }

  /** Stops reconnecting and closes any live connection. Mainly for tests/graceful shutdown. */
  stop(): void {
    this.stopped = true;
    if (this.reconnectTimer) {
      this.deps.clearTimeoutFn(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.removeAllListeners?.();
      this.ws.close();
      this.ws = null;
    }
  }

  /** The last-known full status, or `null` if no successful `Server.GetStatus` has completed yet. */
  getCachedStatus(): SnapcastGetStatusResult | null {
    return this.cache;
  }

  /** Task 57: whether the WebSocket to snapserver's JSON-RPC endpoint is currently OPEN (see the `connected` field's comment above for why this isn't a bare `this.ws !== null` check). Read-only -- used by GET /api/health/detail. */
  get isConnected(): boolean {
    return this.connected;
  }

  private connect(): void {
    if (this.stopped) return;

    let ws: WsLike;
    try {
      ws = this.deps.wsFactory(WS_URL);
    } catch (err: any) {
      this.logFailure(err);
      this.scheduleReconnect();
      return;
    }
    this.ws = ws;

    ws.on('open', () => {
      this.connected = true;
      this.reconnectAttempts = 0;
      this.refreshFullStatus('initial connect');
    });

    ws.on('message', (data: unknown) => {
      this.handleMessage(data);
    });

    ws.on('error', (err: Error) => {
      this.logFailure(err);
    });

    ws.on('close', () => {
      this.ws = null;
      this.connected = false;
      if (!this.stopped) this.scheduleReconnect();
    });
  }

  private scheduleReconnect(): void {
    if (this.stopped) return;
    this.reconnectAttempts += 1;
    const base = Math.min(
      INITIAL_BACKOFF_MS * Math.pow(BACKOFF_FACTOR, this.reconnectAttempts - 1),
      MAX_BACKOFF_MS,
    );
    const jitter = base * JITTER_RATIO * (this.deps.random() * 2 - 1);
    const delay = Math.max(0, Math.round(base + jitter));
    this.reconnectTimer = this.deps.setTimeoutFn(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  private logFailure(err: Error): void {
    // reconnectAttempts is bumped by scheduleReconnect() AFTER this runs
    // (on 'close'), so "attempt N" here means the Nth consecutive failure,
    // counting the one currently happening as attempt reconnectAttempts + 1.
    const attemptNumber = this.reconnectAttempts + 1;
    if (attemptNumber === 1 || attemptNumber % LOG_EVERY_N_FAILURES === 0) {
      this.deps.logger.error(
        `[snapcastLive] WebSocket connection to ${WS_URL} failed (attempt ${attemptNumber}): ${err?.message ?? err}`,
      );
    }
  }

  private refreshFullStatus(context: string): void {
    this.deps
      .fetchStatus()
      .then((result) => {
        this.cache = result;
        this.emit('update', this.cache);
      })
      .catch((err: any) => {
        this.deps.logger.error(`[snapcastLive] Server.GetStatus (${context}) failed: ${err?.message ?? err}`);
      });
  }

  private handleMessage(raw: unknown): void {
    let msg: any;
    try {
      const text = typeof raw === 'string' ? raw : String(raw);
      msg = JSON.parse(text);
    } catch {
      return;
    }
    if (!msg || typeof msg !== 'object') return;
    // Responses to requests WE sent carry an `id`; this module never sends
    // requests over the WS (see this file's header), so any `id`-bearing
    // message here isn't one we're expecting -- ignore it rather than
    // misinterpreting it as a notification.
    if (msg.id !== undefined) return;
    if (typeof msg.method !== 'string') return;
    this.handleNotification(msg.method, msg.params ?? {});
  }

  private handleNotification(method: string, params: any): void {
    if (!this.cache) {
      // Nothing to merge into yet -- a full fetch is the only correct move.
      this.refreshFullStatus(`no base cache for ${method}`);
      return;
    }
    // Defense in depth: applyPreciseMerge()'s handlers are each individually
    // guarded against the malformed-payload shapes we've anticipated, but
    // the notification schema itself is verified against public docs, not a
    // live snapserver (see this file's header comment) -- there could be an
    // entirely unanticipated shape that still slips past a handler's own
    // checks and throws. A synchronous throw from a `ws` 'message' listener
    // has nothing else to catch it and would crash the whole process, so
    // this catches ANY exception from merge logic and falls back to a full
    // refetch rather than letting it escape uncaught.
    let merged: boolean;
    try {
      merged = PRECISE_MERGE_METHODS.has(method) && this.applyPreciseMerge(method, params);
    } catch (err: any) {
      this.deps.logger.error(
        `[snapcastLive] unexpected error applying ${method} notification, falling back to refetch: ${err?.message ?? err}`,
      );
      this.refreshFullStatus(`exception applying ${method}`);
      return;
    }
    if (!merged) {
      this.refreshFullStatus(`fallback for ${method}`);
      return;
    }
    this.emit('update', this.cache);
  }

  /** Returns true if the merge was applied precisely; false means "fall back to a full refetch". */
  private applyPreciseMerge(method: string, params: any): boolean {
    const status = this.cache!;
    switch (method) {
      case 'Server.OnUpdate': {
        // Server.OnUpdate's params carry a full replacement `server` object
        // -- same shape as Server.GetStatus's own result.server -- a
        // genuine full-cache replacement, not a delta merge. Every OTHER
        // handler below reads/writes `status.server.groups`/`.streams` as
        // arrays, so a replacement missing that substructure must be
        // rejected here -- otherwise it's accepted silently and the very
        // next notification (e.g. Group.OnMute doing
        // `status.server.groups.find(...)`) throws on `undefined`.
        if (!params || typeof params !== 'object' || !isValidServerState(params.server)) return false;
        status.server = params.server;
        return true;
      }
      case 'Client.OnConnect':
      case 'Client.OnDisconnect': {
        const id: string | undefined = params?.id;
        const client: unknown = params?.client;
        if (!id || !isValidClient(client)) return false;
        const group = this.findGroupWithClient(status, id);
        if (!group) return false; // brand-new client we've never seen -- unknown group placement, refetch instead of guessing
        const idx = group.clients.findIndex((c) => c.id === id);
        group.clients[idx] = client;
        return true;
      }
      case 'Client.OnVolumeChanged': {
        const id: string | undefined = params?.id;
        const volume = params?.volume;
        if (!id || !volume || typeof volume.percent !== 'number' || typeof volume.muted !== 'boolean') return false;
        const client = this.findClient(status, id);
        if (!client) return false;
        client.config.volume = volume;
        return true;
      }
      case 'Client.OnNameChanged': {
        const id: string | undefined = params?.id;
        const name = params?.name;
        if (!id || typeof name !== 'string') return false;
        const client = this.findClient(status, id);
        if (!client) return false;
        client.config.name = name;
        return true;
      }
      case 'Group.OnStreamChanged': {
        const id: string | undefined = params?.id;
        const streamId = params?.stream_id;
        if (!id || typeof streamId !== 'string') return false;
        const group = status.server.groups.find((g) => g.id === id);
        if (!group) return false;
        group.stream_id = streamId;
        return true;
      }
      case 'Group.OnMute': {
        const id: string | undefined = params?.id;
        const mute = params?.mute;
        if (!id || typeof mute !== 'boolean') return false;
        const group = status.server.groups.find((g) => g.id === id);
        if (!group) return false;
        group.muted = mute;
        return true;
      }
      case 'Group.OnNameChanged': {
        const id: string | undefined = params?.id;
        const name = params?.name;
        if (!id || typeof name !== 'string') return false;
        const group = status.server.groups.find((g) => g.id === id);
        if (!group) return false;
        group.name = name;
        return true;
      }
      case 'Stream.OnUpdate': {
        const id: string | undefined = params?.id;
        const stream: unknown = params?.stream;
        if (!id || !isValidStream(stream)) return false;
        const idx = status.server.streams.findIndex((s) => s.id === id);
        if (idx === -1) {
          status.server.streams.push(stream);
        } else {
          status.server.streams[idx] = stream;
        }
        return true;
      }
      default:
        return false;
    }
  }

  private findGroupWithClient(status: SnapcastGetStatusResult, clientId: string): SnapcastGroup | undefined {
    return status.server.groups.find((g) => g.clients.some((c) => c.id === clientId));
  }

  private findClient(status: SnapcastGetStatusResult, clientId: string): SnapcastClient | undefined {
    for (const group of status.server.groups) {
      const found = group.clients.find((c) => c.id === clientId);
      if (found) return found;
    }
    return undefined;
  }
}

export const snapcastLive = new SnapcastLiveClient();
