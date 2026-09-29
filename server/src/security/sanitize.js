import sanitizeHtml from 'sanitize-html';

/** 标注色只用预置 class，避免 inline style，便于维持严格 CSP。 */
export const ANNO_COLORS = ['seal', 'gold', 'indigo', 'ink'];

const ANNO_CLASSES = [
  'anno',
  'anno-circle',
  'anno-line',
  'anno-strike',
  ...ANNO_COLORS.map((c) => `c-${c}`),
  'rich-fig',
  'rich-img',
  'rich-cap',
  'p-lead',
  'qlist',
];

const ALLOWED_TAGS = [
  'p', 'br', 'strong', 'b', 'em', 'i', 'u', 's', 'span', 'mark',
  'h3', 'h4', 'ul', 'ol', 'li', 'blockquote', 'pre', 'code',
  'figure', 'figcaption', 'img', 'a',
];

const ALLOWED_ATTR = {
  a: ['href', 'title', 'target', 'rel', 'class'],
  img: ['src', 'alt', 'data-mid', 'class', 'width', 'height', 'loading', 'decoding'],
  span: ['class', 'data-anno'],
  figure: ['class'],
  figcaption: ['class'],
  blockquote: ['class'],
  p: ['class'],
  ul: ['class'],
  code: ['class'],
  pre: ['class'],
  mark: ['class'],
};

const ALLOWED_CLASSES = Object.fromEntries(
  ALLOWED_TAGS.map((tag) => [tag, ANNO_CLASSES])
);

const HTTP_URL = /^(?:https?:)?\/\//i;
const SAFE_URL = /^(?:\/api\/media\/|\/|https?:\/\/)/i;

export function sanitizeRichText(html, { maxLength = 200_000 } = {}) {
  const raw = typeof html === 'string' ? html : '';
  if (raw.length > maxLength) {
    throw Object.assign(new Error(`正文长度超过上限 ${maxLength} 字符`), { status: 413 });
  }
  return sanitizeHtml(raw, {
    allowedTags: ALLOWED_TAGS,
    allowedAttributes: ALLOWED_ATTR,
    allowedClasses: ALLOWED_CLASSES,
    allowedSchemes: ['http', 'https'],
    allowProtocolRelative: false,
    disallowedTagsMode: 'discard',
    nonTextTags: ['script', 'style', 'textarea', 'option', 'noscript', 'iframe', 'object', 'embed'],
    transformTags: {
      a: (tagName, attribs) => {
        const href = attribs.href || '';
        if (!SAFE_URL.test(href) || HTTP_URL.test(href) && /javascript:/i.test(href)) {
          return { tagName: 'span', attribs: { class: 'anno c-ink' } };
        }
        return {
          tagName: 'a',
          attribs: { ...attribs, href, rel: 'noopener noreferrer nofollow', target: '_blank' },
        };
      },
      img: (tagName, attribs) => {
        // 读取期下发的签名直链（?exp&sig）属临时量：编辑器会把 DOM 原样 PUT 回来，
        // 不剥掉就会永久写入档案，过期后再也不被重新签名 —— 插图集体 403。
        const src = String(attribs.src || '').replace(/^(\/api\/media\/[^?]+)\?.*$/, '$1');
        if (!SAFE_URL.test(src)) return { tagName: 'span', attribs: {} };
        return {
          tagName: 'img',
          attribs: {
            src,
            alt: attribs.alt || '辟谣档案插图',
            'data-mid': attribs['data-mid'] || '',
            class: 'rich-img',
            loading: 'lazy',
            decoding: 'async',
          },
        };
      },
    },
  });
}

/**
 * 在线阅览用的 EPUB 净化：与档案正文分开一套白名单。
 * 严格 CSP（style-src 'self'）下不允许任何行内样式与 <style>，故版式一律由本站阅读样式表承担；
 * 脚本、表单、svg/math 等一律丢弃，图片与站内链接由调用方给出改写函数。
 */
const READ_TAGS = [
  'p', 'br', 'hr', 'span', 'strong', 'b', 'em', 'i', 'u', 's', 'sup', 'sub', 'small', 'abbr', 'cite', 'q', 'time',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li', 'dl', 'dt', 'dd', 'blockquote', 'pre', 'code',
  'img', 'figure', 'figcaption', 'table', 'thead', 'tbody', 'tfoot', 'caption', 'colgroup', 'col', 'tr', 'td', 'th',
  'a', 'div', 'section', 'article', 'header', 'footer', 'aside', 'nav', 'main',
];

