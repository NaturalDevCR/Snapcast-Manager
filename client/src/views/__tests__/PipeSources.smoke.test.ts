import { describe, expect, it } from 'vitest';
import PipeSources from '../PipeSources.vue';
import { mountSmokeTest } from '../../test/mountView';

describe('PipeSources.vue', () => {
  it('mounts without throwing', async () => {
    const wrapper = await mountSmokeTest(PipeSources, '/pipe-sources');
    expect(wrapper.exists()).toBe(true);
  });
});
