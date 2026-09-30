import crypto from 'node:crypto';
import { diffWords } from 'diff';
import { config } from '../config.js';
import { store } from './jsonStore.js';
import { stripHtml } from '../security/sanitize.js';

/**
 * 档案版本化：每次写入留一份完整快照，配合逐字段与逐词的比对视图。
 * 两条硬边界：
 *  1) 快照存的是**入库原样**的正文（未签名的 /api/media 路径），绝不把短时效签名写进历史；
 *  2) 每档只保留最近 config.revisionKeep 版——这是核查台账，不是备份盘，不能无限膨胀。
 */

const newId = () => `r${Date.now().toString(36)}${crypto.randomBytes(3).toString('hex')}`;

const plainText = (html) => String(stripHtml(html) || '').replace(/\s+/g, ' ').trim();

/** 全站台账的记忆化槽：台账没动过（数据代次未变）就不重算体积 */
let ledgerCache = { generation: -1, sized: [], posts: [], bytes: 0, keep: 30 };

/**
 * 词级比对直接用 jsdiff（BSD-3-Clause、零依赖）：它对 CJK 按字切、对拉丁按词切，
 * 自己再写一遍 LCS 属于重复造轮子。maxEditLength 是它自带的熔断——两版差得太远时
 * 返回 undefined，我们退化为整段呈现，而不是让请求卡在这里。
 */
const MAX_EDIT_LENGTH = 900;

const pushMerged = (list, segment) => {
  const last = list[list.length - 1];
  if (last && last.op === segment.op) last.text += segment.text;
  else list.push(segment);
};

export function diffSegments(before, after) {
  const from = String(before ?? '');
  const to = String(after ?? '');
  if (!from && !to) return { coarse: false, segments: [] };
  const parts = diffWords(from, to, { maxEditLength: MAX_EDIT_LENGTH });
  if (!parts) {
    return {
      coarse: true,
      segments: [
        ...(from ? [{ op: 'del', text: from }] : []),
        ...(to ? [{ op: 'add', text: to }] : []),
      ],
    };
  }
  const segments = [];
  for (const part of parts) {
    if (!part.value) continue;
    pushMerged(segments, { op: part.added ? 'add' : part.removed ? 'del' : 'eq', text: part.value });
  }
  return { coarse: false, segments };
}

const SOURCE_LABEL = (s) => [s.title || '（无名）', s.org, s.url, s.collectedAt, s.note].filter(Boolean).join(' ｜ ');

/** 参与比对的字段清单：新增可编辑字段时要一并登记，否则版本视图会漏报差异 */
const FIELDS = [
  { key: 'title', label: '标题', get: (p) => String(p.title || '') },
  { key: 'tags', label: '话题标签', get: (p) => (p.tags || []).join('、') },
  { key: 'rumorSource', label: '谣言出处', get: (p) => [p.rumor?.source?.platform, p.rumor?.source?.url, p.rumor?.source?.seenAt].filter(Boolean).join(' ｜ ') },
  { key: 'rumor', label: '谣言案例正文', get: (p) => plainText(p.rumor?.html), wordwise: true },
  { key: 'rating', label: '结论判定', get: (p) => String(p.verdict?.rating || '') },
  { key: 'verdict', label: '辟谣正文', get: (p) => plainText(p.verdict?.html), wordwise: true },
  { key: 'sources', label: '材料源', get: (p) => (p.sources || []).map(SOURCE_LABEL).join('\n') },
  { key: 'annotations', label: '图上批注', get: (p) => Object.keys(p.annotations || {}).join('、') },
  { key: 'editor', label: '复核者', get: (p) => String(p.meta?.editor || '') },
  { key: 'publishedAt', label: '首发日期', get: (p) => String(p.meta?.publishedAt || '') },
  { key: 'reviewAt', label: '复核期限', get: (p) => String(p.meta?.reviewAt || '') },
  { key: 'scope', label: '核查范围', get: (p) => String(p.meta?.scope || '') },
  { key: 'level', label: '危害等级', get: (p) => String(p.meta?.level || '') },
  { key: 'pinned', label: '置顶', get: (p) => (p.pinned ? '是' : '否') },
];

export function comparePosts(before, after) {
  const fields = [];
  for (const field of FIELDS) {
    const from = before ? String(field.get(before) ?? '') : '';
    const to = after ? String(field.get(after) ?? '') : '';
    if (from === to) continue;
    const entry = { key: field.key, label: field.label, before: from, after: to };
    if (field.wordwise) {
      const { coarse, segments } = diffSegments(from, to);
      entry.coarse = coarse;
      entry.segments = segments;
    }
    fields.push(entry);
  }
  return fields;
}

