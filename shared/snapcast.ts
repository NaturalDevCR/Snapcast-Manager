// Task 25: shapes for snapserver's JSON-RPC `Server.GetStatus` result, split
// out into shared/ (Task 23's cross-boundary types dir) so both
// server/src/services/snapcastLive.ts's in-memory cache AND a later Stage 4
// client task consuming GET /api/events can type against the exact same
// fields, instead of each side hand-rolling its own (client/src/stores/
// snapcast.ts already does exactly that today -- SnapcastClient/
// SnapcastStream/SnapcastGroup/SnapcastStatus -- this file mirrors those
// shapes field-for-field but is NOT wired into that store; out of scope for
// this task is touching any .vue file or client store, so the client keeps
// its own copy until a later task switches it over).
//
// Field shapes verified against the real, stable Snapcast JSON-RPC API
// (`Server.GetStatus`'s documented result and the corresponding
// notification payloads) -- see snapcastLive.ts's own header comment for
// exactly which notification types were verified this way vs. handled via
// fallback-refetch, and task-25-report.md for the full accounting of what
// docs/snapcast-main-docs.md in this repo does/doesn't cover.

export interface SnapcastClientVolume {
  muted: boolean;
  percent: number;
}

export interface SnapcastClientHost {
  ip: string;
  mac: string;
  name: string;
  os: string;
}

export interface SnapcastClientConfig {
  name: string;
  volume: SnapcastClientVolume;
}

export interface SnapcastClient {
  id: string;
  host: SnapcastClientHost;
  config: SnapcastClientConfig;
  connected: boolean;
}

export interface SnapcastStreamUri {
  query: {
    name?: string;
  };
  scheme: string; // "tcp", "pipe", etc.
}

export interface SnapcastStream {
  id: string;
  status: string; // "playing", "idle"
  uri: SnapcastStreamUri;
}

export interface SnapcastGroup {
  id: string;
  name: string;
  clients: SnapcastClient[];
  stream_id: string;
  muted: boolean;
}

export interface SnapcastServerInfo {
  version: string;
}

/** The inner "server" object of a `Server.GetStatus` result -- host/version info plus groups/streams. */
export interface SnapcastServerState {
  server: SnapcastServerInfo;
  groups: SnapcastGroup[];
  streams: SnapcastStream[];
}

/**
 * The FULL `Server.GetStatus` JSON-RPC result -- i.e. exactly what
 * `server/src/utils/snapcastRpc.ts`'s `executeSnapcastRpc('Server.GetStatus')`
 * resolves to, and what `GET /api/snapcast/status` has always returned under
 * its `status` key (client/src/stores/snapcast.ts's `fetchStatus()` reads
 * `data.status.server`). Kept as the outer wrapper -- not flattened to
 * `SnapcastServerState` -- so this task's route/cache changes don't alter
 * that existing public response shape.
 */
export interface SnapcastGetStatusResult {
  server: SnapcastServerState;
}
