import { describe, expect, it } from 'vitest';
import ClientDashboard from '../ClientDashboard.vue';
import { mountSmokeTest } from '../../test/mountView';

describe('ClientDashboard.vue', () => {
  it('mounts without throwing', async () => {
    const wrapper = await mountSmokeTest(ClientDashboard, '/client');
    expect(wrapper.exists()).toBe(true);
  });
});
