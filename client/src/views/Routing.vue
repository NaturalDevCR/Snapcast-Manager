<script setup lang="ts">
import Layout from '../components/Layout.vue';
import { useSnapcastStore } from '../stores/snapcast';
import { onMounted, onUnmounted, ref, computed } from 'vue';

const vFocus = {
  mounted: (el: HTMLElement) => el.focus()
};

const snapcastStore = useSnapcastStore();
let refreshInterval: any = null;
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
    snapcastStore.fetchStatus();
    refreshInterval = setInterval(() => {
        snapcastStore.fetchStatus();
        triggerRedraw(); // ensure redraw on fetch to catch new groups/streams
    }, 2000);
    window.addEventListener('resize', triggerRedraw);
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('touchmove', handleTouchMove, { passive: false });
    document.addEventListener('mouseup', handleMouseUp);
    document.addEventListener('touchend', handleMouseUp);
    
    // Initial draw delay to ensure DOM is ready
    setTimeout(triggerRedraw, 200);
});

onUnmounted(() => {
    if (refreshInterval) clearInterval(refreshInterval);
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
    connectionsVersion.value;
    
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
    return stream.id || 'Unknown Stream';
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
    <div class="space-y-8 pb-12 w-full max-w-[1600px] mx-auto overflow-x-hidden">
      <!-- Page Header -->
      <div class="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-brand-surface/40 backdrop-blur-3xl border border-white/[0.03] p-8 rounded-[2.5rem] shadow-2xl relative overflow-hidden group">
        <div class="absolute inset-0 bg-gradient-to-r from-brand-primary/5 to-transparent pointer-events-none"></div>
        <div class="relative z-10 flex items-center space-x-4">
            <div class="p-4 bg-brand-primary/10 rounded-2xl border border-brand-primary/20 shadow-lg shadow-brand-primary/20 group-hover:shadow-xl group-hover:shadow-brand-primary/40 transition-all duration-500">
                <span class="material-symbols-outlined text-brand-primary text-3xl">hub</span>
            </div>
            <div>
                <h1 class="text-3xl font-black text-text-main tracking-tight">Audio Matrix</h1>
                <p class="text-[10px] text-white/40 font-black uppercase tracking-[0.3em] mt-1">Infrastructure Routing & Zone Control</p>
            </div>
        </div>
        <button @click="snapcastStore.fetchStatus()" :disabled="snapcastStore.loading" 
                class="px-6 py-3 bg-white/[0.03] hover:bg-white/[0.08] text-white rounded-2xl text-xs font-black border border-white/[0.05] backdrop-blur-xl transition-all active:scale-95 flex items-center gap-3 group/btn shadow-xl z-20">
            <span class="material-symbols-outlined text-sm group-hover/btn:rotate-180 transition-transform duration-700" :class="{'animate-spin': snapcastStore.loading}">refresh</span>
            RE-SYNC INFRASTRUCTURE
        </button>
      </div>

      <!-- Loading / Empty States -->
      <div v-if="snapcastStore.loading && !snapcastStore.status" class="flex flex-col items-center justify-center py-24 text-white/20">
        <div class="w-12 h-12 border-4 border-brand-primary/20 border-t-brand-primary rounded-full animate-spin mb-4"></div>
        <span class="text-xs font-black uppercase tracking-[0.3em]">Querying Network Infrastructure...</span>
      </div>
      <div v-else-if="!snapcastStore.loading && (!snapcastStore.status || snapcastStore.status.groups.length === 0)" class="flex flex-col items-center justify-center py-24 text-white/10 glass rounded-[3rem]">
        <span class="material-symbols-outlined text-6xl mb-4">settings_input_component</span>
        <span class="text-xs font-black uppercase tracking-[0.3em]">No Snapserver Clusters Identified</span>
      </div>

      <!-- Interactive Matrix -->
      <div v-else class="relative w-full min-h-[600px]" ref="containerRef">
         <!-- SVG Overlay for Cables -->
         <svg class="absolute inset-0 w-full h-full pointer-events-none z-10 overflow-visible">
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
                  class="cable-animated opacity-100 drop-shadow-[0_0_12px_rgba(255,255,255,0.4)] pointer-events-none" />
         </svg>
         
         <div class="relative z-20 flex flex-col lg:flex-row gap-8 lg:gap-16 xl:gap-24 w-full px-2 sm:px-4">
             
             <!-- SOURCES COLUMN (Left) -->
             <div class="w-full lg:w-1/2 flex flex-col gap-4">
                 <h2 class="text-[10px] font-black text-text-muted uppercase tracking-[0.2em] mb-2 flex items-center gap-2 px-2">
                    <span class="material-symbols-outlined text-sm">input</span> Virtual Sources
                 </h2>
                 <div v-for="stream in snapcastStore.status?.streams || []" :key="stream.id"
                      class="bg-brand-surface/80 backdrop-blur-xl border rounded-[1.5rem] p-4 flex items-center justify-between shadow-lg transition-all duration-300 relative group/source"
                      :class="[stream.status === 'playing' ? 'border-brand-primary/30' : 'border-white/5']"
                      :style="`--stream-color: ${getStreamColor(stream.id)}`">
                      
                      <!-- Left side info -->
                      <div class="flex items-center gap-4 overflow-hidden">
                         <div class="w-10 h-10 rounded-xl bg-gradient-to-br from-white/5 to-transparent border border-white/5 flex items-center justify-center shrink-0">
                           <span class="material-symbols-outlined text-lg opacity-80" :style="{ color: getStreamColor(stream.id) }">cast</span>
                         </div>
                         <div class="truncate pr-4 flex flex-col justify-center">
                             <div class="font-bold text-text-main text-[15px] truncate items-center flex gap-2">
                                {{ getStreamLabel(stream) }}
                                <div class="w-2 h-2 rounded-full shrink-0 transition-all duration-500"
                                     :class="stream.status === 'playing' ? 'animate-pulse shadow-[0_0_8px_var(--stream-color)]' : 'opacity-40'"
                                     :style="{ backgroundColor: getStreamColor(stream.id) }"></div>
                             </div>
                             <div class="text-[10px] font-bold text-text-muted mt-0.5 truncate uppercase tracking-widest">{{ stream.status }}</div>
                         </div>
                      </div>
                      
                      <!-- Output Connector Node (Draggable Handle) -->
                      <div :ref="setSourceRef(stream.id)"
                           @mousedown.prevent="startDrag(stream.id, $event)"
                           @touchstart.prevent="startDrag(stream.id, $event)"
                           class="w-8 h-8 rounded-full bg-brand-surface border-[3px] flex items-center justify-center cursor-grab active:cursor-grabbing hover:scale-110 transition-transform shadow-[0_0_15px_rgba(0,0,0,0.5)] z-30 shrink-0 right-[-16px] absolute lg:right-[-16px]"
                           :style="{ borderColor: getStreamColor(stream.id) }"
                           title="Drag to connect to a zone">
                           <div class="w-3 h-3 rounded-full transition-all duration-300" 
                                :class="{'animate-ping opacity-50': isDragging && draggedStreamId === stream.id}"
                                :style="{ backgroundColor: getStreamColor(stream.id) }"></div>
                           <div class="w-3 h-3 absolute rounded-full" :style="{ backgroundColor: getStreamColor(stream.id) }"></div>
                      </div>
                 </div>
              </div>
             
             <!-- ZONES COLUMN (Right) -->
             <div class="w-full lg:w-1/2 flex flex-col gap-4 mt-8 lg:mt-0">
                 <h2 class="text-[10px] font-black text-text-muted uppercase tracking-[0.2em] mb-2 flex items-center gap-2 px-2">
                    <span class="material-symbols-outlined text-sm">speaker_group</span> Output Zones
                 </h2>
                 
                 <div v-for="group in snapcastStore.status?.groups || []" :key="group.id"
                      :ref="setZoneCardRef(group.id)"
                      class="bg-brand-surface/80 backdrop-blur-3xl border rounded-[1.5rem] shadow-xl transition-all duration-500 relative flex flex-col group/zone"
                      :class="[
                         hoverZoneId === group.id ? 'border-brand-primary bg-brand-primary/5 scale-[1.02] shadow-[0_0_30px_rgba(59,130,246,0.15)] z-20' : 'border-white/5 hover:border-white/10',
                         !group.stream_id ? 'border-red-500/20 shadow-red-500/5' : ''
                      ]">
                      
                      <!-- Input Connector Node (Drop Target) -->
                      <div :ref="setZoneRef(group.id)"
                           class="w-10 h-10 rounded-full bg-brand-surface border-[3px] flex items-center justify-center transition-all duration-300 z-30 shrink-0 absolute left-[-20px] top-[20px] shadow-[0_0_15px_rgba(0,0,0,0.5)]"
                           :class="hoverZoneId === group.id ? 'scale-125' : ''"
                           :style="{ borderColor: group.stream_id ? getStreamColor(group.stream_id) : '#4b5563' }">
                           <div class="w-4 h-4 rounded-full transition-all duration-300"
                                :class="hoverZoneId === group.id ? 'animate-ping opacity-50' : ''"
                                :style="{ backgroundColor: group.stream_id ? getStreamColor(group.stream_id) : '#374151' }"></div>
                           <div class="w-4 h-4 rounded-full absolute" :style="{ backgroundColor: group.stream_id ? getStreamColor(group.stream_id) : '#374151' }"></div>
                      </div>
                      
                      <!-- Zone Header -->
                      <div class="p-4 flex items-center justify-between gap-4 cursor-pointer min-h-[72px]" @click="toggleGroup(group.id)">
                          <div class="w-2 h-2 rounded-full absolute opacity-0"></div> <!-- spacing component -->
                          <!-- Identity -->
                          <div class="flex items-center gap-4 ml-6 overflow-hidden">
                              <div class="truncate">
                                  <h3 class="text-base font-black text-text-main tracking-tight flex items-center gap-3 truncate">
                                    <!-- Zone name: inline edit on click -->
                                    <div v-if="renamingGroupId === group.id" class="flex items-center gap-2" @click.stop>
                                        <input
                                          type="text"
                                          v-model="newGroupName"
                                          @keyup.enter="submitGroupRename(group.id)"
                                          @keyup.esc="renamingGroupId = null"
                                          @blur="submitGroupRename(group.id)"
                                          class="bg-brand-surface border border-brand-primary/50 outline-none rounded-lg px-2 py-1 text-sm text-text-main focus:ring-2 focus:ring-brand-primary/30 w-40 transition-all"
                                          v-focus
                                        />
                                    </div>
                                    <div v-else class="flex items-center gap-2 group/zonename cursor-pointer" @click.stop="startGroupRename(group.id, group.name || 'Zone ' + group.id.slice(0,4), $event)">
                                        <span class="truncate">{{ group.name || 'Zone ' + group.id.slice(0,4) }}</span>
                                        <span class="material-symbols-outlined text-[13px] text-text-muted opacity-0 group-hover/zonename:opacity-100 transition-all">edit</span>
                                    </div>
                                    <span v-if="group.stream_id" class="px-2 py-0.5 rounded-md text-[9px] font-black uppercase tracking-wider bg-white/10 shrink-0" :style="{ color: getStreamColor(group.stream_id) }">
                                        {{ getStreamLabel(snapcastStore.status?.streams?.find(s => s.id === group.stream_id) || {}) }}
                                    </span>
                                  </h3>
                                  <p class="text-[9px] font-black text-text-muted mt-0.5 uppercase tracking-[0.1em]">{{ group.clients.length }} DESTINATIONS</p>
                              </div>
                          </div>
                          
                          <!-- Group Controls -->
                          <div class="flex items-center gap-2 shrink-0">
                            <button @click.stop="snapcastStore.setGroupMute(group.id, !group.muted)" 
                                    class="w-8 h-8 rounded-xl transition-all duration-300 border flex items-center justify-center group/mute shadow-md shrink-0"
                                    :class="group.muted ? 'bg-red-500/10 text-red-500 border-red-500/20 hover:bg-red-500/20' : 'bg-brand-surface text-text-muted border-white/5 hover:text-text-main hover:border-white/10'">
                                <span class="material-symbols-outlined text-sm transition-transform group-hover/mute:scale-110">{{ group.muted ? 'volume_off' : 'volume_up' }}</span>
                            </button>
                            <div class="w-8 h-8 rounded-full flex items-center justify-center text-text-muted transition-transform duration-300"
                                 :class="{'rotate-180': expandedGroups.has(group.id)}">
                                <span class="material-symbols-outlined">expand_more</span>
                            </div>
                          </div>
                      </div>

                      <!-- Clients List (Expanded) -->
                      <transition name="slide">
                        <div v-if="expandedGroups.has(group.id)" class="bg-black/20 rounded-b-[2rem] p-4 sm:p-6 space-y-2 relative z-10 w-full overflow-hidden transition-all duration-500">
                          <div v-for="client in group.clients" :key="client.id" 
                               class="p-4 rounded-2xl bg-brand-surface/40 backdrop-blur-md border border-white/5 hover:border-white/10 transition-all duration-300 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 w-full group/client">
                              
                              <!-- Client Detail -->
                              <div class="flex items-center gap-4 min-w-0 w-full lg:w-1/2">
                                  <div class="w-10 h-10 rounded-xl bg-gradient-to-br from-white/5 to-transparent border border-white/5 flex items-center justify-center shrink-0 transition-colors"
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
                                              {{ client.config.name || client.host.name || 'Unnamed Client' }}
                                          </span>
                                          <span class="material-symbols-outlined text-[14px] text-text-muted opacity-0 group-hover/name:opacity-100 transition-all">edit</span>
                                      </div>
                                      <div class="flex items-center gap-1.5 mt-0.5">
                                          <div class="w-1.5 h-1.5 rounded-full" :class="client.connected ? 'bg-[#10b981]' : 'bg-red-500'"></div>
                                          <span class="text-[10px] font-medium text-text-muted truncate tracking-wider uppercase">{{ client.host.ip }}</span>
                                      </div>
                                  </div>
                              </div>
                              
                              <!-- Volume Controls -->
                              <div class="flex items-center gap-3 w-full sm:w-auto shrink-0 justify-end">
                                  <button @click="snapcastStore.setClientVolume(client.id, { percent: client.config.volume.percent, muted: !client.config.volume.muted })" 
                                          class="p-2 rounded-xl transition-all hover:bg-white/5 border border-transparent"
                                          :class="client.config.volume.muted ? 'text-red-400 bg-red-400/10 border-red-400/20' : 'text-text-muted hover:text-text-main hover:border-white/10'">
                                      <span class="material-symbols-outlined text-[18px]">{{ client.config.volume.muted ? 'volume_off' : 'volume_up' }}</span>
                                  </button>
                                  <div class="flex items-center gap-3">
                                      <input type="range" class="w-full sm:w-28 h-2 bg-black/40 shadow-inner rounded-full appearance-none cursor-pointer accent-brand-primary hover:accent-brand-primary/80 transition-all" 
                                             min="0" max="100" v-model="client.config.volume.percent" @change="updateVolume(client, $event)">
                                      <span class="text-[11px] font-black tracking-wider w-10 text-right" :class="client.config.volume.muted ? 'text-red-400' : 'text-text-muted'">
                                          {{ client.config.volume.muted ? 'MUTED' : client.config.volume.percent + '%' }}
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
