import { describe, expect, it } from 'vitest';
import Setup from '../Setup.vue';
import { mountSmokeTest } from '../../test/mountView';

describe('Setup.vue', () => {
  it('mounts without throwing', async () => {
    const wrapper = await mountSmokeTest(Setup, '/setup');
    expect(wrapper.exists()).toBe(true);
  });
});