const READ_ATTR = {
  a: ['href', 'title', 'class', 'rel', 'target'],
  img: ['src', 'alt', 'width', 'height', 'class', 'loading', 'decoding'],
  span: ['class'],
  div: ['id', 'class'],
  section: ['id', 'class'],
  article: ['id', 'class'],
  p: ['id'],
  h1: ['id'],
  h2: ['id'],
  h3: ['id'],
  h4: ['id'],
  h5: ['id'],
  h6: ['id'],
  td: ['colspan', 'rowspan'],
  th: ['colspan', 'rowspan', 'scope'],
  col: ['span'],
  ol: ['start'],
  time: ['datetime'],
  abbr: ['title'],
  blockquote: ['cite'],
  q: ['cite'],
};

const READ_CLASSES = ['epub-jump', 'epub-ext', 'epub-anchor', 'epub-dead-link', 'epub-no-asset', 'epub-chapter'];

const READ_NON_TEXT = [
  'script', 'style', 'textarea', 'option', 'noscript', 'iframe', 'object', 'embed', 'form', 'input', 'button',
  'select', 'datalist', 'link', 'meta', 'base', 'title', 'head', 'xml', 'svg', 'math', 'canvas', 'audio', 'video',
  'source', 'track', 'template', 'dialog', 'slot', 'picture', 'map', 'area', 'marquee', 'frame', 'frameset',
];

/**
 * @param {string} html 章节正文（XHTML 片段）
 * @param {{resolveImage?: (src: string) => string|null,
 *          resolveLink?: (href: string) => {url?: string, anchor?: string, external?: string}|null}} hooks
 */
export function sanitizeEpubHtml(html, { resolveImage, resolveLink } = {}) {
  return sanitizeHtml(String(html || ''), {
    allowedTags: READ_TAGS,
    allowedAttributes: READ_ATTR,
    allowedClasses: Object.fromEntries(READ_TAGS.map((tag) => [tag, READ_CLASSES])),
    allowedSchemes: ['http', 'https', 'mailto'],
    allowProtocolRelative: false,
    disallowedTagsMode: 'discard',
    nonTextTags: READ_NON_TEXT,
    allowedSchemesByTag: { img: [] },
    transformTags: {
      img: (tagName, attribs) => {
        const url = resolveImage ? resolveImage(attribs.src || '') : null;
        if (!url) return { tagName: 'span', attribs: { class: 'epub-no-asset' } };
        return {
          tagName: 'img',
          attribs: { src: url, alt: attribs.alt || '书中插图', class: 'epub-jump', loading: 'lazy', decoding: 'async' },
        };
      },
      a: (tagName, attribs) => {
        const target = resolveLink ? resolveLink(attribs.href || '') : null;
        if (target?.url) return { tagName: 'a', attribs: { href: target.url, class: 'epub-jump' } };
        if (target?.anchor) return { tagName: 'a', attribs: { href: `#${target.anchor}`, class: 'epub-anchor' } };
        if (target?.external) {
          return {
            tagName: 'a',
            attribs: { href: target.external, rel: 'noopener noreferrer nofollow', target: '_blank', class: 'epub-ext' },
          };
        }
        return { tagName: 'span', attribs: { class: 'epub-dead-link' } };
      },
    },
  });
}

/** 按一~三级标题切块后累计到上限，保证每页都是完整标签、可独立成页 */
export function splitHtmlPages(html, capBytes) {
  const blocks = String(html || '')
    .split(/(?=<h[1-3]\b)/i)
    .filter((block) => block.length);
  const pages = [];
  let buffer = '';
  for (const block of blocks) {
    if (buffer && Buffer.byteLength(buffer + block, 'utf8') > capBytes) {
      pages.push(buffer);
      buffer = block;
    } else {
      buffer += block;
    }
  }
  if (buffer) pages.push(buffer);
  return pages.length ? pages : [''];
}

export function stripHtml(html) {
  const withoutCaptions = String(html || '').replace(/<figcaption[\s\S]*?<\/figcaption>/gi, ' ');
  return sanitizeHtml(withoutCaptions, { allowedTags: [], allowedAttributes: {} })
    .replace(/\s+/g, ' ')
    .trim();
}

/** 图片标注矢量数据校验：坐标一律归一化到 0..1 */
export function sanitizeAnnotations(list) {
  if (!Array.isArray(list)) return [];
  const num = (v) => (Number.isFinite(v) ? Math.min(Math.max(v, -1), 2) : 0);
  return list
    .filter((a) => a && (a.k === 'ellipse' || a.k === 'line'))
    .slice(0, 60)
    .map((a) => ({
      k: a.k,
      c: ANNO_COLORS.includes(a.c) ? a.c : 'seal',
      x: num(a.x),
      y: num(a.y),
      w: Math.max(num(a.w), 0.01),
      h: Math.max(num(a.h), 0.01),
    }));
}
