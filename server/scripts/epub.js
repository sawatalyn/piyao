import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { encodePng } from './png.js';

/**
 * 极简 ZIP（仅 store，不压缩）写入器：用来产出演示用 EPUB 镜像文件，
 * 让口令门控下载在有真实馆藏之前就可在本机走通与验证。
 */
const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buffer) {
  if (typeof zlib.crc32 === 'function') return zlib.crc32(buffer) >>> 0;
  let c = 0xffffffff;
  for (const byte of buffer) c = (c >>> 8) ^ CRC_TABLE[(c ^ byte) & 0xff];
  return (c ^ 0xffffffff) >>> 0;
}

const dosTime = (d) => ((d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 2)) & 0xffff;
const dosDate = (d) => (((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()) & 0xffff;

export function zipStore(entries, now = new Date()) {
  const parts = [];
  const central = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8');
    const data = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(entry.data, 'utf8');
    const crc = crc32(data);
    // 真实 EPUB 的正文与图片多为 deflate，只发 store 就永远测不到解压分支
    const body = entry.deflate ? zlib.deflateRawSync(data, { level: 6 }) : data;
    const method = entry.deflate ? 8 : 0;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(dosTime(now), 10);
    local.writeUInt16LE(dosDate(now), 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    parts.push(local, name, body);

    const head = Buffer.alloc(46);
    head.writeUInt32LE(0x02014b50, 0);
    head.writeUInt16LE(20, 4);
    head.writeUInt16LE(20, 6);
    head.writeUInt16LE(0x0800, 8);
    head.writeUInt16LE(method, 10);
    head.writeUInt16LE(dosTime(now), 12);
    head.writeUInt16LE(dosDate(now), 14);
    head.writeUInt32LE(crc, 16);
    head.writeUInt32LE(body.length, 20);
    head.writeUInt32LE(data.length, 24);
    head.writeUInt16LE(name.length, 28);
    head.writeUInt32LE(0, 38);
    head.writeUInt32LE(offset, 42);
    central.push(head, name);

    offset += local.length + name.length + body.length;
  }
  const centralBody = Buffer.concat(central);
  const beforeCentral = Buffer.concat(parts);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralBody.length, 12);
  eocd.writeUInt32LE(beforeCentral.length, 16);
  return Buffer.concat([beforeCentral, centralBody, eocd]);
}

/** 演示用 EPUB：正文只写明它是界面演示文件，不含任何他人作品 */
export function demoEpub({ title, author, note }) {
  const id = 'bw-demo-0001';
  const page = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="zh-CN">
<head><meta charset="UTF-8"/><title>${title}</title><link rel="stylesheet" href="style.css"/></head>
<body><h1>${title}</h1><p>${note}</p><p>本文件为「辨妄阁」镜像功能演示占位件，不含任何他人作品或受版权保护内容。</p></body>
</html>`;
  return zipStore([
    { name: 'mimetype', data: 'application/epub+zip' },
    {
      name: 'META-INF/container.xml',
      data: `<?xml version="1.0" encoding="UTF-8"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`,
    },
    {
      name: 'OEBPS/content.opf',
      data: `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" unique-identifier="bid" version="3.0" xml:lang="zh-CN">
<metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="bid">urn:uuid:${id}</dc:identifier><dc:title>${title}</dc:title><dc:creator>${author}</dc:creator><dc:language>zh-CN</dc:language><meta property="dcterms:modified">2026-01-01T00:00:00Z</meta></metadata>
<manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="page" href="page.xhtml" media-type="application/xhtml+xml"/><item id="css" href="style.css" media-type="text/css"/></manifest>
<spine><itemref idref="page"/></spine>
</package>`,
    },
    {
      name: 'OEBPS/nav.xhtml',
      data: `<?xml version="1.0" encoding="UTF-8"?><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>目录</title></head><body><nav epub:type="toc" id="toc"><ol><li><a href="page.xhtml">${title}</a></li></ol></nav></body></html>`,
    },
    { name: 'OEBPS/page.xhtml', data: page },
    { name: 'OEBPS/style.css', data: 'body{font-family:serif;margin:2em;line-height:1.7}' },
  ]);
}

/**
 * 多章节演示/自检用 EPUB：正文自产，deflate 压缩（与真实书籍同一条解压路径），
 * 每章都夹带脚本、行内样式、svg、跨章跳链与位图，用来验证阅读净化与分页；
 * sections 让首章长到必须再切小节，padBytes 用不可压缩数据把整包顶过阈值以演示"大书强制分页"。
 */
export function multiChapterEpub({
  title = '辨妄阁分页阅览演示册',
  author = '辨妄阁',
  chapters = 3,
  sections = 0,
  padBytes = 0,
} = {}) {
  const image = encodePng(8, 6, (x, y) => [(x * 31) % 256, (y * 43) % 256, 120]);
  const items = [
    '<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>',
    '<item id="plate" href="plate.png" media-type="image/png"/>',
  ];
  const spine = [];
  const tocItems = [];
  const files = [
    { name: 'mimetype', data: 'application/epub+zip' },
    {
      name: 'META-INF/container.xml',
      data: '<?xml version="1.0" encoding="UTF-8"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>',
    },
  ];
  for (let n = 1; n <= chapters; n += 1) {
    const label = `第 ${n} 章 · 演示`;
    const parts = [
      `<p>本章为《${title}》第 ${n} 章的自产演示文字，回读校验码 ${n}${n}。</p>`,
      `<script type="text/javascript">window.__bw_pwned = ${n};</script>`,
      '<p style="color:#f00" class="x">带行内样式的段落：样式应被丢弃，文字应保留。</p>',
      '<p><svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><rect width="1" height="1"/></svg></p>',
      '<figure><img src="plate.png" alt="演示图版"/><figcaption>图 ' + n + '：自产位图</figcaption></figure>',
      `<p><a href="https://example.org/mt-${n}">外部来源</a></p>`,
    ];
    if (n < chapters) parts.push(`<p><a href="c${n + 1}.xhtml#sec-${n + 1}">跳到第 ${n + 1} 章</a></p>`);
    if (n === 1 && sections) {
      for (let s = 1; s <= sections; s += 1) {
        parts.push(`<h3 id="sub-${s}">小节 ${s}</h3><p>${'演示正文。'.repeat(900)}</p>`);
      }
    }
    files.push({
      name: `OEBPS/c${n}.xhtml`,
      data: `<?xml version="1.0" encoding="UTF-8"?><html xmlns="http://www.w3.org/1999/xhtml" xml:lang="zh-CN"><head><title>${label}</title></head><body><h2 id="sec-${n}">${label}</h2>${parts.join('')}</body></html>`,
      deflate: true,
    });
    items.push(`<item id="c${n}" href="c${n}.xhtml" media-type="application/xhtml+xml"/>`);
    spine.push(`<itemref idref="c${n}"/>`);
    tocItems.push(`<li><a href="c${n}.xhtml">${label}</a></li>`);
  }
  files.push({
    name: 'OEBPS/content.opf',
    data: `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" unique-identifier="bid" version="3.0" xml:lang="zh-CN">
<metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="bid">urn:uuid:bw-reader-demo</dc:identifier><dc:title>${title}</dc:title><dc:creator>${author}</dc:creator><dc:language>zh-CN</dc:language><meta property="dcterms:modified">2026-01-01T00:00:00Z</meta></metadata>
<manifest>${items.join('')}</manifest>
<spine>${spine.join('')}</spine>
</package>`,
    deflate: true,
  });
  files.push({
    name: 'OEBPS/nav.xhtml',
    data: `<?xml version="1.0" encoding="UTF-8"?><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>目录</title></head><body><nav epub:type="toc" id="toc"><ol>${tocItems.join('')}</ol></nav></body></html>`,
    deflate: true,
  });
  files.push({ name: 'OEBPS/plate.png', data: image, deflate: true });
  if (padBytes > 0) files.push({ name: 'OEBPS/plate-large.bin', data: crypto.randomBytes(padBytes) });
  return zipStore(files);
}
