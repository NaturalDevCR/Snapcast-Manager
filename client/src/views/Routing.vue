<script setup lang="ts">
import Layout from '../components/Layout.vue';
import Badge from '../components/ui/Badge.vue';
import Select from '../components/ui/Select.vue';
import Skeleton from '../components/ui/Skeleton.vue';
import PageHeader from '../components/ui/PageHeader.vue';
import Button from '../components/ui/Button.vue';
import EmptyState from '../components/ui/EmptyState.vue';
import MatrixSource from '../components/routing/MatrixSource.vue';
import { useSnapcastStore, type SnapcastGroup, type SnapcastStream } from '../stores/snapcast';
import { useEventSource } from '../composables/useEventSource';
import { sseStatusBadge } from '../utils/sseStatus';
import { buildRoutingLayout, filterRoutingLayout } from '../utils/routingLayout';
import { nextTick, onMounted, onUnmounted, ref, computed, watch } from 'vue';
import { useI18n } from 'vue-i18n';

const { t } = useI18n({ useScope: 'global' });

const vFocus = {
  mounted: (el: HTMLElement) => el.focus()
};

const snapcastStore = useSnapcastStore();
// Task 29: snapcast state updates now arrive via the app-wide SSE
// connection (Task 28, connected/disconnected by App.vue) instead of this
// view polling `snapcastStore.fetchStatus()` on its own timer. The live/
// reconnecting indicator below surfaces that connection's own status.
const sse = useEventSource();
const renamingClientId = ref<string | null>(null);
const newClientName = ref('');
const renamingGroupId = ref<string | null>(null);
const newGroupName = ref('');

// Container refs for coordinate calculation
const containerRef = ref<HTMLElement | null>(null);
const sourceRefs = ref<Record<string, HTMLElement>>({});
const zoneRefs = ref<Record<string, HTMLElement>>({});
const zoneCardRefs = ref<Record<string, HTMLElement>>({}); // For hit testing the entire card

// Dragging state
const isDragging = ref(false);
const draggedStreamId = ref<string | null>(null);
const mousePos = ref({ x: 0, y: 0 });
const hoverZoneId = ref<string | null>(null);
const expandedGroups = ref<Set<string>>(new Set());

const toggleGroup = (groupId: string) => {
    if (expandedGroups.value.has(groupId)) {
        expandedGroups.value.delete(groupId);
    } else {
        expandedGroups.value.add(groupId);
    }
    // Force reactivity update for the Set
    expandedGroups.value = new Set(expandedGroups.value);
};

// Colors for streams
const streamColors = [
    '#3b82f6', // blue
    '#8b5cf6', // violet
    '#10b981', // emerald
    '#ec4899', // pink
    '#f59e0b', // amber
    '#06b6d4', // cyan
    '#c026d3', // fuchsia
    '#eab308', // yellow
];

const getStreamColor = (streamId: string): string => {
    const index = snapcastStore.status?.streams.findIndex(s => s.id === streamId) ?? 0;
    return streamColors[Math.max(0, index) % streamColors.length]!;
};

const getStreamLabel = (stream: SnapcastStream) => {
    if (stream.uri?.query?.name) return stream.uri.query.name;
    return stream.id || t('routing.unknownStream');
};

const getStreamDetail = (stream: SnapcastStream, zoneCount: number) => {
    const state = stream.status === 'playing' ? t('routing.playing') : t('routing.idle');
    return zoneCount ? `${state} · ${t('routing.zonesCount', zoneCount)}` : state;
};

// Unnamed snapserver groups used to render as "Zone g-be" (a slice of the
// opaque group id). Snapcast's own clients name an unnamed group after its
// members, which is what people actually recognise -- do the same, and only
// fall back to the id when the group has no clients at all.
type ZoneLike = Pick<SnapcastGroup, 'id' | 'name' | 'clients'> | undefined;

const getZoneLabel = (group: ZoneLike) => {
    const name = group?.name;
    if (name) return name;
    const memberNames = (group?.clients || [])
        .map((c) => c.config?.name || c.host?.name)
        .filter(Boolean);
    if (memberNames.length) return memberNames.join(' + ');
    return t('routing.zoneFallback', { id: (group?.id || '').slice(0, 4) });
};

const onlineCount = (group: ZoneLike) => (group?.clients || []).filter((c) => c.connected).length;

const getZoneSearchText = (group: SnapcastGroup) =>
    [getZoneLabel(group), ...group.clients.map((c) => c.config?.name || c.host?.name)].join(' ');

