# Onboarding Wizard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **This session's variant:** this repo's own `.superpowers/sdd/progress.md`-based process (implementer subagent → independent reviewer subagent → fix-if-needed → re-review → ledger update) already executed 46 prior tasks this session using the same underlying discipline as `subagent-driven-development`. Continue using that process for these tasks rather than starting a fresh `executing-plans` session — each task below maps to one task-brief dispatch in that ledger.

**Goal:** Build a skippable, 3-step, server-persisted onboarding wizard (install snapserver → create first pipe source → assign first zone) that runs once after Setup.vue, reusing existing components rather than duplicating their logic.

**Architecture:** A new `users` table migration + `GET`/`PATCH /api/auth/onboarding` pair persist progress. A new Pinia `onboarding` store wraps those endpoints. A new `Onboarding.vue` view renders 3 step components; step 2 embeds the existing `AddEditPipeDialog.vue`, step 3 reuses the `Select`-based zone-assignment pattern from `Routing.vue`. `Setup.vue` redirects here on completion; `Dashboard.vue` gets a small resume banner.

**Tech Stack:** Vue 3 `<script setup>`, Pinia, Vue Router, Vitest + `@vue/test-utils`, Express 5, `better-sqlite3`, the existing versioned-migration system (`server/src/database/migrations.ts`).

## Global Constraints

