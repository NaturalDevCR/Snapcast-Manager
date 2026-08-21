// Task 23: Zod request schemas for routes/snapclientInstances.ts, migrated
// from that file's pre-existing inline `if (!x) return res.status(400)...`
// checks. See schemas/pipeSources.ts's header comment for the placement
// rationale (server/src/schemas/) and preservation policy -- the same
// applies here.
//
// Scope note: only the three endpoints that had a pre-existing inline
// check are migrated (create instance, set ALSA volume, control-by-action)
// -- PUT /:id (update) had NO validation at all before this task (the raw
// body went straight to snapclientInstanceService.updateInstance()) and is
// intentionally left unvalidated here too, matching this task's policy of
// migrating existing checks rather than inventing new ones on an
// unrelated endpoint (see task-23-report.md). Its client store method
// still adopts the shared `UpdateSnapclientInstanceInput` type for
// compile-time typing.
import { z } from 'zod';
import type { CreateSnapclientInstanceInput, SetAlsaVolumeInput } from '@shared/snapclientInstances';

// ---- POST /api/snapclient-instances ----
//
// Pre-migration: `if (!name || !soundcard) return 400 'name and soundcard
// are required'`, then `host: host || '127.0.0.1'`, `port: port || 1704`
// (an explicit falsy port, e.g. 0, also falls back -- preserved exactly),
// `hostId` passed through untouched. No trimming, no type coercion beyond
// truthiness existed for `name`/`soundcard` -- `z.string().min(1)` is a
// disclosed tightening (a non-string value is now rejected instead of
// silently accepted) matching schemas/pipeSources.ts's policy.
export const createSnapclientInstanceBodySchema = z
  .object({
    name: z.string().min(1, 'name and soundcard are required'),
    host: z.string().optional(),
    port: z.number().optional(),
    soundcard: z.string().min(1, 'name and soundcard are required'),
    hostId: z.string().optional(),
  })
  .transform(
    (raw): CreateSnapclientInstanceInput => ({
      name: raw.name,
      host: raw.host || '127.0.0.1',
      port: raw.port || 1704,
      soundcard: raw.soundcard,
      hostId: raw.hostId,
    })
  );

// ---- POST /api/snapclient-instances/alsa/:cardId ----
export const setAlsaVolumeBodySchema: z.ZodSchema<SetAlsaVolumeInput> = z.object({
  control: z.string(),
  percent: z.number(),
});

// ---- POST /api/snapclient-instances/:id/:action ----
//
// `action` arrives as a URL param, not a body field -- this schema
// validates the WHOLE params object (both `id` and `action`) because the
// validate() middleware overwrites `req.params` with the parsed result;
// omitting `id` here would silently drop it from `req.params` downstream.
export const controlSnapclientInstanceParamsSchema = z.object({
  id: z.string(),
  action: z.enum(['start', 'stop', 'restart', 'enable', 'disable'], {
    message: 'Invalid action',
  }),
});