const filterQuery = ref('');
// Below this many sources + zones a filter is just clutter.
const FILTER_MIN_ITEMS = 16;
const showFilter = computed(() =>
    (snapcastStore.status?.streams.length ?? 0) + (snapcastStore.status?.groups.length ?? 0) >= FILTER_MIN_ITEMS
);

const routingLayout = computed(() =>
    filterRoutingLayout(
        buildRoutingLayout(snapcastStore.status?.streams ?? [], snapcastStore.status?.groups ?? []),
        showFilter.value ? filterQuery.value : '',
        getStreamLabel,
        getZoneSearchText,
    )
);
const hasNoMatches = computed(() => !routingLayout.value.lanes.length && !routingLayout.value.unusedStreams.length);

onMounted(() => {
    // Fast first paint before the SSE connection's first `snapcast` event
    // arrives -- see Dashboard.vue's identical comment for why this
    // explicit fetch stays even though polling doesn't.
    snapcastStore.fetchStatus();
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('touchmove', handleTouchMove, { passive: false });
    document.addEventListener('mouseup', handleMouseUp);
    document.addEventListener('touchend', handleMouseUp);
});

onUnmounted(() => {
    cableObserver?.disconnect();
    if (flashTimer) clearTimeout(flashTimer);
    isDragging.value = false;
    document.removeEventListener('mousemove', handleMouseMove);
    document.removeEventListener('touchmove', handleTouchMove);
    document.removeEventListener('mouseup', handleMouseUp);
    document.removeEventListener('touchend', handleMouseUp);
});

// Set source ref
const setSourceRef = (id: string) => (el: any) => {
    if (el) sourceRefs.value[id] = el as HTMLElement;
};

// Set zone ref (connector node)
const setZoneRef = (id: string) => (el: any) => {
    if (el) zoneRefs.value[id] = el as HTMLElement;
};

// Set zone card ref (entire card for hit testing)
const setZoneCardRef = (id: string) => (el: any) => {
    if (el) zoneCardRefs.value[id] = el as HTMLElement;
};

const getConnectorCoordinates = (el: HTMLElement) => {
    if (!el || !containerRef.value) return { x: 0, y: 0 };
    const containerRect = containerRef.value.getBoundingClientRect();
    const rect = el.getBoundingClientRect();

    // Connect from center of the circular node
    const x = rect.left - containerRect.left + rect.width / 2;
    const y = rect.top - containerRect.top + rect.height / 2;
    return { x, y };
};

// Cables of one source share a trunk and branch off at each zone, so a
// source with many zones draws one tidy tree rather than a fan of curves.
const TRUNK_MAX_OFFSET = 40;
const CABLE_CORNER_RADIUS = 10;
// Closer than this horizontally, the zone sits under its source (stacked
// layout), so there's no room for a trunk: the cable just runs down.
const STACKED_MAX_DELTA_X = 24;

const generateCablePath = (startX: number, startY: number, endX: number, endY: number) => {
    const deltaX = endX - startX;
    const deltaY = endY - startY;
    if (Math.abs(deltaX) < STACKED_MAX_DELTA_X) return `M ${startX} ${startY} L ${startX} ${endY} L ${endX} ${endY}`;
    if (Math.abs(deltaY) < 1) return `M ${startX} ${startY} L ${endX} ${endY}`;

    const dirX = Math.sign(deltaX);
    const dirY = Math.sign(deltaY);
    const trunkX = startX + dirX * Math.min(TRUNK_MAX_OFFSET, Math.abs(deltaX) / 2);
    const radius = Math.min(CABLE_CORNER_RADIUS, Math.abs(deltaY) / 2);
    return [
        `M ${startX} ${startY}`,
        `L ${trunkX - dirX * radius} ${startY}`,
        `Q ${trunkX} ${startY}, ${trunkX} ${startY + dirY * radius}`,
        `L ${trunkX} ${endY - dirY * radius}`,
        `Q ${trunkX} ${endY}, ${trunkX + dirX * radius} ${endY}`,
        `L ${endX} ${endY}`,
    ].join(' ');
};

interface Cable {
    groupId: string;
    path: string;
    color: string;
    isPlaying: boolean;
}

const cables = ref<Cable[]>([]);

