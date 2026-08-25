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
