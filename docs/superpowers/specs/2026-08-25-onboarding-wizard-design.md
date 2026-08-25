# Onboarding wizard — design

Date: 2026-08-25
Source: `docs/superpowers/plans/2026-08-18-professional-hardening.md`, Stage
4, item 4.7: *"Onboarding de tres pasos tras el wizard: instalar
snapserver → crear la primera fuente → asignar la primera zona, con
progreso persistido."*

## Goal

A first-run onboarding wizard that walks a new admin through the three
things they need before the app is actually useful: get snapserver
running, add one audio source, and route it to one zone. Reduces the gap
between "created my admin account" (Setup.vue, existing) and "I have
sound coming out of a speaker."

## Non-goals

- Does not replace or modify `Setup.vue` (admin-account creation stays
  exactly as-is; the wizard runs AFTER it).
- Does not gate or block access to the rest of the app.
- Does not build new, wizard-specific forms for adding a source or
  assigning a zone — it reuses the real components those features
  already use elsewhere in the app.
- Does not attempt to automate installing a *client* (physical snapclient
  hardware, or this app's own local snapclient-instance feature) — the
  wizard waits for one to appear and lets the admin connect it themselves,
  by whatever means, outside the wizard's control.

## Overview & trigger

3 steps: install snapserver → create the first pipe source → assign the
first zone. **Skippable at any point** — this is not a hard gate. Progress
is persisted **server-side, tied to the admin account** (a new migration
on the `users` table), so it survives clearing browser storage or
managing the box from a different device.

Trigger: immediately after `Setup.vue` completes account creation,
redirect to `/onboarding` once. From then on, if `onboarding_step < 3`
and the admin hasn't dismissed it, `Dashboard.vue` shows a small,
dismissible banner/link offering to resume. No auto-redirect on every
subsequent login — that would violate "skippable."

## Wizard shell

One dedicated route/view, `client/src/views/Onboarding.vue` (or
`OnboardingWizard.vue` — naming is an implementation detail), with a
step indicator (1/2/3) and a "Skip for now" affordance on every step.
**Not** a persistent overlay navigating the real pages — a single page
that embeds the real, already-built components directly. These
components (`AddEditPipeDialog.vue`, the accessible per-zone `<Select>`
pattern from Routing.vue) are already fully self-contained
(store-backed, `defineExpose`d open methods, no page-context
dependencies), so they work correctly mounted outside their usual page.

## Per-step behavior

### Step 1 — Install snapserver

Reads `systemStore.installedPackages.snapserver` (already fetched
elsewhere in the app on mount).
- Not installed: an "Install Snapserver" button calling
  `systemStore.installPackage('snapserver')` — the exact same store
  action `Dashboard.vue`'s existing "Install Snapserver" button already
  calls, inheriting its existing loading/job-polling behavior (Task 24's
  persistent job service) for free.
- Already installed: shows a confirmation state, lets the admin continue
  immediately without re-doing anything.

### Step 2 — Create the first pipe source

Embeds `client/src/components/pipe-sources/AddEditPipeDialog.vue`
(Task 42) directly via a template ref, auto-invoking its exposed
`openAdd()` when this step mounts. Listens for its `saved` emit to
auto-advance to step 3.

If the admin already has one or more pipe sources when they reach this
step (e.g. resuming after a partial run, or having added one manually
outside the wizard), show it as already-satisfied ("You already have N
source(s) configured") with a Next button, rather than forcing a
redundant add.

### Step 3 — Assign the first zone

Reads live group/client state off `snapcastStore.status` (already
SSE-driven app-wide since Task 28-29 — no new polling).

- No group with a connected client exists yet: a "waiting for a client"
  state explaining how one appears (connect a physical snapclient device
  to this server on the network, or use this app's own local
  snapclient-instance feature under Client mode), live-updating via the
  existing SSE connection as soon as one connects. This state can still
  be skipped/finished from without a client ever appearing.
- Once at least one group exists: the same accessible per-zone
  `<Select>` control and wiring pattern Task 34 built for
  `Routing.vue` (calls `snapcastStore.setGroupStream()`), scoped to
  just the first/only group for simplicity in this context.

### Completion

Marks onboarding complete server-side (`onboarding_step = 3` or an
equivalent "done" state), redirects to `Dashboard.vue` with a success
toast.

## Data model / API

New versioned migration (following the existing pattern in
`server/src/database/migrations.ts`) adding two columns to the `users`
table:
- `onboarding_step INTEGER NOT NULL DEFAULT 0`
- `onboarding_dismissed INTEGER NOT NULL DEFAULT 0`

New endpoints (same JWT auth middleware as every other authenticated
route):
- `GET /api/auth/onboarding` → `{ step: number, dismissed: boolean }`
  for the current authenticated user.
- `PATCH /api/auth/onboarding` → updates `step` and/or `dismissed`.

Client: a small Pinia store (or an extension of the existing auth/user
store) holding this state, fetched once after login/app mount, updated
as the wizard progresses and when the Dashboard banner is dismissed.

## Testing

Vitest component tests per step, mocking `systemStore`/
`pipeSources` store/`snapcastStore` the same way every other component
test this session has (no real backend, no live-browser dependency for
correctness). Cover:
- Step 1's installed/not-installed branches.
- Step 2's auto-open + `saved`-emit-advances-step behavior, and the
  already-has-sources skip path.
- Step 3's waiting-for-client state, its live SSE-driven transition once
  a group appears, and the zone-assignment call.
- The skip/dismiss/resume persistence calls (`GET`/`PATCH
  /api/auth/onboarding`).
- `Dashboard.vue`'s banner's conditional visibility logic.

Live-browser verification is a nice-to-have, not a blocker, matching
this session's established, accepted posture for authenticated-route
verification — same reasoning applied throughout Tasks 33-46.

## Open questions / risks for the implementation plan to address

- Exact route path and whether it needs a router guard (e.g. should a
  *non-first-run* admin visiting `/onboarding` directly still work, for
  manually resuming later via the Dashboard banner's link?).
- Where the new Pinia onboarding store lives relative to the existing
  auth store, and whether `onboarding_step`/`dismissed` should be folded
  into the existing `/api/auth/me`-style user payload instead of a
  separate endpoint pair, to avoid an extra round trip on every load.
- Step 3's "first/only group" simplification: if a real install already
  has multiple groups by the time an admin reaches this step (unlikely
  on a true first run, but possible on a resumed one), decide whether to
  handle multiple groups or keep scoping to just the first one found.
