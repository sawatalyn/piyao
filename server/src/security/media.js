import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { config, sign, MEDIA_DIR } from '../config.js';
import { store } from '../store/jsonStore.js';

/** 文件头魔数嗅探：不信客户端 Content-Type */
export function sniffImageType(buffer) {
  if (!buffer || buffer.length < 12) return null;
  const h = buffer.subarray(0, 12);
  const is = (offset, bytes) => bytes.every((b, i) => h[offset + i] === b);
  if (is(0, [0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (is(0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
  if (is(0, [0x47, 0x49, 0x46, 0x38]) && (h[4] === 0x37 || h[4] === 0x39)) return 'image/gif';
  if (is(0, [0x52, 0x49, 0x46, 0x46]) && h.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
  if (h.subarray(4, 8).toString('ascii') === 'ftyp' && /avif|heic/.test(h.subarray(8, 12).toString('ascii'))) return 'image/avif';
  return null;
}

const EXT = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/gif': '.gif',
  'image/webp': '.webp',
  'image/avif': '.avif',
};

export const media = {
  add({ buffer, originalName, type, uploader }) {
    const sniffed = sniffImageType(buffer);
    if (!sniffed || !config.allowedImageTypes.includes(sniffed)) {
      throw Object.assign(new Error('仅接受 JPEG/PNG/GIF/WebP/AVIF 图像'), { status: 415 });
    }
    if (buffer.length > config.maxImageBytes) {
      throw Object.assign(new Error(`单图不得超过 ${(config.maxImageBytes / 1024 / 1024).toFixed(0)}MB`), { status: 413 });
    }
    const id = `m${Date.now().toString(36)}${crypto.randomBytes(4).toString('hex')}`;
    const file = `${id}${EXT[sniffed]}`;
    fs.writeFileSync(path.join(MEDIA_DIR, file), buffer, { mode: 0o640 });
    const record = {
      id,
      file,
      type: sniffed,
      bytes: buffer.length,
      alt: sanitizeAlt(originalName),
      uploadedBy: uploader || 'unknown',
      createdAt: new Date().toISOString(),
    };
    store.mutate('mediaIndex', (state) => {
      state.items.push(record);
      return state;
    });
    return record;
  },
  get(id) {
    return index().find((item) => item.id === id) || null;
  },
  index,
  remove(id) {
    const record = this.get(id);
    if (!record) return false;
    const target = path.join(MEDIA_DIR, record.file);
    if (fs.existsSync(target)) fs.unlinkSync(target);
    store.mutate('mediaIndex', (state) => {
      state.items = state.items.filter((item) => item.id !== id);
      return state;
    });
    return true;
  },
  /** 签名直链：短时效，阻断批量爬取与外链盗用 */
  signedUrl(id, ttlMs = config.mediaTtlMs) {
    const exp = Date.now() + ttlMs;
    const sig = sign(`${id}.${exp}`);
    return `/api/media/${id}?exp=${exp}&sig=${sig}`;
  },
  verify(id, exp, sig) {
    if (!id || !exp || !sig) return false;
    const expireAt = Number(exp);
    if (!Number.isFinite(expireAt) || expireAt < Date.now()) return false;
    const expected = sign(`${id}.${expireAt}`);
    try {
      return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(String(sig)));
    } catch {
      return false;
    }
  },
};


function sanitizeAlt(name) {
  return String(name || '插图').replace(/[^\w .\-(\u4e00-\u9fa5)]/g, '').slice(0, 60) || '插图';
}

function index() {
  return store.read('mediaIndex').items;
}
