import crypto from 'node:crypto';
import { store } from './jsonStore.js';
import { sanitizeRichText, sanitizeAnnotations, stripHtml } from '../security/sanitize.js';
import { vectorIndex } from '../search/vectorIndex.js';
import { media } from '../security/media.js';

const MAX_TAGS = 20;
const MAX_SOURCES = 20;
/** 结论判定四级：措辞为本站自定义，分级思路参照核查类站点通行做法 */
export const RATINGS = ['不实', '误导', '部分属实', '存疑'];

const nowIso = () => new Date().toISOString();
const newId = (prefix) => `${prefix}${Date.now().toString(36)}${crypto.randomBytes(3).toString('hex')}`;

function normalizeTags(tags) {
  if (!Array.isArray(tags)) return [];
  const seen = new Set();
  const out = [];
  for (const raw of tags) {
    const tag = String(raw ?? '').trim().replace(/\s+/g, ' ').slice(0, 24);
    if (!tag || seen.has(tag)) continue;
    seen.add(tag);
    out.push(tag);
    if (out.length >= MAX_TAGS) break;
  }
  return out;
}

function normalizeSources(sources) {
  if (!Array.isArray(sources)) return [];
  return sources.slice(0, MAX_SOURCES).map((s) => {
    const url = String(s?.url ?? '').trim();
    if (url && !/^(https?:\/\/|\/api\/media\/)/i.test(url)) {
      throw Object.assign(new Error('材料源链接仅支持 http(s) 或站内媒体'), { status: 400 });
    }
    return {
      id: String(s?.id || newId('s')),
      title: String(s?.title ?? '').trim().slice(0, 120),
      url,
      mediaId: String(s?.mediaId ?? '').trim(),
      org: String(s?.org ?? '').trim().slice(0, 60),
      collectedAt: String(s?.collectedAt ?? '').trim().slice(0, 32),
      note: String(s?.note ?? '').trim().slice(0, 300),
    };
  });
}

/** 谣言出处存证：来源平台、原始链接、发现时刻 */
function normalizeSource(source = {}) {
  const url = String(source?.url ?? '').trim();
  if (url && !/^https?:\/\//i.test(url)) {
    throw Object.assign(new Error('谣言原始链接仅支持 http(s)'), { status: 400 });
  }
  return {
    platform: String(source?.platform ?? '').trim().slice(0, 40),
    url,
    seenAt: String(source?.seenAt ?? '').trim().slice(0, 32),
  };
}

function normalizeMeta(meta = {}, fallback = {}) {
  return {
    editor: String(meta.editor ?? fallback.editor ?? '').trim().slice(0, 40),
    publishedAt: String(meta.publishedAt ?? fallback.publishedAt ?? nowIso()),
    reviewAt: String(meta.reviewAt ?? fallback.reviewAt ?? '').trim().slice(0, 32),
    scope: String(meta.scope ?? fallback.scope ?? '').trim().slice(0, 60),
    level: ['高', '中', '低'].includes(meta.level) ? meta.level : fallback.level || '中',
  };
}

const midPattern = /data-mid="([^"]+)"/g;
/** 一条档案"用到"的图片：正文 data-mid、材料源附图、图上批注的键，三处都算引用 */
const referencedMedia = (post) => {
  const ids = new Set();
  for (const html of [post.rumor?.html, post.verdict?.html]) {
    for (const match of String(html || '').matchAll(midPattern)) ids.add(match[1]);
  }
  for (const source of post.sources || []) if (source.mediaId) ids.add(source.mediaId);
  for (const mid of Object.keys(post.annotations || {})) ids.add(mid);
  return ids;
};

/** 删除候选图片中不再被任何在档档案引用的部分：文件与索引一起清，磁盘才不会只增不减 */
function reclaimMedia(candidates) {
  const inUse = new Set();
  for (const post of store.read('posts').items) {
    for (const mid of referencedMedia(post)) inUse.add(mid);
  }
  for (const mid of candidates) if (!inUse.has(mid)) media.remove(mid);
}

function toDoc(post) {
  return {
    id: post.id,
    title: post.title,
    tags: post.tags,
    rumorText: stripHtml(post.rumor?.html).slice(0, 4000),
    verdictText: `${post.verdict?.rating || ''} ${stripHtml(post.verdict?.html)}`.slice(0, 4000),
  };
}

/** 索引跟着数据代次走：本进程写入与外部换文件（reseed、恢复备份、手工编辑）都会推进代次。
 *  只在本进程写入时标脏是不够的——外部换掉 posts.json 后，索引里留着旧 id，
 *  搜索结果会一条都对不上（列表正常，因为列表直接读盘）。 */
