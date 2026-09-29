import path from 'node:path';
import fsp from 'node:fs/promises';
import { config } from '../config.js';
import { readZipDirectory, readZipEntry, zipResolve, ZipError } from './zipRead.js';
import { sanitizeEpubHtml, splitHtmlPages } from '../security/sanitize.js';

/**
 * EPUB 在线阅览的解析层：container.xml → OPF（manifest/spine）→ nav 或 ncx 取章节名，
 * 一章一页；单章过长再按一~三级标题切小节。整本书从不进内存，只有被请求的那一条目会解压。
 */
const META_MAX = 512 * 1024;
const CACHE_MAX = 8;
/** SVG 可内嵌脚本，PDF 可内嵌 JS：阅览资产只放行位图，其余宁可不显示 */
const SAFE_IMAGES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/avif']);
const parsedCache = new Map();

const decode = (text) =>
  String(text ?? '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_m, d) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_m, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&nbsp;/g, ' ')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/&amp;/g, '&')
    .trim();

function attributes(tag) {
  const out = {};
  const re = /([:a-zA-Z_][-:.a-zA-Z0-9_]*)\s*=\s*"([^"]*)"|([:a-zA-Z_][-:.a-zA-Z0-9_]*)\s*=\s*'([^']*)'/g;
  let match;
  while ((match = re.exec(String(tag || '')))) {
    if (match[1]) out[match[1].toLowerCase()] = match[2];
    else out[match[3].toLowerCase()] = match[4];
  }
  return out;
}

const openTags = (html, name) => String(html || '').match(new RegExp(`<${name}\\b[^>]*>`, 'gi')) || [];

async function textOf(file, entries, name) {
  const entry = entries.get(name);
  if (!entry) throw new ZipError(`EPUB 包内缺少 ${name}`);
  return (await readZipEntry(file, entry, META_MAX)).toString('utf8');
}

async function rootfileOf(file, entries) {
  const name = entries.has('META-INF/container.xml')
    ? 'META-INF/container.xml'
    : [...entries.keys()].find((key) => key.toLowerCase() === 'meta-inf/container.xml');
  if (!name) throw new ZipError('缺少 META-INF/container.xml，不是有效的 EPUB');
  const rootTag = (await textOf(file, entries, name)).match(/<rootfile\b[^>]*>/i)?.[0];
  const fullPath = rootTag ? attributes(rootTag)['full-path'] : '';
  if (!fullPath) throw new ZipError('EPUB 未声明包文档（rootfile）');
  return fullPath.replace(/\\/g, '/').replace(/^\/+/, '');
}

function parseOpf(xml) {
  const manifest = new Map();
  for (const tag of openTags(xml, 'item')) {
    const a = attributes(tag);
    if (a.id) manifest.set(a.id, { href: a.href || '', mediaType: (a['media-type'] || '').toLowerCase(), properties: a.properties || '' });
  }
  const spineTag = xml.match(/<spine\b[^>]*>/i)?.[0] || '';
  const spineBlock = xml.match(/<spine\b[\s\S]*?<\/spine>/i)?.[0] || '';
  const refs = openTags(spineBlock, 'itemref').map((tag) => attributes(tag));
  return {
    manifest,
    refs: refs.filter((a) => a.idref && a.linear !== 'no'),
    tocId: attributes(spineTag).toc || '',
    title: decode(xml.match(/<dc:title[^>]*>([\s\S]*?)<\/dc:title>/i)?.[1] || ''),
    language: decode(xml.match(/<dc:language[^>]*>([\s\S]*?)<\/dc:language>/i)?.[1] || ''),
  };
}