// Reads node positions from the DOM, so it has to run after a render: see
// the post-flush watcher and the ResizeObserver below.
const measureCables = () => {
    const next: Cable[] = [];
    for (const { stream, zones } of routingLayout.value.lanes) {
        const sourceEl = stream && sourceRefs.value[stream.id];
        if (!stream || !sourceEl?.isConnected) continue;
        const start = getConnectorCoordinates(sourceEl);
        for (const zone of zones) {
            const zoneEl = zoneRefs.value[zone.id];
            if (!zoneEl?.isConnected) continue;
            const end = getConnectorCoordinates(zoneEl);
            next.push({
                groupId: zone.id,
                path: generateCablePath(start.x, start.y, end.x, end.y),
                color: getStreamColor(stream.id),
                isPlaying: stream.status === 'playing',
            });
        }
    }
    cables.value = next;
};

// Task 29: covers the initial fetchStatus(), a manual Refresh and a pushed
// SSE `snapcast` event alike, since each one changes the layout.
watch(routingLayout, measureCables, { flush: 'post' });

// Anything else that moves a node resizes the matrix: a zone opening its
// speaker list, the window changing width, a late web font.
let cableObserver: ResizeObserver | undefined;
watch(containerRef, (container) => {
    cableObserver?.disconnect();
    if (container && typeof ResizeObserver !== 'undefined') {
        cableObserver = new ResizeObserver(measureCables);
        cableObserver.observe(container);
    }
}, { flush: 'post' });

const draggingPath = computed(() => {
    if (!isDragging.value || !draggedStreamId.value || !containerRef.value) return null;
    const sourceEl = sourceRefs.value[draggedStreamId.value];
    if (!sourceEl) return null;

    const start = getConnectorCoordinates(sourceEl);
    let endX = mousePos.value.x;
    let endY = mousePos.value.y;

    // Snap to hovered zone
    if (hoverZoneId.value && zoneRefs.value[hoverZoneId.value]) {
        const zoneEl = zoneRefs.value[hoverZoneId.value];
        if (zoneEl) {
            const snap = getConnectorCoordinates(zoneEl);
            endX = snap.x;
            endY = snap.y;
        }
    }

    return {
        path: generateCablePath(start.x, start.y, endX, endY),
        color: getStreamColor(draggedStreamId.value)
    };
});

let lastPointer = { x: 0, y: 0 };

const startDrag = (streamId: string, event: MouseEvent | TouchEvent) => {
    isDragging.value = true;
    draggedStreamId.value = streamId;
    if ('touches' in event && event.touches && event.touches.length > 0) {
        const touch = event.touches[0];
        if (touch) updateMousePos(touch.clientX, touch.clientY);
    } else if ('clientX' in event) {
        updateMousePos((event as MouseEvent).clientX, (event as MouseEvent).clientY);
    }
    requestAnimationFrame(autoScrollWhileDragging);
};

// A target zone can be a long way down the page, so holding the cable near
// the top or bottom edge scrolls, faster the closer it gets to the edge.
const AUTO_SCROLL_EDGE = 96;
const AUTO_SCROLL_MAX_SPEED = 20;

const autoScrollWhileDragging = () => {
    if (!isDragging.value) return;
    const { x, y } = lastPointer;
    const distanceToBottom = window.innerHeight - y;
    let speed = 0;
    if (y < AUTO_SCROLL_EDGE) speed = -(1 - y / AUTO_SCROLL_EDGE);
    else if (distanceToBottom < AUTO_SCROLL_EDGE) speed = 1 - distanceToBottom / AUTO_SCROLL_EDGE;
    if (speed !== 0) {
        window.scrollBy(0, speed * AUTO_SCROLL_MAX_SPEED);
        updateMousePos(x, y);
    }
    requestAnimationFrame(autoScrollWhileDragging);
};

const updateMousePos = (clientX: number, clientY: number) => {
    lastPointer = { x: clientX, y: clientY };
    const container = containerRef.value;
    if (!container) return;
    const rect = container.getBoundingClientRect();

    mousePos.value = {
        x: clientX - rect.left,
        y: clientY - rect.top
    };

    // Find hover zone via bounding rects (better for drag & drop than mouseenter)
    let foundHover = false;
    // Use zoneCardRefs for hit testing
    for (const [zoneId, el] of Object.entries(zoneCardRefs.value)) {
        if (!el?.isConnected) continue;
        const zoneRect = el.getBoundingClientRect();
        // Reach a bit left of the card for its node; rows are too close
        // together to add anything vertically.
        if (clientX >= zoneRect.left - 40 && clientX <= zoneRect.right &&
            clientY >= zoneRect.top && clientY <= zoneRect.bottom) {
            hoverZoneId.value = zoneId;
            foundHover = true;
            break;
        }
    }
    if (!foundHover) hoverZoneId.value = null;
};

