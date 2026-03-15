<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useConfigStore } from '../stores/config';
import { useUIStore } from '../stores/ui';
import Layout from '../components/Layout.vue';
import Card from '../components/Card.vue';

const configStore = useConfigStore();
const uiStore = useUIStore();

const selectedSegment = ref<{name: string, content: string} | null>(null);
const editName = ref('');
const editContent = ref('');
const isNew = ref(false);

onMounted(async () => {
    await configStore.fetchConfigSegments();
});

const selectSegment = (segment: {name: string, content: string}) => {
    selectedSegment.value = segment;
    editName.value = segment.name;
    editContent.value = segment.content;
    isNew.value = false;
};

const createNew = () => {
    selectedSegment.value = null;
    editName.value = '';
    editContent.value = '';
    isNew.value = true;
};

const handleSave = async () => {
    if (!editName.value) {
        uiStore.showToast('Segment name is required', 'error');
        return;
    }
    
    try {
        await configStore.saveConfigSegment(editName.value, editContent.value);
        uiStore.showToast(`Segment ${editName.value} saved successfully`, 'success');
        isNew.value = false;
        // Find and select the updated/new segment
        const updated = configStore.configSegments.find(s => s.name === (editName.value.endsWith('.conf') ? editName.value : editName.value + '.conf'));
        if (updated) selectedSegment.value = updated;
    } catch (err: any) {
        uiStore.showToast('Failed to save segment: ' + err.message, 'error');
    }
};

const handleDelete = async (name: string) => {
    if (!confirm(`Are you sure you want to delete segment ${name}?`)) return;
    
    try {
        await configStore.deleteConfigSegment(name);
        uiStore.showToast(`Segment ${name} deleted successfully`, 'success');
        if (selectedSegment.value?.name === name) {
            selectedSegment.value = null;
        }
    } catch (err: any) {
        uiStore.showToast('Failed to delete segment: ' + err.message, 'error');
    }
};

const handleRebuild = async () => {
    if (!confirm('This will rebuild snapserver.conf from base and segments. Snapserver will restart. Continue?')) return;
    try {
        await configStore.rebuildMasterConfig();
        uiStore.showToast('Snapserver configuration rebuilt successfully', 'success');
    } catch (err: any) {
        uiStore.showToast('Failed to rebuild config: ' + err.message, 'error');
    }
};
</script>

<template>
    <Layout title="Modular Config">
        <div class="grid grid-cols-1 lg:grid-cols-12 gap-6">
            <!-- Sidebar: Segments List -->
            <div class="lg:col-span-4 space-y-6">
                <Card title="Configuration Segments" subtitle="Modular .conf files in snapserver.conf.d/">
                    <template #actions>
                        <button @click="createNew" class="p-1.5 bg-emerald-500/10 text-emerald-500 rounded-lg hover:bg-emerald-500/20 transition-all active:scale-95">
                            <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                                <path fill-rule="evenodd" d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z" clip-rule="evenodd" />
                            </svg>
                        </button>
                    </template>
                    
                    <div class="space-y-2 mt-4">
                        <div v-if="configStore.configSegments.length === 0" class="text-center py-8">
                            <span class="text-xs text-slate-400 italic">No segments found.</span>
                        </div>
                        <div v-for="seg in configStore.configSegments" :key="seg.name" 
                             @click="selectSegment(seg)"
                             :class="[
                                'group flex items-center justify-between p-3 rounded-xl border transition-all cursor-pointer',
                                selectedSegment?.name === seg.name 
                                ? 'bg-indigo-500/10 border-indigo-500/30 text-indigo-600 dark:text-indigo-400' 
                                : 'bg-slate-50 dark:bg-slate-800/50 border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600'
                             ]"
                        >
                            <div class="flex items-center gap-3">
                                <span class="text-sm font-mono truncate max-w-[150px]">{{ seg.name }}</span>
                            </div>
                            <button @click.stop="handleDelete(seg.name)" class="opacity-0 group-hover:opacity-100 p-1 text-slate-400 hover:text-rose-500 transition-all">
                                <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                                    <path fill-rule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clip-rule="evenodd" />
                                </svg>
                            </button>
                        </div>
                    </div>

                    <div class="pt-6 border-t border-slate-100 dark:border-slate-800 space-y-3">
                        <span class="text-[10px] font-bold text-slate-400 uppercase tracking-widest px-1">Actions</span>
                        <button @click="handleRebuild" class="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 rounded-xl font-black text-xs hover:bg-slate-200 dark:hover:bg-slate-700 transition-all active:scale-95">
                            <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
                                <path fill-rule="evenodd" d="M4 2a1 1 0 011 1v2.101a7.002 7.002 0 0111.601 2.566 1 1 0 11-1.885.666A5.002 5.002 0 005.999 7H9a1 1 0 110 2H4a1 1 0 01-1-1V3a1 1 0 011-1zm.008 9.057a1 1 0 011.276.61A5.002 5.002 0 0014.001 13H11a1 1 0 110-2h5a1 1 0 011 1v5a1 1 0 11-2 0v-2.101a7.002 7.002 0 01-11.601-2.566 1 1 0 01.61-1.276z" clip-rule="evenodd" />
                            </svg>
                            FORCE MASTER REBUILD
                        </button>
                    </div>
                </Card>
            </div>

            <!-- Main Panel: Editor -->
            <div class="lg:col-span-8">
                <Card v-if="selectedSegment || isNew" :title="isNew ? 'New Segment' : 'Edit Segment'" :subtitle="isNew ? 'Create a new configuration file' : `Editing ${editName}`">
                    <div class="space-y-4 pt-4">
                        <div v-if="isNew" class="space-y-1">
                            <label class="text-[10px] font-black text-slate-400 uppercase tracking-widest pl-1">Segment Name</label>
                            <input v-model="editName" type="text" placeholder="e.g., 10-streams.conf" 
                                   class="w-full bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500/50 transition-all font-mono" />
                        </div>
                        
                        <div class="space-y-1">
                            <label class="text-[10px] font-black text-slate-400 uppercase tracking-widest pl-1">Configuration Content</label>
                            <textarea v-model="editContent" rows="15" 
                                      class="w-full bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl px-4 py-4 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500/50 transition-all resize-none"
                                      placeholder="# Add your configuration here..."></textarea>
                        </div>
                        
                        <div class="flex items-center justify-end gap-3 pt-2">
                             <button @click="handleSave" class="flex items-center gap-2 px-6 py-2.5 bg-emerald-600 text-white rounded-xl font-black text-xs hover:bg-emerald-700 shadow-lg shadow-emerald-500/20 transition-all active:scale-95 disabled:opacity-50" :disabled="configStore.loading">
                                <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor" v-if="!configStore.loading">
                                    <path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd" />
                                </svg>
                                <svg v-else class="animate-spin h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                    <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                                    <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                </svg>
                                SAVE CHANGES
                            </button>
                        </div>
                    </div>
                </Card>

                <div v-else class="h-full flex flex-col items-center justify-center opacity-40 py-20 grayscale">
                    <div class="p-6 rounded-full bg-slate-100 dark:bg-slate-800 mb-6">
                        <svg xmlns="http://www.w3.org/2000/svg" class="h-16 w-16 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                        </svg>
                    </div>
                    <p class="text-slate-500 font-bold uppercase tracking-widest text-xs">Select a segment or create a new one</p>
                </div>
            </div>
        </div>
    </Layout>
</template>
