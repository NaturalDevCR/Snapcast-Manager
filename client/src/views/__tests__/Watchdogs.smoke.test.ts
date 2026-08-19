import { describe, expect, it } from 'vitest';
import Watchdogs from '../Watchdogs.vue';
import { mountSmokeTest } from '../../test/mountView';

describe('Watchdogs.vue', () => {
  it('mounts without throwing', async () => {
    const wrapper = await mountSmokeTest(Watchdogs, '/watchdogs');
    expect(wrapper.exists()).toBe(true);
  });
});
