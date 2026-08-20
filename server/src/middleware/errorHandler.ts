import { Request, Response, NextFunction } from 'express';

// Task 15: central error-handling middleware -- registered LAST in
// index.ts, after every router. This is a SAFETY NET for genuinely
// unhandled errors (a thrown error inside middleware itself, or a route
// that's missing its own try/catch) -- it deliberately does NOT replace
// each existing route's local try/catch/res.status(500).json({error:
// err.message}) pattern, which remains in place across the codebase. See
// .superpowers/sdd/task-15-brief.md requirement 4 for the explicit scope
// boundary: this is not a route-by-route rewrite.
//
// Express recognizes error-handling middleware purely by ARITY -- it must
// take exactly four parameters (err, req, res, next), even though `req`
// and `next` aren't otherwise used here.
export function errorHandler(err: unknown, req: Request, res: Response, next: NextFunction): void {
  // If a response has already started, Express's own docs say the only
  // safe thing to do is delegate to the default handler via next(err) --
  // calling res.json() again here would throw "Cannot set headers after
  // they are sent".
  if (res.headersSent) {
    next(err);
    return;
  }

  // Always log the full error server-side, regardless of environment --
  // this is what makes this middleware useful as a backstop, not just a
  // generic-response wrapper.
  // eslint-disable-next-line no-console
  console.error('[unhandled error]', err);

  const isProduction = process.env.NODE_ENV === 'production';
  if (isProduction) {
    // Never leak a stack trace or raw error message to the client in
    // production -- design-spec finding #12.
    res.status(500).json({ error: 'Internal server error' });
    return;
  }

  const detail = err instanceof Error ? err.message : String(err);
  res.status(500).json({ error: 'Internal server error', detail });
}
