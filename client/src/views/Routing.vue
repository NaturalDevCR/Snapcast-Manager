<script setup lang="ts">
import Layout from '../components/Layout.vue';
import Badge from '../components/ui/Badge.vue';
import Select from '../components/ui/Select.vue';
import Skeleton from '../components/ui/Skeleton.vue';
import PageHeader from '../components/ui/PageHeader.vue';
import Button from '../components/ui/Button.vue';
import EmptyState from '../components/ui/EmptyState.vue';
import { useSnapcastStore, type SnapcastGroup } from '../stores/snapcast';
import { useEventSource } from '../composables/useEventSource';
import { sseStatusBadge } from '../utils/sseStatus';
import { onMounted, onUnmounted, ref, computed, watch } from 'vue';
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
    
    // Redraw connections because height changed
    setTimeout(triggerRedraw, 50);
    setTimeout(triggerRedraw, 150);
    setTimeout(triggerRedraw, 300); // multiple times to catch animation frames
};

// Force reactive updates for connections on resize/scroll
const connectionsVersion = ref(0);
const triggerRedraw = () => { connectionsVersion.value++; };

// Task 29: redraw the cable connections whenever fresh snapcast data
// arrives, whether that's the initial fetchStatus() call, a manual
// RE-SYNC click, or a pushed SSE `snapcast` event -- all three replace
// `snapcastStore.status` with a new object (see stores/snapcast.ts's
// fetchStatus() and useEventSource.ts's applySnapcastUpdate()), so a plain
// (non-deep) watch on the store's `status` reference is the natural,
// transport-agnostic replacement for the old "poll tick -> triggerRedraw()"
// pairing -- this view stays decoupled from how the data got here.
watch(() => snapcastStore.status, () => {
  triggerRedraw();
});

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

const getStreamColor = (streamId: string) => {
    if (!snapcastStore.status) return streamColors[0];
    const index = snapcastStore.status.streams.findIndex(s => s.id === streamId);
    return streamColors[Math.max(0, index) % streamColors.length];
};

onMounted(() => {
    // Fast first paint before the SSE connection's first `snapcast` event
    // arrives -- see Dashboard.vue's identical comment for why this
    // explicit fetch stays even though polling doesn't.
    snapcastStore.fetchStatus();
    window.addEventListener('resize', triggerRedraw);
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('touchmove', handleTouchMove, { passive: false });
    document.addEventListener('mouseup', handleMouseUp);
    document.addEventListener('touchend', handleMouseUp);

    // Initial draw delay to ensure DOM is ready
    setTimeout(triggerRedraw, 200);
});

onUnmounted(() => {
    window.removeEventListener('resize', triggerRedraw);
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

const generateBezierPath = (startX: number, startY: number, endX: number, endY: number) => {
    const deltaX = endX - startX;
    const deltaY = endY - startY;
    
    // Standard horizontal flow
    let cp1x = startX + Math.max(80, Math.abs(deltaX) * 0.5);
    let cp1y = startY;
    let cp2x = endX - Math.max(80, Math.abs(deltaX) * 0.5);
    let cp2y = endY;

    // Mobile fallback (if source is above zone and horizontally compressed)
    if (Math.abs(deltaY) > Math.abs(deltaX) * 2 && deltaX < 80) {
        cp1x = startX;
        cp1y = startY + Math.abs(deltaY) * 0.5;
        cp2x = endX;
        cp2y = endY - Math.abs(deltaY) * 0.5;
    }
    
    return `M ${startX} ${startY} C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${endX} ${endY}`;
};

const activeConnections = computed(() => {
    // Dependency on connectionsVersion to force redraw
    void connectionsVersion.value;

    if (!snapcastStore.status || !containerRef.value) return [];
    
    const connections: any[] = [];
    snapcastStore.status.groups.forEach(group => {
        const streamId = group.stream_id;
        const sourceEl = sourceRefs.value[streamId];
        const zoneEl = zoneRefs.value[group.id];
        
        if (sourceEl && zoneEl) {
            const start = getConnectorCoordinates(sourceEl);
            const end = getConnectorCoordinates(zoneEl);
            connections.push({
                groupId: group.id,
                streamId,
                path: generateBezierPath(start.x, start.y, end.x, end.y),
                color: getStreamColor(streamId),
                isPlaying: snapcastStore.status?.streams.find(s => s.id === streamId)?.status === 'playing'
            });
        }
    });
    return connections;
});

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
        path: generateBezierPath(start.x, start.y, endX, endY),
        color: getStreamColor(draggedStreamId.value)
    };
});

