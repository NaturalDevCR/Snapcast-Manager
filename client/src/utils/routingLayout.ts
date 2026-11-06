// Layout model for the Audio Matrix (Routing.vue).
//
// A zone plays exactly one source, so the routing graph is a set of stars:
// putting each source on the same row as its zones means no two cables ever
// cross and none of them leaves the row, however many sources and zones
// exist. That's what this groups the flat status lists into.
import type { SnapcastGroup, SnapcastStream } from '../stores/snapcast';

export interface RoutingLane {
  /** `null` for the lane of zones with no source, or one that no longer exists. */
  stream: SnapcastStream | null;
  zones: SnapcastGroup[];
}

export interface RoutingLayout {
  lanes: RoutingLane[];
  /** Sources no zone plays: still draggable, kept apart so they don't push the routed lanes down. */
  unusedStreams: SnapcastStream[];
}

export function buildRoutingLayout(
  streams: SnapcastStream[],
  groups: SnapcastGroup[],
): RoutingLayout {
  const zonesByStream = new Map<string, SnapcastGroup[]>(streams.map((stream) => [stream.id, []]));
  const unassigned: SnapcastGroup[] = [];

  for (const group of groups) {
    const zones = zonesByStream.get(group.stream_id);
    if (zones) zones.push(group);
    else unassigned.push(group);
  }

  const lanes: RoutingLane[] = [];
  const unusedStreams: SnapcastStream[] = [];
  if (unassigned.length) lanes.push({ stream: null, zones: unassigned });
  for (const stream of streams) {
    const zones = zonesByStream.get(stream.id) ?? [];
    if (zones.length) lanes.push({ stream, zones });
    else unusedStreams.push(stream);
  }

  return { lanes, unusedStreams };
}

/**
 * Keeps whole lanes whose source matches and, elsewhere, only the matching
 * zones. Search text comes from the caller, which owns the display labels.
 */
export function filterRoutingLayout(
  layout: RoutingLayout,
  query: string,
  streamText: (stream: SnapcastStream) => string,
  zoneText: (zone: SnapcastGroup) => string,
): RoutingLayout {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return layout;
  const matches = (text: string) => text.toLocaleLowerCase().includes(needle);

  return {
    lanes: layout.lanes.flatMap((lane) => {
      if (lane.stream && matches(streamText(lane.stream))) return [lane];
      const zones = lane.zones.filter((zone) => matches(zoneText(zone)));
      return zones.length ? [{ ...lane, zones }] : [];
    }),
    unusedStreams: layout.unusedStreams.filter((stream) => matches(streamText(stream))),
  };
}
