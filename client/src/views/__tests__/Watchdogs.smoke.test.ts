import { describe, expect, it } from 'vitest';
import { nextTick } from 'vue';
import Watchdogs from '../Watchdogs.vue';
import { mountSmokeTest } from '../../test/mountView';
import { useWatchdogStore, type Watchdog } from '../../stores/watchdog';
import { useUIStore } from '../../stores/ui';

describe('Watchdogs.vue', () => {
  it('mounts without throwing', async () => {
    const wrapper = await mountSmokeTest(Watchdogs, '/watchdogs');
    expect(wrapper.exists()).toBe(true);
  });

  it('renders Spanish copy when locale is switched to "es"', async () => {
    const wrapper = await mountSmokeTest(Watchdogs, '/watchdogs');
    useWatchdogStore().watchdogs = [];
    useUIStore().setLocale('es');
    await nextTick();

    expect(wrapper.text()).toContain('Aún no hay watchdogs configurados');
    expect(wrapper.text()).toContain('Agrega un watchdog para supervisar las conexiones de fuentes TCP Server en tiempo real.');
  });

  // UI overhaul regression: each card used a non-existent #header slot on
  // Card.vue, so the watchdog's name, toggle and delete button never
  // rendered; and the delete ConfirmDialog was v-if'd without v-model, so it
  // never opened.
  it('renders each watchdog name with its toggle and delete controls', async () => {
    const wrapper = await mountSmokeTest(Watchdogs, '/watchdogs');
    useWatchdogStore().watchdogs = [
      { id: 'w1', name: 'Living Room TCP', ports: [4953], enabled: true, autoKillDuplicates: false } as Watchdog,
    ];
    await nextTick();

    expect(wrapper.text()).toContain('Living Room TCP');
    expect(wrapper.find('[role="switch"]').exists()).toBe(true);
    const del = wrapper.findAll('button').find((b) => b.attributes('aria-label') === 'Delete Living Room TCP');
    expect(del, 'expected a labelled delete button').toBeTruthy();
  });

  it('opens the delete confirmation when the delete button is clicked', async () => {
    const wrapper = await mountSmokeTest(Watchdogs, '/watchdogs');
    useWatchdogStore().watchdogs = [
      { id: 'w1', name: 'Living Room TCP', ports: [4953], enabled: true, autoKillDuplicates: false } as Watchdog,
    ];
    await nextTick();

    const del = wrapper.findAll('button').find((b) => b.attributes('aria-label') === 'Delete Living Room TCP');
    await del!.trigger('click');
    await nextTick();
    await nextTick();

    expect(document.body.textContent).toContain('Delete Watchdog');
  });
});