- Server-side persistence only (no localStorage fallback) — spec §"Overview & trigger".
- Skippable at every step, never gates the rest of the app — spec §"Overview & trigger".
- Step 2 and step 3 MUST call the exact same store actions/components the rest of the app already uses for those operations (`AddEditPipeDialog.vue`'s `openAdd()`, `systemStore.installPackage('snapserver')`, `snapcastStore.setGroupStream()`) — no duplicate/parallel logic — spec §"Non-goals" and §"Per-step behavior".
- New migration follows the exact `{ version, name, isApplied, up }` shape and transactional-application convention already established in `server/src/database/migrations.ts` (current latest is version 6 — this adds version 7).
- New endpoints reuse the existing `authenticateToken` middleware from `server/src/auth.ts` — same auth posture as every other authenticated route.

---

## Task 1: Backend — `users` table migration + onboarding endpoints

**Files:**
- Modify: `server/src/database/migrations.ts` (add migration version 7)
- Modify: `server/src/auth.ts` (add `GET`/`PATCH /api/auth/onboarding`)
- Test: `server/src/database/migrations.test.ts` (extend with a test for migration 7)
- Test: `server/src/auth.test.ts` (extend with tests for the two new endpoints)

**Interfaces:**
- Produces: two new columns on `users` — `onboarding_step INTEGER NOT NULL DEFAULT 0` (0-3), `onboarding_dismissed INTEGER NOT NULL DEFAULT 0` (0 or 1, SQLite has no native boolean).
- Produces: `GET /api/auth/onboarding` → `200 { step: number, dismissed: boolean }` for the authenticated user.
- Produces: `PATCH /api/auth/onboarding` → body `{ step?: number, dismissed?: boolean }`, updates only the fields present, returns the same shape as GET. `step` must be an integer 0-3 inclusive; reject (`400`) anything else.

- [ ] **Step 1: Write the failing migration test**

Read `server/src/database/migrations.test.ts` first to match its existing test style for a prior migration (e.g. the token_version or job-table migration), then add:

```typescript
describe('migration 7: onboarding columns', () => {
  it('adds onboarding_step and onboarding_dismissed to users, defaulting to 0', () => {
    const db = freshTestDb(); // use whatever helper this file's existing tests use to get a migrated-through-v6 db
    const row = db.prepare('SELECT onboarding_step, onboarding_dismissed FROM users LIMIT 1').get() as any;
    // no users yet; just prove the columns exist and the statement doesn't throw
    expect(row).toBeUndefined();
    db.prepare("INSERT INTO users (username, password, role) VALUES ('t', 'h', 'admin')").run();
    const inserted = db.prepare('SELECT onboarding_step, onboarding_dismissed FROM users WHERE username = ?').get('t') as any;
    expect(inserted.onboarding_step).toBe(0);
    expect(inserted.onboarding_dismissed).toBe(0);
  });

  it('isApplied() returns true once the columns exist, so up() is not re-run', () => {
    const db = freshTestDb();
    const migration = migrations.find(m => m.version === 7)!;
    expect(migration.isApplied(db)).toBe(true);
  });
});
```

(Adjust `freshTestDb()`/import names to match whatever this file's existing helpers are actually called — read the file before writing, don't guess.)

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && npm test -- --test-name-pattern "migration 7"`
Expected: FAIL — migration 7 doesn't exist yet, or the columns don't exist.

- [ ] **Step 3: Add migration 7**

In `server/src/database/migrations.ts`, following the exact pattern of the existing versions 1-6, add after the last one:

```typescript
{
  version: 7,
  name: 'onboarding progress columns on users',
  isApplied: db => columnExists(db, 'users', 'onboarding_step') && columnExists(db, 'users', 'onboarding_dismissed'),
  up: db => {
    db.exec(`
      ALTER TABLE users ADD COLUMN onboarding_step INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE users ADD COLUMN onboarding_dismissed INTEGER NOT NULL DEFAULT 0;
    `);
  },
},
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && npm test -- --test-name-pattern "migration 7"`
Expected: PASS

- [ ] **Step 5: Write the failing endpoint tests**

Read `server/src/auth.test.ts` first to match its existing request-testing style (likely `supertest` or a direct `app`/`request` helper — match whatever's already there), then add tests for:
- `GET /api/auth/onboarding` without a token → 401.
- `GET /api/auth/onboarding` with a valid token, fresh user → `{ step: 0, dismissed: false }`.
- `PATCH /api/auth/onboarding` with `{ step: 2 }` → `200`, then a follow-up `GET` reflects `step: 2`.
- `PATCH /api/auth/onboarding` with `{ dismissed: true }` → `200`, `GET` reflects `dismissed: true`, `step` unchanged.
- `PATCH /api/auth/onboarding` with `{ step: 5 }` (out of range) → `400`, no DB change.
- `PATCH /api/auth/onboarding` with `{ step: -1 }` → `400`.

- [ ] **Step 6: Run tests to verify they fail**

Run: `cd server && npm test -- --test-name-pattern "onboarding"`
Expected: FAIL — routes don't exist yet (404s).

- [ ] **Step 7: Implement the endpoints**

In `server/src/auth.ts`, add near the other authenticated routes (after `/change-password`, before `/logout`, or wherever reads most naturally alongside the other user-scoped routes):

```typescript
router.get('/onboarding', authenticateToken, (req: Request, res: Response) => {
  const user = (req as any).user;
  try {
    const row = db.prepare('SELECT onboarding_step, onboarding_dismissed FROM users WHERE id = ?').get(user.id) as
      { onboarding_step: number; onboarding_dismissed: number } | undefined;
    if (!row) {
      return res.status(404).json({ error: 'User not found' });
    }
    res.json({ step: row.onboarding_step, dismissed: row.onboarding_dismissed === 1 });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.patch('/onboarding', authenticateToken, (req: Request, res: Response) => {
  const user = (req as any).user;
  const { step, dismissed } = req.body;

  if (step !== undefined && (!Number.isInteger(step) || step < 0 || step > 3)) {
    return res.status(400).json({ error: 'step must be an integer between 0 and 3' });
  }
  if (dismissed !== undefined && typeof dismissed !== 'boolean') {
    return res.status(400).json({ error: 'dismissed must be a boolean' });
  }

  try {
    if (step !== undefined) {
      db.prepare('UPDATE users SET onboarding_step = ? WHERE id = ?').run(step, user.id);
    }
    if (dismissed !== undefined) {
      db.prepare('UPDATE users SET onboarding_dismissed = ? WHERE id = ?').run(dismissed ? 1 : 0, user.id);
    }
    const row = db.prepare('SELECT onboarding_step, onboarding_dismissed FROM users WHERE id = ?').get(user.id) as
      { onboarding_step: number; onboarding_dismissed: number };
    res.json({ step: row.onboarding_step, dismissed: row.onboarding_dismissed === 1 });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});
```

- [ ] **Step 8: Run tests to verify they pass**

Run: `cd server && npm test`
Expected: all tests PASS, including the new ones (full suite, not just the filtered ones, to catch any regression).

- [ ] **Step 9: Run server build and the shell-injection guard**

Run: `cd server && npm run build`
Expected: clean, no TypeScript errors.

Run: `./scripts/check-no-shell-injection.sh` (from repo root)
Expected: "No shell-injection-prone exec-family template-literal patterns found under server/src." (this task touches no `exec`/shell code, but running the guard is cheap and keeps the invariant checked every task, matching this session's established practice).

- [ ] **Step 10: Commit**

```bash
git add server/src/database/migrations.ts server/src/auth.ts server/src/database/migrations.test.ts server/src/auth.test.ts
git commit -m "feat(server): add onboarding progress persistence (migration 7 + endpoints)"
```

---

## Task 2: Frontend — `onboarding` Pinia store

**Files:**
- Create: `client/src/stores/onboarding.ts`
- Test: `client/src/stores/__tests__/onboarding.test.ts`

**Interfaces:**
- Consumes: `GET`/`PATCH /api/auth/onboarding` from Task 1 (via `fetchApi` from `client/src/utils/api.ts`, the same helper `stores/auth.ts` and every other store already uses).
- Produces: `useOnboardingStore()` with `step: Ref<number>`, `dismissed: Ref<boolean>`, `loading: Ref<boolean>`, `fetchOnboarding(): Promise<void>`, `setStep(step: number): Promise<void>`, `dismiss(): Promise<void>`. Later tasks (3 and 4) call `setStep`/`dismiss`/read `step`/`dismissed`.

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { useOnboardingStore } from '../onboarding';
import * as api from '../../utils/api';

describe('useOnboardingStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.restoreAllMocks();
  });

  it('fetchOnboarding() populates step/dismissed from GET /auth/onboarding', async () => {
    vi.spyOn(api, 'fetchApi').mockResolvedValue({ step: 2, dismissed: false });
    const store = useOnboardingStore();
    await store.fetchOnboarding();
    expect(api.fetchApi).toHaveBeenCalledWith('/auth/onboarding');
    expect(store.step).toBe(2);
    expect(store.dismissed).toBe(false);
  });

  it('setStep(n) PATCHes the new step and updates local state', async () => {
    vi.spyOn(api, 'fetchApi').mockResolvedValue({ step: 3, dismissed: false });
    const store = useOnboardingStore();
    await store.setStep(3);
    expect(api.fetchApi).toHaveBeenCalledWith('/auth/onboarding', {
      method: 'PATCH',
      body: JSON.stringify({ step: 3 }),
    });
    expect(store.step).toBe(3);
  });

  it('dismiss() PATCHes dismissed:true and updates local state', async () => {
    vi.spyOn(api, 'fetchApi').mockResolvedValue({ step: 1, dismissed: true });
    const store = useOnboardingStore();
    await store.dismiss();
    expect(api.fetchApi).toHaveBeenCalledWith('/auth/onboarding', {
      method: 'PATCH',
      body: JSON.stringify({ dismissed: true }),
    });
    expect(store.dismissed).toBe(true);
  });
});
```

(Check `client/src/utils/api.ts`'s actual `fetchApi` signature before finalizing this test — match its real call shape, e.g. whether it takes headers/method as a second options object exactly like this, by reading one other store's existing test for the same mocking pattern.)

- [ ] **Step 2: Run test to verify it fails**

Run: `cd client && npx vitest run src/stores/__tests__/onboarding.test.ts`
Expected: FAIL — `../onboarding` doesn't exist yet.

- [ ] **Step 3: Implement the store**

```typescript
import { defineStore } from 'pinia';
import { ref } from 'vue';
import { fetchApi } from '../utils/api';

export const useOnboardingStore = defineStore('onboarding', () => {
  const step = ref(0);
  const dismissed = ref(false);
  const loading = ref(false);

  async function fetchOnboarding() {
    loading.value = true;
    try {
      const data = await fetchApi('/auth/onboarding');
      step.value = data.step;
      dismissed.value = data.dismissed;
    } finally {
      loading.value = false;
    }
  }

  async function setStep(newStep: number) {
    const data = await fetchApi('/auth/onboarding', {
      method: 'PATCH',
      body: JSON.stringify({ step: newStep }),
    });
    step.value = data.step;
    dismissed.value = data.dismissed;
  }

  async function dismiss() {
    const data = await fetchApi('/auth/onboarding', {
      method: 'PATCH',
      body: JSON.stringify({ dismissed: true }),
    });
    step.value = data.step;
    dismissed.value = data.dismissed;
  }

  return { step, dismissed, loading, fetchOnboarding, setStep, dismiss };
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd client && npx vitest run src/stores/__tests__/onboarding.test.ts`
Expected: PASS

- [ ] **Step 5: Run full client test suite + build + lint**

Run: `cd client && npm run build && npm test`
Expected: build clean, all tests pass (no regressions).

Run: `npm run lint` (repo root)
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add client/src/stores/onboarding.ts client/src/stores/__tests__/onboarding.test.ts
git commit -m "feat(client): add onboarding Pinia store"
```

---

## Task 3: Frontend — `Onboarding.vue` view, steps 1 and 2

**Files:**
- Create: `client/src/views/Onboarding.vue`
- Test: `client/src/views/__tests__/Onboarding.smoke.test.ts`
- Modify: `client/src/router/index.ts` (add the `/onboarding` route)
- Modify: `client/src/views/Setup.vue:39` (redirect target)

**Interfaces:**
- Consumes: `useOnboardingStore()` (Task 2), `useSystemStore()`'s `installedPackages.snapserver` / `installPackage('snapserver')` / `loading` (existing, unchanged), `AddEditPipeDialog.vue`'s `defineExpose({ openAdd, openEdit })` and `saved` emit shape `{ snapserverConfigChanged: boolean }` (existing, Task 42, unchanged), `usePipeSourcesStore()`'s `pipes` list (existing, to detect "already has a source").
- Produces: a step-indicator UI and step-1/step-2 bodies. Step 3 is added in Task 4 — this task's `Onboarding.vue` should render steps 1-2 fully and a placeholder-free "coming in the next task" is NOT acceptable per this plan's no-placeholder rule, so **this task also renders step 3's body as a static "connect a client, then come back" message with no live SSE logic yet** — Task 4 REPLACES that static message with the real live-updating version. State this explicitly in the component so Task 4's diff is a clean swap, not an addition into empty space.

- [ ] **Step 1: Write the failing smoke test**

Read `client/src/views/__tests__/PipeSources.smoke.test.ts`'s `mountSmokeTest` helper usage (or whatever this project's shared view-mounting test helper is called) before writing this, then add:

```typescript
import { describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { nextTick } from 'vue';
import Onboarding from '../Onboarding.vue';
import { useOnboardingStore } from '../../stores/onboarding';
import { useSystemStore } from '../../stores/system';
import { usePipeSourcesStore } from '../../stores/pipeSources';
import { mountSmokeTest } from './mountView'; // match the actual helper import path used elsewhere

describe('Onboarding.vue', () => {
  it('step 1 shows "Install Snapserver" when not installed, and calls systemStore.installPackage on click', async () => {
    const wrapper = await mountSmokeTest(Onboarding, '/onboarding');
    const onboardingStore = useOnboardingStore();
    const systemStore = useSystemStore();
    onboardingStore.step = 1;
    systemStore.installedPackages.snapserver = false;
    const installSpy = vi.spyOn(systemStore, 'installPackage').mockResolvedValue(undefined as any);
    await nextTick();

    const installButton = wrapper.findAll('button').find(b => b.text().includes('Install Snapserver'));
    expect(installButton, 'expected an Install Snapserver button on step 1').toBeTruthy();
    await installButton!.trigger('click');
    expect(installSpy).toHaveBeenCalledWith('snapserver');
  });

  it('step 1 shows a confirmation and a Next control when already installed', async () => {
    const wrapper = await mountSmokeTest(Onboarding, '/onboarding');
    const onboardingStore = useOnboardingStore();
    const systemStore = useSystemStore();
    onboardingStore.step = 1;
    systemStore.installedPackages.snapserver = true;
    await nextTick();

    expect(wrapper.text()).not.toContain('Install Snapserver');
    const nextButton = wrapper.findAll('button').find(b => b.text().includes('Next'));
    expect(nextButton, 'expected a Next control once snapserver is installed').toBeTruthy();
  });

  it('step 2 auto-opens AddEditPipeDialog and advances to step 3 when it emits saved', async () => {
    const wrapper = await mountSmokeTest(Onboarding, '/onboarding');
    const onboardingStore = useOnboardingStore();
    const pipeSourcesStore = usePipeSourcesStore();
    onboardingStore.step = 2;
    pipeSourcesStore.pipes = [];
    const setStepSpy = vi.spyOn(onboardingStore, 'setStep').mockResolvedValue(undefined);
    await nextTick();
    await nextTick();

    // Dialog is Teleport(to="body")'d -- query document.body, same pattern
    // established by every extracted-modal test this session.
    expect(document.body.textContent).toContain('Add Pipe Source');

    const dialogComponent = wrapper.findComponent({ name: 'AddEditPipeDialog' });
    dialogComponent.vm.$emit('saved', { snapserverConfigChanged: true });
    await nextTick();

    expect(setStepSpy).toHaveBeenCalledWith(3);
  });

  it('step 2 skips the dialog and shows an already-satisfied state if pipes already exist', async () => {
    const wrapper = await mountSmokeTest(Onboarding, '/onboarding');
    const onboardingStore = useOnboardingStore();
    const pipeSourcesStore = usePipeSourcesStore();
    onboardingStore.step = 2;
    pipeSourcesStore.pipes = [{ id: 'p1', name: 'Radio' } as any];
    await nextTick();

    expect(document.body.textContent).not.toContain('Add Pipe Source');
    expect(wrapper.text()).toContain('already have');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd client && npx vitest run src/views/__tests__/Onboarding.smoke.test.ts`
Expected: FAIL — `Onboarding.vue` doesn't exist.

- [ ] **Step 3: Implement `Onboarding.vue`**

```vue
<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue';
import Layout from '../components/Layout.vue';
import Button from '../components/ui/Button.vue';
import AddEditPipeDialog from '../components/pipe-sources/AddEditPipeDialog.vue';
import { useOnboardingStore } from '../stores/onboarding';
import { useSystemStore } from '../stores/system';
import { usePipeSourcesStore } from '../stores/pipeSources';
import { useRouter } from 'vue-router';

const onboardingStore = useOnboardingStore();
const systemStore = useSystemStore();
const pipeSourcesStore = usePipeSourcesStore();
const router = useRouter();

const addEditDialog = ref<InstanceType<typeof AddEditPipeDialog> | null>(null);

onMounted(async () => {
  await onboardingStore.fetchOnboarding();
  if (pipeSourcesStore.pipes.length === 0) {
    await pipeSourcesStore.fetchPipes();
  }
  if (onboardingStore.step === 2 && pipeSourcesStore.pipes.length === 0) {
    addEditDialog.value?.openAdd();
  }
});

// Re-open the dialog if step becomes 2 after mount (e.g. advancing from step 1).
watch(() => onboardingStore.step, (step) => {
  if (step === 2 && pipeSourcesStore.pipes.length === 0) {
    addEditDialog.value?.openAdd();
  }
});

const step1Done = computed(() => systemStore.installedPackages.snapserver);
const step2Done = computed(() => pipeSourcesStore.pipes.length > 0);

async function handleInstallSnapserver() {
  await systemStore.installPackage('snapserver');
}

async function advanceTo(step: number) {
  await onboardingStore.setStep(step);
}

async function handlePipeSaved() {
  await advanceTo(3);
}

async function skip() {
  await onboardingStore.dismiss();
  router.push('/');
}
</script>

<template>
  <Layout>
    <div class="max-w-2xl mx-auto py-12 space-y-8">
      <div class="flex items-center justify-between">
        <h1 class="text-2xl font-black text-text-main">Get Started</h1>
        <button @click="skip" class="text-xs font-bold text-text-muted hover:text-text-main uppercase tracking-widest">
          Skip for now
        </button>
      </div>

      <div class="flex items-center gap-2" aria-label="Onboarding progress">
        <div v-for="n in 3" :key="n" class="flex-1 h-1 rounded-full"
             :class="onboardingStore.step >= n ? 'bg-brand-primary' : 'bg-white/10'"></div>
      </div>

      <div v-if="onboardingStore.step === 1" class="space-y-4">
        <h2 class="text-lg font-bold text-text-main">1. Install Snapserver</h2>
        <p class="text-sm text-text-muted">Snapserver is the audio server this app manages.</p>
        <div v-if="!step1Done">
          <Button :loading="systemStore.loading" @click="handleInstallSnapserver">Install Snapserver</Button>
        </div>
        <div v-else class="space-y-3">
          <p class="text-sm text-[#00ff9d]">Snapserver is installed.</p>
          <Button @click="advanceTo(2)">Next</Button>
        </div>
      </div>

      <div v-else-if="onboardingStore.step === 2" class="space-y-4">
        <h2 class="text-lg font-bold text-text-main">2. Add your first source</h2>
        <p v-if="step2Done" class="text-sm text-text-muted">
          You already have {{ pipeSourcesStore.pipes.length }} source(s) configured.
        </p>
        <Button v-if="step2Done" @click="advanceTo(3)">Next</Button>
        <AddEditPipeDialog ref="addEditDialog" @saved="handlePipeSaved" />
      </div>

      <div v-else-if="onboardingStore.step === 3" class="space-y-4">
        <h2 class="text-lg font-bold text-text-main">3. Assign your first zone</h2>
        <!-- Task 4 replaces this static body with a live, SSE-driven
             "waiting for a client" state and the real per-zone <Select>
             assignment control. -->
        <p class="text-sm text-text-muted">
          Connect a client (a physical snapclient device on your network, or
          this app's own local Client mode), then come back here to assign it
          a source.
        </p>
      </div>
    </div>
  </Layout>
</template>
```

(Check `Button.vue`'s actual `loading` prop name before finalizing — if it's spelled differently, e.g. `:disabled` + a manual spinner like other views use, match the REAL prop, don't assume.)

- [ ] **Step 4: Add the route**

In `client/src/router/index.ts`, add alongside the other `meta: { requiresAuth: true }` routes:

```typescript
{
  path: '/onboarding',
  name: 'Onboarding',
  component: () => import('../views/Onboarding.vue'),
  meta: { requiresAuth: true }
},
```

(Match the existing routes' style exactly — some use direct `component: Dashboard` imports, some may use lazy `() => import(...)`; read a neighboring route and follow the SAME convention rather than introducing a new one.)

- [ ] **Step 5: Wire the Setup.vue redirect**

In `client/src/views/Setup.vue`, change line 39's `router.push('/')` to `router.push('/onboarding')`.

- [ ] **Step 6: Run test to verify it passes**

Run: `cd client && npx vitest run src/views/__tests__/Onboarding.smoke.test.ts`
Expected: PASS

- [ ] **Step 7: Run full client suite + build + lint**

Run: `cd client && npm run build && npm test`
Expected: build clean, all tests pass. Specifically confirm `Setup.vue`'s own existing test (if any) still passes after the redirect-target change.

Run: `npm run lint` (repo root)
Expected: exit 0.

- [ ] **Step 8: Commit**

```bash
git add client/src/views/Onboarding.vue client/src/views/__tests__/Onboarding.smoke.test.ts client/src/router/index.ts client/src/views/Setup.vue
git commit -m "feat(client): add onboarding wizard steps 1-2 (install snapserver, add first source)"
```

---

## Task 4: Frontend — `Onboarding.vue` step 3 (live zone assignment) + Dashboard resume banner

**Files:**
- Modify: `client/src/views/Onboarding.vue` (replace step 3's static body)
- Modify: `client/src/views/Dashboard.vue` (add the resume banner)
- Modify: `client/src/views/__tests__/Onboarding.smoke.test.ts` (add step-3 tests)
- Modify: `client/src/views/__tests__/Dashboard.smoke.test.ts` (add banner tests)

**Interfaces:**
- Consumes: `useSnapcastStore()`'s `status` (already SSE-driven app-wide, existing, unchanged), `setGroupStream(groupId, streamId)` (existing, unchanged), the `Select` UI primitive (`client/src/components/ui/Select.vue`, existing).
- Produces: nothing new consumed by later tasks — this is the last implementation task.

- [ ] **Step 1: Write the failing step-3 tests**

Append to `client/src/views/__tests__/Onboarding.smoke.test.ts`:

```typescript
it('step 3 shows a waiting state when no group has a connected client', async () => {
  const wrapper = await mountSmokeTest(Onboarding, '/onboarding');
  const onboardingStore = useOnboardingStore();
  const snapcastStore = useSnapcastStore();
  onboardingStore.step = 3;
  snapcastStore.status = { server: { version: '1.0' }, groups: [], streams: [] } as any;
  await nextTick();

  expect(wrapper.text().toLowerCase()).toContain('waiting for a client');
});

it('step 3 shows a zone-assignment Select once a group with a client exists, and completes onboarding on assignment', async () => {
  const wrapper = await mountSmokeTest(Onboarding, '/onboarding');
  const onboardingStore = useOnboardingStore();
  const snapcastStore = useSnapcastStore();
  const setStepSpy = vi.spyOn(onboardingStore, 'setStep').mockResolvedValue(undefined);
  onboardingStore.step = 3;
  snapcastStore.status = {
    server: { version: '1.0' },
    groups: [{ id: 'g1', name: 'Living Room', clients: [{ id: 'c1' }], stream_id: '', muted: false }],
    streams: [{ id: 'a', status: 'idle', uri: { query: { name: 'Radio A' }, scheme: 'tcp' } }],
  } as any;
  const setGroupStreamSpy = vi.spyOn(snapcastStore, 'setGroupStream').mockResolvedValue(undefined);
  await nextTick();

  expect(wrapper.text().toLowerCase()).not.toContain('waiting for a client');

  const selectButton = wrapper.findAll('button').find(b => b.text().length > 0);
  expect(selectButton, 'expected the zone Select trigger to be present').toBeTruthy();
  await selectButton!.trigger('click');
  const option = wrapper.findAll('[role="option"]').find(o => o.text().includes('Radio A'));
  await option!.trigger('click');
  await nextTick();

  expect(setGroupStreamSpy).toHaveBeenCalledWith('g1', 'a');
  expect(setStepSpy).toHaveBeenCalledWith(3); // marks complete; adjust to whatever "done" sentinel Step 3 implementation actually uses
});
```

(Import `useSnapcastStore` at the top of the test file alongside the other store imports. If step-3-complete uses a different sentinel than `setStep(3)` again — e.g. a dedicated `complete()` — write the test against whatever you actually implement in Step 2 below, keep this test and the implementation consistent.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd client && npx vitest run src/views/__tests__/Onboarding.smoke.test.ts`
Expected: FAIL — step 3 still shows the static placeholder text from Task 3.

- [ ] **Step 3: Replace step 3's body in `Onboarding.vue`**

Add to the `<script setup>` block:

```typescript
import { useSnapcastStore } from '../stores/snapcast';
import Select from '../components/ui/Select.vue';

const snapcastStore = useSnapcastStore();

const firstGroupWithClient = computed(() =>
  snapcastStore.status?.groups.find(g => g.clients.length > 0) ?? null
);

const streamSelectOptions = computed(() =>
  (snapcastStore.status?.streams || []).map((stream: any) => ({
    value: stream.id,
    label: stream.uri?.query?.name || stream.id,
  }))
);

async function handleZoneAssignment(streamId: string | number) {
  const group = firstGroupWithClient.value;
  if (!group) return;
  await snapcastStore.setGroupStream(group.id, String(streamId));
  await advanceTo(3);
  router.push('/');
}
```

Replace the `v-else-if="onboardingStore.step === 3"` block's body:

```vue
      <div v-else-if="onboardingStore.step === 3" class="space-y-4">
        <h2 class="text-lg font-bold text-text-main">3. Assign your first zone</h2>
        <div v-if="!firstGroupWithClient" class="space-y-2">
          <p class="text-sm text-text-muted">
            Waiting for a client to connect. Connect a physical snapclient device
            on your network, or use this app's own local Client mode -- this page
            updates automatically once one appears.
          </p>
        </div>
        <div v-else class="space-y-3">
          <p class="text-sm text-text-muted">
            {{ firstGroupWithClient.name || 'Zone ' + firstGroupWithClient.id.slice(0, 4) }} is ready.
            Pick a source for it:
          </p>
          <Select
            :model-value="firstGroupWithClient.stream_id"
            :options="streamSelectOptions"
            placeholder="Choose a source"
            @update:model-value="handleZoneAssignment"
          />
        </div>
      </div>
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd client && npx vitest run src/views/__tests__/Onboarding.smoke.test.ts`
Expected: PASS

- [ ] **Step 5: Write the failing Dashboard banner test**

Append to `client/src/views/__tests__/Dashboard.smoke.test.ts`:

```typescript
it('shows a resume-onboarding banner when incomplete and not dismissed', async () => {
  const wrapper = await mountSmokeTest(Dashboard, '/');
  const onboardingStore = useOnboardingStore();
  onboardingStore.step = 2;
  onboardingStore.dismissed = false;
  await nextTick();

  expect(wrapper.text().toLowerCase()).toContain('finish setting up');
  const link = wrapper.findAll('a, router-link-stub').find(el => el.attributes('to') === '/onboarding' || el.attributes('href') === '/onboarding');
  expect(link, 'expected a link/route to /onboarding').toBeTruthy();
});

it('hides the banner once onboarding is complete or dismissed', async () => {
  const wrapper = await mountSmokeTest(Dashboard, '/');
  const onboardingStore = useOnboardingStore();
  onboardingStore.step = 3;
  onboardingStore.dismissed = false;
  await nextTick();
  expect(wrapper.text().toLowerCase()).not.toContain('finish setting up');

  onboardingStore.step = 1;
  onboardingStore.dismissed = true;
  await nextTick();
  expect(wrapper.text().toLowerCase()).not.toContain('finish setting up');
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `cd client && npx vitest run src/views/__tests__/Dashboard.smoke.test.ts`
Expected: FAIL — no banner exists yet.

- [ ] **Step 7: Add the banner to `Dashboard.vue`**

Add the import (`import { useOnboardingStore } from '../stores/onboarding';` and `const onboardingStore = useOnboardingStore();`, plus an `onMounted` call to `onboardingStore.fetchOnboarding()` if one doesn't already run app-wide) and, near the top of the template (above the existing page header, matching wherever this view's other conditional banners like the zombie-warning one are placed):

```vue
<div v-if="onboardingStore.step < 3 && !onboardingStore.dismissed"
     class="flex items-center justify-between p-4 bg-brand-primary/10 border border-brand-primary/30 rounded-lg mb-6">
  <span class="text-sm font-bold text-text-main">Finish setting up your system.</span>
  <router-link to="/onboarding" class="text-xs font-black text-brand-primary uppercase tracking-widest hover:underline">
    Resume Setup
  </router-link>
</div>
```

(Check whether `Dashboard.vue` already fetches `onboardingStore` data somewhere on mount from Task 3's changes — if not, add the fetch call here; don't double-fetch if `Onboarding.vue`'s own `onMounted` already ran this session and the store's state persists across navigation, which it does since Pinia stores are singletons.)

- [ ] **Step 8: Run test to verify it passes**

Run: `cd client && npx vitest run src/views/__tests__/Dashboard.smoke.test.ts`
Expected: PASS

- [ ] **Step 9: Run full verification suite**

Run: `cd client && npm run build && npm test`
Expected: build clean, all tests pass (no regressions across the whole suite, not just the two files touched this task).

Run: `cd server && npm test && npm run build`
Expected: unaffected, unchanged pass count from before Task 1.

Run: `npm run lint` (repo root)
Expected: exit 0.

Run: `./scripts/check-no-shell-injection.sh` (repo root)
Expected: zero matches.

- [ ] **Step 10: Commit**

```bash
git add client/src/views/Onboarding.vue client/src/views/Dashboard.vue client/src/views/__tests__/Onboarding.smoke.test.ts client/src/views/__tests__/Dashboard.smoke.test.ts
git commit -m "feat(client): add onboarding wizard step 3 (assign first zone) and Dashboard resume banner"
```

---

## Self-Review

**Spec coverage:**
- 3-step wizard, skippable, server-persisted → Tasks 1-4, all steps.
- Step 1 (install snapserver) → Task 3.
- Step 2 (create first pipe source, reusing `AddEditPipeDialog.vue`) → Task 3.
- Step 3 (assign first zone, waiting-for-client state, reusing the `Select` pattern) → Task 4.
- Trigger via Setup.vue redirect → Task 3, Step 5.
- Dashboard resume banner → Task 4.
- Data model / API → Task 1.
- Testing approach (Vitest, mocked stores, no live-browser dependency) → every task's test steps.
- Spec's "Open questions" section (route guard for direct `/onboarding` visits, folding onboarding state into `/api/auth/me`, multi-group step-3 scoping) is intentionally NOT resolved by this plan — these are flagged in the spec as decisions for whoever executes the plan to make a judgment call on if they come up, not blocking gaps. The plan as written handles the common case (direct visits work fine since the route has no special guard beyond `requiresAuth`; a separate endpoint pair was chosen over folding into `/me` for a smaller, more isolated Task 1 diff; step 3 scopes to the first group with a client, matching a true first-run and disclosed as a simplification for the resumed-with-existing-groups case).

**Placeholder scan:** No TBD/TODO/"handle appropriately" patterns. Every code block is complete. The one deliberate exception — Task 3's static step-3 body — is explicitly flagged as intentional and fully specified (exact text), not a placeholder; Task 4 replaces it with real code, not fills in a gap.

**Type consistency:** `useOnboardingStore()`'s `step`/`dismissed`/`setStep`/`dismiss` signatures (Task 2) are used identically in Tasks 3 and 4. `AddEditPipeDialog.vue`'s `openAdd()`/`saved` emit shape (Task 3) matches its actual existing implementation (verified against the real component during planning, not assumed). `snapcastStore.setGroupStream(groupId: string, streamId: string)` (Task 4) matches its existing real signature.

---

Plan complete and saved to `docs/superpowers/plans/2026-08-25-onboarding-wizard.md`.
