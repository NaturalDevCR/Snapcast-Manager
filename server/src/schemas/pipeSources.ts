// Task 23: Zod request schemas for routes/pipeSources.ts, migrated from
// that file's pre-existing inline `if (!x) return res.status(400)...`
// checks. Placement: server/src/schemas/ (a dedicated directory, mirroring
// the existing middleware/ and platform/ separation-of-concerns already in
// this codebase) rather than inline in the route file -- keeps the route
// file focused on wiring/dispatch and makes each schema independently
// testable (see pipeSources.schemas.test.ts).
//
// PRESERVATION POLICY (see task-23-report.md "Zod schema placement" /
// "self-review" sections for the full writeup): every field that had
// genuine VALUE-transforming business logic in the original route
// (defaulting, coercion, the URL character allowlist) is replicated here
// bit-for-bit via `.transform()`/`.refine()`, not just "made a Zod type".
// Fields that were previously only truthy-checked with no type constraint
// (`name`) are now real `z.string()` fields -- a disclosed, deliberate
// tightening (rejects a non-string value that used to be silently
// `String()`-coerced), not a loosening of anything.
import { z } from 'zod';
import type {
  AdoptPipeSourceInput,
  ControlPipeSourceInput,
  CreatePipeSourceInput,
  PipeSourceType,
  SetPipeSourceConfigInput,
} from '@shared/pipeSources';

// ---- validateStreamUrl: Stage 1 security guarantee, unchanged ----
//
// The URL ends up inside the ExecStart line of a systemd unit (shell
// context), so reject anything that could break out of the quoted string.
// This is copied VERBATIM (same two regexes, same order, same messages)
// from the pre-migration routes/pipeSources.ts -- see
// task-23-report.md's "routes migrated" section for the explicit test
// confirming a backtick/`$`/`;` payload is still rejected post-migration.
// Exported standalone (not just embedded in a `.refine()`) specifically so
// it stays independently unit-testable regardless of how the surrounding
// Zod schema is structured.
export function validateStreamUrl(url: string): string | null {
  if (!/^https?:\/\/\S+$/i.test(url)) {
    return 'URL must start with http:// or https:// and contain no spaces';
  }
  if (/["'`$\\;\n\r]/.test(url)) {
    return 'URL contains invalid characters (quotes, backticks, $, \\, or ;)';
  }
  return null;
}

// ---- coercion helpers, replicating pre-migration inline logic exactly ----
// Each wrapped in `.optional()` at the use site below: Zod's `.optional()`
// short-circuits on `undefined` *before* running the inner transform, so
// "field omitted" is handled separately (via `?? <default>`) from "field
// present but falsy", matching the original code's distinct handling of
// each.

/** Replicates `x !== false` -- anything but the literal boolean `false` is treated as true. */
const looseBoolean = z.unknown().transform((v): boolean => v !== false);

/** Replicates `Number(x) || fallback` -- NaN or 0 (including "0") falls back. */
function looseNumberWithFallback(fallback: number) {
  return z.unknown().transform((v): number => Number(v) || fallback);
}

/** Replicates `type === 'mpd' ? 'mpd' : 'radio'` -- anything unrecognized silently becomes 'radio'. */
const looseType = z.unknown().transform((v): PipeSourceType => (v === 'mpd' ? 'mpd' : 'radio'));

// ---- POST /api/pipe-sources ----
export const createPipeSourceBodySchema = z
  .object({
    name: z.string().min(1, 'name is required'),
    type: looseType.optional(),
    url: z.unknown().optional(),
    reconnect: looseBoolean.optional(),
    reconnectStreamed: looseBoolean.optional(),
    reconnectAtEof: looseBoolean.optional(),
    reconnectDelayMax: looseNumberWithFallback(30).optional(),
    idleThreshold: looseNumberWithFallback(15000).optional(),
    enabled: looseBoolean.optional(),
  })
  .transform((raw, ctx): CreatePipeSourceInput => {
    const type: PipeSourceType = raw.type ?? 'radio';
    const url = raw.url ? String(raw.url).trim() : '';

    if (type === 'radio' && !url) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'url is required for radio sources', path: ['url'] });
      return z.NEVER;
    }
    if (url) {
      const urlError = validateStreamUrl(url);
      if (urlError) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: urlError, path: ['url'] });
        return z.NEVER;
      }
    }

    return {
      name: raw.name.trim(),
      type,
      url,
      reconnect: raw.reconnect ?? true,
      reconnectStreamed: raw.reconnectStreamed ?? true,
      reconnectAtEof: raw.reconnectAtEof ?? true,
      reconnectDelayMax: raw.reconnectDelayMax ?? 30,
      idleThreshold: raw.idleThreshold ?? 15000,
      enabled: raw.enabled ?? true,
    };
  });