const startDrag = (streamId: string, event: MouseEvent | TouchEvent) => {
    isDragging.value = true;
    draggedStreamId.value = streamId;
    if ('touches' in event && event.touches && event.touches.length > 0) {
        const touch = event.touches[0];
        if (touch) updateMousePos(touch.clientX, touch.clientY);
    } else if ('clientX' in event) {
        updateMousePos((event as MouseEvent).clientX, (event as MouseEvent).clientY);
    }
};

const updateMousePos = (clientX: number, clientY: number) => {
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
        if (!el) continue;
        const zoneRect = el.getBoundingClientRect();
        // Generous bounding box for the entire card
        if (clientX >= zoneRect.left - 60 && clientX <= zoneRect.right + 20 &&
            clientY >= zoneRect.top - 20 && clientY <= zoneRect.bottom + 20) {
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

const handleMouseUp = async () => {
    if (!isDragging.value) return;
    
    if (draggedStreamId.value && hoverZoneId.value) {
        const currentGroup = snapcastStore.status?.groups.find(g => g.id === hoverZoneId.value);
        if (currentGroup && currentGroup.stream_id !== draggedStreamId.value) {
            const newStreamId = draggedStreamId.value;
            const groupId = hoverZoneId.value;
            // Optimistic UI update
            currentGroup.stream_id = newStreamId;
            triggerRedraw();
            
            // Send request to server (without blocking the UI cleanup)
            snapcastStore.setGroupStream(groupId, newStreamId).catch(err => {
                console.error("Failed to set stream, resetting optimistic update", err);
            });
        }
    }
    
    isDragging.value = false;
    draggedStreamId.value = null;
    hoverZoneId.value = null;
    setTimeout(triggerRedraw, 50); // Need to wait for Vue ref updates
};

const getStreamLabel = (stream: any) => {
    if (stream.uri?.query?.name) return stream.uri.query.name;
    return stream.id || t('routing.unknownStream');
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

// Task 34: keyboard/screen-reader-usable alternative to the mouse/touch
// "cable" drag gesture above. Every zone gets a <Select> listing all
// available streams; picking one routes audio exactly the way dropping a
// dragged cable on the zone does -- both paths call the same
// snapcastStore.setGroupStream() with the same optimistic-update pattern
// (see handleMouseUp above), so behavior never forks between the two
// interaction modes.
const streamSelectOptions = computed(() =>
    (snapcastStore.status?.streams || []).map((stream) => ({
        value: stream.id,
        label: getStreamLabel(stream),
    }))
);

const onZoneSourceChange = (groupId: string, newStreamId: string | number) => {
    const streamId = String(newStreamId);
    const currentGroup = snapcastStore.status?.groups.find(g => g.id === groupId);
    if (!currentGroup || currentGroup.stream_id === streamId) return;

    // Optimistic UI update, mirroring handleMouseUp's drag-and-drop path.
    currentGroup.stream_id = streamId;
    triggerRedraw();

    snapcastStore.setGroupStream(groupId, streamId).catch(err => {
        console.error("Failed to set stream, resetting optimistic update", err);
    });
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
    <div class="pb-12 w-full overflow-x-hidden">
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
      <!-- Task 35: shaped like the two-column Sources/Zones matrix it's
           about to replace (same flex-col lg:flex-row split as the real
           matrix below, same 76px-tall source-card / 72px-tall
           zone-card-header proportions) rather than a generic spinner, so
           the page doesn't visually "jump" from an unrelated loading
           shape into the real layout once data arrives. -->
      <div v-if="snapcastStore.loading && !snapcastStore.status" class="flex flex-col lg:flex-row gap-8 lg:gap-16 xl:gap-24 w-full px-2 sm:px-4">
        <div class="w-full lg:w-1/2 flex flex-col gap-4">
          <Skeleton variant="text" width="140px" height="12px" />
          <Skeleton v-for="n in 3" :key="n" variant="rect" height="76px" />
        </div>
        <div class="w-full lg:w-1/2 flex flex-col gap-4 mt-8 lg:mt-0">
          <Skeleton variant="text" width="140px" height="12px" />
          <Skeleton v-for="n in 2" :key="n" variant="rect" height="96px" />
        </div>
      </div>
      <div v-else-if="!snapcastStore.loading && (!snapcastStore.status || snapcastStore.status.groups.length === 0)" class="rounded-2xl border border-dashed border-line bg-brand-surface/50">
        <EmptyState icon="speaker_group" :title="t('routing.noClusters')" :description="t('routing.noClustersHint')" />
      </div>

      <!-- Interactive Matrix -->
      <div v-else class="relative w-full min-h-[600px]" ref="containerRef">
         <!-- SVG Overlay for Cables -->
         <!-- Task 34: decorative now that each zone's <Select> below provides
              the real accessible routing interaction (requirement 1) -- a
              screen reader has nothing useful to announce about these <path>
              cable curves, so hide the whole overlay from the a11y tree. -->
         <svg class="absolute inset-0 w-full h-full pointer-events-none z-10 overflow-visible hidden lg:block" role="presentation" aria-hidden="true">
            <!-- Active Cables -->
            <path v-for="conn in activeConnections" :key="conn.groupId"
                  :d="conn.path" 
                  fill="none" 
                  :stroke="conn.color" 
                  :stroke-width="hoverZoneId === conn.groupId ? 6 : 4"
                  stroke-linecap="round"
                  class="transition-all duration-300 pointer-events-none drop-shadow-md"
                  :class="[
                     conn.isPlaying ? 'cable-animated opacity-90' : 'opacity-30',
                     (isDragging && hoverZoneId === conn.groupId && draggedStreamId !== conn.streamId) ? 'opacity-0 scale-95' : 'opacity-100 scale-100'
                  ]" />
                  
            <!-- Dragging Ghost Cable -->
            <path v-if="draggingPath"
                  :d="draggingPath.path"
                  fill="none"
                  :stroke="draggingPath.color"
                  stroke-width="5"
                  stroke-linecap="round"
                  class="cable-animated opacity-100 pointer-events-none" />
         </svg>
         
         <div class="relative z-20 flex flex-col lg:flex-row gap-8 lg:gap-16 xl:gap-20 w-full lg:px-4">
             
             <!-- SOURCES COLUMN (Left) -->
             <div class="w-full lg:w-1/2 flex flex-col gap-3 order-2 lg:order-1">
                 <h2 class="text-xs font-semibold text-text-muted mb-1 flex items-center gap-2 px-1">
                    <span class="material-symbols-outlined text-[1rem]" aria-hidden="true">input</span> {{ t('routing.virtualSources') }}
                 </h2>
                 <div v-for="stream in snapcastStore.status?.streams || []" :key="stream.id"
                      class="bg-brand-surface/80 backdrop-blur-xl border rounded-2xl p-4 flex items-center justify-between shadow-sm transition-all duration-300 relative group/source"
                      :class="[stream.status === 'playing' ? 'border-brand-primary/30' : 'border-line']"
                      :style="`--stream-color: ${getStreamColor(stream.id)}`">
                      
                      <!-- Left side info -->
                      <div class="flex items-center gap-4 overflow-hidden">
                         <div class="w-10 h-10 rounded-xl bg-inset border border-line flex items-center justify-center shrink-0">
                           <span class="material-symbols-outlined text-lg opacity-80" :style="{ color: getStreamColor(stream.id) }">cast</span>
                         </div>
                         <div class="truncate pr-4 flex flex-col justify-center">
                             <div class="font-semibold text-text-main text-sm truncate items-center flex gap-2">
                                {{ getStreamLabel(stream) }}
                                <div class="w-2 h-2 rounded-full shrink-0 transition-all duration-500"
                                     :class="stream.status === 'playing' ? 'animate-pulse' : 'opacity-40'"
                                     :style="{ backgroundColor: getStreamColor(stream.id) }"></div>
                             </div>
                             <div class="text-xs text-text-muted mt-0.5 truncate">{{ stream.status === 'playing' ? t('routing.playing') : t('routing.idle') }}</div>
                         </div>
                      </div>
                      
                      <!-- Output Connector Node (Draggable Handle) -->
                      <!-- Task 34: mouse/touch-only drag gesture, fully
                           replaced for non-mouse users by each zone's
                           accessible <Select> below -- hidden from the a11y
                           tree, and from layout on mobile where the SVG
                           cable overlay is also hidden (see requirement 3). -->
                      <div :ref="setSourceRef(stream.id)"
                           @mousedown.prevent="startDrag(stream.id, $event)"
                           @touchstart.prevent="startDrag(stream.id, $event)"
                           class="hidden lg:flex w-8 h-8 rounded-full bg-brand-surface border-[3px] items-center justify-center cursor-grab active:cursor-grabbing hover:scale-110 transition-transform z-30 shrink-0 right-[-16px] absolute lg:right-[-16px]"
                           :style="{ borderColor: getStreamColor(stream.id) }"
                           :title="t('routing.dragToConnect')"
                           aria-hidden="true">
                           <div class="w-3 h-3 rounded-full transition-all duration-300" 
                                :class="{'animate-ping opacity-50': isDragging && draggedStreamId === stream.id}"
                                :style="{ backgroundColor: getStreamColor(stream.id) }"></div>
                           <div class="w-3 h-3 absolute rounded-full" :style="{ backgroundColor: getStreamColor(stream.id) }"></div>
                      </div>
                 </div>
              </div>
             
             <!-- ZONES COLUMN (Right) -->
             <div class="w-full lg:w-1/2 flex flex-col gap-3 order-1 lg:order-2">
                 <h2 class="text-xs font-semibold text-text-muted mb-1 flex items-center gap-2 px-1">
                    <span class="material-symbols-outlined text-[1rem]" aria-hidden="true">speaker_group</span> {{ t('routing.outputZones') }}
                 </h2>
                 
                 <div v-for="group in snapcastStore.status?.groups || []" :key="group.id"
                      :ref="setZoneCardRef(group.id)"
                      class="bg-brand-surface/80 backdrop-blur-xl border rounded-2xl shadow-sm transition-all duration-300 relative flex flex-col group/zone"
                      :class="[
                         hoverZoneId === group.id ? 'border-brand-primary bg-brand-primary/5 scale-[1.02] z-20' : 'border-line',
                         !group.stream_id ? 'border-warning/40' : ''
                      ]">
                      
                      <!-- Input Connector Node (Drop Target) -->
                      <!-- Task 34: same rationale as the source connector
                           node above -- decorative/hidden from the a11y tree,
                           hidden on mobile alongside the SVG cable overlay. -->
                      <div :ref="setZoneRef(group.id)"
                           class="hidden lg:flex w-10 h-10 rounded-full bg-brand-surface border-[3px] items-center justify-center transition-all duration-300 z-30 shrink-0 absolute left-[-20px] top-[20px]"
                           :class="hoverZoneId === group.id ? 'scale-125' : ''"
                           :style="{ borderColor: group.stream_id ? getStreamColor(group.stream_id) : '#4b5563' }"
                           aria-hidden="true">
                           <div class="w-4 h-4 rounded-full transition-all duration-300"
                                :class="hoverZoneId === group.id ? 'animate-ping opacity-50' : ''"
                                :style="{ backgroundColor: group.stream_id ? getStreamColor(group.stream_id) : '#374151' }"></div>
                           <div class="w-4 h-4 rounded-full absolute" :style="{ backgroundColor: group.stream_id ? getStreamColor(group.stream_id) : '#374151' }"></div>
                      </div>
                      
                      <!-- Zone Header -->
                      <div class="p-4 flex items-center justify-between gap-3 cursor-pointer min-h-[72px]" @click="toggleGroup(group.id)">
                          <!-- Identity -->
                          <div class="flex items-center gap-3 lg:ml-6 min-w-0">
                              <div class="min-w-0">
                                  <div v-if="renamingGroupId === group.id" class="flex items-center gap-2" @click.stop>
                                      <input
                                        type="text"
                                        v-model="newGroupName"
                                        :aria-label="t('routing.renameZone', { name: getZoneLabel(group) })"
                                        @keyup.enter="submitGroupRename(group.id)"
                                        @keyup.esc="renamingGroupId = null"
                                        @blur="submitGroupRename(group.id)"
                                        class="bg-brand-surface border border-brand-primary/50 outline-none rounded-lg px-2 py-1 text-sm text-text-main focus:ring-2 focus:ring-brand-primary/30 w-48"
                                        v-focus
                                      />
                                  </div>
                                  <h3 v-else class="text-sm font-bold text-text-main flex items-center gap-1.5 min-w-0">
                                      <span class="truncate" :class="group.name ? '' : 'italic font-semibold'">{{ getZoneLabel(group) }}</span>
                                      <button
                                        type="button"
                                        class="w-7 h-7 flex items-center justify-center rounded-md text-text-muted hover:text-text-main hover:bg-inset opacity-60 group-hover/zone:opacity-100 focus:opacity-100 shrink-0"
                                        :aria-label="t('routing.renameZone', { name: getZoneLabel(group) })"
                                        @click.stop="startGroupRename(group.id, group.name || '', $event)"
                                      >
                                          <span class="material-symbols-outlined text-[15px]" aria-hidden="true">edit</span>
                                      </button>
                                  </h3>
                                  <p class="text-xs text-text-muted flex items-center gap-1.5">
                                      <span class="w-1.5 h-1.5 rounded-full" :class="onlineCount(group) === group.clients.length ? 'bg-success' : onlineCount(group) === 0 ? 'bg-danger' : 'bg-warning'" aria-hidden="true"></span>
                                      {{ t('routing.speakersOnline', { online: onlineCount(group), total: group.clients.length }) }}
                                  </p>
                              </div>
                          </div>

                          <!-- Group Controls -->
                          <div class="flex items-center gap-1 shrink-0">
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
                           extra steps, and works identically on mobile,
                           where it's the primary routing path once the cable
                           UI is hidden below the `lg` breakpoint. -->
                      <div class="px-4 pb-4 relative z-10">
                          <label class="flex items-center gap-3 w-full">
                              <span class="text-xs font-medium text-text-muted shrink-0 flex items-center gap-1.5 lg:ml-6">
                                  <span class="material-symbols-outlined text-[1rem]" aria-hidden="true">input</span>
                                  {{ t('routing.source') }}
                              </span>
                              <span class="flex-1 min-w-0">
                                  <Select
                                      :model-value="group.stream_id"
                                      :options="streamSelectOptions"
                                      :placeholder="t('routing.noSourceAssigned')"
                                      @update:model-value="(value) => onZoneSourceChange(group.id, value)"
                                  />
                              </span>
                          </label>
                      </div>

                      <!-- Clients List (Expanded) -->
                      <transition name="slide">
                        <div v-if="expandedGroups.has(group.id)" class="border-t border-line bg-inset rounded-b-2xl p-3 sm:p-4 space-y-2 relative z-10 w-full overflow-hidden">
                          <div v-for="client in group.clients" :key="client.id" 
                               class="p-3 rounded-xl bg-brand-surface border border-line flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 w-full group/client" :class="client.connected ? '' : 'opacity-70'">
                              
                              <!-- Client Detail -->
                              <div class="flex items-center gap-4 min-w-0 w-full lg:w-1/2">
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
                              <div class="flex items-center gap-3 w-full sm:w-auto shrink-0 justify-end">
                                  <button @click="snapcastStore.setClientVolume(client.id, { percent: client.config.volume.percent, muted: !client.config.volume.muted })"
                                          class="p-2 min-w-[40px] min-h-[40px] flex items-center justify-center rounded-lg transition-colors hover:bg-inset border border-transparent"
                                          :class="client.config.volume.muted ? 'text-danger bg-danger/10 border-danger/20' : 'text-text-muted hover:text-text-main'"
                                          :aria-label="client.config.volume.muted ? t('routing.unmuteClient', { name: client.config.name || client.host.name || t('routing.client') }) : t('routing.muteClient', { name: client.config.name || client.host.name || t('routing.client') })">
                                      <span class="material-symbols-outlined text-[18px]">{{ client.config.volume.muted ? 'volume_off' : 'volume_up' }}</span>
                                  </button>
                                  <div class="flex items-center gap-3">
                                      <input type="range" class="w-full sm:w-32 h-2 bg-line rounded-full appearance-none cursor-pointer accent-brand-primary" :aria-label="t('routing.volumeFor', { name: client.config.name || client.host.name || t('routing.client') })" 
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
    </div>
  </Layout>
</template>

<style scoped>
.cable-animated {
    stroke-dasharray: 12 12;
    animation: flow 0.8s linear infinite;
}
@keyframes flow {
    from { stroke-dashoffset: 24; }
    to { stroke-dashoffset: 0; }
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
