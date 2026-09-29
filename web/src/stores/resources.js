import { computed, ref } from 'vue';
import { defineStore } from 'pinia';
import { api, describeError } from '../api/client.js';
import { useUiStore } from './ui.js';

export const useResourceStore = defineStore('resources', () => {
  const ui = useUiStore();
  const groups = ref([]);
  const total = ref(0);
  const items = ref([]);
  const loading = ref(false);
  const saving = ref(false);

  const flat = computed(() => groups.value.flatMap((group) => group.items));

  async function load() {
    loading.value = true;
    try {
      const data = await api.get('/api/resources');
      groups.value = data.groups;
      total.value = data.total;
    } catch (err) {
      ui.notify(describeError(err), 'error');
    } finally {
      loading.value = false;
    }
  }

  async function loadAll() {
    const data = await api.get('/api/resources/all');
    items.value = data.items;
    return data.items;
  }

  async function create(payload) {
    const data = await api.post('/api/resources', payload);
    await Promise.all([load(), loadAll().catch(() => undefined)]);
    ui.notify('资源条目已登记', 'commit');
    return data.resource;
  }

  async function update(id, payload) {
    const data = await api.put(`/api/resources/${encodeURIComponent(id)}`, payload);
    await Promise.all([load(), loadAll().catch(() => undefined)]);
    ui.notify('资源条目已更新', 'commit');
    return data.resource;
  }

  async function remove(id) {
    await api.del(`/api/resources/${encodeURIComponent(id)}`);
    await Promise.all([load(), loadAll().catch(() => undefined)]);
    ui.notify('资源条目已移除', 'commit');
  }

  return { groups, total, items, loading, saving, flat, load, loadAll, create, update, remove };
});
