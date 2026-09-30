import path from 'node:path';
import fsp from 'node:fs/promises';
import { parseXml } from '@rgrove/parse-xml';
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

/** 只服务 docTitle 那类"HTML 片段里取个标题"的场合：正文是 HTML，不按 XML 严格要求闭合与实体 */
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

/**
 * 包内 XML（container.xml / OPF / nav / NCX）一律交给 parse-xml（ISC、零依赖）严格解析。
 * 早先用正则读标签属于自己造 XML 解析器：属性顺序、命名空间、嵌套 navPoint、
 * 实体写法任一不符就静默读错，而这类书是要给读者看的。
 * 章节正文不在这里解析——它按 HTML 走 sanitize-html 白名单。
 */
function docOf(text, label, { tolerant = false } = {}) {
  try {
    return parseXml(String(text ?? '')).root;
  } catch (err) {
    // tolerant 只用于"缺了顶多没有章节名"的来源，不至于让整本书读不出来
    if (tolerant) return null;
    throw new ZipError(`${label} 无法解析：${err?.message || 'XML 结构错误'}`);
  }
}

const localName = (el) => String(el?.name || '').replace(/^[\w.-]+:/, '').toLowerCase();
const elementsOf = (el) => (el?.children || []).filter((node) => node.type === 'element');

function textOf(el) {
  let out = '';
  for (const node of el?.children || []) {
    if (node.type === 'text' || node.type === 'cdata') out += node.text;
    else if (node.type === 'element') out += ` ${textOf(node)} `;
  }
  return out.replace(/\s+/g, ' ').trim();
}

/** 按"去掉命名空间前缀后的标签名"取元素，文档序返回（dc:title 与 title 一视同仁） */
function findAll(root, name) {
  const out = [];
  const visit = (el) => {
    if (localName(el) === name) out.push(el);
    for (const child of elementsOf(el)) visit(child);
  };
  if (root) visit(root);
  return out;
}

const firstAttr = (root, name, attr) => String(findAll(root, name)[0]?.attributes?.[attr] || '');
const firstText = (root, name) => textOf(findAll(root, name)[0]);

async function entryText(file, entries, name) {
  const entry = entries.get(name);
  if (!entry) throw new ZipError(`EPUB 包内缺少 ${name}`);
  return (await readZipEntry(file, entry, META_MAX)).toString('utf8');
}

async function rootfileOf(file, entries) {
  const name = entries.has('META-INF/container.xml')
    ? 'META-INF/container.xml'
    : [...entries.keys()].find((key) => key.toLowerCase() === 'meta-inf/container.xml');
  if (!name) throw new ZipError('缺少 META-INF/container.xml，不是有效的 EPUB');
  const fullPath = firstAttr(docOf(await entryText(file, entries, name), 'container.xml'), 'rootfile', 'full-path');
  if (!fullPath) throw new ZipError('EPUB 未声明包文档（rootfile）');
  return fullPath.replace(/\\/g, '/').replace(/^\/+/, '');
}

function parseOpf(xml) {
  const root = docOf(xml, '包文档（OPF）');
  const manifest = new Map();
  for (const item of findAll(root, 'item')) {
    const a = item.attributes || {};
    if (a.id) manifest.set(a.id, { href: a.href || '', mediaType: String(a['media-type'] || '').toLowerCase(), properties: a.properties || '' });
  }
  const spine = findAll(root, 'spine')[0];
  const refs = elementsOf(spine)
    .filter((el) => localName(el) === 'itemref')
    .map((el) => el.attributes || {})
    .filter((a) => a.idref && a.linear !== 'no');
  return {
    manifest,
    refs,
    tocId: String(spine?.attributes?.toc || ''),
    title: firstText(root, 'title'),
    language: firstText(root, 'language'),
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
      const navRoot = docOf(await entryText(file, entries, navName), 'nav.xhtml', { tolerant: true });
      const toc = findAll(navRoot, 'nav').find((el) => /\btoc\b/.test(String(el.attributes?.['epub:type'] || '').toLowerCase()));
      for (const link of findAll(toc || navRoot, 'a')) {
        const href = String(link.attributes?.href || '');
        if (href) put(href.split('#')[0], textOf(link));
      }
    }
  }
  const ncxItem = opf.tocId ? opf.manifest.get(opf.tocId) : [...opf.manifest.values()].find((item) => item.mediaType === 'application/x-dtbncx+xml');
  if (ncxItem && labels.size === 0) {
    const ncxName = zipResolve(baseDir, ncxItem.href);
    if (ncxName && entries.has(ncxName)) {
      const ncxRoot = docOf(await entryText(file, entries, ncxName), 'NCX', { tolerant: true });
      // 文档序遍历：父级 navPoint 先入表，子级同名路径不会把父级标题冲掉
      for (const point of findAll(ncxRoot, 'navpoint')) {
        const src = String(findAll(point, 'content')[0]?.attributes?.src || '');
        if (src) put(src.split('#')[0], textOf(findAll(point, 'text')[0]));
      }
    }
  }
  return labels;
}

async function parse(file) {
  const entries = await readZipDirectory(file);
  const opfName = await rootfileOf(file, entries);
  const baseDir = path.posix.dirname(opfName) === '.' ? '' : path.posix.dirname(opfName);
  const opf = parseOpf(await entryText(file, entries, opfName));
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
