import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { config, LIBRARY_DIR, sign } from '../config.js';
import { store } from './jsonStore.js';

/** 允许镜像的文件类型：EPUB 与 PDF（按魔数识别，不信扩展名） */
const TYPES = [
  { type: 'application/epub+zip', ext: '.epub', magic: (head) => head.subarray(0, 4).toString('latin1') === 'PK\x03\x04' },
  { type: 'application/pdf', ext: '.pdf', magic: (head) => head.subarray(0, 5).toString('latin1') === '%PDF-' },
];

const newId = (prefix) => `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

function sniff(buffer) {
  return TYPES.find((entry) => entry.magic(buffer)) || null;
}

function hashFile(file) {
  return new Promise((resolve, reject) => {
    const stream = fs.createReadStream(file);
    const hash = crypto.createHash('sha256');
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

/** 目录里的真实文件路径：只允许 LIBRARY_DIR 下的 basename，杜绝路径穿越 */
function realPath(item) {
  const safe = path.basename(String(item?.file || ''));
  const target = path.join(LIBRARY_DIR, safe);
  if (!target.startsWith(LIBRARY_DIR) || !fs.existsSync(target)) return null;
  return target;
}

export const library = {
  dir: LIBRARY_DIR,
  all() {
    return [...store.read('library').items].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  },
  enabled() {
    return this.all().filter((item) => item.enabled);
  },
  get(id) {
    return this.all().find((item) => item.id === id) || null;
  },
  /** 磁盘上已存在但尚未登记的书籍文件，供登录用户一键登记 */
  pending() {
    const known = new Set(this.all().map((item) => item.file));
    if (!fs.existsSync(LIBRARY_DIR)) return [];
    return fs
      .readdirSync(LIBRARY_DIR, { withFileTypes: true })
      .filter((entry) => entry.isFile() && !entry.name.startsWith('.') && !known.has(entry.name))
      .map((entry) => {
        const stat = fs.statSync(path.join(LIBRARY_DIR, entry.name));
        return { file: entry.name, bytes: stat.size, mtime: stat.mtimeMs };
      })
      .filter((item) => item.bytes <= config.libraryMaxBytes);
  },
  async register({ file, ...input }, user) {
    const safe = path.basename(String(file || ''));
    const target = path.join(LIBRARY_DIR, safe);
    if (!safe || !fs.existsSync(target) || !fs.statSync(target).isFile()) {
      throw Object.assign(new Error('待登记的文件不在镜像目录内'), { status: 400 });
    }
    const buffer = Buffer.alloc(8);
    const fd = fs.openSync(target, 'r');
    try {
      fs.readSync(fd, buffer, 0, 8, 0);
    } finally {
      fs.closeSync(fd);
    }
    const kind = sniff(buffer);
    if (!kind) throw Object.assign(new Error('仅接受 EPUB 或 PDF 文件'), { status: 415 });
    const stat = fs.statSync(target);
    if (stat.size > config.libraryMaxBytes) {
      throw Object.assign(
        new Error(`单本不得超过 ${(config.libraryMaxBytes / 1024 / 1024).toFixed(0)}MB`),
        { status: 413 }
      );
    }
    const title = String(input.title ?? '').trim().slice(0, 120);
    if (!title) throw Object.assign(new Error('书名不可为空'), { status: 400 });
    const record = {
      id: newId('b'),
      title,
      author: String(input.author ?? '').trim().slice(0, 60),
      translator: String(input.translator ?? '').trim().slice(0, 60),
      group: String(input.group ?? '').trim().slice(0, 40),
      note: String(input.note ?? '').trim().slice(0, 300),
      sourceUrl: /^https?:\/\//i.test(String(input.sourceUrl ?? '').trim()) ? String(input.sourceUrl).trim().slice(0, 500) : '',
      rights: String(input.rights ?? '').trim().slice(0, 200),
      file: safe,
      type: kind.type,
      bytes: stat.size,
      sha256: await hashFile(target),
      enabled: input.enabled !== false,
      addedBy: user?.username || 'unknown',
      createdAt: new Date().toISOString(),
    };
    store.mutate('library', (state) => {
      state.items.push(record);
      return state;
    });
    return record;
  },
  update(id, input) {
    let updated = null;
    store.mutate('library', (state) => {
      const index = state.items.findIndex((item) => item.id === id);
      if (index < 0) throw Object.assign(new Error('镜像条目不存在'), { status: 404 });
      const previous = state.items[index];
      updated = {
        ...previous,
        title: String(input.title ?? previous.title).trim().slice(0, 120) || previous.title,
        author: String(input.author ?? previous.author).trim().slice(0, 60),
        translator: String(input.translator ?? previous.translator).trim().slice(0, 60),
        group: String(input.group ?? previous.group).trim().slice(0, 40),
        note: String(input.note ?? previous.note).trim().slice(0, 300),
        sourceUrl: /^https?:\/\//i.test(String(input.sourceUrl ?? '').trim())
          ? String(input.sourceUrl).trim().slice(0, 500)
          : '',
        rights: String(input.rights ?? previous.rights).trim().slice(0, 200),
        enabled: input.enabled !== false,
        updatedAt: new Date().toISOString(),
      };
      if (!updated.title) throw Object.assign(new Error('书名不可为空'), { status: 400 });
      state.items[index] = updated;
      return state;
    });
    return updated;
  },
  /** 只删登记与索引，磁盘文件由运维自管（镜像是备份载体，不自动抹除原件） */
  remove(id) {
    let removed = null;
    store.mutate('library', (state) => {
      const index = state.items.findIndex((item) => item.id === id);
      if (index < 0) throw Object.assign(new Error('镜像条目不存在'), { status: 404 });
      [removed] = state.items.splice(index, 1);
      return state;
    });
    return removed;
  },
  pathOf(item) {
    return realPath(item);
  },
};

export const libraryKeys = {
  all() {
    return [...store.read('libraryKeys').items].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  },
  get(id) {
    return this.all().find((item) => item.id === id) || null;
  },
  create({ code, label, scope, fileIds, expiresAt, hint }, user) {
    const plain = String(code ?? '');
    if (plain.length < 4 || plain.length > 40) {
      throw Object.assign(new Error('口令长度需为 4-40 个字符'), { status: 400 });
    }
    const ids = Array.isArray(fileIds) ? fileIds.map(String).filter(Boolean) : [];
    const record = {
      id: newId('k'),
      code: plain,
      label: String(label ?? '').trim().slice(0, 40) || '未命名口令',
      hint: String(hint ?? '').trim().slice(0, 120),
      scope: scope === 'files' && ids.length ? 'files' : 'all',
      fileIds: scope === 'files' ? ids.slice(0, 200) : [],
      expiresAt: Number.isFinite(Number(expiresAt)) && Number(expiresAt) > Date.now() ? Number(expiresAt) : 0,
      active: true,
      downloads: 0,
      createdBy: user?.username || 'unknown',
      createdAt: new Date().toISOString(),
    };
    store.mutate('libraryKeys', (state) => {
      state.items.push(record);
      return state;
    });
    return record;
  },
  update(id, input) {
    let updated = null;
    store.mutate('libraryKeys', (state) => {
      const index = state.items.findIndex((item) => item.id === id);
      if (index < 0) throw Object.assign(new Error('口令不存在'), { status: 404 });
      const previous = state.items[index];
      const ids = Array.isArray(input.fileIds) ? input.fileIds.map(String).filter(Boolean) : previous.fileIds;
      const plain = input.code === undefined || input.code === null || input.code === ''
        ? previous.code
        : String(input.code);
      if (plain.length < 4 || plain.length > 40) {
        throw Object.assign(new Error('口令长度需为 4-40 个字符'), { status: 400 });
      }
      updated = {
        ...previous,
        code: plain,
        label: String(input.label ?? previous.label).trim().slice(0, 40) || previous.label,
        hint: input.hint === undefined ? previous.hint : String(input.hint).trim().slice(0, 120),
        scope: input.scope === 'files' && ids.length ? 'files' : 'all',
        fileIds: input.scope === 'files' && ids.length ? ids.slice(0, 200) : [],
        expiresAt: input.expiresAt === undefined ? previous.expiresAt : Number(input.expiresAt) || 0,
        active: input.active !== false,
        updatedAt: new Date().toISOString(),
      };
      state.items[index] = updated;
      return state;
    });
    return updated;
  },
  remove(id) {
    let removed = null;
    store.mutate('libraryKeys', (state) => {
      const index = state.items.findIndex((item) => item.id === id);
      if (index < 0) throw Object.assign(new Error('口令不存在'), { status: 404 });
      [removed] = state.items.splice(index, 1);
      return state;
    });
    return removed;
  },
  usable(item) {
    if (!item || item.active === false) return false;
    if (item.expiresAt && item.expiresAt < Date.now()) return false;
    return true;
  },
  /** 先各自取摘要再定长比较：长度与内容都不通过反应时间外泄 */
  match(code) {
    const entered = crypto.createHash('sha256').update(String(code ?? '').slice(0, 64), 'utf8').digest();
    for (const item of this.all()) {
      if (!this.usable(item)) continue;
      const stored = crypto.createHash('sha256').update(String(item.code), 'utf8').digest();
      if (crypto.timingSafeEqual(stored, entered)) return item;
    }
    return null;
  },
  covers(key, fileId) {
    if (key.scope !== 'files') return true;
    return (key.fileIds || []).includes(fileId);
  },
  countDownload(id) {
    store.mutate('libraryKeys', (state) => {
      const item = state.items.find((entry) => entry.id === id);
      if (item) {
        item.downloads = (item.downloads || 0) + 1;
        item.lastUsedAt = new Date().toISOString();
      }
      return state;
    });
  },
};

/** 解锁令牌：10 分钟时效，绑定口令条目；下载时再核对范围 */
export const grants = {
  issue(key) {
    const exp = Date.now() + config.libraryGrantTtlMs;
    const sig = sign(`${key.id}.${exp}`);
    return { k: key.id, exp, sig, expiresAt: new Date(exp).toISOString() };
  },
  verify(keyId, exp, sig) {
    const key = libraryKeys.get(String(keyId || ''));
    if (!key || !libraryKeys.usable(key)) return null;
    const expireAt = Number(exp);
    if (!Number.isFinite(expireAt) || expireAt < Date.now()) return null;
    const expected = sign(`${key.id}.${expireAt}`);
    try {
      if (!crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(String(sig || '')))) return null;
    } catch {
      return null;
    }
    return key;
  },
};
