import { defineStore } from 'pinia';
import { ref } from 'vue';
import { fetchApi } from '../utils/api';

export interface Snapshot {
    id: number;
    name: string;
    description: string;
    filename: string;
    timestamp: string;
}

export const useSnapshotStore = defineStore('snapshots', () => {
    const snapshots = ref<Snapshot[]>([]);
    const loading = ref(false);

    async function fetchSnapshots() {
        loading.value = true;
        try {
            snapshots.value = await fetchApi('/snapshots');
        } catch (error) {
            console.error('Failed to fetch snapshots:', error);
            throw error;
        } finally {
            loading.value = false;
        }
    }

    async function createSnapshot(name: string, description: string = '') {
        loading.value = true;
        try {
            const newSnapshot = await fetchApi('/snapshots', {
                method: 'POST',
                body: JSON.stringify({ name, description }),
            });
            snapshots.value.unshift(newSnapshot);
            return newSnapshot;
        } catch (error) {
            console.error('Failed to create snapshot:', error);
            throw error;
        } finally {
            loading.value = false;
        }
    }

    async function restoreSnapshot(id: number) {
        loading.value = true;
        try {
            await fetchApi(`/snapshots/${id}/restore`, {
                method: 'POST',
            });
        } catch (error) {
            console.error('Failed to restore snapshot:', error);
            throw error;
        } finally {
            loading.value = false;
        }
    }

    async function deleteSnapshot(id: number) {
        loading.value = true;
        try {
            await fetchApi(`/snapshots/${id}`, {
                method: 'DELETE',
            });
            snapshots.value = snapshots.value.filter(s => s.id !== id);
        } catch (error) {
            console.error('Failed to delete snapshot:', error);
            throw error;
        } finally {
            loading.value = false;
        }
    }

    return {
        snapshots,
        loading,
        fetchSnapshots,
        createSnapshot,
        restoreSnapshot,
        deleteSnapshot,
    };
});
