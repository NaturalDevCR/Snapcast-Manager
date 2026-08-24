import express, { Request, Response } from 'express';
import { EventEmitter } from 'events';
import { authenticateToken } from '../auth';
import { snapcastLive } from '../services/snapcastLive';
import { jobService, jobEvents, type Job } from '../services/jobs';
import { activeState } from '../platform/systemd';
import type { SnapcastGetStatusResult } from '@shared/snapcast';
import type { SseEvent, ServiceStatusEntry } from '@shared/events';

// Task 25: `GET /api/events` -- a Server-Sent Events stream multiplexing
// three narrowly-scoped sources onto one connection per client (design-spec
// §4.3/finding #20): snapcast state (pushed by snapcastLive.ts's
// notification-driven cache, requirement 1), service status (polled
// server-side here, only emitted on an actual change), and job progress
// (pushed by services/jobs.ts's `jobEvents` emitter). This is deliberately
// NOT a general pub/sub framework -- exactly these three sources, wired
// directly, per the task brief.
//
// Every piece of per-connection state below (the service-status polling
// interval, its `lastSent` diff snapshot, and the listeners added to
// `snapcastLive`/`jobEvents`) lives inside the GET handler's own closure,
// created fresh per request and torn down on `req.on('close', ...)` -- so
// concurrent SSE clients (this is a multi-tab/multi-device app) never share
// or clobber each other's polling state, and a disconnect can never leak a
// listener or a live `setInterval`.

/** Services polled for status -- mirrors services/system.ts's getDashboardMetrics() service list. */
const DEFAULT_MONITORED_SERVICES = ['snapserver', 'snapclient', 'shairport-sync', 'mpd', 'mympd'] as const;
const DEFAULT_POLL_INTERVAL_MS = 5000;

export interface EventsRouterDeps {
  /** Emits 'update' with the new SnapcastGetStatusResult (or null) whenever the cache changes. */
  snapcastEvents: EventEmitter;
  getCachedSnapcastStatus: () => SnapcastGetStatusResult | null;
  /** Emits 'update' with a `Job` whenever job state changes. */
  jobEventsEmitter: EventEmitter;
  getCurrentJob: () => Job | undefined;
  activeState: (unit: string) => Promise<string>;
  services: readonly string[];
  pollIntervalMs: number;
}

const defaultDeps: EventsRouterDeps = {
  snapcastEvents: snapcastLive,
  getCachedSnapcastStatus: () => snapcastLive.getCachedStatus(),
  jobEventsEmitter: jobEvents,
  getCurrentJob: () => jobService.getCurrent(),
  activeState,
  services: DEFAULT_MONITORED_SERVICES,
  pollIntervalMs: DEFAULT_POLL_INTERVAL_MS,
};

function writeSseEvent(res: Response, event: SseEvent): void {
  if (res.writableEnded || res.destroyed) return;
  res.write(`event: ${event.type}\n`);
  res.write(`data: ${JSON.stringify(event.data)}\n\n`);
}

function sameServiceStatuses(a: ServiceStatusEntry[], b: ServiceStatusEntry[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((entry, i) => entry.service === b[i].service && entry.status === b[i].status);
}

/**
 * Builds the events router. Production code uses the default export below
 * (real snapcastLive/jobService/systemd, 5s poll); tests call this directly
 * with fakes and a short `pollIntervalMs` so cleanup-on-disconnect and
 * change-only-emission are deterministic and fast to verify.
 */
export function createEventsRouter(deps: Partial<EventsRouterDeps> = {}): express.Router {
  const d: EventsRouterDeps = { ...defaultDeps, ...deps };
  const router = express.Router();

  router.use(authenticateToken);

  router.get('/', (req: Request, res: Response) => {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      // Belt-and-braces for any reverse proxy this ever ends up behind
      // (nginx buffers proxied responses by default, which would defeat
      // SSE); harmless when served directly, as this app is today.
      'X-Accel-Buffering': 'no',
    });
    res.flushHeaders?.();

    // Send whatever is already known immediately, so a client doesn't sit
    // blank until the next tick/notification.
    writeSseEvent(res, { type: 'snapcast', data: d.getCachedSnapcastStatus() });
    const currentJob = d.getCurrentJob();
    if (currentJob) writeSseEvent(res, { type: 'job', data: currentJob });

    // ---- snapcast: pushed by snapcastLive's notification-driven cache ----
    const onSnapcastUpdate = (status: SnapcastGetStatusResult | null) => {
      writeSseEvent(res, { type: 'snapcast', data: status });
    };
    d.snapcastEvents.on('update', onSnapcastUpdate);

    // ---- job: pushed by jobService's log()/start()/finish hook ----
    const onJobUpdate = (job: Job) => {
      writeSseEvent(res, { type: 'job', data: job });
    };
    d.jobEventsEmitter.on('update', onJobUpdate);

    // ---- service-status: polled here, emitted only when something changed ----
    let lastServiceStatuses: ServiceStatusEntry[] | null = null;
    const pollServiceStatuses = async () => {
      try {
        const results = await Promise.all(
          d.services.map(async (service) => ({ service, status: await d.activeState(`${service}.service`) })),
        );
        if (!lastServiceStatuses || !sameServiceStatuses(lastServiceStatuses, results)) {
          lastServiceStatuses = results;
          writeSseEvent(res, { type: 'service-status', data: results });
        }
      } catch (err: any) {
        console.error('[events] service-status poll failed:', err?.message ?? err);
      }
    };
    void pollServiceStatuses(); // fire immediately so the client gets a baseline without waiting a full interval
    const serviceInterval = setInterval(pollServiceStatuses, d.pollIntervalMs);

    let cleanedUp = false;
    const cleanup = () => {
      if (cleanedUp) return;
      cleanedUp = true;
      clearInterval(serviceInterval);
      d.snapcastEvents.off('update', onSnapcastUpdate);
      d.jobEventsEmitter.off('update', onJobUpdate);
    };

    req.on('close', cleanup);
    res.on('error', cleanup);
  });

  return router;
}

export default createEventsRouter();