let indexedGeneration = -1;

export const posts = {
  all() {
    return store.read('posts').items;
  },
  sorted(items = this.all()) {
    return [...items].sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : b.pinned ? 1 : 0;
      return a.order - b.order;
    });
  },
  index() {
    const generation = store.generation('posts');
    if (generation !== indexedGeneration) {
      vectorIndex.build(this.all().map(toDoc));
      indexedGeneration = generation;
    }
    return vectorIndex;
  },
  summary(post, { withCover = true } = {}) {
    const excerpt = stripHtml(post.rumor?.html).slice(0, 180);
    const firstMid = [...String(post.rumor?.html || '').matchAll(midPattern)][0]?.[1];
    return {
      id: post.id,
      title: post.title,
      tags: post.tags,
      excerpt,
      pinned: !!post.pinned,
      order: post.order,
      level: post.meta?.level || '中',
      rating: post.verdict?.rating || '',
      sourcePlatform: post.rumor?.source?.platform || '',
      updatedAt: post.updatedAt,
      publishedAt: post.meta?.publishedAt,
      reviewAt: post.meta?.reviewAt || '',
      editor: post.meta?.editor || '',
      imageCount: [...String(post.rumor?.html || '').matchAll(/<img/g)].length,
      sourceCount: (post.sources || []).length,
      cover: withCover && firstMid ? media.signedUrl(firstMid) : '',
      charCount: {
        rumor: stripHtml(post.rumor?.html).length,
        verdict: stripHtml(post.verdict?.html).length,
      },
    };
  },
  list({ page = 1, size = 12, tag = '', q = '', rating = '' } = {}) {
    let items = this.sorted();
    if (tag) items = items.filter((p) => (p.tags || []).includes(tag));
    if (rating) items = items.filter((p) => (p.verdict?.rating || '') === rating);
    if (q) {
      const hits = new Map(this.index().search(q, 200).map((h) => [h.id, h.score]));
      if (hits.size) {
        items = items
          .filter((p) => hits.has(p.id))
          .sort((a, b) => {
            if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
            return hits.get(b.id) - hits.get(a.id);
          });
      } else {
        const needle = String(q).toLowerCase();
        items = items.filter((p) => `${p.title} ${(p.tags || []).join(' ')}`.toLowerCase().includes(needle));
      }
    }
    const total = items.length;
    const start = (page - 1) * size;
    return {
      total,
      page,
      size,
      hasMore: start + size < total,
      items: items.slice(start, start + size).map((p) => this.summary(p)),
    };
  },
  get(id) {
    const post = this.all().find((p) => p.id === id);
    if (!post) return null;
    // 正文里的图片一律换成短时效签名直链
    const signHtmlSrc = (html) =>
      String(html || '').replace(
        // 兼容旧数据里已带 query 的 src：一并换成新鲜签名，等于自愈
        /src="\/api\/media\/([A-Za-z0-9]+)(?:\?[^"]*)?"/g,
        (_all, mediaId) => `src="${media.signedUrl(mediaId)}"`
      );
    return {
      ...post,
      rumor: { ...post.rumor, html: signHtmlSrc(post.rumor?.html) },
      verdict: { ...post.verdict, html: signHtmlSrc(post.verdict?.html) },
      media: [...referencedMedia(post)]
        .map((mid) => {
          const record = media.get(mid);
          return record ? { id: mid, alt: record.alt, type: record.type, bytes: record.bytes } : null;
        })
        .filter(Boolean)
        .map((record) => ({ ...record, url: media.signedUrl(record.id) })),
    };
  },
  validate(input) {
    const title = String(input?.title ?? '').trim();
    if (!title) throw Object.assign(new Error('标题不可为空'), { status: 400 });
    if (title.length > 120) throw Object.assign(new Error('标题不得超过 120 字'), { status: 400 });
    if (!stripHtml(input?.rumor?.html)) throw Object.assign(new Error('谣言案例正文不可为空'), { status: 400 });
    if (!stripHtml(input?.verdict?.html)) throw Object.assign(new Error('辟谣内容不可为空'), { status: 400 });
    return title;
  },
  create(input, user) {
    this.validate(input);
    const timestamp = nowIso();
    const state = store.read('posts');
    const minOrder = state.items.length ? Math.min(...state.items.map((p) => p.order)) : 1;
    const post = buildPost(input, {
      id: newId('p'),
      order: minOrder - 1,
      author: user?.displayName || user?.username || '匿名',
      createdAt: timestamp,
    });
    store.mutate('posts', (next) => {
      next.items.push(post);
      return next;
    });
    this.syncTags();
    return post;
  },
  update(id, input, user) {
    this.validate(input);
    let updated = null;
    let previous = null;
    store.mutate('posts', (state) => {
      const index = state.items.findIndex((p) => p.id === id);
      if (index < 0) throw Object.assign(new Error('档案不存在'), { status: 404 });
      previous = state.items[index];
      updated = buildPost(input, {
        id,
        order: previous.order,
        pinned: previous.pinned,
        author: previous.author,
        createdAt: previous.createdAt,
        reviser: user?.displayName || user?.username || '匿名',
      });
      state.items[index] = updated;
      return state;
    });
    // 修订中被撤下的图片即刻回收（仍被任何在档档案引用的会被留下）
    reclaimMedia(referencedMedia(previous));
    this.syncTags();
    return updated;
  },
  remove(id) {
    let removed = null;
    store.mutate('posts', (state) => {
      const index = state.items.findIndex((p) => p.id === id);
      if (index < 0) throw Object.assign(new Error('档案不存在'), { status: 404 });
      [removed] = state.items.splice(index, 1);
      return state;
    });
    reclaimMedia(referencedMedia(removed));
    this.syncTags();
    return removed;
  },
  /** 置顶唯一：新置顶自动解除原置顶 */
  setPinned(id, value) {
    let target = null;
    let released = null;
    store.mutate('posts', (state) => {
      const next = Boolean(value);
      for (const post of state.items) {
        if (post.id === id) {
          post.pinned = next;
          post.updatedAt = nowIso();
          target = post.title;
        } else if (post.pinned && next) {
          post.pinned = false;
          released = post.title;
        }
      }
      if (!target) throw Object.assign(new Error('档案不存在'), { status: 404 });
      return state;
    });
    return { pinned: target ? Boolean(value) : false, title: target, released };
  },
  setOrder(ids) {
    if (!Array.isArray(ids) || !ids.length) throw Object.assign(new Error('排序列表为空'), { status: 400 });
    const known = new Set(this.all().map((p) => p.id));
    for (const id of ids) if (!known.has(id)) throw Object.assign(new Error(`未知档案 ${id}`), { status: 400 });
    store.mutate('posts', (state) => {
      ids.forEach((id, position) => {
        const post = state.items.find((p) => p.id === id);
        if (post) post.order = position;
      });
      // 未出现在列表中的档案顺延排在其后，避免被静默丢失
      let tail = ids.length;
      for (const post of state.items) if (!ids.includes(post.id)) post.order = (tail += 1);
      return state;
    });
    return this.sorted().map((p) => ({ id: p.id, title: p.title, order: p.order, pinned: p.pinned }));
  },
  syncTags() {
    const counts = new Map();
    for (const post of this.all()) {
      for (const tag of post.tags || []) counts.set(tag, (counts.get(tag) || 0) + 1);
    }
    const items = [...counts.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'zh-Hans-CN'));
    store.write('tags', { version: 1, items });
    return items;
  },
  tagList(query = '', limit = 40) {
    const tags = store.read('tags').items;
    if (!query) return tags.slice(0, limit);
    const scored = this.index().suggestTags(query, tags, limit);
    return scored.length ? scored : tags.filter((t) => t.name.includes(query)).slice(0, limit);
  },
  stats() {
    const items = this.all();
    return {
      total: items.length,
      tagged: new Set(items.flatMap((p) => p.tags || [])).size,
      pinned: items.filter((p) => p.pinned).length,
      sources: items.reduce((sum, p) => sum + (p.sources || []).length, 0),
      lastUpdated: items.reduce((max, p) => (p.updatedAt > max ? p.updatedAt : max), ''),
    };
  },
};

function buildPost(input, base) {
  const annotations = {};
  for (const [mid, list] of Object.entries(input?.annotations || {})) {
    const clean = sanitizeAnnotations(list);
    if (clean.length) annotations[String(mid).slice(0, 40)] = clean;
  }
  return {
    id: base.id,
    title: String(input.title).trim(),
    tags: normalizeTags(input.tags),
    rumor: {
      html: sanitizeRichText(input.rumor?.html),
      source: normalizeSource(input.rumor?.source),
    },
    verdict: {
      html: sanitizeRichText(input.verdict?.html),
      rating: RATINGS.includes(input.verdict?.rating) ? input.verdict.rating : '',
    },
    sources: normalizeSources(input.sources),
    annotations,
    meta: normalizeMeta(input.meta, { level: input.meta?.level }),
    pinned: Boolean(base.pinned),
    order: Number.isFinite(base.order) ? base.order : 0,
    author: base.author,
    reviser: base.reviser || '',
    createdAt: base.createdAt,
    updatedAt: nowIso(),
  };
}