// ---- PUT /api/pipe-sources/:id ----
//
// The pre-migration handler passed `req.body` straight through to
// `pipeSourceService.update()` UNCHANGED -- no name requirement, no
// type/boolean/number coercion at all -- with the URL check as the only
// gate ("if (req.body.url !== undefined && req.body.url !== '')"). Typed
// optional fields below are a disclosed tightening (a wrong-typed field,
// e.g. a string where a number was expected, now 400s instead of being
// silently written to SQLite as-is) -- see this file's header comment;
// the update path had effectively no field-level validation before this
// task, so this is new safety, not a removed check.
export const updatePipeSourceBodySchema = z
  .object({
    name: z.string().min(1).optional(),
    type: z.enum(['radio', 'mpd']).optional(),
    url: z.string().optional(),
    reconnect: z.boolean().optional(),
    reconnectStreamed: z.boolean().optional(),
    reconnectAtEof: z.boolean().optional(),
    reconnectDelayMax: z.number().optional(),
    idleThreshold: z.number().optional(),
    enabled: z.boolean().optional(),
  })
  .superRefine((raw, ctx) => {
    // Matches the exact pre-migration condition: an explicit empty string
    // is exempt from the character-allowlist check (mpd-type pipes clear
    // their URL this way), but any other non-empty value is checked.
    if (raw.url !== undefined && raw.url !== '') {
      const urlError = validateStreamUrl(raw.url.trim());
      if (urlError) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: urlError, path: ['url'] });
      }
    }
  });

// ---- POST /api/pipe-sources/:id/control ----
export const controlPipeSourceBodySchema: z.ZodSchema<ControlPipeSourceInput> = z.object({
  action: z.enum(['start', 'stop', 'restart', 'enable', 'disable'], {
    message: 'Invalid action',
  }),
});

// ---- PUT /api/pipe-sources/:id/config ----
export const setPipeSourceConfigBodySchema: z.ZodSchema<SetPipeSourceConfigInput> = z.object({
  content: z.string(),
});

// ---- POST /api/pipe-sources/adopt ----
//
// Deliberately does NOT require a url for radio-type sources -- unlike
// POST / (create), the pre-migration adopt handler never had that check,
// only the url-format check when a url is present. Preserved exactly.
export const adoptPipeSourceBodySchema = z
  .object({
    name: z.string().min(1, 'name is required'),
    type: looseType.optional(),
    url: z.unknown().optional(),
    reconnect: looseBoolean.optional(),
    reconnectStreamed: looseBoolean.optional(),
    reconnectAtEof: looseBoolean.optional(),
    reconnectDelayMax: looseNumberWithFallback(30).optional(),
    idleThreshold: looseNumberWithFallback(15000).optional(),
    enabled: looseBoolean.optional(),
    existingServiceName: z.string().optional(),
  })
  .transform((raw, ctx): AdoptPipeSourceInput => {
    const url = raw.url ? String(raw.url).trim() : '';
    if (url) {
      const urlError = validateStreamUrl(url);
      if (urlError) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: urlError, path: ['url'] });
        return z.NEVER;
      }
    }

    return {
      name: raw.name.trim(),
      type: raw.type ?? 'radio',
      url,
      reconnect: raw.reconnect ?? true,
      reconnectStreamed: raw.reconnectStreamed ?? true,
      reconnectAtEof: raw.reconnectAtEof ?? true,
      reconnectDelayMax: raw.reconnectDelayMax ?? 30,
      idleThreshold: raw.idleThreshold ?? 15000,
      enabled: raw.enabled ?? true,
      existingServiceName: raw.existingServiceName || undefined,
    };
  });
