import fs from 'node:fs';
import path from 'node:path';
import { Router } from 'express';
import { config } from '../config.js';
import { grants, library, libraryKeys } from '../store/library.js';
import { loadEpub, readerLimits, renderChapter, renderWhole, verifyImageBytes } from '../library/epubRead.js';
import { readZipEntry } from '../library/zipRead.js';
import { bumpAttempt, clearAttempt, waitMs } from '../security/attempts.js';
import { requireAuth } from '../security/middleware.js';
import { audit } from '../security/audit.js';

export const libraryRouter = Router();

const UNLOCK_MAX = 6;
const UNLOCK_LOCK_MS = 3 * 60 * 1000;
const UNLOCK_WINDOW_MS = 15 * 60 * 1000;

/** 公开视图：只给书目信息，不给磁盘文件名与登记者 */
const publicView = (item) => ({
  id: item.id,
  title: item.title,
  author: item.author,
  translator: item.translator,
  group: item.group,
  note: item.note,
  sourceUrl: item.sourceUrl,
  rights: item.rights,
  type: item.type,
  bytes: item.bytes,
  createdAt: item.createdAt,
});

libraryRouter.get('/library', (_req, res) => {
  const items = library.enabled().map(publicView);
  res.json({
    items,
    total: items.length,
    dir: 'server/data/library',
    maxBytes: config.libraryMaxBytes,
    grantTtlMs: config.libraryGrantTtlMs,
  });
});

libraryRouter.post('/library/unlock', (req, res) => {
  const key = `lib:${req.ip}`;
  const wait = waitMs(key);
  if (wait > 0) {
    res.set('Retry-After', String(Math.ceil(wait / 1000)));
    audit('library-unlock-locked', { seconds: Math.ceil(wait / 1000) }, req);
    return res.status(429).json({ error: 'too-many-tries', message: `口令尝试过多，请 ${Math.ceil(wait / 1000)} 秒后再试` });
  }
  const record = libraryKeys.match(req.body?.code);
  if (!record) {
    bumpAttempt(key, { max: UNLOCK_MAX, lockMs: UNLOCK_LOCK_MS, windowMs: UNLOCK_WINDOW_MS });
    audit('library-unlock-denied', {}, req);
    return res.status(401).json({ error: 'bad-key', message: '口令不正确或已停用' });
  }
  clearAttempt(key);
  const grant = grants.issue(record);
  audit('library-unlock-ok', { keyId: record.id, label: record.label }, req);
  return res.json({ ...grant, scope: record.scope, label: record.label });
});

