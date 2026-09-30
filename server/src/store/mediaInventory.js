import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { MEDIA_DIR } from '../config.js';
import { media } from '../security/media.js';
import { posts } from './posts.js';

/**
 * 媒体台账：把"磁盘上的文件"与"索引里的记录"和"在档档案的引用"三方对账。
 * 自动回收只发生在写入路径（保存/删档时顺带清），所以崩溃、手工拷文件、外部换数据目录
 * 都可能留下对不上号的残迹——这些必须看得见，并且要能逐个点名清理，不给"一键清空磁盘"的入口。
 */

/** 只认本站上传器写出的扩展名：别人放进媒体目录的东西一律不进清理候选 */
const OWN_EXT = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.avif']);

const extOf = (name) => path.extname(String(name)).toLowerCase();
const inDir = (name) => {
  const safe = path.basename(String(name || ''));
  const target = path.join(MEDIA_DIR, safe);
  return target.startsWith(MEDIA_DIR) && safe === String(name) ? target : null;
};

function sha256Of(target) {
  try {
    return crypto.createHash('sha256').update(fs.readFileSync(target)).digest('hex');
  } catch {
    return '';
  }
}

function diskRows() {
  const rows = new Map();
  if (!fs.existsSync(MEDIA_DIR)) return rows;
  for (const entry of fs.readdirSync(MEDIA_DIR, { withFileTypes: true })) {
    if (!entry.isFile() || entry.name.startsWith('.')) continue;
    const full = path.join(MEDIA_DIR, entry.name);
    const stat = fs.statSync(full);
    rows.set(entry.name, { file: entry.name, bytes: stat.size, mtime: stat.mtimeMs });
  }
  return rows;
}

export function report() {
  const records = media.index();
  const byFile = new Map(records.map((row) => [path.basename(String(row.file)), row]));
  const disk = diskRows();
  const referenced = posts.referencedIds();

  const orphanFiles = [];
  const staleIndex = [];
  const unreferenced = [];
  const used = [];

  for (const [name, row] of disk) {
    if (byFile.has(name)) continue;
    orphanFiles.push({
      key: `file:${name}`,
      kind: 'orphan-file',
      file: name,
      bytes: row.bytes,
      mtime: new Date(row.mtime).toISOString(),
      mine: OWN_EXT.has(extOf(name)),
      sha256: OWN_EXT.has(extOf(name)) ? sha256Of(path.join(MEDIA_DIR, name)) : '',
    });
  }

  for (const record of records) {
    const name = path.basename(String(record.file));
    const base = {
      id: record.id,
      key: `id:${record.id}`,
      file: name,
      alt: record.alt,
      type: record.type,
      bytes: record.bytes,
      uploadedBy: record.uploadedBy,
      createdAt: record.createdAt,
    };
    if (!disk.has(name)) {
      staleIndex.push({ ...base, kind: 'missing-file' });
      continue;
    }
    if (referenced.has(record.id)) {
      used.push(base);
      continue;
    }
    unreferenced.push({ ...base, kind: 'unreferenced' });
  }

  const sum = (rows) => rows.reduce((total, row) => total + (Number(row.bytes) || 0), 0);
  const reclaimable = sum(orphanFiles.filter((row) => row.mine)) + sum(unreferenced);

  return {
    generatedAt: new Date().toISOString(),
    dir: 'server/data/media',
    totals: {
      indexRecords: records.length,
      diskFiles: disk.size,
      used: used.length,
      unreferenced: unreferenced.length,
      orphanFiles: orphanFiles.length,
      staleIndex: staleIndex.length,
      reclaimableBytes: reclaimable,
      diskBytes: sum([...disk.values()]),
    },
    used,
    unreferenced,
    orphanFiles,
    staleIndex,
  };
}

/**
 * 清理候选逐个点名，绝不接受"全部"这种通配：
 * ids 撤索引记录并删对应文件，files 只删磁盘上确实无索引归属的本站扩展名孤儿。
 * confirm !== true 时只做预演，一个字节都不动。
 */
export function purge({ ids = [], files = [], confirm = false } = {}) {
  const snapshot = report();
  const referenced = posts.referencedIds();
  const byId = new Map(media.index().map((row) => [row.id, row]));
  const orphanByKey = new Map(snapshot.orphanFiles.map((row) => [row.file, row]));

  const plan = { indexRecords: [], orphanFiles: [] };
  const skipped = [];

  for (const id of new Set(ids.map(String))) {
    const record = byId.get(id);
    if (!record) {
      skipped.push({ key: `id:${id}`, reason: '索引里没有这条记录' });
      continue;
    }
    if (referenced.has(id)) {
      skipped.push({ key: `id:${id}`, reason: '仍被在档档案引用，拒绝删除' });
      continue;
    }
    plan.indexRecords.push({ id, file: path.basename(String(record.file)), bytes: record.bytes });
  }

  for (const name of new Set(files.map(String))) {
    const target = inDir(name);
    if (!target) {
      skipped.push({ key: `file:${name}`, reason: '文件名不合法（须是媒体目录内的裸文件名）' });
      continue;
    }
    if (!OWN_EXT.has(extOf(name))) {
      skipped.push({ key: `file:${name}`, reason: '非本站写出的扩展名，不代作决定' });
      continue;
    }
    if (!orphanByKey.has(name)) {
      skipped.push({ key: `file:${name}`, reason: '该文件在索引中有归属，不能按孤儿清理' });
      continue;
    }
    plan.orphanFiles.push({ file: name, bytes: orphanByKey.get(name).bytes });
  }

  const bytesToFree =
    plan.indexRecords.reduce((t, r) => t + (Number(r.bytes) || 0), 0) + plan.orphanFiles.reduce((t, r) => t + (Number(r.bytes) || 0), 0);

  if (confirm !== true) {
    return { dryRun: true, plan, skipped, bytesFreed: bytesToFree, removed: { indexRecords: [], orphanFiles: [] } };
  }

  const removed = { indexRecords: [], orphanFiles: [] };
  for (const row of plan.indexRecords) {
    if (media.remove(row.id)) removed.indexRecords.push(row);
    else skipped.push({ key: `id:${row.id}`, reason: '删除时记录已不在，跳过' });
  }
  for (const row of plan.orphanFiles) {
    const target = inDir(row.file);
    if (!target) {
      skipped.push({ key: `file:${row.file}`, reason: '删除时文件路径不合法，跳过' });
      continue;
    }
    if (media.index().some((record) => path.basename(String(record.file)) === row.file)) {
      skipped.push({ key: `file:${row.file}`, reason: '删除前索引又出现了归属，停手' });
      continue;
    }
    try {
      fs.rmSync(target, { force: true });
      removed.orphanFiles.push(row);
    } catch (err) {
      skipped.push({ key: `file:${row.file}`, reason: `删除失败：${err?.message || '未知错误'}` });
    }
  }
  return { dryRun: false, plan, skipped, bytesFreed: removed.indexRecords.reduce((t, r) => t + r.bytes, 0) + removed.orphanFiles.reduce((t, r) => t + r.bytes, 0), removed };
}