const handleMouseMove = (event: MouseEvent) => {
    if (!isDragging.value) return;
    updateMousePos(event.clientX, event.clientY);
};

const handleTouchMove = (event: TouchEvent) => {
    if (!isDragging.value) return;
    event.preventDefault(); // Stop scrolling while dragging
    if (event.touches && event.touches.length > 0) {
        const touch = event.touches[0];
        if (touch) updateMousePos(touch.clientX, touch.clientY);
    }
};

// A routed zone jumps to its new source's lane, so mark where it landed.
const flashZoneId = ref<string | null>(null);
let flashTimer: ReturnType<typeof setTimeout> | undefined;

const revealZone = async (groupId: string) => {
    flashZoneId.value = groupId;
    if (flashTimer) clearTimeout(flashTimer);
    flashTimer = setTimeout(() => { flashZoneId.value = null; }, 1600);

    await nextTick();
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    zoneCardRefs.value[groupId]?.scrollIntoView?.({ block: 'nearest', behavior: reduceMotion ? 'auto' : 'smooth' });
};

// Both ways of routing audio land here, so they can't drift apart.
const routeZone = (groupId: string, streamId: string): boolean => {
    const currentGroup = snapcastStore.status?.groups.find(g => g.id === groupId);
    if (!currentGroup || currentGroup.stream_id === streamId) return false;

    // Optimistic UI update
    currentGroup.stream_id = streamId;

    // Send request to server (without blocking the UI cleanup)
    snapcastStore.setGroupStream(groupId, streamId).catch(err => {
        console.error("Failed to set stream, resetting optimistic update", err);
    });
    return true;
};

const handleMouseUp = async () => {
    if (!isDragging.value) return;

    const groupId = hoverZoneId.value;
    const streamId = draggedStreamId.value;
    isDragging.value = false;
    draggedStreamId.value = null;
    hoverZoneId.value = null;

    if (groupId && streamId && routeZone(groupId, streamId)) await revealZone(groupId);
};

// Task 34: keyboard/screen-reader-usable alternative to the mouse/touch
// "cable" drag gesture above. Every zone gets a <Select> listing all
// available streams; picking one routes audio through the same routeZone()
// a dropped cable uses, so behavior never forks between the two interaction
// modes.
const streamSelectOptions = computed(() =>
    (snapcastStore.status?.streams || []).map((stream) => ({
        value: stream.id,
        label: getStreamLabel(stream),
    }))
);

const onZoneSourceChange = async (groupId: string, newStreamId: string | number) => {
    if (!routeZone(groupId, String(newStreamId))) return;
    await revealZone(groupId);
    // Moving lanes remounts the zone, taking keyboard focus with it.
    zoneCardRefs.value[groupId]?.querySelector<HTMLElement>('[aria-haspopup="listbox"]')?.focus({ preventScroll: true });
};

const startRename = (clientId: string, currentName: string) => {
    renamingClientId.value = clientId;
    newClientName.value = currentName;
};

const submitRename = async (clientId: string) => {
    if (newClientName.value.trim()) {
        await snapcastStore.setClientName(clientId, newClientName.value.trim());
        renamingClientId.value = null;
    }
};

const startGroupRename = (groupId: string, currentName: string, event: Event) => {
    event.stopPropagation();
    renamingGroupId.value = groupId;
    newGroupName.value = currentName || '';
};

const submitGroupRename = async (groupId: string) => {
    if (newGroupName.value.trim()) {
        await snapcastStore.setGroupName(groupId, newGroupName.value.trim());
    }
    renamingGroupId.value = null;
};

const updateVolume = (client: any, event: Event) => {
    const target = event.target as HTMLInputElement;
    if (target) {
        snapcastStore.setClientVolume(client.id, { 
            percent: Number(target.value), 
            muted: client.config.volume.muted 
        });
    }
};
</script>

