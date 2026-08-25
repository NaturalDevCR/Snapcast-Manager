// Task 38: focused coverage for the newly-extracted SnapshotsPanel.vue —
// ServerConfig.vue's smoke test only mounts on the default 'standard' tab,
// so this is the only test that exercises the Snapshots tab's markup at all.
import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import SnapshotsPanel from '../SnapshotsPanel.vue';
import { useSnapshotStore } from '../../../stores/snapshots';

describe('SnapshotsPanel.vue', () => {
  it('renders snapshot rows when snapshotStore.snapshots is populated', () => {
    const pinia = createPinia();
    setActivePinia(pinia);
    const store = useSnapshotStore();
    store.snapshots = [
      { id: 1, name: 'Pre-optimization', description: 'Before tuning buffer sizes', filename: 'a.tar.gz', timestamp: '2026-08-01T00:00:00.000Z' },
    ];

    const wrapper = mount(SnapshotsPanel, {
      global: { plugins: [pinia] },
    });

    expect(wrapper.exists()).toBe(true);
    expect(wrapper.text()).toContain('Pre-optimization');
    expect(wrapper.text()).toContain('Before tuning buffer sizes');
    expect(wrapper.text()).not.toContain('No snapshots archived');
  });

  it('renders the empty state when snapshotStore.snapshots is empty', () => {
    const pinia = createPinia();
    setActivePinia(pinia);

    const wrapper = mount(SnapshotsPanel, {
      global: { plugins: [pinia] },
    });

    expect(wrapper.text()).toContain('No snapshots archived');
  });
});
