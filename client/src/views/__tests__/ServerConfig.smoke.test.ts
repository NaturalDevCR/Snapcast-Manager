import { describe, expect, it } from 'vitest';
import ServerConfig from '../ServerConfig.vue';
import { mountSmokeTest } from '../../test/mountView';

describe('ServerConfig.vue', () => {
  it('mounts without throwing', async () => {
    const wrapper = await mountSmokeTest(ServerConfig, '/server');
    expect(wrapper.exists()).toBe(true);
  });
});
