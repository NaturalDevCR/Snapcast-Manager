// Task 23: the response shape returned by server/src/middleware/validate.ts
// on a 400. Shared so the client can eventually render field-level errors
// (e.g. under the offending form field) without guessing the server's
// error format. Deliberately curated/flat -- NOT Zod's raw `ZodError`
// (which can carry deeply-nested union/discriminant internals not meant
// for a client to parse) -- see validate.ts for what gets mapped in.

/** One field-level validation failure. */
export interface ValidationIssue {
  /**
   * Dot/bracket path to the offending field within the validated payload,
   * e.g. "url" or "items.0.name". Empty string for an issue on the payload
   * itself (e.g. "expected object, received array").
   */
  path: string;
  message: string;
}

/** Body of a 400 response produced by the `validate()` middleware. */
export interface ValidationErrorBody {
  code: 'VALIDATION_ERROR';
  /** Human-readable summary, safe to show as-is. */
  error: string;
  issues: ValidationIssue[];
}
