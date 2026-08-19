import { describe, expect, it } from 'vitest';
import Dashboard from '../Dashboard.vue';
import { mountSmokeTest } from '../../test/mountView';

describe('Dashboard.vue', () => {
  it('mounts without throwing', async () => {
    const wrapper = await mountSmokeTest(Dashboard, '/');
    expect(wrapper.exists()).toBe(true);
  });
});