const headerOf = (entry, version) => ({
  id: entry.id,
  version,
  kind: entry.kind,
  at: entry.at,
  by: entry.by,
  title: entry.snapshot?.title || '',
  charCount: {
    rumor: plainText(entry.snapshot?.rumor?.html).length,
    verdict: plainText(entry.snapshot?.verdict?.html).length,
  },
});

export const revisions = {
  /** 写入后调用：kind = create | update。删档不再补记一条——最后一版的快照已经在台账里，
   *  重复存一份只会让 diff 出现"两个一模一样版本"的怪象 */
  record(post, { kind, user }) {
    if (!post?.id) return null;
    const entry = {
      id: newId(),
      postId: post.id,
      kind,
      at: new Date().toISOString(),
      by: user?.displayName || user?.username || '匿名',
      snapshot: structuredClone(post),
    };
    store.mutate('revisions', (state) => {
      state.items.push(entry);
      const keep = Math.max(1, Number(config.revisionKeep) || 30);
      const mine = state.items.filter((row) => row.postId === post.id);
      if (mine.length > keep) {
        const drop = new Set(mine.slice(0, mine.length - keep).map((row) => row.id));
        state.items = state.items.filter((row) => !drop.has(row.id));
      }
      return state;
    });
    return entry;
  },
  forPost(postId) {
    return store.read('revisions').items.filter((row) => row.postId === postId);
  },
  /** 表头列表（不含快照正文），按版本先后正序 */
  list(postId) {
    return this.forPost(postId).map((entry, position) => headerOf(entry, position + 1));
  },
  /** 两版比对：双方表头 + 逐字段差异；任一 id 不属于该档案则返回 null */
  headersWithSnapshot(postId, fromId, toId) {
    const rows = this.forPost(postId);
    const indexById = new Map(rows.map((row, position) => [row.id, { row, version: position + 1 }]));
    const from = indexById.get(fromId);
    const to = indexById.get(toId);
    if (!from || !to) return null;
    return {
      from: headerOf(from.row, from.version),
      to: headerOf(to.row, to.version),
      fields: comparePosts(from.row.snapshot, to.row.snapshot),
    };
  },
  /**
   * 全站台账：每档的版本数与占用体积、最新一版的表头，外加**按档案/类型筛选后的行**。
   * 不含快照正文（清单接口一律不下发正文，正文只在比对时按需拉两版）。
   * 体积要逐条 JSON.stringify 才算得出来，所以按数据代次记忆化：台账没动过就不重算。
   */
  ledger({ limit = 200, postId = '', kind = '' } = {}) {
    const generation = store.generation('revisions');
    if (ledgerCache.generation !== generation) {
      const all = store.read('revisions').items;
      const counters = new Map();
      const sized = all.map((entry) => {
        const version = (counters.get(entry.postId) || 0) + 1;
        counters.set(entry.postId, version);
        return { entry, version, bytes: Buffer.byteLength(JSON.stringify(entry.snapshot ?? null)) };
      });
      const perPost = new Map();
      for (const row of sized) {
        const bucket = perPost.get(row.entry.postId) || { postId: row.entry.postId, count: 0, bytes: 0, latestAt: '', title: '' };
        bucket.count += 1;
        bucket.bytes += row.bytes;
        // items 是按写入顺序追加的，最后一条即最新一版
        bucket.latestAt = row.entry.at;
        bucket.title = row.entry.snapshot?.title || bucket.title;
        perPost.set(row.entry.postId, bucket);
      }
      ledgerCache = {
        generation,
        sized,
        posts: [...perPost.values()],
        bytes: sized.reduce((sum, row) => sum + row.bytes, 0),
        keep: Math.max(1, Number(config.revisionKeep) || 30),
      };
    }
    const { sized, posts, bytes, keep } = ledgerCache;
    const matched = sized.filter(
      ({ entry }) => (!postId || entry.postId === postId) && (!kind || entry.kind === kind)
    );
    const rows = matched
      .slice()
      .sort((a, b) => String(b.entry.at).localeCompare(String(a.entry.at)))
      .slice(0, Math.max(1, Math.min(500, Number(limit) || 200)))
      .map(({ entry, version, bytes: size }) => ({ ...headerOf(entry, version), postId: entry.postId, bytes: size }));
    return {
      items: rows,
      posts: posts.slice().sort((a, b) => String(b.latestAt).localeCompare(String(a.latestAt))),
      totals: { entries: sized.length, matched: matched.length, posts: posts.length, bytes, keep },
      truncated: matched.length > rows.length,
    };
  },
};
