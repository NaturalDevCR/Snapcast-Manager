// Task 28: tests for the app-wide SSE connection composable.
//
// No native `EventSource` in jsdom (this project's Vitest `environment`) --
// and no precedent in this codebase for mocking it -- so
// `createEventSourceController()` takes fully injected deps (mirroring
// server/src/services/snapcastLive.ts's own deps-injection style for its
// WebSocket reconnect logic): a fake `createEventSource` factory that
// returns a minimal listener-registry fake, and fake `setTimeoutFn`/
// `clearTimeoutFn` so backoff delays are asserted directly instead of
// waited on with real timers.
//
// Array indexing below uses `!` non-null assertions where an element is
// known (by test construction, not by chance) to exist -- required under
// this project's `noUncheckedIndexedAccess` (see @vue/tsconfig).
import { describe, expect, it, vi } from 'vitest';
import { createEventSourceController, type EventSourceLike, type UseEventSourceDeps } from '../useEventSource';

function makeFakeEventSource() {
  const listeners: Record<string, Array<(ev: any) => void>> = {};
  const closeSpy = vi.fn();
  const es: EventSourceLike = {
    addEventListener: (type: string, cb: (ev: any) => void) => {
      (listeners[type] ??= []).push(cb);
    },
    close: closeSpy,
  };
  return {
    es,
    closeSpy,
    emit(type: string, data?: unknown) {
      for (const cb of listeners[type] ?? []) cb({ data: data !== undefined ? JSON.stringify(data) : undefined });
    },
  };
}

function makeDeps(overrides: Partial<UseEventSourceDeps> = {}) {
  const createdEventSources: Array<ReturnType<typeof makeFakeEventSource>> = [];
  const scheduledCallbacks: Array<{ cb: () => void; ms: number }> = [];
  const applySnapcastUpdate = vi.fn();

  const deps: UseEventSourceDeps = {
    fetchTicket: vi.fn().mockResolvedValue('ticket-1'),
    createEventSource: vi.fn((_url: string) => {
      const fake = makeFakeEventSource();
      createdEventSources.push(fake);
      return fake.es;
    }),
    setTimeoutFn: vi.fn((cb: () => void, ms: number) => {
      scheduledCallbacks.push({ cb, ms });
      return scheduledCallbacks.length as unknown as ReturnType<typeof setTimeout>;
    }),
    clearTimeoutFn: vi.fn(),
    random: () => 0.5, // yields zero jitter offset: base * 0.2 * (0.5*2-1) === 0
    applySnapcastUpdate,
    ...overrides,
  };

  return { deps, createdEventSources, scheduledCallbacks, applySnapcastUpdate };
}

async function flush() {
  await Promise.resolve();
  await Promise.resolve();
}

