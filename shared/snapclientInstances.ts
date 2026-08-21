// Task 23: request/response shapes for /api/snapclient-instances, shared
// between server/src/routes/snapclientInstances.ts (+ its Zod schemas in
// server/src/schemas/snapclientInstances.ts) and
// client/src/stores/snapclientInstances.ts. Mirrors
// server/src/services/snapclientInstances.ts's own `SnapclientInstance` /
// `AlsaControl` / `AudioDevice` interfaces -- see shared/pipeSources.ts's
// header comment for why this is a separate copy rather than importing the
// service's.

export interface SnapclientInstance {
  id: string;
  name: string;
  host: string;
  port: number;
  soundcard: string;
  hostId: string | null;
  instanceNum: number;
  enabled: boolean;
  status: string;
}

export interface AlsaControl {
  name: string;
  percent: number;
}

/** As returned by GET /api/snapclient-instances/devices (includes the route's added `inUse`). */
export interface AudioDevice {
  cardNumber: number;
  cardId: string;
  cardName: string;
  device: number;
  deviceName: string;
  hwId: string;
  label: string;
  inUse: boolean;
}

export type SnapclientControlAction = 'start' | 'stop' | 'restart' | 'enable' | 'disable';

/**
 * Request body for POST /api/snapclient-instances, AFTER validation --
 * `host`/`port` are always present (the schema defaults them to
 * '127.0.0.1'/1704 when omitted on the wire; see
 * server/src/schemas/snapclientInstances.ts).
 */
export interface CreateSnapclientInstanceInput {
  name: string;
  host: string;
  port: number;
  soundcard: string;
  hostId?: string;
}

/** Request body for PUT /api/snapclient-instances/:id -- a partial update. */
export type UpdateSnapclientInstanceInput = Partial<CreateSnapclientInstanceInput>;

/** Request body for POST /api/snapclient-instances/alsa/:cardId. */
export interface SetAlsaVolumeInput {
  control: string;
  percent: number;
}

/** Request params for POST /api/snapclient-instances/:id/:action. */
export interface ControlSnapclientInstanceParams {
  id: string;
  action: SnapclientControlAction;
}
