import MiniSearch from 'minisearch';

const CJK = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\u3040-\u30ff]/u;
const LATIN = /[a-z0-9]+/gi;

/**
 * 中文无空格分词：单字 + 相邻二字组；西文按词。
 * 二字组让"路由器辐射"这类查询能命中长句中的连续片段。
 */
export function tokenize(text) {
  const out = [];
  const lower = String(text || '').toLowerCase();
  for (const match of lower.matchAll(LATIN)) out.push(match[0]);
  const chars = [...lower].filter((ch) => CJK.test(ch));
  out.push(...chars);
  for (let i = 0; i < chars.length - 1; i += 1) out.push(chars[i] + chars[i + 1]);
  return out;
}

const FIELDS = ['title', 'tags', 'rumorText', 'verdictText'];
const BOOST = { title: 4, tags: 6, verdictText: 1.4, rumorText: 1 };

const engine = new MiniSearch({
  fields: FIELDS,
  storeFields: [],
  boost: BOOST,
  tokenize,
});

export const vectorIndex = {
  build(docs) {
    engine.removeAll();
    engine.addAll(
      docs.map((doc) => ({
        id: doc.id,
        title: doc.title || '',
        tags: (doc.tags || []).join(' '),
        rumorText: doc.rumorText || '',
        verdictText: doc.verdictText || '',
      }))
    );
    return engine;
  },

  /**
   * 模糊仅用于西文词；中文二字组做 fuzzy 会产生无意义近邻。
   * 结果按 MiniSearch 的 BM25+ 与字段加权分数排序。
   */
  search(query, limit = 20) {
    const q = String(query || '').trim();
    if (!q) return [];
    try {
      return engine
        .search(q, {
          prefix: true,
          fuzzy: (token) => (token.length > 3 && !CJK.test(token) ? 0.2 : false),
          combineWith: 'OR',
        })
        .slice(0, limit)
        .map((hit) => ({ id: String(hit.id), score: hit.score }));
    } catch {
      return [];
    }
  },

  /** 话题 tag 联想：编辑器与话题索引共用 */
  suggestTags(query, tags, limit = 12) {
    const tokens = new Set(tokenize(query));
    if (!tokens.size) return tags.slice(0, limit);
    return tags
      .map((tag) => {
        const own = new Set(tokenize(tag.name));
        let hits = 0;
        for (const token of tokens) if (own.has(token)) hits += 1;
        const exact = tag.name === query ? 8 : 0;
        const contains = tag.name.includes(String(query)) ? 3 : 0;
        return { ...tag, score: hits + exact + contains };
      })
      .filter((tag) => tag.score > 0)
      .sort((a, b) => b.score - a.score || b.count - a.count)
      .slice(0, limit);
  },

  get size() {
    return engine.documentCount;
  },
};
