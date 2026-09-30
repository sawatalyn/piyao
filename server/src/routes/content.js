import { Router } from 'express';
import { posts, RATINGS } from '../store/posts.js';
import { revisions } from '../store/revisions.js';
import { menu } from '../store/menu.js';
import { config } from '../config.js';
import { requireAuth } from '../security/middleware.js';
import { audit } from '../security/audit.js';

export const contentRouter = Router();

const int = (value, fallback, min, max) => {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, min), max);
};

contentRouter.get('/posts', (req, res) => {
  const page = int(req.query.page, 1, 1, 500);
  const size = int(req.query.size, 12, 1, 48);
  // 深翻页对游客关闭：批量抓取成本高于正常浏览需求
  if (page > 20 && !req.user) {
    return res.status(403).json({ error: 'deep-page-requires-session', message: '继续翻页需登录' });
  }
  return res.json(
    posts.list({
      page,
      size,
      tag: String(req.query.tag || ''),
      q: String(req.query.q || ''),
      rating: RATINGS.includes(String(req.query.rating || '')) ? String(req.query.rating) : '',
    })
  );
});

contentRouter.get('/posts/:id', (req, res) => {
  const post = posts.get(req.params.id);
  if (!post) return res.status(404).json({ error: 'not-found', message: '档案不存在或已被移除' });
  return res.json({ post });
});

contentRouter.post('/posts', requireAuth, (req, res) => {
  const post = posts.create(req.body, req.user);
  res.status(201).json({ post: { ...post, media: [] } });
});

contentRouter.put('/posts/:id', requireAuth, (req, res) => {
  const post = posts.update(req.params.id, req.body, req.user);
  res.json({ post: { ...post, media: [] } });
});

contentRouter.delete('/posts/:id', requireAuth, (req, res) => {
  const removed = posts.remove(req.params.id);
  audit('post-delete', { id: removed.id, title: removed.title }, req);
  res.json({ ok: true, id: removed.id });
});

contentRouter.post('/posts/:id/pin', requireAuth, (req, res) => {
  const result = posts.setPinned(req.params.id, req.body?.pinned !== false);
  audit('post-pin', { id: req.params.id, pinned: result.pinned, released: result.released || '' }, req);
  res.json({ ...result, list: posts.sorted().map((p) => posts.summary(p, { withCover: false })) });
});

contentRouter.put('/order', requireAuth, (req, res) => {
  res.json({ items: posts.setOrder(req.body?.ids) });
});

contentRouter.get('/search', (req, res) => {
  const q = String(req.query.q || '').slice(0, 120);
  const hits = posts.index().search(q, int(req.query.limit, 20, 1, 60));
  const byId = new Map(posts.all().map((p) => [p.id, p]));
  res.json({
    query: q,
    items: hits
      .map((hit) => {
        const post = byId.get(hit.id);
        return post ? { ...posts.summary(post, { withCover: false }), score: Number(hit.score.toFixed(4)) } : null;
      })
      .filter(Boolean),
  });
});

contentRouter.get('/tags', (req, res) => {
  res.json({ items: posts.tagList(String(req.query.q || ''), int(req.query.limit, 60, 1, 200)) });
});

contentRouter.get('/menu', (_req, res) => {
  res.json({ items: menu.get() });
});

contentRouter.put('/menu', requireAuth, (req, res) => {
  const known = Array.isArray(req.body?.known) ? req.body.known.map(String) : [];
  res.json({ items: menu.save(req.body?.items, known) });
});

/* —— 修订档案：版本清单与两版比对（与维基百科的"历史"同一公开口径） —— */

contentRouter.get('/posts/:id/revisions', (req, res) => {
  const items = revisions.list(req.params.id);
  if (!items.length) return res.status(404).json({ error: 'no-revisions', message: '该档案没有版本记录' });
  const current = posts.all().find((p) => p.id === req.params.id);
  const newest = items[items.length - 1];
  res.json({
    post: {
      id: req.params.id,
      title: current?.title || newest.title,
      exists: Boolean(current),
      updatedAt: current?.updatedAt || newest.at,
    },
    keep: config.revisionKeep,
    items,
    pair: { from: (items.length > 1 ? items[items.length - 2] : items[0]).id, to: newest.id },
  });
});

contentRouter.get('/posts/:id/revisions/diff', (req, res) => {
  const pair = revisions.headersWithSnapshot(req.params.id, String(req.query.from || ''), String(req.query.to || ''));
  if (!pair) return res.status(404).json({ error: 'no-revision', message: '版本不存在或不属于该档案' });
  return res.json(pair);
});

contentRouter.get('/bootstrap', (_req, res) => {
  res.json({
    stats: posts.stats(),
    menu: menu.get(),
    limits: { maxImageBytes: config.maxImageBytes, maxTags: 20, maxSources: 20 },
    annoColors: ['seal', 'gold', 'indigo', 'ink'],
    ratings: RATINGS,
    serverTime: new Date().toISOString(),
  });
});
