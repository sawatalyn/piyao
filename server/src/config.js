import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(here, '..');
export const DATA_DIR = process.env.BW_DATA_DIR
  ? path.resolve(process.env.BW_DATA_DIR)
  : path.join(ROOT, 'data');
export const MEDIA_DIR = path.join(DATA_DIR, 'media');
/** 洛琪希图书馆镜像的落盘目录：文件由运维自行放入，后端只登记与分发，不代抓取外部网盘 */
export const LIBRARY_DIR = path.join(DATA_DIR, 'library');

fs.mkdirSync(MEDIA_DIR, { recursive: true });
fs.mkdirSync(LIBRARY_DIR, { recursive: true });

function persistentSecret(name) {
  const file = path.join(DATA_DIR, name);
  if (process.env.BW_SECRET) return process.env.BW_SECRET;
  if (fs.existsSync(file)) return fs.readFileSync(file, 'utf8').trim();
  const secret = crypto.randomBytes(32).toString('hex');
  fs.writeFileSync(file, secret, { mode: 0o600 });
  return secret;
}

export const config = {
  port: Number(process.env.BW_PORT || 8787),
  host: process.env.BW_HOST || '127.0.0.1',
  isProd: process.env.NODE_ENV === 'production',
  secret: persistentSecret('.secret'),
  // 上传限制：单图 5MB，单次请求 1 个文件
  maxImageBytes: 5 * 1024 * 1024,
  allowedImageTypes: ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/avif'],
  mediaTtlMs: 30 * 60 * 1000,
  sessionTtlMs: 12 * 60 * 60 * 1000,
  // 镜像下载令牌时效与单本体积上限（EPUB/PDF 远大于插图，单独放宽）
  libraryGrantTtlMs: 10 * 60 * 1000,
  libraryMaxBytes: Number(process.env.BW_LIBRARY_MAX_MB || 120) * 1024 * 1024,
  libraryTypes: { 'application/epub+zip': '.epub', 'application/pdf': '.pdf' },
  // 在线阅览：超过该体积的书本一律按章节分页渲染（整本进内存与响应体都不划算）
  readSplitBytes: Number(process.env.BW_READ_SPLIT_MB || 10) * 1024 * 1024,
  // 单个 zip 条目解压后的上限，防解压炸弹
  readEntryMaxBytes: Number(process.env.BW_READ_ENTRY_MAX_MB || 16) * 1024 * 1024,
  readPageMaxBytes: Number(process.env.BW_READ_PAGE_MAX_KB || 128) * 1024,
  readWholeMaxBytes: Number(process.env.BW_READ_WHOLE_MAX_KB || 1024) * 1024,
  // PDF 没有 spine：有书签就按书签分节，没书签就按这个页数切（BW_PDF_PAGES_PER_CHAPTER）
  pdfPagesPerChapter: Number(process.env.BW_PDF_PAGES_PER_CHAPTER || 12),
  // 修订档案：每档保留最近 N 个版本，超出即丢最旧（版本历史是台账不是备份盘）
  revisionKeep: Number(process.env.BW_REVISION_KEEP || 30),
  // 明文 CSV 口令存储为用户明确指定的需求；置 1 可切换为 scrypt 哈希
  hashPasswords: process.env.BW_HASH_PASSWORDS === '1',
  // 写操作限流（每分钟每用户/每 IP）：正常编辑一页档案要 3-5 次写，40 足够；自检线里会调高以免自伤
  writeLimitPerMinute: Number(process.env.BW_WRITE_LIMIT_PER_MIN || 40),
  cookieName: 'bw_sid',
  csrfHeader: 'x-bw-csrf',
  mediaDir: MEDIA_DIR,
  libraryDir: LIBRARY_DIR,
  paths: {
    posts: path.join(DATA_DIR, 'posts.json'),
    revisions: path.join(DATA_DIR, 'revisions.json'),
    menu: path.join(DATA_DIR, 'menu.json'),
    tags: path.join(DATA_DIR, 'tags.json'),
    users: path.join(DATA_DIR, 'users.csv'),
    sessions: path.join(DATA_DIR, 'sessions.json'),
    attempts: path.join(DATA_DIR, 'login-attempts.json'),
    mediaIndex: path.join(DATA_DIR, 'media-index.json'),
    resources: path.join(DATA_DIR, 'resources.json'),
    library: path.join(DATA_DIR, 'library.json'),
    libraryKeys: path.join(DATA_DIR, 'library-keys.json'),
  },
};

export const sign = (value) =>
  crypto.createHmac('sha256', config.secret).update(value).digest('base64url');
