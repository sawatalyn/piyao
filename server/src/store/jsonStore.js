import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';

const queue = new Map();
const cache = new Map();
const stamps = new Map();
const gens = new Map();
const pendingWrite = new Set();

/** 每次内存态真的换了来源（从盘重读或本进程写入）就 +1，供派生结构（检索索引）判断自己是否过期 */
const bump = (name) => gens.set(name, (gens.get(name) ?? 0) + 1);

/** 外部改过文件（手工编辑、reseed 脚本）后自动失效，避免进程读到过期内存态 */
function freshOnDisk(file) {
  try {
    return Math.floor(fs.statSync(file).mtimeMs);
  } catch {
    return 0;
  }
}

/** 同一文件的落盘串行化：内存态即时可读，磁盘写排队。 */
function scheduleWrite(file, text) {
  const prev = queue.get(file) ?? Promise.resolve();
  const next = prev.then(() => writeAtomic(file, text), () => writeAtomic(file, text));
  queue.set(
    file,
    next.catch((err) => console.error(`[store] 写入 ${path.basename(file)} 失败:`, err?.message))
  );
  return next;
}

function writeAtomic(file, text) {
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(tmp, text, 'utf8');
  try {
    fs.renameSync(tmp, file);
  } catch (err) {
    if (process.platform === 'win32' && (err.code === 'EPERM' || err.code === 'EBUSY')) {
      fs.copyFileSync(tmp, file);
      fs.unlinkSync(tmp);
    } else {
      throw err;
    }
  }
}

function readFromDisk(file, fallback) {
  if (!fs.existsSync(file)) {
    writeAtomic(file, JSON.stringify(fallback, null, 2));
    return structuredClone(fallback);
  }
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    const backup = `${file}.corrupt-${Date.now()}`;
    fs.copyFileSync(file, backup);
    console.warn(`[store] ${path.basename(file)} 解析失败，已备份至 ${backup} 并回退默认值`);
    return structuredClone(fallback);
  }
}

function configOf(name) {
  const map = {
    posts: { file: config.paths.posts, fallback: { version: 1, items: [] } },
    revisions: { file: config.paths.revisions, fallback: { version: 1, items: [] } },
    menu: { file: config.paths.menu, fallback: { version: 1, items: [] } },
    tags: { file: config.paths.tags, fallback: { version: 1, items: [] } },
    mediaIndex: { file: config.paths.mediaIndex, fallback: { version: 1, items: [] } },
    sessions: { file: config.paths.sessions, fallback: { version: 1, items: [] } },
    attempts: { file: config.paths.attempts, fallback: { version: 1, items: [] } },
    resources: { file: config.paths.resources, fallback: { version: 1, items: [] } },
    library: { file: config.paths.library, fallback: { version: 1, items: [] } },
    libraryKeys: { file: config.paths.libraryKeys, fallback: { version: 1, items: [] } },
  };
  const entry = map[name];
  if (!entry) throw new Error(`unknown store: ${name}`);
  return entry;
}

/** 内存态与磁盘对齐：文件被外部换过（reseed、恢复备份、手工编辑）就重读并推进代次。
 *  派生结构（检索索引）据此判断自己是否过期，不必只依赖本进程的写入。 */
function syncFromDisk(name) {
  const { file, fallback } = configOf(name);
  const cached = cache.get(name);
  // 内存写尚未落盘时以内存为准；已落盘则用 mtime 判断外部是否改过文件
  if (cached && (pendingWrite.has(name) || stamps.get(name) === freshOnDisk(file))) {
    return false;
  }
  const value = readFromDisk(file, fallback);
  cache.set(name, value);
  stamps.set(name, freshOnDisk(file));
  bump(name);
  return true;
}

export const store = {
  read(name) {
    syncFromDisk(name);
    return structuredClone(cache.get(name));
  },
  write(name, value) {
    const { file } = configOf(name);
    cache.set(name, value);
    bump(name);
    pendingWrite.add(name);
    const settle = () => {
      pendingWrite.delete(name);
      stamps.set(name, freshOnDisk(file));
    };
    scheduleWrite(file, JSON.stringify(value, null, 2)).then(settle, settle);
    return value;
  },
  /** 内存态同步生效，磁盘写排队 */
  mutate(name, fn) {
    const current = this.read(name);
    const next = fn(current) ?? current;
    this.write(name, next);
    return next;
  },
  pending() {
    return Promise.allSettled([...queue.values()]);
  },
  /** 数据代次：外部换文件（reseed、恢复备份、手工编辑）与本进程写入都会推进它 */
  generation(name) {
    syncFromDisk(name);
    return gens.get(name) ?? 0;
  },
};
