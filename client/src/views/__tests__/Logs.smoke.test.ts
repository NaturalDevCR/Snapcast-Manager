import { describe, expect, it } from 'vitest';
import Logs from '../Logs.vue';
import { mountSmokeTest } from '../../test/mountView';

describe('Logs.vue', () => {
  it('mounts without throwing', async () => {
    const wrapper = await mountSmokeTest(Logs, '/logs');
    expect(wrapper.exists()).toBe(true);
  });
});
