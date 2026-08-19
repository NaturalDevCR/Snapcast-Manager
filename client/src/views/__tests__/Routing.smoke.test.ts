import { describe, expect, it } from 'vitest';
import Routing from '../Routing.vue';
import { mountSmokeTest } from '../../test/mountView';

describe('Routing.vue', () => {
  it('mounts without throwing', async () => {
    const wrapper = await mountSmokeTest(Routing, '/routing');
    expect(wrapper.exists()).toBe(true);
  });
});
