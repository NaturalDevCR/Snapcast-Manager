import { describe, expect, it } from 'vitest';
import Login from '../Login.vue';
import { mountSmokeTest } from '../../test/mountView';

describe('Login.vue', () => {
  it('mounts without throwing', async () => {
    const wrapper = await mountSmokeTest(Login, '/login');
    expect(wrapper.exists()).toBe(true);
  });
});
