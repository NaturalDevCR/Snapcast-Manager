// Feature request found live: a user installing/updating a package (e.g.
// shairport-sync, a real multi-minute source compile) asked to see a real
// log window instead of one line overwritten every 2s poll -- see
// JobLogPanel.vue's own header comment for the full account, and
// stores/system.ts's runJob()/jobLog for where the log array itself comes
// from.
import { describe, expect, it } from 'vitest';
import { nextTick } from 'vue';
import JobLogPanel from '../JobLogPanel.vue';
import { mountSmokeTest } from '../../test/mountView';
import { useSystemStore } from '../../stores/system';

describe('JobLogPanel.vue', () => {
  it('renders nothing when no job is running', async () => {
    const wrapper = await mountSmokeTest(JobLogPanel);
    expect(wrapper.find('.fixed').exists()).toBe(false);
  });

  it('shows the loading header but no log panel for a quick action with no log lines (e.g. start/stop/restart a service)', async () => {
    const wrapper = await mountSmokeTest(JobLogPanel);
    const systemStore = useSystemStore();
    systemStore.loading = true;
    systemStore.loadingMessage = 'Restarting MPD...';
    // jobLog left empty -- runJob() only ever populates it for a real
    // background job (one with a jobId), never for the quick,
    // synchronous service-control actions that also set `loading`.
    await nextTick();

    expect(wrapper.text()).toContain('Restarting MPD...');
    // The terminal-styled log body itself must not render at all for a
    // log-less action -- an empty black panel would be worse than none.
    expect(wrapper.find('.bg-black\\/90').exists()).toBe(false);
  });

  it('renders the full, growing job log for a real background job', async () => {
    const wrapper = await mountSmokeTest(JobLogPanel);
    const systemStore = useSystemStore();
    systemStore.loading = true;
    systemStore.loadingMessage = 'Installing Shairport Sync (AirPlay)...';
    systemStore.jobLog = [
      'Cleaning up any legacy installations...',
      'Building and installing nqptp...',
    ];
    await nextTick();

    expect(wrapper.text()).toContain('Installing Shairport Sync (AirPlay)...');
    expect(wrapper.text()).toContain('Cleaning up any legacy installations...');
    expect(wrapper.text()).toContain('Building and installing nqptp...');

    // A real install keeps pushing lines onto the SAME array -- the panel
    // must reflect every new line, not just whatever was present at mount.
    systemStore.jobLog.push('Cloning into /tmp/nqptp-build...');
    await nextTick();
    expect(wrapper.text()).toContain('Cloning into /tmp/nqptp-build...');
  });

  it('disappears once the job finishes (loading goes false)', async () => {
    const wrapper = await mountSmokeTest(JobLogPanel);
    const systemStore = useSystemStore();
    systemStore.loading = true;
    systemStore.jobLog = ['Installing...'];
    await nextTick();
    expect(wrapper.find('.fixed').exists()).toBe(true);

    systemStore.loading = false;
    await nextTick();
    expect(wrapper.find('.fixed').exists()).toBe(false);
  });
});