<template>
  <Layout>
    <div class="pb-12 w-full">
      <PageHeader :title="t('routing.title')" :description="t('routing.subtitle')">
        <template #badge>
          <Badge :variant="sseStatusBadge(sse.status.value).variant" size="sm">{{ sseStatusBadge(sse.status.value).label }}</Badge>
        </template>
        <template #actions>
          <Button variant="subtle" :loading="snapcastStore.loading" @click="snapcastStore.fetchStatus()">
            <span v-if="!snapcastStore.loading" class="material-symbols-outlined text-[1.1rem]" aria-hidden="true">refresh</span>
            {{ t('routing.resync') }}
          </Button>
        </template>
      </PageHeader>

      <!-- Loading / Empty States -->
      <!-- Task 35: shaped like the lanes it's about to replace rather than a
           generic spinner, so the page doesn't visually "jump" into the real
           layout once data arrives. -->
      <div v-if="snapcastStore.loading && !snapcastStore.status" class="flex flex-col gap-3 w-full">
        <Skeleton v-for="n in 4" :key="n" variant="rect" height="84px" />
      </div>
      <div v-else-if="!snapcastStore.loading && (!snapcastStore.status || snapcastStore.status.groups.length === 0)" class="rounded-2xl border border-dashed border-line bg-brand-surface/50">
        <EmptyState icon="speaker_group" :title="t('routing.noClusters')" :description="t('routing.noClustersHint')" />
      </div>

      <template v-else>
        <label v-if="showFilter" class="relative block max-w-sm mb-4">
          <span class="sr-only">{{ t('routing.filterLabel') }}</span>
          <span class="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-[1.1rem] text-text-muted" aria-hidden="true">search</span>
          <input
            v-model="filterQuery"
            type="search"
            :placeholder="t('routing.filterLabel')"
            class="w-full bg-brand-surface border border-line outline-none rounded-xl pl-10 pr-3 py-2.5 text-sm text-text-main placeholder:text-text-muted focus:border-brand-primary/50 focus:ring-2 focus:ring-brand-primary/30"
          />
        </label>

        <!-- Interactive Matrix -->
        <!-- One lane per source, holding that source's zones: see
             utils/routingLayout.ts for why. From `xl` a lane reads left to
             right; below that its zones stack under the source, off a rail. -->
        <div class="relative w-full" ref="containerRef">
          <!-- SVG Overlay for Cables -->
          <!-- Task 34: decorative now that each zone's <Select> below provides
               the real accessible routing interaction (requirement 1) -- a
               screen reader has nothing useful to announce about these <path>
               cable curves, so hide the whole overlay from the a11y tree. -->
          <svg class="absolute inset-0 w-full h-full pointer-events-none z-10 overflow-visible" role="presentation" aria-hidden="true">
            <!-- Active Cables -->
            <path v-for="cable in cables" :key="cable.groupId"
                  :d="cable.path"
                  fill="none"
                  :stroke="cable.color"
                  :stroke-width="hoverZoneId === cable.groupId ? 4 : 2.5"
                  stroke-linecap="round"
                  class="pointer-events-none"
                  :class="cable.isPlaying ? 'cable-animated' : 'opacity-50'" />

            <!-- Dragging Ghost Cable -->
            <path v-if="draggingPath"
                  :d="draggingPath.path"
                  fill="none"
                  :stroke="draggingPath.color"
                  stroke-width="4"
                  stroke-linecap="round"
                  class="cable-animated pointer-events-none" />
          </svg>

          <div class="hidden xl:grid grid-cols-[15rem_5rem_minmax(0,1fr)] px-3 mb-2">
            <h2 class="text-xs font-semibold text-text-muted flex items-center gap-2">
              <span class="material-symbols-outlined text-[1rem]" aria-hidden="true">input</span> {{ t('routing.virtualSources') }}
            </h2>
            <h2 class="col-start-3 text-xs font-semibold text-text-muted flex items-center gap-2">
              <span class="material-symbols-outlined text-[1rem]" aria-hidden="true">speaker_group</span> {{ t('routing.outputZones') }}
            </h2>
          </div>

          <div class="flex flex-col gap-3">
            <div v-for="lane in routingLayout.lanes" :key="lane.stream?.id ?? 'no-source'"
                 class="rounded-2xl border bg-brand-surface/60 p-3 grid gap-3 xl:gap-0 xl:grid-cols-[15rem_5rem_minmax(0,1fr)]"
                 :class="lane.stream ? 'border-line' : 'border-warning/40'">

              <MatrixSource
                v-if="lane.stream"
                :label="getStreamLabel(lane.stream)"
                :detail="getStreamDetail(lane.stream, lane.zones.length)"
                :color="getStreamColor(lane.stream.id)"
                :playing="lane.stream.status === 'playing'"
                :dragging="draggedStreamId === lane.stream.id"
                :drag-hint="t('routing.dragToConnect')"
                :handle-ref="setSourceRef(lane.stream.id)"
                @start-drag="startDrag(lane.stream!.id, $event)"
              />
              <div v-else class="p-3 xl:self-start min-w-0">
                <div class="text-sm font-semibold text-warning flex items-center gap-2">
                  <span class="material-symbols-outlined text-lg" aria-hidden="true">warning</span>
                  {{ t('routing.noSourceZones') }}
                </div>
                <p class="text-xs text-text-muted mt-1">{{ t('routing.noSourceZonesHint') }}</p>
              </div>

              <div class="xl:col-start-3 min-w-0 flex flex-col gap-2" :class="lane.stream ? 'pl-10 xl:pl-0' : ''">
                <div v-for="group in lane.zones" :key="group.id"
                     :ref="setZoneCardRef(group.id)"
                     class="@container relative scroll-mt-20 rounded-xl border bg-brand-surface transition-colors duration-200 group/zone"
                     :class="[
                       hoverZoneId === group.id ? 'border-brand-primary bg-brand-primary/10' : 'border-line',
                       flashZoneId === group.id ? 'zone-flash' : '',
                     ]"
                     :style="{ '--zone-color': lane.stream ? getStreamColor(lane.stream.id) : 'transparent' }">

                  <!-- Input Connector Node (Drop Target) -->
                  <!-- Task 34: decorative, like the source handle: the
                       <Select> below is the accessible way to route. -->
                  <div :ref="setZoneRef(group.id)"
                       class="w-5 h-5 rounded-full bg-brand-surface border-[3px] flex items-center justify-center transition-transform duration-200 absolute -left-2.5 top-[1.375rem] z-20"
                       :class="hoverZoneId === group.id ? 'scale-125' : ''"
                       :style="{ borderColor: lane.stream ? getStreamColor(lane.stream.id) : 'var(--color-text-muted)' }"
                       aria-hidden="true">
                    <div class="w-2 h-2 rounded-full" :style="{ backgroundColor: lane.stream ? getStreamColor(lane.stream.id) : 'var(--color-text-muted)' }"></div>
                  </div>

                  <!-- Stacks the source picker under the name in a narrow card -->
                  <div class="grid grid-cols-[minmax(0,1fr)_auto] @xl:grid-cols-[minmax(0,1fr)_13rem_auto] items-center gap-x-2 gap-y-2 p-2 pl-5">
                    <!-- Identity -->
                    <div class="min-w-0 cursor-pointer" @click="toggleGroup(group.id)">
                      <div v-if="renamingGroupId === group.id" class="flex items-center gap-2" @click.stop>
                        <input
                          type="text"
                          v-model="newGroupName"
                          :aria-label="t('routing.renameZone', { name: getZoneLabel(group) })"
                          @keyup.enter="submitGroupRename(group.id)"
                          @keyup.esc="renamingGroupId = null"
                          @blur="submitGroupRename(group.id)"
                          class="bg-brand-surface border border-brand-primary/50 outline-none rounded-lg px-2 py-1 text-sm text-text-main focus:ring-2 focus:ring-brand-primary/30 w-full max-w-48"
                          v-focus
                        />
                      </div>
                      <h3 v-else class="text-sm font-bold text-text-main flex items-center gap-1 min-w-0">
                        <span class="truncate" :class="group.name ? '' : 'italic font-semibold'" :title="getZoneLabel(group)">{{ getZoneLabel(group) }}</span>
                        <button
                          type="button"
                          class="w-6 h-6 flex items-center justify-center rounded-md text-text-muted hover:text-text-main hover:bg-inset opacity-60 group-hover/zone:opacity-100 focus:opacity-100 shrink-0"
                          :aria-label="t('routing.renameZone', { name: getZoneLabel(group) })"
                          @click.stop="startGroupRename(group.id, group.name || '', $event)"
                        >
                          <span class="material-symbols-outlined text-[15px]" aria-hidden="true">edit</span>
                        </button>
                      </h3>
                      <p class="text-xs text-text-muted flex items-center gap-1.5">
                        <span class="w-1.5 h-1.5 rounded-full shrink-0" :class="onlineCount(group) === group.clients.length ? 'bg-success' : onlineCount(group) === 0 ? 'bg-danger' : 'bg-warning'" aria-hidden="true"></span>
                        <span class="truncate">{{ t('routing.speakersOnline', { online: onlineCount(group), total: group.clients.length }) }}</span>
                      </p>
                    </div>

                    <!-- Accessible Source Selector (Task 34) -->
                    <!-- Keyboard/screen-reader-usable alternative to the
                         mouse/touch cable-drag gesture above: lists every
                         available stream and shows the zone's current
                         assignment as the selected value. Native
                         <select>-equivalent keyboard behavior (Up/Down/
                         Home/End/typeahead) comes for free from Select.vue
                         (headlessui Listbox). Wrapping in <label> gives the
                         inner Listbox trigger <button> an accessible name
                         without needing Select.vue to expose an aria-label
                         prop. Always visible (not gated behind the
                         expand/collapse toggle) so it's reachable without
                         extra steps. -->
                    <label class="flex items-center gap-3 min-w-0 col-span-2 row-start-2 @xl:col-span-1 @xl:col-start-2 @xl:row-start-1">
                      <span class="text-xs font-medium text-text-muted shrink-0 @xl:sr-only">{{ t('routing.source') }}</span>
                      <span class="flex-1 min-w-0">
                        <Select
                          :model-value="group.stream_id"
                          :options="streamSelectOptions"
                          :placeholder="t('routing.noSourceAssigned')"
                          @update:model-value="(value) => onZoneSourceChange(group.id, value)"
                        />
                      </span>
                    </label>

                    <!-- Group Controls -->
                    <div class="flex items-center shrink-0">
                      <button @click.stop="snapcastStore.setGroupMute(group.id, !group.muted)"
                              class="w-10 h-10 rounded-lg transition-colors border flex items-center justify-center shrink-0"
                              :class="group.muted ? 'bg-danger/10 text-danger border-danger/20 hover:bg-danger/15' : 'text-text-muted border-transparent hover:text-text-main hover:bg-inset'"
                              :aria-pressed="group.muted"
                              :aria-label="group.muted ? t('routing.unmuteZone', { name: getZoneLabel(group) }) : t('routing.muteZone', { name: getZoneLabel(group) })">
                        <span class="material-symbols-outlined text-[1.2rem]" aria-hidden="true">{{ group.muted ? 'volume_off' : 'volume_up' }}</span>
                      </button>
                      <button
                           type="button"
                           class="w-10 h-10 rounded-lg flex items-center justify-center text-text-muted hover:text-text-main hover:bg-inset"
                           :aria-expanded="expandedGroups.has(group.id)"
                           :aria-label="expandedGroups.has(group.id) ? t('routing.hideSpeakers', { name: getZoneLabel(group) }) : t('routing.showSpeakers', { name: getZoneLabel(group) })"
                           @click.stop="toggleGroup(group.id)">
                        <span class="material-symbols-outlined transition-transform duration-300" :class="{'rotate-180': expandedGroups.has(group.id)}" aria-hidden="true">expand_more</span>
                      </button>
                    </div>
                  </div>

                  <!-- Clients List (Expanded) -->
                  <transition name="slide">
                    <div v-if="expandedGroups.has(group.id)" class="border-t border-line bg-inset rounded-b-xl p-3 space-y-2 w-full overflow-hidden">
                      <div v-for="client in group.clients" :key="client.id"
                           class="p-3 rounded-xl bg-brand-surface border border-line flex flex-col @lg:flex-row items-start @lg:items-center justify-between gap-3 w-full group/client" :class="client.connected ? '' : 'opacity-70'">

                        <!-- Client Detail -->
                        <div class="flex items-center gap-4 min-w-0 w-full @lg:w-1/2">
                          <div class="w-10 h-10 rounded-xl bg-inset border border-line flex items-center justify-center shrink-0 transition-colors"
                               :class="client.connected ? 'text-text-main' : 'text-text-muted'">
                            <span class="material-symbols-outlined text-[20px]">{{ client.config.name ? 'speaker' : 'smartphone' }}</span>
                          </div>
                          <div class="min-w-0 flex flex-col w-full">
                            <div v-if="renamingClientId === client.id" class="flex items-center gap-2">
                              <input type="text" v-model="newClientName" @keyup.enter="submitRename(client.id)" @blur="submitRename(client.id)"
                                     class="bg-brand-surface border border-brand-primary/50 outline-none rounded-lg px-2 py-1 text-sm text-text-main focus:ring-2 focus:ring-brand-primary/30 w-full transition-all"
                                     v-focus>
                            </div>
                            <div v-else @click="startRename(client.id, client.config.name || client.host.name)"
                                 class="flex items-center gap-2 cursor-pointer group/name w-full">
                              <span class="text-sm font-semibold text-text-main truncate group-hover/name:text-brand-primary transition-colors">
                                {{ client.config.name || client.host.name || t('routing.unnamedClient') }}
                              </span>
                              <span class="material-symbols-outlined text-[14px] text-text-muted opacity-0 group-hover/name:opacity-100 transition-all">edit</span>
                            </div>
                            <div class="flex items-center gap-1.5 mt-0.5">
                              <div class="w-1.5 h-1.5 rounded-full" :class="client.connected ? 'bg-success' : 'bg-danger'" aria-hidden="true"></div>
                              <span class="text-[11px] text-text-muted truncate font-mono">{{ client.host.ip }}</span>
                              <span v-if="!client.connected" class="text-[11px] font-semibold text-danger">· {{ t('routing.offline') }}</span>
                            </div>
                          </div>
                        </div>

                        <!-- Volume Controls -->
                        <div class="flex items-center gap-3 w-full @lg:w-auto shrink-0 justify-end">
                          <button @click="snapcastStore.setClientVolume(client.id, { percent: client.config.volume.percent, muted: !client.config.volume.muted })"
                                  class="p-2 min-w-[40px] min-h-[40px] flex items-center justify-center rounded-lg transition-colors hover:bg-inset border border-transparent"
                                  :class="client.config.volume.muted ? 'text-danger bg-danger/10 border-danger/20' : 'text-text-muted hover:text-text-main'"
                                  :aria-label="client.config.volume.muted ? t('routing.unmuteClient', { name: client.config.name || client.host.name || t('routing.client') }) : t('routing.muteClient', { name: client.config.name || client.host.name || t('routing.client') })">
                            <span class="material-symbols-outlined text-[18px]">{{ client.config.volume.muted ? 'volume_off' : 'volume_up' }}</span>
                          </button>
                          <div class="flex items-center gap-3 w-full @lg:w-auto">
                            <input type="range" class="w-full @lg:w-32 h-2 bg-line rounded-full appearance-none cursor-pointer accent-brand-primary" :aria-label="t('routing.volumeFor', { name: client.config.name || client.host.name || t('routing.client') })"
                                   min="0" max="100" v-model="client.config.volume.percent" @change="updateVolume(client, $event)">
                            <span class="text-xs font-medium tabular-nums w-14 text-right" :class="client.config.volume.muted ? 'text-danger' : 'text-text-muted'">
                              {{ client.config.volume.muted ? t('routing.muted') : client.config.volume.percent + '%' }}
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>
                  </transition>
                </div>
              </div>
            </div>
          </div>

          <section v-if="routingLayout.unusedStreams.length" class="mt-6">
            <h2 class="text-xs font-semibold text-text-muted mb-2 flex items-center gap-2 px-3">
              <span class="material-symbols-outlined text-[1rem]" aria-hidden="true">input</span> {{ t('routing.unusedSources') }}
            </h2>
            <div class="grid sm:grid-cols-2 xl:grid-cols-3 gap-2">
              <MatrixSource
                v-for="stream in routingLayout.unusedStreams"
                :key="stream.id"
                compact
                :label="getStreamLabel(stream)"
                :detail="getStreamDetail(stream, 0)"
                :color="getStreamColor(stream.id)"
                :playing="stream.status === 'playing'"
                :dragging="draggedStreamId === stream.id"
                :drag-hint="t('routing.dragToConnect')"
                :handle-ref="setSourceRef(stream.id)"
                @start-drag="startDrag(stream.id, $event)"
              />
            </div>
          </section>

          <p v-if="hasNoMatches" class="py-10 text-center text-sm text-text-muted">{{ t('routing.noMatches', { query: filterQuery.trim() }) }}</p>
        </div>
      </template>
    </div>
  </Layout>
</template>

<style scoped>
.cable-animated {
    stroke-dasharray: 8 8;
    animation: flow 0.8s linear infinite;
}
@keyframes flow {
    from { stroke-dashoffset: 16; }
    to { stroke-dashoffset: 0; }
}

.zone-flash {
    animation: zone-flash 1.6s ease-out;
}
@keyframes zone-flash {
    from { box-shadow: 0 0 0 3px var(--zone-color); }
    to { box-shadow: 0 0 0 3px transparent; }
}

.slide-enter-active, .slide-leave-active {
    transition: all 0.3s ease-in-out;
    max-height: 1000px;
    opacity: 1;
}
.slide-enter-from, .slide-leave-to {
    max-height: 0;
    opacity: 0;
    padding-top: 0;
    padding-bottom: 0;
    margin-top: 0;
    margin-bottom: 0;
    overflow: hidden;
}

input[type=range]::-webkit-slider-thumb {
  height: 14px;
  width: 14px;
  border-radius: 50%;
  background: var(--brand-primary, #3b82f6);
  box-shadow: 0 0 10px rgba(59, 130, 246, 0.4);
}
</style>
