import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';

const FILE = path.join(path.dirname(config.paths.posts), 'security.log');
const MAX_BYTES = 512 * 1024;
let buffer = [];
let flushing = false;

function write() {
  if (!buffer.length) return;
  const lines = buffer;
  buffer = [];
  try {
    if (fs.existsSync(FILE) && fs.statSync(FILE).size > MAX_BYTES) {
      fs.renameSync(FILE, `${FILE}.1`);
    }
    fs.appendFileSync(FILE, lines.map((l) => JSON.stringify(l)).join('\n') + '\n', 'utf8');
  } catch (err) {
    console.error('[audit] 写入失败', err?.message);
  }
}

/** 只记录安全事件：登录失败、蜜罐命中、锁定、CSRF 拒绝、上传、删除、改密 */
export function audit(event, detail = {}, req = null) {
  const entry = {
    at: new Date().toISOString(),
    event,
    ip: req?.ip ? String(req.ip) : undefined,
    user: req?.user?.username,
    ...detail,
  };
  buffer.push(entry);
  if (flushing) return;
  flushing = true;
  setTimeout(() => {
    flushing = false;
    write();
  }, 120).unref?.();
}

export const auditFile = () => FILE;
