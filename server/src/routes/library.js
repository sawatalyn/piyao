import fs from 'node:fs';
import path from 'node:path';
import { Router } from 'express';
import { config } from '../config.js';
import { grants, library, libraryKeys } from '../store/library.js';
import { loadEpub, readerLimits, renderChapter, renderWhole, verifyImageBytes } from '../library/epubRead.js';
import { loadPdf, pdfLimits, renderPdfChapter, renderPdfWhole } from '../library/pdfRead.js';
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
  // 预览白名单标记：前端据此决定"在线阅览"入口是否出现
  previewable: item.previewable === true,
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

/** 门控链：令牌有效 → 书在架 → 口令覆盖此书 → 在预览白名单内 → 类型受支持 → 文件在位 */
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
  // 预览白名单：可下载不等于可预览，逐本由馆员勾选，默认关
  if (item.previewable !== true) {
    audit('library-preview-denied', { keyId: key.id, bookId: item.id }, req);
    res.status(403).json({ error: 'preview-off', message: '此书未加入预览白名单，仅可下载' });
    return null;
  }
  const kind = item.type === 'application/epub+zip' ? 'epub' : item.type === 'application/pdf' ? 'pdf' : null;
  if (!kind) {
    res.status(409).json({ error: 'type-unsupported', message: '该类型不支持在线阅览' });
    return null;
  }
  const file = library.pathOf(item);
  if (!file) {
    res.status(404).json({ error: 'file-missing', message: '镜像文件不在位，请联系馆员补齐' });
    return null;
  }
  res.setHeader('Cache-Control', 'no-store');
  return { key, item, file, kind };
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
    if (gate.kind === 'pdf') {
      const book = await loadPdf(gate.file);
      res.json({
        book: publicView(gate.item),
        kind: 'pdf',
        meta: { title: gate.item.title, pages: book.pageCount, splitBy: book.hasOutline ? 'outline' : 'pages' },
        splitRequired: book.bytes > config.readSplitBytes,
        limits: pdfLimits(),
        chapters: book.chapters.map((chapter) => ({
          index: chapter.index,
          title: chapterTitle(chapter),
          pages: chapter.to - chapter.from + 1,
        })),
      });
      return;
    }
    const book = await loadEpub(gate.file);
    res.json({
      book: publicView(gate.item),
      kind: 'epub',
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
    if (gate.kind === 'pdf') {
      const book = await loadPdf(gate.file);
      const whole = await renderPdfWhole(gate.file, book);
      audit('library-read-all', { bookId: gate.item.id, kind: 'pdf', bytes: whole.bytes }, req);
      res.json({
        mode: 'whole',
        kind: 'pdf',
        splitRequired: book.bytes > config.readSplitBytes,
        chapterCount: whole.chapterCount,
        bytes: whole.bytes,
        html: whole.html,
      });
      return;
    }
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
    const book = gate.kind === 'pdf' ? await loadPdf(gate.file) : await loadEpub(gate.file);
    if (index >= book.chapters.length) return res.status(404).json({ error: 'no-chapter', message: '没有该章节' });
    const ctx = readerCtx(req, gate.item);
    const page =
      gate.kind === 'pdf'
        ? await renderPdfChapter(gate.file, book, index, ctx)
        : await renderChapter(gate.file, book, index, ctx);
    const last = book.chapters.length - 1;
    const next = page.part < page.parts ? { c: index, p: page.part + 1 } : index < last ? { c: index + 1, p: 1 } : null;
    const prev = page.part > 1 ? { c: index, p: page.part - 1 } : index > 0 ? { c: index - 1, p: 1 } : null;
    audit('library-read', { bookId: gate.item.id, kind: gate.kind, chapter: index, part: page.part, bytes: page.bytes }, req);
    res.json({
      mode: 'chapter',
      kind: gate.kind,
      ...page,
      chapterTitle: chapterTitle(book.chapters[index]),
      splitRequired: book.bytes > config.readSplitBytes,
      nav: { next, prev, last },
    });
  } catch (err) {
    next(err);
  }
});