/** EPUB3 用 nav.xhtml，EPUB2 用 NCX；两处都只取"路径 → 首个标题"，不复制正文 */
async function labelsOf(file, entries, baseDir, opf) {
  const labels = new Map();
  const put = (href, text) => {
    const name = zipResolve(baseDir, href);
    if (name && !labels.has(name)) labels.set(name, text);
  };
  const navItem = [...opf.manifest.values()].find((item) => /\bnav\b/.test(item.properties));
  if (navItem) {
    const navName = zipResolve(baseDir, navItem.href);
    if (navName && entries.has(navName)) {
      const nav = (await textOf(file, entries, navName)).match(/<nav\b[^>]*epub:type="toc"[^>]*>([\s\S]*?)<\/nav>/i)?.[1] || '';
      for (const tag of nav.match(/<a\b[^>]*>[\s\S]*?<\/a>/gi) || []) {
        const href = attributes(tag).href || '';
        const text = decode(tag.replace(/<[^>]*>/g, ' '));
        put(href.split('#')[0], text);
      }
    }
  }
  const ncxItem = opf.tocId ? opf.manifest.get(opf.tocId) : [...opf.manifest.values()].find((item) => item.mediaType === 'application/x-dtbncx+xml');
  if (ncxItem && labels.size === 0) {
    const ncxName = zipResolve(baseDir, ncxItem.href);
    if (ncxName && entries.has(ncxName)) {
      const ncx = await textOf(file, entries, ncxName);
      for (const block of ncx.match(/<navPoint\b[\s\S]*?<\/navPoint>/gi) || []) {
        const text = block.match(/<text[^>]*>([\s\S]*?)<\/text>/i)?.[1];
        const src = attributes(block.match(/<content\b[^>]*>/i)?.[0] || '').src;
        if (src) put(src.split('#')[0], decode(text || ''));
      }
    }
  }
  return labels;
}

async function parse(file) {
  const entries = await readZipDirectory(file);
  const opfName = await rootfileOf(file, entries);
  const baseDir = path.posix.dirname(opfName) === '.' ? '' : path.posix.dirname(opfName);
  const opf = parseOpf(await textOf(file, entries, opfName));
  const labels = await labelsOf(file, entries, baseDir, opf);
  const chapters = [];
  for (const ref of opf.refs) {
    const item = opf.manifest.get(ref.idref);
    const name = item ? zipResolve(baseDir, item.href) : null;
    if (!name || !entries.has(name)) continue;
    if (!/xhtml|html/.test(item.mediaType) && !/\.x?html?$/i.test(name)) continue;
    chapters.push({ index: chapters.length, name, title: labels.get(name) || '' });
  }
  if (!chapters.length) throw new ZipError('EPUB 的 spine 里没有可阅览的章节');
  const images = new Map();
  for (const item of opf.manifest.values()) {
    const name = item.href ? zipResolve(baseDir, item.href) : null;
    if (name && entries.has(name) && SAFE_IMAGES.has(item.mediaType)) images.set(name, item.mediaType);
  }
  for (const [name, entry] of entries) {
    if (images.has(name) || !entry.uncompSize) continue;
    const guess = /\.(png|jpe?g|gif|webp|avif)$/i.exec(name)?.[1];
    if (guess) images.set(name, `image/${guess === 'jpg' ? 'jpeg' : guess}`);
  }
  return {
    title: opf.title,
    language: opf.language,
    chapters,
    byName: new Map(chapters.map((chapter) => [chapter.name, chapter.index])),
    images,
    entries,
    directoryEntries: entries.size,
  };
}

/** 解析结果按"路径+修改时间+体积"缓存；正文不进缓存，大书因此不会被驻留 */
export async function loadEpub(file) {
  const stat = await fsp.stat(file);
  const key = `${file}|${Math.round(stat.mtimeMs)}|${stat.size}`;
  const hit = parsedCache.get(key);
  if (hit) {
    parsedCache.delete(key);
    parsedCache.set(key, hit);
    return hit.book;
  }
  const book = await parse(file);
  book.bytes = stat.size;
  parsedCache.set(key, { book });
  while (parsedCache.size > CACHE_MAX) parsedCache.delete(parsedCache.keys().next().value);
  return book;
}

const bodyOf = (html) => html.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i)?.[1] ?? String(html || '');

