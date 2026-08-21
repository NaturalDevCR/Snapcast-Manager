// Task 23: generic Zod-based request-validation middleware. Composes with
// the existing `authenticateToken` middleware (auth.ts) and the central
// `errorHandler` safety net (errorHandler.ts) without touching either --
// this only ever produces its own 400 response or calls `next()`, so it
// never reaches errorHandler (a 500-only backstop) and runs independently
// of auth (order in each route's middleware chain is the caller's choice,
// same as any other Express middleware).
//
// Design: on success, the parsed/coerced value for each validated part is
// attached to `req.validated.{body,params,query}` -- a new, explicitly
// typed property (see `ValidatedRequest` below) -- AND, for `body`/
// `params`, ALSO written back onto `req.body`/`req.params` themselves.
// That second part is deliberate: this codebase's existing route handlers
// overwhelmingly destructure `req.body`/`req.params` directly (see
// routes/pipeSources.ts, routes/snapclientInstances.ts pre-migration), and
// the brief's core requirement is that validation be load-bearing, not
// decorative -- a handler that keeps reading `req.body` after this
// middleware runs must still get the VALIDATED value, coercions and
// defaults included, not the untouched raw input. Overwriting `req.body`/
// `req.params` in place makes that true unconditionally, independent of
// whether a given handler was updated to use `req.validated` or not.
//
// `req.query` is the one exception: Express 5 defines it via a
// getter-only property (`defineGetter(req, 'query', ...)` in
// express/lib/request.js) -- assigning to it throws at runtime. There is
// no way to overwrite it in place, so a coerced/validated query is only
// ever available via `req.validated.query`; `req.query` itself is left as
// Express's own raw parse.
import { NextFunction, Request, RequestHandler, Response } from 'express';
import { ZodError, ZodSchema } from 'zod';
import type { ValidationErrorBody, ValidationIssue } from '@shared/validation';

/** A `Request` after `validate()` has run successfully -- the typed, ergonomic path for reading validated data. */
export interface ValidatedRequest<TBody = unknown, TParams = unknown, TQuery = unknown> extends Request {
  validated: {
    body: TBody;
    params: TParams;
    query: TQuery;
  };
}

export interface ValidateSchemas<TBody = unknown, TParams = unknown, TQuery = unknown> {
  body?: ZodSchema<TBody>;
  params?: ZodSchema<TParams>;
  query?: ZodSchema<TQuery>;
}

function flattenIssues(error: ZodError): ValidationIssue[] {
  return error.issues.map(issue => ({
    path: issue.path.join('.'),
    message: issue.message,
  }));
}

/**
 * Builds an Express middleware that validates `req.body` / `req.params` /
 * `req.query` against the given Zod schemas (each optional -- only the
 * parts a route actually cares about need a schema). All provided schemas
 * are checked before responding, so a request that fails on more than one
 * part gets every failing field back in a single 400 response rather than
 * one-at-a-time.
 *
 * On success: calls `next()` with the validated/coerced data attached (see
 * this file's header comment for exactly where).
 *
 * On failure: responds 400 with a curated `ValidationErrorBody` (see
 * shared/validation.ts) -- a stable `code`, a human-readable `error`
 * summary, and a flattened `issues` array (`{ path, message }`) -- and
 * does NOT call `next()`, so the downstream route handler is never
 * reached. Deliberately does not expose Zod's raw `ZodError`/`ZodIssue`
 * objects (internal `code`/`expected`/`received` fields, etc.).
 */
export function validate<TBody = unknown, TParams = unknown, TQuery = unknown>(
  schemas: ValidateSchemas<TBody, TParams, TQuery>
): RequestHandler {
  return (req: Request, res: Response, next: NextFunction): void => {
    const issues: ValidationIssue[] = [];

    let parsedBody: TBody | undefined;
    if (schemas.body) {
      const result = schemas.body.safeParse(req.body);
      if (result.success) {
        parsedBody = result.data;
      } else {
        issues.push(...flattenIssues(result.error));
      }
    }

    let parsedParams: TParams | undefined;
    if (schemas.params) {
      const result = schemas.params.safeParse(req.params);
      if (result.success) {
        parsedParams = result.data;
      } else {
        issues.push(...flattenIssues(result.error));
      }
    }

    let parsedQuery: TQuery | undefined;
    if (schemas.query) {
      const result = schemas.query.safeParse(req.query);
      if (result.success) {
        parsedQuery = result.data;
      } else {
        issues.push(...flattenIssues(result.error));
      }
    }

    if (issues.length > 0) {
      const body: ValidationErrorBody = {
        code: 'VALIDATION_ERROR',
        error: 'Request validation failed',
        issues,
      };
      res.status(400).json(body);
      return;
    }

    const validatedReq = req as ValidatedRequest<TBody, TParams, TQuery>;
    validatedReq.validated = {
      body: (schemas.body ? parsedBody : req.body) as TBody,
      params: (schemas.params ? parsedParams : req.params) as TParams,
      query: (schemas.query ? parsedQuery : req.query) as TQuery,
    };

    // See header comment: req.body/req.params are safe to overwrite
    // in-place (plain writable properties); req.query is not (Express 5
    // getter-only) and is deliberately left alone.
    if (schemas.body) req.body = parsedBody;
    if (schemas.params) req.params = parsedParams as Request['params'];

    next();
  };
}
