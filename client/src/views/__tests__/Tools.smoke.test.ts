import { describe, expect, it } from 'vitest';
import Tools from '../Tools.vue';
import { mountSmokeTest } from '../../test/mountView';

describe('Tools.vue', () => {
  it('mounts without throwing', async () => {
    const wrapper = await mountSmokeTest(Tools, '/tools');
    expect(wrapper.exists()).toBe(true);
  });
});