/** 与登记环节同一立场：类型只认魔数，不认 manifest 声明与扩展名 */
export function verifyImageBytes(buffer, mediaType) {
  const head = buffer.subarray(0, 16).toString('latin1');
  const ok =
    (mediaType === 'image/png' && head.startsWith('\x89PNG\r\n\x1a\n')) ||
    (mediaType === 'image/jpeg' && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) ||
    (mediaType === 'image/gif' && /^GIF8[79]a/.test(head)) ||
    (mediaType === 'image/webp' && head.startsWith('RIFF') && buffer.subarray(8, 12).toString('latin1') === 'WEBP') ||
    (mediaType === 'image/avif' && buffer.subarray(4, 12).toString('latin1') === 'ftypavif');
  return ok;
}

function docTitle(html) {
  return decode(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '');
}

async function chapterHtml(file, book, chapter, ctx) {
  const raw = (await readZipEntry(file, book.entries.get(chapter.name), config.readEntryMaxBytes)).toString('utf8');
  const baseDir = path.posix.dirname(chapter.name) === '.' ? '' : path.posix.dirname(chapter.name);
  const html = bodyOf(raw);
  const sanitized = sanitizeEpubHtml(html, {
    resolveImage: (src) => {
      const name = zipResolve(baseDir, src);
      return name && book.images.has(name) ? ctx.assetUrl(name) : null;
    },
    resolveLink: (href) => {
      const value = String(href || '').trim();
      if (!value) return null;
      if (/^(https?:|mailto:)/i.test(value)) return { external: value.slice(0, 500) };
      const [target, fragment] = value.split('#');
      if (!target) return fragment ? { anchor: fragment.slice(0, 80) } : null;
      const name = zipResolve(baseDir, target);
      if (!name) return null;
      if (book.byName.has(name)) return { url: ctx.pageUrl(book.byName.get(name), fragment) };
      if (book.images.has(name)) return { url: ctx.assetUrl(name) };
      return null;
    },
  });
  return { html: sanitized, inferredTitle: docTitle(raw) };
}

/** 一章一页；过长再按小节切，part 为 1 起的小节序号 */
export async function renderChapter(file, book, index, ctx) {
  const chapter = book.chapters[index];
  if (!chapter) throw new ZipError('没有该章节', 404);
  const { html, inferredTitle } = await chapterHtml(file, book, chapter, ctx);
  const pages = splitHtmlPages(html, config.readPageMaxBytes);
  const part = Math.min(Math.max(Number(ctx.part) || 1, 1), pages.length);
  const page = pages[part - 1];
  return {
    chapterIndex: index,
    chapterTitle: chapter.title || inferredTitle || `第 ${index + 1} 节`,
    part,
    parts: pages.length,
    html: page,
    bytes: Buffer.byteLength(page, 'utf8'),
    chapterCount: book.chapters.length,
  };
}

/** 全本模式：仅限未超过拆分阈值的小书，且总输出另有硬上限 */
export async function renderWhole(file, book, ctx) {
  if (book.bytes > config.readSplitBytes) {
    throw Object.assign(
      new ZipError(
        `本书 ${(book.bytes / 1024 / 1024).toFixed(1)}MB 超过 ${(config.readSplitBytes / 1024 / 1024).toFixed(0)}MB，只能按章节分页阅览`,
        409
      ),
      { code: 'split-required' }
    );
  }
  const sections = [];
  let total = 0;
  for (const chapter of book.chapters) {
    const { html, inferredTitle } = await chapterHtml(file, book, chapter, ctx);
    const title = chapter.title || inferredTitle || `第 ${chapter.index + 1} 节`;
    const section = `<section class="epub-chapter" id="c${chapter.index}"><h2 class="epub-chapter">${title}</h2>${html}</section>`;
    total += Buffer.byteLength(section, 'utf8');
    if (total > config.readWholeMaxBytes) {
      throw Object.assign(new ZipError('全本渲染超出单次上限，请逐章阅览', 413), { code: 'too-wide' });
    }
    sections.push(section);
  }
  return { html: sections.join(''), bytes: total, chapterCount: book.chapters.length };
}

export const readerLimits = () => ({
  splitBytes: config.readSplitBytes,
  pageBytes: config.readPageMaxBytes,
  wholeBytes: config.readWholeMaxBytes,
  entryBytes: config.readEntryMaxBytes,
});
