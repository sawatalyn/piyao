import zlib from 'node:zlib';
import crypto from 'node:crypto';

/**
 * 自产 PDF 夹具生成器：为本馆演示与自检造出结构完整、文字层可抽取的 PDF，不含任何他人作品。
 * 正文走 ASCII（内置 Helvetica 即可解码），章节标题写 UTF-16BE 十六进制串，
 * 这样中文标题能被 pdf.js 读出，而正文不会因为缺 CJK 字体变成乱码。
 */

const escapeLatin = (text) =>
  String(text)
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)')
    .replace(/[^\x20-\x7e]/g, '?');

/** PDF 的 UTF-16BE 字符串写法：非 ASCII 文本要靠它才能被正确解出 */
const utf16Hex = (text) => {
  const hex = [...String(text)]
    .flatMap((ch) => {
      const code = ch.codePointAt(0);
      return [(code >> 8) & 0xff, code & 0xff];
    })
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
  return `<FEFF${hex}>`;
};

function streamObject(data, extra = '') {
  const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data, 'latin1');
  const head = `<< ${extra ? `${extra} ` : ''}/Length ${buffer.length} >>`;
  return `${head}\nstream\n${buffer.toString('latin1')}\nendstream`;
}

/**
 * @param {object} spec
 * @param {string} spec.title 文档标题（写进 /Info）
 * @param {Array<{title: string, pages: string[]}>} spec.chapters 每章含若干页正文
 * @param {boolean} [spec.outline] 是否写书签；关掉可测"无书签→按固定页数拆分"
 * @param {number} [spec.padBytes] 追加一块不可压缩的随机流，用于真的跨过 10MB 阈值
 */
export function buildPdf({ title = 'Bianwang demo book', chapters = [], outline = true, padBytes = 0 } = {}) {
  const objects = [];
  const add = (body) => {
    objects.push(body);
    return objects.length; // 对象号从 1 起
  };

  // 号位先占后填：书签项要指向书签根，书签根又要指向首末项
  const catalogRef = add('');
  const pagesRef = add('');
  const outlineRef = outline ? add('') : 0;
  const fontRef = add('/Type /Font /Subtype /Type1 /BaseFont /Helvetica');
  const infoRef = add(`/Title ${utf16Hex(title)} /Producer (bianwang-archive self-made fixture)`);

  const pageRefs = [];
  const firstPageOfChapter = [];
  for (const chapter of chapters) {
    const refs = [];
    for (const text of chapter.pages) {
      const body = `BT /F1 14 Tf 64 760 Td (${escapeLatin(text)}) Tj ET\nBT /F1 10 Tf 64 730 Td (Bianwang Archive self-made demo page - not a third-party work.) Tj ET`;
      const contentRef = add(streamObject(body));
      refs.push(
        add(`/Type /Page /Parent ${pagesRef} 0 R /Resources << /Font << /F1 ${fontRef} 0 R >> >> /MediaBox [0 0 595 842] /Contents ${contentRef} 0 R`)
      );
    }
    firstPageOfChapter.push(refs[0]);
    pageRefs.push(...refs);
  }

  if (outline && chapters.length) {
    const itemRefs = chapters.map(() => add(''));
    itemRefs.forEach((ref, index) => {
      const next = itemRefs[index + 1] ? ` /Next ${itemRefs[index + 1]} 0 R` : '';
      const prev = itemRefs[index - 1] ? ` /Prev ${itemRefs[index - 1]} 0 R` : '';
      objects[ref - 1] =
        `/Title ${utf16Hex(chapters[index].title)} /Parent ${outlineRef} 0 R${prev}${next} /Dest [ ${firstPageOfChapter[index]} 0 R /Fit ]`;
    });
    objects[outlineRef - 1] = `/Type /Outlines /First ${itemRefs[0]} 0 R /Last ${itemRefs[itemRefs.length - 1]} 0 R /Count ${itemRefs.length}`;
  }

  // 大文件夹具：/BinaryPad 挂一块随机字节（deflate 压不动）才能真正超过体积阈值
  if (padBytes > 0) {
    const pad = Buffer.concat([Buffer.from('%BianwangPad'), crypto.randomBytes(Math.max(16, padBytes - 11))]);
    add(streamObject(pad, '/Type /Annot'));
  }

  objects[catalogRef - 1] = `/Type /Catalog /Pages ${pagesRef} 0 R${outlineRef ? ` /Outlines ${outlineRef} 0 R` : ''}`;
  objects[pagesRef - 1] = `/Type /Pages /Count ${pageRefs.length} /Kids [${pageRefs.map((r) => `${r} 0 R`).join(' ')}]`;

  const parts = ['%PDF-1.4\n%\xE2\xE3\xCF\xD3\n'];
  const offsets = [];
  objects.forEach((body, index) => {
    offsets.push(Buffer.byteLength(parts.join(''), 'latin1'));
    // 字典必须带 << >> 定界符：漏掉就是非法 PDF，pdf.js 会报 "Invalid Root reference"
    const dict = body.startsWith('<<') ? body : `<< ${body} >>`;
    parts.push(`${index + 1} 0 obj\n${dict}\nendobj\n`);
  });
  const startxref = Buffer.byteLength(parts.join(''), 'latin1');
  const rows = ['0000000000 65535 f \n'];
  for (const offset of offsets) rows.push(`${String(offset).padStart(10, '0')} 00000 n \n`);
  parts.push(
    `xref\n0 ${objects.length + 1}\n${rows.join('')}trailer\n<< /Size ${objects.length + 1} /Root ${catalogRef} 0 R /Info ${infoRef} 0 R >>\nstartxref\n${startxref}\n%%EOF\n`
  );
  return Buffer.from(parts.join(''), 'latin1');
}

/** 小夹具：三章带书签，用于逐节阅览与整本渲染 */
export function demoPdf({ title = '辨妄阁 PDF 阅览演示册' } = {}) {
  return buildPdf({
    title,
    chapters: [
      { title: '第一章 · 谣言样本', pages: ['Rumor sample, chapter 1 page 1.', 'Rumor sample, chapter 1 page 2.'] },
      { title: '第二章 · 证据与推理', pages: ['Evidence: the controlled trial found no effect.', 'Evidence, chapter 2 page 2.'] },
      { title: '第三章 · 结论判定', pages: ['Verdict: false. The quoted reaction does not exist.'] },
    ],
  });
}

/** 大夹具：无书签 + 不可压缩填充，用来验证"按固定页数拆分"与整本被拒 */
export function bigPdf({
  title = '辨妄阁 PDF 大书拆分演示册',
  chapters = 2,
  sections = 40,
  padBytes = 10 * 1024 * 1024 + 128 * 1024,
} = {}) {
  const list = [];
  for (let c = 0; c < chapters; c += 1) {
    const pages = [];
    for (let s = 0; s < sections; s += 1) {
      pages.push(`Chapter ${c + 1} page ${s + 1}: long scanned body text used only for split assertions.`);
    }
    list.push({ title: `第 ${c + 1} 章`, pages });
  }
  return buildPdf({ title, chapters: list, outline: false, padBytes });
}
