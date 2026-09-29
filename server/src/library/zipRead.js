import fsp from 'node:fs/promises';
import path from 'node:path';
import zlib from 'node:zlib';

/**
 * EPUB 就是 ZIP：这里只读中央目录，正文按 local header 偏移定点取，
 * 让 10MB 以上的书也只把"当前这一章"解压进内存。
 */
const EOCD_SIG = 0x06054b50;
const EOCD64_LOC_SIG = 0x07064b50;
const EOCD64_SIG = 0x06064b50;
const CENTRAL_SIG = 0x02014b50;
const LOCAL_SIG = 0x04034b50;
const SCAN_TAIL = 65557; // 22 字节 EOCD + 最长 65535 注释

export class ZipError extends Error {
  constructor(message, status = 422) {
    super(message);
    this.status = status;
    this.code = 'epub-invalid';
  }
}

const normalizeName = (raw) =>
  String(raw)
    .replace(/\\/g, '/')
    .replace(/^\.\/+/, '')
    .replace(/^\/+/, '');

/** 三个长度/偏移字段若为 0xffffffff，真值在 Zip64 扩展字段里（顺序：解压后、压缩后、局部偏移） */
function applyZip64(extra, entry) {
  let at = 0;
  while (at + 4 <= extra.length) {
    const id = extra.readUInt16LE(at);
    const size = extra.readUInt16LE(at + 2);
    if (id === 0x0001) {
      let p = at + 4;
      for (const field of ['uncompSize', 'compSize', 'localOffset']) {
        if (entry[field] === 0xffffffff && p + 8 <= extra.length) {
          entry[field] = Number(extra.readBigUInt64LE(p));
          p += 8;
        }
      }
      return entry;
    }
    at += 4 + size;
  }
  return entry;
}

/** @returns {Promise<Map<string, {name,method,flags,compSize,uncompSize,localOffset}>>} */
export async function readZipDirectory(file) {
  let handle;
  try {
    handle = await fsp.open(file, 'r');
    const { size } = await handle.stat();
    if (size < 22) throw new ZipError('文件过小，不是可用的 EPUB 容器');

    const scan = Math.min(size, SCAN_TAIL);
    const tail = Buffer.alloc(scan);
    await handle.read(tail, 0, scan, size - scan);
    let eocd = -1;
    for (let i = tail.length - 22; i >= 0; i -= 1) {
      if (tail.readUInt32LE(i) === EOCD_SIG) {
        eocd = i;
        break;
      }
    }
    if (eocd < 0) throw new ZipError('未找到 ZIP 目录，无法按章节拆分');

    let count = tail.readUInt16LE(eocd + 10);
    let cdSize = tail.readUInt32LE(eocd + 12);
    let cdOffset = tail.readUInt32LE(eocd + 16);
    if (count === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) {
      if (eocd < 20 || tail.readUInt32LE(eocd - 20) !== EOCD64_LOC_SIG) throw new ZipError('Zip64 目录定位符缺失');
      const z64Offset = Number(tail.readBigUInt64LE(eocd - 20 + 8));
      const z64 = Buffer.alloc(56);
      await handle.read(z64, 0, 56, z64Offset);
      if (z64.readUInt32LE(0) !== EOCD64_SIG) throw new ZipError('Zip64 目录记录损坏');
      count = Number(z64.readBigUInt64LE(32));
      cdSize = Number(z64.readBigUInt64LE(40));
      cdOffset = Number(z64.readBigUInt64LE(48));
    }
    if (!count || cdSize <= 0 || cdOffset + cdSize > size) throw new ZipError('ZIP 目录长度不自洽');

    const cd = Buffer.alloc(cdSize);
    await handle.read(cd, 0, cdSize, cdOffset);

    const entries = new Map();
    let at = 0;
    for (let n = 0; n < count && at + 46 <= cd.length; n += 1) {
      if (cd.readUInt32LE(at) !== CENTRAL_SIG) break;
      const nameLen = cd.readUInt16LE(at + 28);
      const extraLen = cd.readUInt16LE(at + 30);
      const commentLen = cd.readUInt16LE(at + 32);
      const extraStart = at + 46 + nameLen;
      const entry = {
        name: normalizeName(cd.subarray(at + 46, at + 46 + nameLen).toString('utf8')),
        method: cd.readUInt16LE(at + 10),
        flags: cd.readUInt16LE(at + 8),
        compSize: cd.readUInt32LE(at + 20),
        uncompSize: cd.readUInt32LE(at + 24),
        localOffset: cd.readUInt32LE(at + 42),
      };
      at += 46 + nameLen + extraLen + commentLen;
      if (!entry.name || entry.name.endsWith('/')) continue;
      if (entry.compSize === 0xffffffff || entry.uncompSize === 0xffffffff || entry.localOffset === 0xffffffff) {
        applyZip64(cd.subarray(extraStart, extraStart + extraLen), entry);
      }
      entries.set(entry.name, entry);
    }
    if (!entries.size) throw new ZipError('ZIP 目录里没有可读条目');
    return entries;
  } finally {
    if (handle) await handle.close();
  }
}

