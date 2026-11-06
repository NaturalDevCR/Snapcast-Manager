<script setup lang="ts">
// ClientsPanel.vue -- the Dashboard's clients card. A deployment can have
// dozens of clients, so rows are single-line, the list scrolls inside a
// fixed-height card, and larger lists get a search box and status filter.
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import type { SnapcastClient } from '@shared/snapcast';
import Card from '../Card.vue';

const FILTER_THRESHOLD = 8;

type StatusFilter = 'all' | 'online' | 'offline';

const props = defineProps<{ clients: SnapcastClient[] }>();

const { t } = useI18n({ useScope: 'global' });

const query = ref('');
const status = ref<StatusFilter>('all');

const displayName = (client: SnapcastClient) => client.config.name || client.host.name;
// Snapserver reports IPv4 peers in their IPv6-mapped form.
const displayIp = (client: SnapcastClient) => client.host.ip.replace(/^::ffff:/, '');

const sorted = computed(() =>
  [...props.clients].sort(
    (a, b) =>
      Number(b.connected) - Number(a.connected) ||
      displayName(a).localeCompare(displayName(b), undefined, { numeric: true }),
  ),
);

const onlineCount = computed(() => props.clients.filter((c) => c.connected).length);
const hasFilters = computed(() => props.clients.length > FILTER_THRESHOLD);

const filters = computed<{ value: StatusFilter; label: string; count: number }[]>(() => [
  { value: 'all', label: t('dashboard.clientsFilterAll'), count: props.clients.length },
  { value: 'online', label: t('dashboard.clientsFilterOnline'), count: onlineCount.value },
  {
    value: 'offline',
    label: t('dashboard.clientsFilterOffline'),
    count: props.clients.length - onlineCount.value,
  },
]);

const visible = computed(() => {
  if (!hasFilters.value) return sorted.value;
  const needle = query.value.trim().toLowerCase();
  return sorted.value.filter((client) => {
    if (status.value === 'online' && !client.connected) return false;
    if (status.value === 'offline' && client.connected) return false;
    return (
      !needle ||
      displayName(client).toLowerCase().includes(needle) ||
      displayIp(client).includes(needle)
    );
  });
});
</script>

<template>
  <Card :title="t('dashboard.clientsCardTitle')" class="lg:h-[32rem]">
    <template #icon>
      <span class="material-symbols-outlined text-[1.2rem]" aria-hidden="true">speaker_group</span>
    </template>
    <template #action>
      <router-link
        to="/routing"
        class="text-xs font-semibold text-brand-primary-text hover:underline"
        >{{ t('dashboard.openMatrixLink') }}</router-link
      >
    </template>

    <div v-if="hasFilters" class="mb-3 space-y-2">
      <div class="relative">
        <span
          class="material-symbols-outlined pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[1rem] text-text-muted"
          aria-hidden="true"
          >search</span
        >
        <input
          v-model="query"
          type="search"
          :placeholder="t('dashboard.clientsSearchPlaceholder')"
          :aria-label="t('dashboard.clientsSearchPlaceholder')"
          class="w-full rounded-lg border border-line bg-inset py-1.5 pl-8 pr-3 text-sm text-text-main placeholder:text-text-muted focus:border-brand-primary focus:outline-none"
        />
      </div>
      <div
        class="flex rounded-lg border border-line bg-inset p-0.5"
        role="radiogroup"
        :aria-label="t('dashboard.clientsFilterLabel')"
      >
        <button
          v-for="filter in filters"
          :key="filter.value"
          type="button"
          role="radio"
          :aria-checked="status === filter.value"
          :class="
            status === filter.value
              ? 'bg-brand-surface text-text-main shadow-sm'
              : 'text-text-muted hover:text-text-main'
          "
          class="flex-1 whitespace-nowrap rounded-md px-2 py-1 text-xs font-semibold transition-colors"
          @click="status = filter.value"
        >
          {{ filter.label }}
          <span class="tabular-nums opacity-70">{{ filter.count }}</span>
        </button>
      </div>
    </div>

    <ul
      v-if="visible.length"
      class="-mx-5 -mb-3 max-h-96 flex-1 divide-y divide-line overflow-y-auto px-5 [scrollbar-width:thin] lg:max-h-none lg:min-h-0"
    >
      <li
        v-for="client in visible"
        :key="client.id"
        class="flex items-center gap-2.5 py-2"
        :class="client.connected ? '' : 'opacity-60'"
      >
        <span
          class="h-2 w-2 flex-shrink-0 rounded-full"
          :class="client.connected ? 'bg-success' : 'bg-text-muted/40'"
          aria-hidden="true"
        ></span>
        <span class="min-w-0 flex-1 truncate text-sm text-text-main" :title="displayName(client)">{{
          displayName(client)
        }}</span>
        <span class="hidden flex-shrink-0 font-mono text-[11px] text-text-muted xl:inline">{{
          displayIp(client)
        }}</span>
        <span
          class="flex-shrink-0 text-right text-xs tabular-nums text-text-muted"
          :class="client.connected ? 'w-9' : ''"
        >
          <template v-if="!client.connected">{{ t('dashboard.clientOffline') }}</template>
          <span
            v-else-if="client.config.volume.muted"
            class="material-symbols-outlined align-middle text-[1rem]"
            :title="t('dashboard.volumeMutedLabel')"
            :aria-label="t('dashboard.volumeMutedLabel')"
            >volume_off</span
          >
          <template v-else>{{ client.config.volume.percent }}%</template>
        </span>
      </li>
    </ul>
    <p v-else class="text-sm text-text-muted">
      {{ clients.length ? t('dashboard.clientsNoMatch') : t('dashboard.clientsEmpty') }}
    </p>
  </Card>
</template>
