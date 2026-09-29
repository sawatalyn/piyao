import { computed, ref } from 'vue';
import { defineStore } from 'pinia';
import { api, describeError } from '../api/client.js';
import { DEFAULT_MENU, MODULES, moduleById } from '../modules/registry.js';
import { useAuthStore } from './auth.js';
import { useUiStore } from './ui.js';

export const useMenuStore = defineStore('menu', () => {
  const auth = useAuthStore();
  const ui = useUiStore();
  const raw = ref([]);
  const loading = ref(false);
  const saving = ref(false);

  /** 注册表 ∩ 菜单配置：登录门槛由 auth 决定，可见性由菜单编辑决定 */
  const resolved = computed(() => {
    const stored = raw.value.filter((entry) => moduleById(entry.moduleId));
    const known = new Set(stored.map((entry) => entry.moduleId));
    // 注册表里有、菜单文件里还没有的模块补到末尾：新增功能不必等菜单重新保存一次才出现
    const merged = [
      ...stored,
      ...DEFAULT_MENU.filter((entry) => !known.has(entry.moduleId)).map((entry, i) => ({ ...entry, order: 1000 + i })),
    ];
    return [...merged]
      .sort((a, b) => a.order - b.order)
      .map((entry) => {
        const module = moduleById(entry.moduleId);
        if (!module) return null;
        return {
          ...module,
          moduleId: module.id,
          label: entry.label || module.title,
          visible: entry.visible !== false,
          locked: module.requiresAuth && !auth.isAuthed,
        };
      })
      .filter(Boolean);
  });

  const indexModules = computed(() => resolved.value.filter((m) => m.inIndex && m.visible));
  const marginModules = computed(() => resolved.value.filter((m) => m.inMargin && m.visible));

  const editorRows = computed(() => {
    const known = new Set(resolved.value.map((m) => m.moduleId));
    const rows = resolved.value.map((m, position) => ({
      moduleId: m.moduleId,
      label: m.label,
      visible: m.visible,
      order: position,
      requiresAuth: m.requiresAuth,
      summary: m.summary,
      subtitle: m.subtitle,
      route: m.route,
    }));
    for (const module of MODULES) {
      if (!known.has(module.id)) {
        rows.push({
          moduleId: module.id,
          label: module.title,
          visible: true,
          order: rows.length,
          requiresAuth: module.requiresAuth,
          summary: module.summary,
          subtitle: module.subtitle,
          route: module.route,
        });
      }
    }
    return rows;
  });

  async function load() {
    loading.value = true;
    try {
      const data = await api.get('/api/menu');
      raw.value = data.items;
    } catch (err) {
      ui.notify(describeError(err), 'error');
    } finally {
      loading.value = false;
    }
  }

  async function save(items) {
    saving.value = true;
    try {
      const data = await api.put('/api/menu', {
        items: items.map((item, order) => ({ ...item, order })),
        known: MODULES.map((module) => module.id),
      });
      raw.value = data.items;
      ui.notify('菜单已更新，立即生效', 'commit');
      return true;
    } catch (err) {
      ui.notify(describeError(err), 'error');
      return false;
    } finally {
      saving.value = false;
    }
  }

  function canOpen(moduleId) {
    const module = moduleById(moduleId);
    if (!module) return false;
    return !module.requiresAuth || auth.isAuthed;
  }

  return { raw, loading, saving, resolved, indexModules, marginModules, editorRows, load, save, canOpen };
});
