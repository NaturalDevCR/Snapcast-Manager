// Task 58 (Stage 5, item 5.1 -- frontend half): Pinia store wrapping the
// authenticated GET /api/health/detail endpoint (Task 57). Follows
// stores/system.ts's established shape: a `loading` ref plus a fetch
// function that calls fetchApi() and swallows/logs errors rather than
// throwing, so a transient failure just leaves `detail` at its last-known
// value instead of crashing the caller.
//
// `HealthDetail` is typed directly against the real response shape shipped
// in server/src/routes/health.ts's `/health/detail` handler -- five
// independently-reported checks, each with its own pass/fail shape (config
// and disk are discriminated unions since a failed check reports an `error`
// string instead of the success fields).
import { defineStore } from 'pinia';
import { ref } from 'vue';
import { fetchApi } from '../utils/api';

export interface HealthDetail {
  snapserver: {
    systemdActive: boolean;
    rpcConnected: boolean;
  };
  config: { parseable: true } | { parseable: false; error: string };
  disk: { freeBytes: number; freePercent: number } | { error: string };
  permissions: {
    snapshotsDirWritable: boolean;
  };
}

export const useHealthStore = defineStore('health', () => {
  const loading = ref(false);
  const detail = ref<HealthDetail | null>(null);

  async function fetchHealthDetail() {
    loading.value = true;
    try {
      detail.value = await fetchApi<HealthDetail>('/health/detail');
    } catch (err) {
      console.error('Failed to fetch health detail:', err);
    } finally {
      loading.value = false;
    }
  }

  return {
    loading,
    detail,
    fetchHealthDetail,
  };
});
