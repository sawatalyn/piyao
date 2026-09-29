import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { config } from '../config.js';

/**
 * 用户表：CSV 明文存储（用户明确指定的形态）。
 * 列序：username,password,role,displayName,createdAt
 * 若 BW_HASH_PASSWORDS=1，password 列存放 scrypt 摘要，格式 scrypt$<salt>$<hash>。
 */
const HEADER = 'username,password,role,displayName,createdAt';

function hashPassword(plain, salt = crypto.randomBytes(16).toString('hex')) {
  const derived = crypto.scryptSync(plain, salt, 32).toString('hex');
  return `scrypt$${salt}$${derived}`;
}

function verifyPassword(plain, stored) {
  if (typeof stored === 'string' && stored.startsWith('scrypt$')) {
    const [, salt, hash] = stored.split('$');
    const candidate = crypto.scryptSync(plain, salt, 32).toString('hex');
    const a = Buffer.from(hash, 'hex');
    const b = Buffer.from(candidate, 'hex');
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  }
  const a = Buffer.from(String(stored));
  const b = Buffer.from(String(plain));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function parseCsvLine(line) {
  const out = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i += 1;
      } else if (ch === '"') {
        quoted = false;
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ',') {
      out.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}

const cell = (value) => {
  const text = String(value ?? '');
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

function readRows() {
  if (!fs.existsSync(config.paths.users)) return [];
  return fs
    .readFileSync(config.paths.users, 'utf8')
    .split(/\r?\n/)
    .filter((line) => line.trim() && !line.startsWith(HEADER))
    .map((line) => {
      const [username, password, role, displayName, createdAt] = parseCsvLine(line);
      return { username, password, role, displayName, createdAt };
    });
}

function writeRows(rows) {
  const body = [HEADER, ...rows.map((r) => [r.username, r.password, r.role, r.displayName, r.createdAt].map(cell).join(','))];
  fs.mkdirSync(path.dirname(config.paths.users), { recursive: true });
  fs.writeFileSync(config.paths.users, `${body.join('\r\n')}\r\n`, 'utf8');
}

function ensureSeed() {
  if (!fs.existsSync(config.paths.users)) {
    const now = new Date().toISOString();
    writeRows([
      {
        username: 'admin',
        password: config.hashPasswords ? hashPassword('admin') : 'admin',
        role: 'admin',
        displayName: '档案管理员',
        createdAt: now,
      },
    ]);
  }
}

export const users = {
  init() {
    ensureSeed();
    return this;
  },
  all() {
    ensureSeed();
    return readRows().map((r) => ({
      username: r.username,
      role: r.role,
      displayName: r.displayName,
      createdAt: r.createdAt,
      // 口令仅在 BW_SHOW_PASSWORDS=1 时回显，默认不随接口外泄
      password: process.env.BW_SHOW_PASSWORDS === '1' ? r.password : '',
      storage: String(r.password).startsWith('scrypt$') ? 'scrypt' : 'plain',
    }));
  },
  find(username) {
    ensureSeed();
    return readRows().find((r) => r.username === username);
  },
  verify(username, password) {
    const row = this.find(username);
    if (!row) {
      verifyPassword(password, 'x'.repeat(64));
      return null;
    }
    return verifyPassword(password, row.password)
      ? { username: row.username, role: row.role, displayName: row.displayName }
      : null;
  },
  upsert({ username, password, role = 'editor', displayName = '' }) {
    ensureSeed();
    if (!/^[A-Za-z0-9_.-]{2,32}$/.test(username)) {
      throw Object.assign(new Error('用户名需为 2-32 位字母、数字、_ . -'), { status: 400 });
    }
    if (String(password).length < 8) {
      throw Object.assign(new Error('新密码长度至少 8 位'), { status: 400 });
    }
    const rows = readRows();
    const stored = config.hashPasswords ? hashPassword(password) : String(password);
    const existing = rows.find((r) => r.username === username);
    if (existing) {
      existing.password = stored;
      existing.role = role;
      existing.displayName = displayName || existing.displayName;
    } else {
      rows.push({
        username,
        password: stored,
        role,
        displayName: displayName || username,
        createdAt: new Date().toISOString(),
      });
    }
    writeRows(rows);
    return this.all();
  },
  remove(username) {
    const rows = readRows();
    if (username === 'admin') throw Object.assign(new Error('内置 admin 不可删除'), { status: 400 });
    writeRows(rows.filter((r) => r.username !== username));
    return this.all();
  },
};