/** 下载：口令令牌 + 范围校验 + 文件名 basename 化，禁缓存 */
libraryRouter.get('/library/files/:id', (req, res) => {
  const key = grants.verify(req.query.k, req.query.exp, req.query.sig);
  if (!key) return res.status(403).json({ error: 'grant-required', message: '口令令牌无效或已过期，请重新输入口令' });
  const item = library.get(req.params.id);
  if (!item || !item.enabled) return res.status(404).json({ error: 'not-found', message: '该书未登记或已下架' });
  if (!libraryKeys.covers(key, item.id)) {
    audit('library-scope-denied', { keyId: key.id, bookId: item.id }, req);
    return res.status(403).json({ error: 'out-of-scope', message: '该口令不含此书' });
  }
  const target = library.pathOf(item);
  if (!target) return res.status(404).json({ error: 'file-missing', message: '镜像文件不在位，请联系馆员补齐' });

  libraryKeys.countDownload(key.id);
  audit('library-download', { bookId: item.id, keyId: key.id, bytes: item.bytes }, req);
  res.setHeader('Content-Type', item.type);
  res.setHeader('Content-Length', String(item.bytes));
  res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(path.basename(target))}`);
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
  fs.createReadStream(target).pipe(res);
});

/* —— 在线阅览：与下载同一口令门控，但只按章节出页 —— */

/** 门控链：令牌有效 → 书在架 → 口令覆盖此书 → 是 EPUB → 文件在位 */
async function readGate(req, res) {
  const key = grants.verify(req.query.k, req.query.exp, req.query.sig);
  if (!key) {
    res.status(403).json({ error: 'grant-required', message: '口令令牌无效或已过期，请重新输入口令' });
    return null;
  }
  const item = library.get(req.params.id);
  if (!item || !item.enabled) {
    res.status(404).json({ error: 'not-found', message: '该书未登记或已下架' });
    return null;
  }
  if (!libraryKeys.covers(key, item.id)) {
    audit('library-scope-denied', { keyId: key.id, bookId: item.id }, req);
    res.status(403).json({ error: 'out-of-scope', message: '该口令不含此书' });
    return null;
  }
  if (item.type !== 'application/epub+zip') {
    res.status(409).json({ error: 'not-epub', message: '仅 EPUB 支持在线阅览，PDF 请下载后本地阅读' });
    return null;
  }
  const file = library.pathOf(item);
  if (!file) {
    res.status(404).json({ error: 'file-missing', message: '镜像文件不在位，请联系馆员补齐' });
    return null;
  }
  res.setHeader('Cache-Control', 'no-store');
  return { key, item, file };
}

/** 正文里的图片要能被浏览器直接取，故把同一枚短时效令牌嵌进 src；站内跳链走 SPA 路由，不带令牌 */
function readerCtx(req, item) {
  const token = ['k', 'exp', 'sig']
    .map((name) => `${name}=${encodeURIComponent(String(req.query[name] ?? ''))}`)
    .join('&');
  return {
    part: req.query.p,
    assetUrl: (name) => `/api/library/${encodeURIComponent(item.id)}/asset?p=${encodeURIComponent(name)}&${token}`,
    pageUrl: (index, fragment) => {
      const url = `/library/${encodeURIComponent(item.id)}/read?c=${index}`;
      return fragment ? `${url}#${encodeURIComponent(fragment)}` : url;
    },
  };
}

const chapterTitle = (chapter) => chapter.title || `第 ${chapter.index + 1} 节`;

libraryRouter.get('/library/:id/reader', async (req, res, next) => {
  const gate = await readGate(req, res);
  if (!gate) return;
  try {
    const book = await loadEpub(gate.file);
    res.json({
      book: publicView(gate.item),
      meta: { title: book.title, language: book.language, entries: book.directoryEntries },
      splitRequired: book.bytes > config.readSplitBytes,
      limits: readerLimits(),
      chapters: book.chapters.map((chapter) => ({ index: chapter.index, title: chapterTitle(chapter) })),
    });
  } catch (err) {
    next(err);
  }
});

/** 全本只对阈值以下的书开放，注册顺序必须排在 /:index 之前 */
libraryRouter.get('/library/:id/reader/all', async (req, res, next) => {
  const gate = await readGate(req, res);
  if (!gate) return;
  try {
    const book = await loadEpub(gate.file);
    const whole = await renderWhole(gate.file, book, readerCtx(req, gate.item));
    audit('library-read-all', { bookId: gate.item.id, bytes: whole.bytes }, req);
    res.json({
      mode: 'whole',
      splitRequired: book.bytes > config.readSplitBytes,
      chapterCount: whole.chapterCount,
      bytes: whole.bytes,
      html: whole.html,
    });
  } catch (err) {
    next(err);
  }
});

libraryRouter.get('/library/:id/reader/:index', async (req, res, next) => {
  const gate = await readGate(req, res);
  if (!gate) return;
  const index = Number(req.params.index);
  if (!Number.isInteger(index) || index < 0) {
    return res.status(400).json({ error: 'bad-index', message: '章节序号无效' });
  }
  try {
    const book = await loadEpub(gate.file);
    if (index >= book.chapters.length) return res.status(404).json({ error: 'no-chapter', message: '没有该章节' });
    const ctx = readerCtx(req, gate.item);
    const page = await renderChapter(gate.file, book, index, ctx);
    const last = book.chapters.length - 1;
    const next = page.part < page.parts ? { c: index, p: page.part + 1 } : index < last ? { c: index + 1, p: 1 } : null;
    const prev = page.part > 1 ? { c: index, p: page.part - 1 } : index > 0 ? { c: index - 1, p: 1 } : null;
    audit('library-read', { bookId: gate.item.id, chapter: index, part: page.part, bytes: page.bytes }, req);
    res.json({
      mode: 'chapter',
      ...page,
      chapterTitle: chapterTitle(book.chapters[index]),
      splitRequired: book.bytes > config.readSplitBytes,
      nav: { next, prev, last },
    });
  } catch (err) {
    next(err);
  }
});