export async function readZipEntry(file, entry, maxBytes) {
  if (!entry) throw new ZipError('EPUB 内缺少该文件');
  if (entry.flags & 0x0001) throw new ZipError('该 EPUB 已加密，无法在线阅览');
  if (entry.method !== 0 && entry.method !== 8) throw new ZipError(`不支持的压缩方式（method ${entry.method}）`);
  if (entry.compSize > maxBytes) throw new ZipError('单条目体积超出阅览上限', 413);

  let handle;
  try {
    handle = await fsp.open(file, 'r');
    const head = Buffer.alloc(30);
    const headRead = await handle.read(head, 0, 30, entry.localOffset);
    if (headRead.bytesRead !== 30 || head.readUInt32LE(0) !== LOCAL_SIG) throw new ZipError('EPUB 内部偏移已损坏');
    const start = entry.localOffset + 30 + head.readUInt16LE(26) + head.readUInt16LE(28);
    const raw = Buffer.alloc(entry.compSize);
    const bodyRead = await handle.read(raw, 0, entry.compSize, start);
    if (bodyRead.bytesRead !== entry.compSize) throw new ZipError('EPUB 条目不完整');
    if (entry.method === 0) {
      if (entry.uncompSize && entry.uncompSize !== raw.length) throw new ZipError('EPUB 条目长度与目录不符');
      return raw;
    }
    try {
      return zlib.inflateRawSync(raw, { maxOutputLength: maxBytes });
    } catch (err) {
      const over = err?.code === 'ERR_BUFFER_OUT_OF_BOUNDS' || /maxOutputLength/i.test(String(err?.message));
      throw new ZipError(over ? 'EPUB 条目解压后超出阅览上限' : 'EPUB 条目解压失败', over ? 413 : 422);
    }
  } finally {
    if (handle) await handle.close();
  }
}

/**
 * OPF 里的 href 相对 OPF 所在目录。归一化后仍越界（`../`、绝对路径、带协议）一律拒，
 * 图片资产接口据此只允许命中包内条目。
 * @returns {string|null} 包内路径；'' 表示纯锚点；null 表示拒绝
 */
export function zipResolve(baseDir, href) {
  const clean = String(href ?? '')
    .split('#')[0]
    .split('?')[0]
    .trim();
  if (!clean) return '';
  if (/^[a-z][a-z0-9+.-]*:/i.test(clean) || clean.startsWith('/')) return null;
  const joined = path.posix.normalize(path.posix.join(baseDir, clean.replace(/\\/g, '/')));
  if (!joined || joined === '..' || joined.startsWith('../') || joined.startsWith('/')) return null;
  return joined;
}
