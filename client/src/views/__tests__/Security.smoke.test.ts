import { describe, expect, it } from 'vitest';
import Security from '../Security.vue';
import { mountSmokeTest } from '../../test/mountView';

describe('Security.vue', () => {
  it('mounts without throwing', async () => {
    const wrapper = await mountSmokeTest(Security, '/security');
    expect(wrapper.exists()).toBe(true);
  });
});
