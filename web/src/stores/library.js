import { computed, ref } from 'vue';
import { defineStore } from 'pinia';
import { api, describeError } from '../api/client.js';
import { useUiStore } from './ui.js';

export const useLibraryStore = defineStore('library', () => {
  const ui = useUiStore();
  const books = ref([]);
  const meta = ref({ dir: '', maxBytes: 0, grantTtlMs: 0 });

  // 阅览要翻页与刷新，令牌得活过整页导航；sessionStorage 随标签页结束即清，与令牌本身的十分钟同量级
  const GRANT_KEY = 'bianwang.library.grant.v1';
  function readGrant() {
    try {
      const saved = JSON.parse(sessionStorage.getItem(GRANT_KEY) || 'null');
      return saved && Date.now() < new Date(saved.expiresAt).getTime() ? saved : null;
    } catch {
      return null;
    }
  }
  function writeGrant(value) {
    try {
      if (value) sessionStorage.setItem(GRANT_KEY, JSON.stringify(value));
      else sessionStorage.removeItem(GRANT_KEY);
    } catch {
      /* 隐私浏览下禁写：令牌只留在内存里，刷新需重输 */
    }
  }

  const grant = ref(readGrant());
  const unlocking = ref(false);
  const loading = ref(false);
  const keys = ref([]);
  const pending = ref([]);
  const booksFull = ref([]);

  /** 令牌时效由服务端给出，前端只做提示与提前收口 */
  const unlocked = computed(() => Boolean(grant.value && Date.now() < new Date(grant.value.expiresAt).getTime()));

  function downloadUrl(id) {
    if (!unlocked.value) return '';
    const g = grant.value;
    return `/api/library/files/${encodeURIComponent(id)}?k=${g.k}&exp=${g.exp}&sig=${g.sig}`;
  }

  /* —— 在线阅览：与下载共用同一枚短时效令牌，按章节逐页取 —— */
  const reader = ref(null);
  const page = ref(null);
  const reading = ref(false);
  const readError = ref('');

  function tokenQuery() {
    const g = grant.value;
    return `k=${encodeURIComponent(g.k)}&exp=${g.exp}&sig=${encodeURIComponent(g.sig)}`;
  }

  /** 令牌过期/被吊销时收回解锁态，让界面重新索要口令，而不是反复 403 */
  function dropGrantIfStale(err) {
    if (err?.status === 403 && ['grant-required', 'out-of-scope'].includes(err.code)) {
      grant.value = null;
      writeGrant(null);
      reader.value = null;
      page.value = null;
      searchResult.value = null;
      searchError.value = '口令已失效，请重新输入后再检索';
    }
  }

  async function openReader(id) {
    reading.value = true;
    readError.value = '';
    try {
      reader.value = await api.get(`/api/library/${encodeURIComponent(id)}/reader?${tokenQuery()}`);
      return reader.value;
    } catch (err) {
      dropGrantIfStale(err);
      readError.value = describeError(err);
      return null;
    } finally {
      reading.value = false;
    }
  }

  async function openPage(id, chapter, part = 1) {
    reading.value = true;
    readError.value = '';
    try {
      page.value = await api.get(
        `/api/library/${encodeURIComponent(id)}/reader/${Number(chapter) || 0}?p=${Number(part) || 1}&${tokenQuery()}`
      );
      return page.value;
    } catch (err) {
      dropGrantIfStale(err);
      readError.value = describeError(err);
      return null;
    } finally {
      reading.value = false;
    }
  }

  async function openWhole(id) {
    reading.value = true;
    readError.value = '';
    try {
      page.value = await api.get(`/api/library/${encodeURIComponent(id)}/reader/all?${tokenQuery()}`);
      return page.value;
    } catch (err) {
      dropGrantIfStale(err);
      readError.value = describeError(err);
      return null;
    } finally {
      reading.value = false;
    }
  }

  function closeReader() {
    reader.value = null;
    page.value = null;
    readError.value = '';
  }

  /* —— 站内检索：口令解锁后才可用，命中项直连到某一章 —— */
  const searchResult = ref(null);
  const searching = ref(false);
  const searchError = ref('');

  async function search(term) {
    const q = String(term || '').trim();
    if (!q) {
      searchResult.value = null;
      searchError.value = '';
      return null;
    }
    if (!unlocked.value) {
      searchError.value = '请先输入口令再检索';
      return null;
    }
    searching.value = true;
    searchError.value = '';
    try {
      searchResult.value = await api.get(`/api/library/search?q=${encodeURIComponent(q)}&${tokenQuery()}`);
      return searchResult.value;
    } catch (err) {
      dropGrantIfStale(err);
      searchResult.value = null;
      searchError.value = describeError(err);
      return null;
    } finally {
      searching.value = false;
    }
  }

  function clearSearch() {
    searchResult.value = null;
    searchError.value = '';
  }

  async function load() {
    loading.value = true;
    try {
      const data = await api.get('/api/library');
      books.value = data.items;
      meta.value = { dir: data.dir, maxBytes: data.maxBytes, grantTtlMs: data.grantTtlMs };
    } catch (err) {
      ui.notify(describeError(err), 'error');
    } finally {
      loading.value = false;
    }
  }

  async function unlock(code) {
    unlocking.value = true;
    try {
      grant.value = await api.post('/api/library/unlock', { code });
      writeGrant(grant.value);
      ui.notify(`口令有效，${Math.round(meta.value.grantTtlMs / 60000)} 分钟内可直接取书`, 'commit');
      return true;
    } catch (err) {
      grant.value = null;
      writeGrant(null);
      ui.notify(describeError(err), 'error');
      return false;
    } finally {
      unlocking.value = false;
    }
  }

  async function loadManaged() {
    const [keyData, pendingData, fullData] = await Promise.all([
      api.get('/api/library/keys'),
      api.get('/api/library/pending'),
      api.get('/api/library/files'),
    ]);
    keys.value = keyData.items;
    pending.value = pendingData.items;
    booksFull.value = fullData.items;
    return { keys: keyData.items, pending: pendingData.items, books: fullData.items };
  }

  async function addKey(payload) {
    await api.post('/api/library/keys', payload);
    await loadManaged();
    ui.notify('口令已签发', 'commit');
  }

  async function patchKey(id, payload) {
    await api.put(`/api/library/keys/${encodeURIComponent(id)}`, payload);
    await loadManaged();
    ui.notify('口令已更新', 'commit');
  }

  async function removeKey(id) {
    await api.del(`/api/library/keys/${encodeURIComponent(id)}`);
    await loadManaged();
    ui.notify('口令已吊销', 'commit');
  }

  async function register(payload) {
    await api.post('/api/library/register', payload);
    await Promise.all([load(), loadManaged()]);
    ui.notify('镜像条目已登记', 'commit');
  }

  async function updateBook(id, payload) {
    await api.put(`/api/library/files/${encodeURIComponent(id)}`, payload);
    await Promise.all([load(), loadManaged()]);
    ui.notify('书目信息已更新', 'commit');
  }

  async function unregister(id) {
    await api.del(`/api/library/files/${encodeURIComponent(id)}`);
    await Promise.all([load(), loadManaged()]);
    ui.notify('已取消登记（磁盘原件保留，由馆员自管）', 'commit');
  }

  return {
    books,
    meta,
    grant,
    unlocked,
    unlocking,
    loading,
    keys,
    pending,
    booksFull,
    reader,
    page,
    reading,
    readError,
    searchResult,
    searching,
    searchError,
    load,
    unlock,
    downloadUrl,
    openReader,
    openPage,
    openWhole,
    closeReader,
    search,
    clearSearch,
    loadManaged,
    addKey,
    patchKey,
    removeKey,
    register,
    updateBook,
    unregister,
  };
});
