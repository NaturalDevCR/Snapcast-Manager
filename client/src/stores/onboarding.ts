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
