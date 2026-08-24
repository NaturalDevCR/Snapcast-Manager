// Task 29: shared label/variant mapping for the "live / reconnecting" SSE
// status indicator (rendered with Badge.vue) used by Dashboard.vue and
// Routing.vue -- the first two real consumers of useEventSource()'s
// connection-status value (Task 28). A plain function, not a Vue component
// -- the brief is explicit that a general-purpose indicator component isn't
// warranted here, just reuse of this one small mapping so the two views
// render the same thing instead of drifting.
import type { SseConnectionStatus } from '../composables/useEventSource';

// Mirrors Badge.vue's BadgeProps['variant'] literals (minus 'brand', which
// has no use here) -- kept as a local literal union instead of importing
// the type from the .vue SFC to avoid coupling this plain module to Vue's
// component type-extraction.
export type SseStatusBadgeVariant = 'success' | 'warning' | 'danger' | 'neutral';

export interface SseStatusBadge {
  variant: SseStatusBadgeVariant;
  label: string;
}

const SSE_STATUS_BADGES: Record<SseConnectionStatus, SseStatusBadge> = {
  connected: { variant: 'success', label: 'Live' },
  connecting: { variant: 'neutral', label: 'Connecting…' },
  reconnecting: { variant: 'warning', label: 'Reconnecting…' },
  disconnected: { variant: 'danger', label: 'Offline' },
};

export function sseStatusBadge(status: SseConnectionStatus): SseStatusBadge {
  return SSE_STATUS_BADGES[status];
}
