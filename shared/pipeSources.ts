// Task 23: request/response shapes for /api/pipe-sources, shared between
// server/src/routes/pipeSources.ts (+ its Zod schemas in
// server/src/schemas/pipeSources.ts) and client/src/stores/pipeSources.ts.
// These mirror the fields server/src/services/pipeSources.ts's own
// `PipeSource`/`PipeSourceWithStatus`/`ExistingService`/`DiscoveredPipe`
// interfaces already define -- kept here as the single cross-boundary
// source of truth rather than duplicated (see task-23-brief.md's finding
// #29). The service module keeps its own copies for its internal use
// (unaffected by this task, per scope).

export type PipeSourceType = 'radio' | 'mpd';

export type PipeSourceControlAction = 'start' | 'stop' | 'restart' | 'enable' | 'disable';

/** A pipe source as returned by the API (GET list / create / update / adopt). */
export interface PipeSource {
  id: string;
  name: string;
  type: PipeSourceType;
  url: string;
  reconnect: boolean;
  reconnectStreamed: boolean;
  reconnectAtEof: boolean;
  reconnectDelayMax: number;
  idleThreshold: number;
  enabled: boolean;
  createdAt: string;
  status: string;
  fifoPath: string;
  serviceName: string;
}

/** Request body for POST /api/pipe-sources. */
export type CreatePipeSourceInput = Omit<PipeSource, 'id' | 'createdAt' | 'status' | 'fifoPath' | 'serviceName'>;

/** Request body for PUT /api/pipe-sources/:id -- a partial update. */
export type UpdatePipeSourceInput = Partial<CreatePipeSourceInput>;

/** Request body for POST /api/pipe-sources/adopt. */
export interface AdoptPipeSourceInput extends CreatePipeSourceInput {
  existingServiceName?: string;
}

/** Request body for POST /api/pipe-sources/:id/control. */
export interface ControlPipeSourceInput {
  action: PipeSourceControlAction;
}

/** Request body for PUT /api/pipe-sources/:id/config. */
export interface SetPipeSourceConfigInput {
  content: string;
}

/** A systemd unit discovered on disk that a DiscoveredPipe may already have. */
export interface ExistingService {
  name: string;
  filePath: string;
  url: string;
  reconnect: boolean;
  reconnectStreamed: boolean;
  reconnectAtEof: boolean;
  reconnectDelayMax: number;
  isActive: boolean;
}

/** An entry returned by GET /api/pipe-sources/discover. */
export interface DiscoveredPipe {
  name: string;
  fifoPath: string;
  sourceUri: string;
  idleThreshold: number;
  detectedType: PipeSourceType;
  existingService: ExistingService | null;
}
