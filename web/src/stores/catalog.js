import { computed, ref } from 'vue';
import { defineStore } from 'pinia';
import { api, describeError } from '../api/client.js';
import { useUiStore } from './ui.js';

const PAGE_SIZE = 9;
const DETAIL_TTL_MS = 20 * 60 * 1000;

export const useCatalogStore = defineStore('catalog', () => {
  const ui = useUiStore();
  const items = ref([]);
  const total = ref(0);
  const page = ref(0);
  const hasMore = ref(true);
  const loading = ref(false);
  const listError = ref('');
  const tag = ref('');
  const query = ref('');
  const rating = ref('');
  const details = ref(new Map());
  const tags = ref([]);
  const stats = ref({ total: 0, tagged: 0, pinned: 0, sources: 0, lastUpdated: '' });
  const limits = ref({ maxImageBytes: 5 * 1024 * 1024, maxTags: 20, maxSources: 20 });

  const pinnedItem = computed(() => items.value.find((item) => item.pinned) || null);

  const endpoint = () => {
    const params = new URLSearchParams({ page: String(page.value + 1), size: String(PAGE_SIZE) });
    if (tag.value) params.set('tag', tag.value);
    if (query.value) params.set('q', query.value);
    if (rating.value) params.set('rating', rating.value);
    return `/api/posts?${params}`;
  };

  async function loadList({ reset = false } = {}) {
    if (loading.value) return;
    if (reset) {
      page.value = 0;
      hasMore.value = true;
      items.value = [];
    }
    if (!hasMore.value) return;
    loading.value = true;
    listError.value = '';
    try {
      const data = await api.get(endpoint());
      items.value = reset ? data.items : [...items.value, ...data.items];
      total.value = data.total;
      hasMore.value = data.hasMore;
      page.value += 1;
    } catch (err) {
      listError.value = describeError(err);
      ui.notify(listError.value, 'error');
      // 失败页不重试：哨兵仍在视野里，留着 hasMore 会被反复触发（游客深翻页就是 403）
      hasMore.value = false;
    } finally {
      loading.value = false;
    }
  }

  async function openPost(id) {
    const hit = details.value.get(id);
    // 详情里的插图是短时效签名直链（服务端 30 分钟），缓存必须在过期前作废，否则复用即 403
    if (hit && Date.now() - hit.at < DETAIL_TTL_MS) return hit.post;
    const data = await api.get(`/api/posts/${encodeURIComponent(id)}`);
    details.value.set(id, { post: data.post, at: Date.now() });
    return data.post;
  }

  function patchPost(post) {
    details.value.set(post.id, { post, at: Date.now() });
    const index = items.value.findIndex((item) => item.id === post.id);
    if (index >= 0) items.value.splice(index, 1);
  }

  async function savePost(payload, id) {
    const data = id
      ? await api.put(`/api/posts/${encodeURIComponent(id)}`, payload)
      : await api.post('/api/posts', payload);
    patchPost(data.post);
    await Promise.all([refreshHead(), loadTags()]);
    return data.post;
  }

  async function removePost(id) {
    await api.del(`/api/posts/${encodeURIComponent(id)}`);
    details.value.delete(id);
    await Promise.all([refreshHead(), loadTags(), loadList({ reset: true })]);
  }

  async function setPinned(id, value) {
    const data = await api.post(`/api/posts/${encodeURIComponent(id)}/pin`, { pinned: value });
    await refreshHead();
    await loadList({ reset: true });
    return data;
  }

  async function saveOrder(ids) {
    const data = await api.put('/api/order', { ids });
    await loadList({ reset: true });
    return data.items;
  }

  async function uploadImage(file) {
    if (file.size > limits.value.maxImageBytes) {
      throw new Error(`单图不得超过 ${(limits.value.maxImageBytes / 1024 / 1024).toFixed(0)}MB`);
    }
    return api.upload('/api/media', file);
  }

  async function loadTags() {
    try {
      const data = await api.get('/api/tags?limit=200');
      tags.value = data.items;
    } catch (err) {
      // 话题取不到只影响导轨，不该连带打断首屏其余加载
      ui.notify(describeError(err), 'error');
    }
  }

  async function refreshHead() {
    try {
      const data = await api.get('/api/bootstrap');
      stats.value = data.stats;
      limits.value = data.limits;
    } catch {
      /* 首屏统计失败不阻断浏览 */
    }
  }

  async function bootstrap() {
    await Promise.all([refreshHead(), loadTags()]);
  }

  function setFilter({ tag: nextTag, q: nextQuery, rating: nextRating } = {}) {
    if (nextTag !== undefined) tag.value = nextTag;
    if (nextQuery !== undefined) query.value = nextQuery;
    if (nextRating !== undefined) rating.value = nextRating;
    return loadList({ reset: true });
  }

  return {
    items,
    total,
    page,
    hasMore,
    loading,
    listError,
    tag,
    query,
    rating,
    tags,
    stats,
    limits,
    details,
    pinnedItem,
    loadList,
    openPost,
    patchPost,
    savePost,
    removePost,
    setPinned,
    saveOrder,
    uploadImage,
    loadTags,
    bootstrap,
    setFilter,
    PAGE_SIZE,
  };
});
