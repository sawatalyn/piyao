import fs from 'node:fs';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { config } from '../config.js';
import { sanitizeEpubHtml } from '../security/sanitize.js';

/**
 * PDF 在线阅览：与 EPUB 同一套原则——口令门控、只按节下发、正文过白名单、
 * 超过阈值必须分节；区别只在"节"的定义：书签优先，无书签回退固定页数。
 * 本站不做服务端光栅化：没有文字层的页（扫描图）只给明确提示，不硬塞像素。
 */

class PdfError extends Error {
  constructor(message, status = 422) {
    super(message);
    this.name = 'PdfError';
    this.status = status;
    this.code = 'pdf-invalid';
  }
}

const structureCache = new Map();
const CACHE_MAX = 8;

const cacheKey = (file) => {
  const stat = fs.statSync(file);
  return `${file}|${stat.mtimeMs}|${stat.size}`;
};

/** 打开一次、取完所需结构就销毁：pdf.js 的文档对象持有整份字节，不宜长驻 */
async function withDocument(file, run) {
  const data = new Uint8Array(fs.readFileSync(file));
  const task = getDocument({
    data,
    isEvalSupported: false,
    useSystemFonts: true,
    verbosity: 0,
    disableFontFace: true,
  });
  const doc = await task.promise;
  try {
    return await run(doc);
  } finally {
    // pdf.js 6 的 PDFDocumentProxy 上没有 destroy()：释掉整份字节只能走 loadingTask
    await task.destroy().catch(() => undefined);
  }
}

/** 书签 → 章节起始页；嵌套项按先序展平，页号取不到就丢弃该条 */
async function chaptersFromOutline(doc) {
  const outline = await doc.getOutline();
  if (!outline?.length) return [];
  const flat = [];

  const pageIndex = async (item) => {
    let target = item.dest ?? null;
    // 命名字典目标要先解析成显式目标；命名解析失败在损坏的书签里很常见
    if (typeof target === 'string') {
      target = await doc.getDestination(target).catch(() => null);
    }
    if (!target && item.destRef) target = [item.destRef];
    const pageRef = Array.isArray(target) ? target[0] : null;
    if (!pageRef || typeof pageRef.num !== 'number') return null;
    try {
      const index = await doc.getPageIndex(pageRef);
      return Number.isInteger(index) && index >= 0 ? index : null;
    } catch {
      return null;
    }
  };

  const walk = async (items) => {
    for (const item of items) {
      const index = await pageIndex(item);
      const title = String(item.title || '').trim();
      if (index !== null && title) flat.push({ index, title });
      if (item.items?.length) await walk(item.items);
    }
  };
  await walk(outline);

  // 同页多标题、乱序书签都常见：按页号排序后去掉与前一节同页的重复起点
  flat.sort((a, b) => a.index - b.index);
  return flat.filter((entry, i) => i === 0 || entry.index > flat[i - 1].index);
}

/** 结构（页数 + 分节）解析结果缓存；正文每次现取，避免长驻整份文件 */
async function structureOf(file) {
  const key = cacheKey(file);
  if (structureCache.has(key)) return structureCache.get(key);

  const built = await withDocument(file, async (doc) => {
    const pageCount = doc.numPages;
    if (!pageCount) throw new PdfError('PDF 没有可用页面');
    const starts = await chaptersFromOutline(doc);
    const chapters = [];
    if (starts.length >= 2) {
      starts.forEach((start, i) => {
        const next = starts[i + 1]?.index ?? pageCount;
        chapters.push({ index: i, title: start.title, from: start.index, to: next - 1 });
      });
    } else {
      // 无书签或只有一条：按固定页数切，保证大文件也绝不会整本下发
      const size = Math.max(1, config.pdfPagesPerChapter);
      for (let from = 0, index = 0; from < pageCount; from += size, index += 1) {
        chapters.push({
          index,
          title: `第 ${index + 1} 节 · 第 ${from + 1}—${Math.min(from + size, pageCount)} 页`,
          from,
          to: Math.min(from + size, pageCount) - 1,
        });
      }
    }
    return { pageCount, chapters, hasOutline: starts.length >= 2, metadata: null };
  }).catch((err) => {
    if (err instanceof PdfError) throw err;
    throw new PdfError(String(err?.message || 'PDF 解析失败'));
  });

  structureCache.set(key, built);
  if (structureCache.size > CACHE_MAX) structureCache.delete(structureCache.keys().next().value);
  return built;
}

