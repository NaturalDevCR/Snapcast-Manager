import { describe, expect, it } from 'vitest';
import type { SnapcastGroup, SnapcastStream } from '../../stores/snapcast';
import { buildRoutingLayout, filterRoutingLayout } from '../routingLayout';

const stream = (id: string): SnapcastStream => ({
  id,
  status: 'idle',
  uri: { query: { name: id }, scheme: 'pipe' },
});
const zone = (id: string, streamId: string): SnapcastGroup => ({
  id,
  name: id,
  clients: [],
  stream_id: streamId,
  muted: false,
});

const ids = (layout: ReturnType<typeof buildRoutingLayout>) => ({
  lanes: layout.lanes.map((lane) => [lane.stream?.id ?? null, lane.zones.map((z) => z.id)]),
  unused: layout.unusedStreams.map((s) => s.id),
});

describe('buildRoutingLayout', () => {
  it('puts every zone on the lane of its source, keeping server order', () => {
    const layout = buildRoutingLayout(
      [stream('a'), stream('b')],
      [zone('z1', 'b'), zone('z2', 'a'), zone('z3', 'b')],
    );

    expect(ids(layout)).toEqual({
      lanes: [
        ['a', ['z2']],
        ['b', ['z1', 'z3']],
      ],
      unused: [],
    });
  });

  it('keeps sources no zone plays apart from the routed lanes', () => {
    const layout = buildRoutingLayout([stream('a'), stream('b'), stream('c')], [zone('z1', 'b')]);

    expect(ids(layout)).toEqual({ lanes: [['b', ['z1']]], unused: ['a', 'c'] });
  });

  it('leads with zones that have no source or point at a removed one', () => {
    const layout = buildRoutingLayout(
      [stream('a')],
      [zone('z1', 'a'), zone('z2', ''), zone('z3', 'gone')],
    );

    expect(ids(layout)).toEqual({
      lanes: [
        [null, ['z2', 'z3']],
        ['a', ['z1']],
      ],
      unused: [],
    });
  });
});

describe('filterRoutingLayout', () => {
  const layout = buildRoutingLayout(
    [stream('Radio'), stream('Jazz'), stream('Spare')],
    [zone('Kitchen', 'Radio'), zone('Patio', 'Radio'), zone('Office', 'Jazz'), zone('Lost', '')],
  );
  const filter = (query: string) =>
    ids(
      filterRoutingLayout(
        layout,
        query,
        (s) => s.id,
        (z) => z.id,
      ),
    );

  it('returns the layout untouched for a blank query', () => {
    expect(
      filterRoutingLayout(
        layout,
        '   ',
        (s) => s.id,
        (z) => z.id,
      ),
    ).toBe(layout);
  });

  it('keeps a whole lane when its source matches, ignoring case', () => {
    expect(filter('RADIO')).toEqual({ lanes: [['Radio', ['Kitchen', 'Patio']]], unused: [] });
  });

  it('keeps only the matching zones when the source does not match', () => {
    expect(filter('pat')).toEqual({ lanes: [['Radio', ['Patio']]], unused: [] });
  });

  it('also searches unassigned zones and unused sources', () => {
    expect(filter('lost')).toEqual({ lanes: [[null, ['Lost']]], unused: [] });
    expect(filter('spare')).toEqual({ lanes: [], unused: ['Spare'] });
  });
});