/** 包内插图只对 EPUB 有意义：PDF 的图像页不走这条门控（本站不做 PDF 光栅化） */
libraryRouter.get('/library/:id/asset', async (req, res, next) => {
  const gate = await readGate(req, res);
  if (!gate) return;
  if (gate.kind !== 'epub') {
    return res.status(409).json({ error: 'asset-epub-only', message: '该类型没有包内插图可取' });
  }
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

/* —— 站内检索：口令解锁后，对书目元数据与包内章节标题做检索 —— */

/** 按空格分词后逐字段做子串匹配：中文不需要分词器也能命中，
 *  而且刻意不建常驻索引——索引一旦不与"外部换文件"联动就会静默漏检（见 DEVELOPMENT B-10）。 */
function termMatch(needles, ...fields) {
  const hay = fields.map((f) => String(f ?? '').toLowerCase()).join(' ');
  return needles.every((term) => hay.includes(term));
}

const SEARCH_MAX_HITS = 60;
const SEARCH_MAX_BOOKS = 60;

libraryRouter.get('/library/search', async (req, res, next) => {
  const key = grants.verify(req.query.k, req.query.exp, req.query.sig);
  if (!key) {
    res.status(403).json({ error: 'grant-required', message: '口令令牌无效或已过期，请重新输入口令' });
    return;
  }
  const term = String(req.query.q ?? '').trim().slice(0, 60);
  if (term.length < 1) {
    res.status(400).json({ error: 'bad-query', message: '检索词不可为空' });
    return;
  }
  const needles = term.toLowerCase().split(/\s+/).filter(Boolean);
  if (!needles.length) {
    res.status(400).json({ error: 'bad-query', message: '检索词不可为空' });
    return;
  }

  const scope = library.enabled().filter((item) => libraryKeys.covers(key, item.id));
  const hits = [];
  let skipped = 0;
  for (const item of scope.slice(0, SEARCH_MAX_BOOKS)) {
    if (termMatch(needles, item.title, item.author, item.translator, item.group, item.note, item.rights)) {
      hits.push({ kind: 'book', bookId: item.id, bookTitle: item.title, title: item.title, href: `/library/${item.id}/read` });
    }
    // 章节标题要打开包才拿得到；未进预览白名单的书只给书目级命中，不外泄包内结构
    if (item.type !== 'application/epub+zip' && item.type !== 'application/pdf') continue;
    if (item.previewable !== true) continue;
    const file = library.pathOf(item);
    if (!file) continue;
    try {
      const book = item.type === 'application/pdf' ? await loadPdf(file) : await loadEpub(file);
      for (const chapter of book.chapters) {
        if (hits.length >= SEARCH_MAX_HITS) break;
        if (termMatch(needles, chapter.title)) {
          hits.push({
            kind: 'chapter',
            bookId: item.id,
            bookTitle: item.title,
            chapterIndex: chapter.index,
            title: chapter.title || `第 ${chapter.index + 1} 节`,
            href: `/library/${item.id}/read?c=${chapter.index}`,
          });
        }
      }
    } catch {
      // 单本解析失败（包坏、超限）不得拖垮整次检索
      skipped += 1;
    }
    if (hits.length >= SEARCH_MAX_HITS) break;
  }

  res.setHeader('Cache-Control', 'no-store');
  audit('library-search', { keyId: key.id, term: term.slice(0, 24), termLength: term.length, hits: hits.length, skipped }, req);
  res.json({
    query: term,
    items: hits,
    total: hits.length,
    searched: Math.min(scope.length, SEARCH_MAX_BOOKS),
    truncated: scope.length > SEARCH_MAX_BOOKS || hits.length >= SEARCH_MAX_HITS,
    skipped,
  });
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
