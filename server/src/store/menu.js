import { store } from './jsonStore.js';

/** 服务端保存的是「哪些模块可见、以何顺序」，模块本体由前端注册表定义。
 *  id 必须与 web/src/modules/registry.js 一致：对不上的项会被前端丢弃。 */
export const DEFAULT_MENU = [
  { moduleId: 'home', visible: true },
  { moduleId: 'search', visible: true },
  { moduleId: 'tags', visible: true },
  { moduleId: 'resources', visible: true },
  { moduleId: 'library', visible: true },
  { moduleId: 'submit', visible: true },
  { moduleId: 'reorder', visible: true },
  { moduleId: 'menu-editor', visible: true },
  { moduleId: 'users', visible: true },
  { moduleId: 'about', visible: true },
];

export const menu = {
  get() {
    const state = store.read('menu');
    if (!state.items.length) {
      const seeded = DEFAULT_MENU.map((item, position) => ({ ...item, order: position }));
      store.write('menu', { version: 1, items: seeded });
      return seeded;
    }
    // 旧文件里没有的后加模块（资源库、镜像站等）补到末尾：不补就永远进不了菜单，也不会在菜单编辑器里出现
    const missing = DEFAULT_MENU.filter((def) => !state.items.some((item) => item.moduleId === def.moduleId));
    if (!missing.length) return state.items;
    const merged = [
      ...state.items,
      ...missing.map((item, offset) => ({ ...item, order: state.items.length + offset })),
    ];
    store.write('menu', { version: 1, items: merged });
    return merged;
  },
  save(items, knownModuleIds) {
    if (!Array.isArray(items)) throw Object.assign(new Error('菜单格式错误'), { status: 400 });
    const known = new Set(knownModuleIds);
    const cleaned = [];
    for (const raw of items) {
      const moduleId = String(raw?.moduleId ?? '');
      if (!known.has(moduleId)) continue;
      if (cleaned.some((item) => item.moduleId === moduleId)) continue;
      cleaned.push({
        moduleId,
        visible: raw?.visible !== false,
        label: String(raw?.label ?? '').trim().slice(0, 24),
        order: cleaned.length,
      });
    }
    if (!cleaned.length) throw Object.assign(new Error('至少保留一个可见菜单项'), { status: 400 });
    store.write('menu', { version: 1, items: cleaned });
    return cleaned;
  },
};
