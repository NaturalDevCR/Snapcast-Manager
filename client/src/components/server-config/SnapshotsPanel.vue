<script setup lang="ts">
// Task 38: extracted from ServerConfig.vue's "Snapshots" tab — the first
// slice of decomposing that 1500+ line view onto smaller, self-contained
// child components (see .superpowers/sdd/task-38-brief.md).
//
// Self-sufficient: talks to `snapshotStore` (a Pinia store) directly, needs
// no props from ServerConfig.vue for its data. The one piece of genuine
// cross-tab coupling found while extracting this — a successful restore
// also needs the parent to re-fetch the Standard/Expert tabs' config state
// and open the (parent-owned) "Restart Snapserver?" dialog — is surfaced via
// the `restored` emit instead of being silently dropped.
import { ref } from 'vue';
import { useSnapshotStore } from '../../stores/snapshots';
import { useUIStore } from '../../stores/ui';
import Card from '../Card.vue';
import ConfirmDialog from '../ConfirmDialog.vue';
import Skeleton from '../ui/Skeleton.vue';

const emit = defineEmits<{ restored: [] }>();

const snapshotStore = useSnapshotStore();
const uiStore = useUIStore();

const snapshotName = ref('');
const snapshotDescription = ref('');

const showConfirmRestore = ref(false);
const showConfirmDeleteSnapshot = ref(false);
const pendingRestoreId = ref<number | null>(null);
const pendingDeleteSnapshotId = ref<number | null>(null);

const handleCreateSnapshot = async () => {
    if (!snapshotName.value) return;
    try {
        await snapshotStore.createSnapshot(snapshotName.value, snapshotDescription.value);
        snapshotName.value = '';
        snapshotDescription.value = '';
        uiStore.showToast('Snapshot created successfully!', 'success');
    } catch (e: any) {
        uiStore.showToast('Failed to create snapshot: ' + e.message, 'error');
    }
};

const triggerRestoreSnapshot = (id: number) => {
  pendingRestoreId.value = id;
  showConfirmRestore.value = true;
};

const handleRestoreSnapshot = async () => {
    if (pendingRestoreId.value === null) return;
    try {
        await snapshotStore.restoreSnapshot(pendingRestoreId.value);
        // Config restored on the server — let the parent re-fetch the
        // Standard/Expert tabs' config state and offer a Snapserver
        // restart (both are ServerConfig.vue-owned concerns).
        emit('restored');
        uiStore.showToast('Snapshot restored successfully!', 'success');
    } catch (e: any) {
        uiStore.showToast('Failed to restore snapshot: ' + e.message, 'error');
    }
};

const triggerDeleteSnapshot = (id: number) => {
  pendingDeleteSnapshotId.value = id;
  showConfirmDeleteSnapshot.value = true;
};

const handleDeleteSnapshot = async () => {
    if (pendingDeleteSnapshotId.value === null) return;
    try {
        await snapshotStore.deleteSnapshot(pendingDeleteSnapshotId.value);
        uiStore.showToast('Snapshot deleted', 'info');
    } catch (e: any) {
        uiStore.showToast('Failed to delete snapshot: ' + e.message, 'error');
    }
};
</script>

