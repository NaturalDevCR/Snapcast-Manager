// Task 64 (Stage 5, item 5.7): minimal LOCAL metrics -- no external
// telemetry/APM, no new persistent storage. Backs the `metrics` field added
// to GET /api/health/detail (see routes/health.ts). Three independently
// computed pieces:
//
//   1. Uptime        -- process.uptime(), Node's own built-in.
//   2. Jobs executed  -- a real COUNT(*) against the `jobs` table
//      (services/jobs.ts), not a separate in-memory counter that could
//      drift from what's actually durably recorded.
//   3. Errors per endpoint -- a plain in-process Map, reset on restart
//      (matches uptime's own "resets on restart" framing -- this is
//      explicitly the plan item's "local" metrics, not a persisted table).
//
// The error-tracking piece is deliberately NOT wired through
// middleware/errorHandler.ts. That middleware is a safety net for
// genuinely UNHANDLED errors only (see its own header comment) -- most
// routes in this codebase catch their own errors locally
// (try/catch/res.status(...).json(...)) and never reach it, so counting
// only what passes through errorHandler would badly undercount "errores
// por endpoint". Instead, `trackEndpointErrors` below is an app-level
// middleware registered before every router (see index.ts) that listens
// for `res.on('finish')` -- this fires for EVERY response, regardless of
// which code path produced it, after Express has already matched the
// route.
import { Request, Response, NextFunction } from 'express';
import Database from 'better-sqlite3';
import defaultDb from '../database';

/** Whole seconds since process start -- process.uptime() is already the correct, already-monotonic primitive; no need to hand-roll a start-time timestamp. */
export function getUptimeSeconds(): number {
  return Math.round(process.uptime());
}

/**
 * Total number of rows ever inserted into `jobs` -- i.e. every job that has
 * ever run or been attempted, regardless of its current `status`
 * ('running' | 'done' | 'error' | 'interrupted'). A job that errored or was
 * interrupted by a restart still genuinely executed, so this deliberately
 * does NOT filter to `status = 'done'` only.
 *
 * `db` is injectable (defaults to the real app singleton) purely so tests
 * can point this at an isolated throwaway database, same convention as
 * `JobService` itself (see services/jobs.ts).
 */
export function getJobsExecuted(db: Database.Database = defaultDb): number {
  const row = db.prepare('SELECT COUNT(*) as count FROM jobs').get() as { count: number };
  return row.count;
}

export interface EndpointErrorCount {
  method: string;
  path: string;
  count: number;
}

/**
 * Counts non-2xx (statusCode >= 400) responses per (method, normalized
 * path). Kept as a plain class independent of Express so the counting
 * logic itself is directly unit-testable without spinning up an HTTP
 * server (see metrics.test.ts) -- `trackEndpointErrors` below is the thin
 * Express adapter over this.
 */
export class ErrorMetricsTracker {
  private counts = new Map<string, EndpointErrorCount>();

  record(method: string, path: string): void {
    const key = `${method} ${path}`;
    const existing = this.counts.get(key);
    if (existing) {
      existing.count += 1;
    } else {
      this.counts.set(key, { method, path, count: 1 });
    }
  }

  /** A snapshot array, highest-error-count endpoint first -- the most useful ordering for an admin skimming this. */
  snapshot(): EndpointErrorCount[] {
    return Array.from(this.counts.values())
      .map((entry) => ({ ...entry }))
      .sort((a, b) => b.count - a.count);
  }

  /** Test-only helper -- clears all recorded counts so tests don't leak state into each other via the shared singleton below. */
  reset(): void {
    this.counts.clear();
  }
}

/** The real, process-wide tracker -- shared by the middleware below and read by routes/health.ts. */
export const errorMetrics = new ErrorMetricsTracker();

/**
 * App-level middleware -- registered in index.ts AFTER express.json() but
 * BEFORE any router, so it wraps every request. It does its actual work in
 * a `res.on('finish')` listener rather than inline: `finish` fires only
 * after the response has actually been sent, by which point Express has
 * already matched the route, so `req.route`/`req.baseUrl` are populated
 * (even though this middleware function itself runs BEFORE routing, at
 * registration order).
 *
 * Path normalization: `req.baseUrl + (req.route?.path ?? req.path)`
 * collapses a parameterized route (e.g. POST /api/pipe-sources/:id/control)
 * into ONE tracked entry regardless of which real `:id` was used, instead
 * of exploding into one entry per distinct resource id. `req.route` is only
 * populated once Express has matched a router-registered route; for a
 * request that never matches one (e.g. index.ts's catch-all
 * `/api` 404 middleware), it falls back to the raw `req.path`, which is
 * the best available "normalized" path in that case.
 */
export function trackEndpointErrors(req: Request, res: Response, next: NextFunction): void {
  res.on('finish', () => {
    if (res.statusCode >= 400) {
      const path = req.baseUrl + (req.route?.path ?? req.path);
      errorMetrics.record(req.method, path);
    }
  });
  next();
}