/** 抽取指定页范围的文字层；无文字层的页给出诚实提示而不是塞空内容 */
async function pagesText(file, from, to) {
  return withDocument(file, async (doc) => {
    const blocks = [];
    for (let page = from; page <= to; page += 1) {
      const pdfPage = await doc.getPage(page + 1);
      const content = await pdfPage.getTextContent();
      const lines = [];
      for (const item of content.items) {
        if (typeof item.str !== 'string') continue;
        const text = item.str.replace(/\s+/g, ' ');
        if (text.trim()) lines.push(text);
      }
      blocks.push({ page: page + 1, lines });
    }
    return blocks;
  });
}

const escapeHtml = (text) =>
  String(text).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]);

/** 一节渲染成一页网页；超过单页上限再按物理页分组（与 EPUB 的小节再切等价） */
export async function renderPdfChapter(file, book, chapterIndex, ctx = {}) {
  const chapter = book.chapters[chapterIndex];
  if (!chapter) return null;
  const stat = fs.statSync(file);

  // 先逐页出 HTML，再按字节贪心分组：反复整段重抽会把一次渲染变成平方级开销
  const perPage = (await pagesText(file, chapter.from, chapter.to)).map((block) => {
    const inner = block.lines.length
      ? block.lines.map((line) => `<p>${escapeHtml(line)}</p>`).join('')
      : '<p class="pdf-scan">本页未内嵌文字层（多为扫描图像页），本站不做服务端光栅化，请下载后本地阅读。</p>';
    const html = sanitizeEpubHtml(`<section class="pdf-page" id="p${block.page}">${inner}</section>`, {});
    return { page: block.page, html, bytes: Buffer.byteLength(html, 'utf8') };
  });

  const groups = [];
  let bucket = [];
  let bucketBytes = 0;
  for (const entry of perPage) {
    // 单页本身就超上限时也要发出去，否则那一节永远翻不到
    if (bucket.length && bucketBytes + entry.bytes > config.readPageMaxBytes) {
      groups.push(bucket);
      bucket = [];
      bucketBytes = 0;
    }
    bucket.push(entry);
    bucketBytes += entry.bytes;
  }
  if (bucket.length) groups.push(bucket);

  const part = Math.min(Math.max(1, Number(ctx.part) || 1), groups.length);
  const chosen = groups[part - 1] || [];
  const html = `<div class="pdf-chapter">${chosen.map((entry) => entry.html).join('')}</div>`;
  return {
    chapterIndex,
    chapterTitle: chapter.title,
    part,
    parts: groups.length,
    html,
    bytes: Buffer.byteLength(html, 'utf8'),
    pageCount: chapter.to - chapter.from + 1,
    pages: chosen.map((entry) => entry.page),
    chapterCount: book.chapters.length,
    splitBy: book.hasOutline ? 'outline' : 'pages',
    bookBytes: stat.size,
  };
}

/** 整本渲染只对阈值以下的书开放，与 EPUB 同一硬边界 */
export async function renderPdfWhole(file, book, ctx = {}) {
  const stat = fs.statSync(file);
  if (stat.size > config.readSplitBytes) {
    throw Object.assign(new PdfError('PDF 超过整本渲染上限，必须按节阅览', 409), { code: 'split-required' });
  }
  const pieces = [];
  for (const chapter of book.chapters) {
    const page = await renderPdfChapter(file, book, chapter.index, ctx);
    // 整本没有阅读页那个"当前节"标题栏，节名要在正文里有自己的载体；id 由我们生成，标题走转义
    const head = sanitizeEpubHtml(`<h2 id="ch${chapter.index}">${escapeHtml(chapter.title || `第 ${chapter.index + 1} 节`)}</h2>`, {});
    pieces.push(head + page.html);
  }
  const html = pieces.join('');
  return {
    chapterIndex: 0,
    chapterTitle: '整本',
    part: 1,
    parts: 1,
    html,
    bytes: Buffer.byteLength(html, 'utf8'),
    pageCount: book.pageCount,
    chapterCount: book.chapters.length,
  };
}

export async function loadPdf(file) {
  const structure = await structureOf(file);
  return { ...structure, bytes: fs.statSync(file).size };
}

export function pdfLimits() {
  return {
    splitBytes: config.readSplitBytes,
    pageBytes: config.readPageMaxBytes,
    wholeBytes: config.readWholeMaxBytes,
    pagesPerChapter: config.pdfPagesPerChapter,
  };
}