libraryRouter.get('/library/:id/asset', async (req, res, next) => {
  const gate = await readGate(req, res);
  if (!gate) return;
  try {
    const book = await loadEpub(gate.file);
    const name = String(req.query.p ?? '');
    const declared = book.images.get(name);
    if (!declared) return res.status(404).json({ error: 'asset-unknown', message: '书中没有该图片' });
    const buffer = await readZipEntry(gate.file, book.entries.get(name), config.readEntryMaxBytes);
    if (!verifyImageBytes(buffer, declared)) {
      audit('library-asset-mismatch', { bookId: gate.item.id, declared }, req);
      return res.status(415).json({ error: 'asset-mismatch', message: '图片内容与声明类型不符，已拒绝下发' });
    }
    res.setHeader('Content-Type', declared);
    res.setHeader('Content-Length', String(buffer.length));
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    res.send(buffer);
  } catch (err) {
    next(err);
  }
});

/* —— 以下为登录用户管理面 —— */

libraryRouter.get('/library/pending', requireAuth, (_req, res) => {
  res.json({ items: library.pending(), dir: library.dir });
});

/** 馆员视图：含磁盘文件名与校验值，公开列表刻意不返回这些 */
libraryRouter.get('/library/files', requireAuth, (_req, res) => {
  res.json({ items: library.all() });
});

libraryRouter.post('/library/register', requireAuth, async (req, res, next) => {
  try {
    const record = await library.register(req.body || {}, req.user);
    audit('library-register', { id: record.id, title: record.title, bytes: record.bytes }, req);
    res.status(201).json({ book: publicView(record) });
  } catch (err) {
    next(err);
  }
});

libraryRouter.put('/library/files/:id', requireAuth, (req, res) => {
  const record = library.update(req.params.id, req.body || {});
  audit('library-write', { id: record.id, title: record.title }, req);
  res.json({ book: publicView(record) });
});

libraryRouter.delete('/library/files/:id', requireAuth, (req, res) => {
  const removed = library.remove(req.params.id);
  audit('library-unregister', { id: removed.id, title: removed.title, file: removed.file }, req);
  res.json({ ok: true, id: removed.id });
});

/** 口令表仅对登录用户开放，含口令明文（与 CSV 名册同一取舍） */
libraryRouter.get('/library/keys', requireAuth, (_req, res) => {
  res.json({
    items: libraryKeys.all().map((item) => ({ ...item, expiresSoon: item.expiresAt ? item.expiresAt - Date.now() : 0 })),
    books: library.all().map((item) => ({ id: item.id, title: item.title })),
  });
});

libraryRouter.post('/library/keys', requireAuth, (req, res) => {
  const record = libraryKeys.create(req.body || {}, req.user);
  audit('library-key-write', { id: record.id, label: record.label, scope: record.scope }, req);
  res.status(201).json({ key: record });
});

libraryRouter.put('/library/keys/:id', requireAuth, (req, res) => {
  const record = libraryKeys.update(req.params.id, req.body || {});
  audit('library-key-write', { id: record.id, label: record.label, scope: record.scope }, req);
  res.json({ key: record });
});

libraryRouter.delete('/library/keys/:id', requireAuth, (req, res) => {
  const removed = libraryKeys.remove(req.params.id);
  audit('library-key-delete', { id: removed.id, label: removed.label }, req);
  res.json({ ok: true, id: removed.id });
});