<template>
  <div class="animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div class="grid grid-cols-1 lg:grid-cols-3 gap-8">
          <div class="lg:col-span-1">
              <Card title="Checkpoint">
                <template #icon>
                  <span class="material-symbols-outlined text-[20px] text-brand-primary drop-shadow-[0_0_8px_rgba(166,13,242,0.5)]">content_copy</span>
                </template>
                <div class="space-y-5">
                    <div>
                        <label class="text-[10px] font-black text-text-muted uppercase tracking-widest block mb-2">Identifier</label>
                        <input v-model="snapshotName" type="text" placeholder="e.g. Pre-optimization"
                          class="w-full text-sm font-medium px-4 py-2.5 bg-black/40 border border-black/5 dark:border-white/5 rounded-xl focus:ring-2 focus:ring-brand-primary/30 focus:border-brand-primary outline-none transition-all text-gray-700 dark:text-gray-300 placeholder-gray-400 dark:placeholder-gray-600">
                    </div>
                    <div>
                        <label class="text-[10px] font-black text-text-muted uppercase tracking-widest block mb-2">Notes</label>
                        <textarea v-model="snapshotDescription" placeholder="Briefly describe why this checkpoint is being made..."
                          class="w-full text-sm font-medium px-4 py-2.5 bg-black/40 border border-black/5 dark:border-white/5 rounded-xl focus:ring-2 focus:ring-brand-primary/30 focus:border-brand-primary outline-none transition-all text-gray-700 dark:text-gray-300 placeholder-gray-400 dark:placeholder-gray-600 h-32 resize-none"></textarea>
                    </div>
                    <button
                      @click="handleCreateSnapshot"
                      :disabled="snapshotStore.loading || !snapshotName"
                      class="w-full px-6 py-3 bg-brand-primary text-white rounded-xl font-black text-xs uppercase tracking-widest hover:bg-[#b526ff] shadow-[0_0_15px_rgba(166,13,242,0.4)] hover:shadow-[0_0_20px_rgba(166,13,242,0.6)] disabled:opacity-50 transition-all active:scale-95 border border-brand-primary"
                    >
                      Capture State
                    </button>
                </div>
              </Card>
          </div>
          <div class="lg:col-span-2">
              <Card title="Version History">
                <template #icon>
                  <span class="material-symbols-outlined text-[20px] text-[#00d4ff] drop-shadow-[0_0_5px_rgba(0,212,255,0.5)]">history</span>
                </template>
                <!-- Task 35: shaped like the real snapshot rows in
                     the v-else branch below (same p-5/rounded-2xl
                     card, a title-width bar, a shorter timestamp
                     chip) instead of a bare spinner icon, so it
                     reads as "list rows about to appear". -->
                <div v-if="snapshotStore.loading && snapshotStore.snapshots.length === 0" class="space-y-4">
                    <div v-for="n in 3" :key="n" class="p-5 border border-black/5 dark:border-white/5 rounded-2xl bg-black/30 space-y-2">
                        <Skeleton variant="text" width="45%" height="14px" />
                        <Skeleton variant="text" width="20%" height="10px" />
                    </div>
                </div>
                <div v-else-if="snapshotStore.snapshots.length === 0" class="text-center py-24 bg-black/20 rounded-2xl border border-dashed border-black/10 dark:border-white/10">
                    <p class="text-xs font-black text-text-muted uppercase tracking-[0.2em]">No snapshots archived</p>
                </div>
                <div v-else class="space-y-4">
                    <div v-for="snapshot in snapshotStore.snapshots" :key="snapshot.id"
                      class="p-5 border border-black/5 dark:border-white/5 rounded-2xl flex justify-between items-center bg-black/30 hover:bg-black/50 hover:border-brand-primary/30 transition-all group shadow-sm">
                        <div class="space-y-1">
                            <h4 class="font-black text-gray-900 dark:text-white uppercase tracking-tight dark:drop-shadow-[0_0_5px_rgba(255,255,255,0.2)]">{{ snapshot.name }}</h4>
                            <p v-if="snapshot.description" class="text-xs font-semibold text-text-muted">{{ snapshot.description }}</p>
                            <div class="flex items-center text-[10px] font-bold text-brand-primary bg-brand-primary/10 border border-brand-primary/20 px-2 py-0.5 rounded w-fit mt-2 uppercase tracking-widest">
                              {{ new Date(snapshot.timestamp).toLocaleString() }}
                            </div>
                        </div>
                        <div class="flex space-x-2">
                            <button @click="triggerRestoreSnapshot(snapshot.id)"
                              class="text-[10px] font-black uppercase tracking-widest px-4 py-2 bg-brand-primary/10 text-brand-primary border border-brand-primary/20 rounded-lg hover:bg-brand-primary hover:text-white transition-all shadow-[inset_0_0_10px_rgba(166,13,242,0.1)] hover:shadow-[0_0_15px_rgba(166,13,242,0.3)] active:scale-95">
                                Restore
                            </button>
                            <button @click="triggerDeleteSnapshot(snapshot.id)"
                              class="p-2 min-w-[44px] min-h-[44px] flex items-center justify-center text-text-muted hover:text-[#ff3b30] hover:bg-[#ff3b30]/10 border border-transparent hover:border-[#ff3b30]/20 rounded-lg transition-all group-hover:opacity-100 md:opacity-0 active:scale-95"
                              :aria-label="`Delete snapshot ${snapshot.name}`">
                                <span class="material-symbols-outlined text-[18px]">delete</span>
                            </button>
                        </div>
                    </div>
                </div>
              </Card>
          </div>
      </div>

      <ConfirmDialog
        v-model="showConfirmRestore"
        title="Restore Snapshot?"
        message="Are you sure you want to restore this snapshot? Current configuration will be overwritten."
        type="danger"
        confirmText="Overwrite & Restore"
        @confirm="handleRestoreSnapshot"
      />

      <ConfirmDialog
        v-model="showConfirmDeleteSnapshot"
        title="Delete Snapshot?"
        message="This action cannot be undone."
        type="danger"
        confirmText="Delete Permanently"
        @confirm="handleDeleteSnapshot"
      />
  </div>
</template>