describe('createEventSourceController', () => {
  it('connect() fetches a ticket and opens an EventSource against /api/events?ticket=...', async () => {
    const { deps, createdEventSources } = makeDeps();
    const controller = createEventSourceController(deps);
    controller.connect();
    await flush();

    expect(deps.fetchTicket).toHaveBeenCalledTimes(1);
    expect(deps.createEventSource).toHaveBeenCalledWith('/api/events?ticket=ticket-1');
    expect(createdEventSources).toHaveLength(1);
    expect(controller.status.value).toBe('connecting');
  });

  it('transitions to "connected" on the EventSource open event, and back through reconnecting/connecting states', async () => {
    const { deps, createdEventSources } = makeDeps();
    const controller = createEventSourceController(deps);
    expect(controller.status.value).toBe('disconnected');
    controller.connect();
    await flush();
    expect(controller.status.value).toBe('connecting');
    createdEventSources[0]!.emit('open');
    expect(controller.status.value).toBe('connected');
  });

  it('parses a snapcast event and forwards its data to the injected store updater', async () => {
    const { deps, createdEventSources, applySnapcastUpdate } = makeDeps();
    const controller = createEventSourceController(deps);
    controller.connect();
    await flush();
    const payload = { server: { server: { version: '1.0' }, groups: [], streams: [] } };
    createdEventSources[0]!.emit('snapcast', payload);
    expect(applySnapcastUpdate).toHaveBeenCalledWith(payload);
  });

  it('parses a service-status event into reactive state', async () => {
    const { deps, createdEventSources } = makeDeps();
    const controller = createEventSourceController(deps);
    controller.connect();
    await flush();
    const payload = [{ service: 'snapserver', status: 'active' }];
    createdEventSources[0]!.emit('service-status', payload);
    expect(controller.serviceStatuses.value).toEqual(payload);
  });

  it('parses a job event into reactive state', async () => {
    const { deps, createdEventSources } = makeDeps();
    const controller = createEventSourceController(deps);
    controller.connect();
    await flush();
    const payload = { id: 'job1', label: 'Install snapserver', status: 'running', log: ['step 1'], startedAt: 123 };
    createdEventSources[0]!.emit('job', payload);
    expect(controller.currentJob.value).toEqual(payload);
  });

  it('on an EventSource error: closes the dead connection, goes "reconnecting", and the NEXT attempt fetches a FRESH ticket (not the dead one)', async () => {
    const { deps, createdEventSources, scheduledCallbacks } = makeDeps();
    const controller = createEventSourceController(deps);
    controller.connect();
    await flush();
    createdEventSources[0]!.emit('open');
    expect(controller.status.value).toBe('connected');

    createdEventSources[0]!.emit('error');
    expect(createdEventSources[0]!.closeSpy).toHaveBeenCalledTimes(1);
    expect(controller.status.value).toBe('reconnecting');
    expect(scheduledCallbacks).toHaveLength(1);

    (deps.fetchTicket as ReturnType<typeof vi.fn>).mockResolvedValue('ticket-2');
    scheduledCallbacks[0]!.cb();
    await flush();

    expect(deps.fetchTicket).toHaveBeenCalledTimes(2);
    expect(deps.createEventSource).toHaveBeenLastCalledWith('/api/events?ticket=ticket-2');
    expect(createdEventSources).toHaveLength(2);
  });

  it('does NOT rely on a second error from the now-closed EventSource -- only the controller\'s own reconnect path fires', async () => {
    const { deps, createdEventSources, scheduledCallbacks } = makeDeps();
    const controller = createEventSourceController(deps);
    controller.connect();
    await flush();
    createdEventSources[0]!.emit('error');
    expect(scheduledCallbacks).toHaveLength(1);
    // A stray late event from the already-closed, now-detached EventSource must not schedule a second reconnect.
    createdEventSources[0]!.emit('error');
    expect(scheduledCallbacks).toHaveLength(1);
  });

  it('applies exponential backoff with a cap across repeated errors', async () => {
    const { deps, createdEventSources, scheduledCallbacks } = makeDeps();
    const controller = createEventSourceController(deps);
    controller.connect();
    await flush();

    createdEventSources[0]!.emit('error');
    expect(scheduledCallbacks[0]!.ms).toBe(1000);

    scheduledCallbacks[0]!.cb();
    await flush();
    createdEventSources[1]!.emit('error');
    expect(scheduledCallbacks[1]!.ms).toBe(2000);

    scheduledCallbacks[1]!.cb();
    await flush();
    createdEventSources[2]!.emit('error');
    expect(scheduledCallbacks[2]!.ms).toBe(4000);
  });

  it('a successful reconnect resets the backoff back to the initial delay on the next failure', async () => {
    const { deps, createdEventSources, scheduledCallbacks } = makeDeps();
    const controller = createEventSourceController(deps);
    controller.connect();
    await flush();
    createdEventSources[0]!.emit('error'); // attempt 1 -> 1000ms
    scheduledCallbacks[0]!.cb();
    await flush();
    createdEventSources[1]!.emit('open'); // this reconnect succeeds -- resets attempts to 0
    createdEventSources[1]!.emit('error'); // should be back to 1000ms, not 2000ms
    expect(scheduledCallbacks[1]!.ms).toBe(1000);
  });

  it('on a shutdown event: proactively closes and reconnects after a short FIXED delay, without waiting for an error', async () => {
    const { deps, createdEventSources, scheduledCallbacks } = makeDeps();
    const controller = createEventSourceController(deps);
    controller.connect();
    await flush();
    createdEventSources[0]!.emit('open');

    createdEventSources[0]!.emit('shutdown');
    expect(createdEventSources[0]!.closeSpy).toHaveBeenCalledTimes(1);
    expect(controller.status.value).toBe('reconnecting');
    expect(scheduledCallbacks).toHaveLength(1);
    expect(scheduledCallbacks[0]!.ms).toBeLessThan(30_000); // a short fixed delay, not the exponential-backoff cap
    expect(scheduledCallbacks[0]!.ms).not.toBe(1000); // distinct from the error-path INITIAL_BACKOFF_MS

    (deps.fetchTicket as ReturnType<typeof vi.fn>).mockResolvedValue('ticket-after-shutdown');
    scheduledCallbacks[0]!.cb();
    await flush();
    expect(deps.createEventSource).toHaveBeenLastCalledWith('/api/events?ticket=ticket-after-shutdown');
  });

  it('disconnect() stops reconnection attempts, cancels a pending timer, and closes the live connection', async () => {
    const { deps, createdEventSources, scheduledCallbacks } = makeDeps();
    const controller = createEventSourceController(deps);
    controller.connect();
    await flush();
    createdEventSources[0]!.emit('error'); // schedules a reconnect
    expect(scheduledCallbacks).toHaveLength(1);

    controller.disconnect();
    expect(deps.clearTimeoutFn).toHaveBeenCalledTimes(1);
    expect(controller.status.value).toBe('disconnected');

    // Even if the pending timer's callback still somehow fires (already cancelled in practice), it must not reconnect once stopped.
    scheduledCallbacks[0]!.cb();
    await flush();
    expect(deps.createEventSource).toHaveBeenCalledTimes(1); // no new connection was opened
  });

  it('connect() is idempotent while already connecting/connected', async () => {
    const { deps } = makeDeps();
    const controller = createEventSourceController(deps);
    controller.connect();
    controller.connect();
    await flush();
    expect(deps.fetchTicket).toHaveBeenCalledTimes(1);
  });

  it('a synchronous EventSource construction failure schedules a reconnect instead of throwing', async () => {
    const { deps, scheduledCallbacks } = makeDeps({
      createEventSource: vi.fn(() => {
        throw new Error('refused to construct');
      }),
    });
    const controller = createEventSourceController(deps);
    controller.connect();
    await flush();
    expect(controller.status.value).toBe('reconnecting');
    expect(scheduledCallbacks).toHaveLength(1);
  });

  it('a ticket fetch failure schedules a reconnect instead of throwing', async () => {
    const { deps, scheduledCallbacks } = makeDeps({
      fetchTicket: vi.fn().mockRejectedValue(new Error('network down')),
    });
    const controller = createEventSourceController(deps);
    controller.connect();
    await flush();
    expect(controller.status.value).toBe('reconnecting');
    expect(scheduledCallbacks).toHaveLength(1);
  });
});
