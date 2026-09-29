import { store } from './jsonStore.js';

/** 资源分组：与前端侧栏、资源库页共用同一套分类名 */
export const RESOURCE_GROUPS = [
  '官方一手出处',
  '中文区查证载体',
  '访谈与翻译合集',
  '事实核对工具',
  '常见误传题材',
];

const TRUST = ['高', '中', '待核实'];

const newId = () => `r${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

function cleanUrl(value) {
  const url = String(value ?? '').trim().slice(0, 500);
  if (!url) return '';
  // 只允许 http(s) 外链与站内路径，挡掉 javascript: / data:
  if (!/^(https?:\/\/|\/api\/|\/)/i.test(url)) {
    throw Object.assign(new Error('资源链接仅支持 http(s) 或站内路径'), { status: 400 });
  }
  return url;
}

function normalize(input, existing = null) {
  const group = RESOURCE_GROUPS.includes(input?.group) ? input.group : RESOURCE_GROUPS[0];
  const name = String(input?.name ?? '').trim().slice(0, 60);
  if (!name) throw Object.assign(new Error('资源名称不可为空'), { status: 400 });
  return {
    id: existing?.id || newId(),
    name,
    url: cleanUrl(input?.url),
    group,
    note: String(input?.note ?? '').trim().slice(0, 200),
    trust: TRUST.includes(input?.trust) ? input.trust : '待核实',
    visible: input?.visible !== false,
    order: Number.isFinite(Number(input?.order)) ? Number(input.order) : existing?.order ?? 0,
    addedBy: existing?.addedBy || '',
    createdAt: existing?.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

export const resources = {
  all() {
    return [...store.read('resources').items].sort((a, b) => a.order - b.order);
  },
  visible() {
    return this.all().filter((item) => item.visible);
  },
  groups() {
    const buckets = new Map();
    for (const item of this.visible()) {
      if (!buckets.has(item.group)) buckets.set(item.group, []);
      buckets.get(item.group).push(item);
    }
    return RESOURCE_GROUPS.filter((g) => buckets.has(g)).map((g) => ({ group: g, items: buckets.get(g) }));
  },
  get(id) {
    return this.all().find((item) => item.id === id) || null;
  },
  create(input, user) {
    const record = normalize(input);
    record.addedBy = user?.username || 'unknown';
    record.order = this.all().length;
    store.mutate('resources', (state) => {
      state.items.push(record);
      return state;
    });
    return record;
  },
  update(id, input) {
    let updated = null;
    store.mutate('resources', (state) => {
      const index = state.items.findIndex((item) => item.id === id);
      if (index < 0) throw Object.assign(new Error('资源条目不存在'), { status: 404 });
      updated = normalize(input, state.items[index]);
      state.items[index] = updated;
      return state;
    });
    return updated;
  },
  remove(id) {
    let removed = null;
    store.mutate('resources', (state) => {
      const index = state.items.findIndex((item) => item.id === id);
      if (index < 0) throw Object.assign(new Error('资源条目不存在'), { status: 404 });
      [removed] = state.items.splice(index, 1);
      return state;
    });
    return removed;
  },
  seed(items) {
    const current = this.all();
    if (current.length) return current;
    const known = new Set(current.map((item) => item.url));
    const added = [];
    items.forEach((item, order) => {
      if (known.has(item.url)) return;
      const record = normalize({ ...item, order });
      record.addedBy = 'seed';
      added.push(record);
    });
    if (!added.length) return current;
    store.mutate('resources', (state) => {
      state.items = [...state.items, ...added];
      return state;
    });
    return this.all();
  },
};
