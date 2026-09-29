import { computed, ref } from 'vue';
import { defineStore } from 'pinia';
import { api, describeError, setCsrf } from '../api/client.js';
import { useUiStore } from './ui.js';

export const useAuthStore = defineStore('auth', () => {
  const ui = useUiStore();
  const user = ref(null);
  const ready = ref(false);
  const busy = ref(false);
  const isAuthed = computed(() => Boolean(user.value));

  async function fetchMe() {
    try {
      const data = await api.get('/api/auth/me');
      user.value = data.user;
      setCsrf(data.csrfToken);
    } catch (err) {
      user.value = null;
      ui.notify(describeError(err), 'error');
    } finally {
      ready.value = true;
    }
  }

  async function login({ username, password, trap }) {
    busy.value = true;
    try {
      const data = await api.post('/api/auth/login', { username, password, company_website: trap || '' });
      user.value = data.user;
      setCsrf(data.csrfToken);
      ui.notify(`已登录：${data.user.displayName || data.user.username}`, 'commit');
      return true;
    } catch (err) {
      ui.notify(describeError(err), 'error');
      return false;
    } finally {
      busy.value = false;
    }
  }

  async function logout() {
    try {
      await api.post('/api/auth/logout');
    } finally {
      user.value = null;
      setCsrf('');
      ui.notify('已退出登录，回到游客浏览态');
    }
  }

  return { user, ready, busy, isAuthed, fetchMe, login, logout };
});
