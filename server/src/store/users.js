import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { parse } from 'csv-parse/sync';
import { stringify } from 'csv-stringify/sync';
import { config } from '../config.js';

/**
 * 用户表：CSV 明文存储（用户明确指定的形态）。
 * 列序：username,password,role,displayName,createdAt
 * 若 BW_HASH_PASSWORDS=1，password 列存放 scrypt 摘要，格式 scrypt$<salt>$<hash>。
 */
const COLUMNS = ['username', 'password', 'role', 'displayName', 'createdAt'];

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

/**
 * CSV 的读写交给 csv-parse / csv-stringify（MIT、零依赖）。
 * 自己按行 split 的版本无法表达"字段内含换行"：显示名里一个 \n 就会被读成两行，
 * 而这一份名册里躺着明文口令——多出一行意味着多出一个可登录身份。
 */
function readRows() {
  if (!fs.existsSync(config.paths.users)) return [];
  const records = parse(fs.readFileSync(config.paths.users, 'utf8'), {
    columns: false,
    skip_empty_lines: true,
    relax_column_count: true,
  });
  return records
    // 表头行按整行比对：用户名恰好以 "username," 开头的记录不该被当成表头丢掉
    .filter((row) => !(row[0] === 'username' && row[1] === 'password'))
    .map(([username = '', password = '', role = '', displayName = '', createdAt = '']) => ({
      username,
      password,
      role,
      displayName,
      createdAt,
    }))
    .filter((row) => row.username);
}

function writeRows(rows) {
  const text = stringify(
    [COLUMNS, ...rows.map((r) => [r.username, r.password, r.role, r.displayName, r.createdAt].map((v) => String(v ?? '')))],
    // 记录分隔符是 CRLF，而字段里可能只含裸 \n：默认规则不会给它加引号，写出来就是坏 CSV。
    // 显式把"含分隔符、引号、任一换行"的字段全部括起来。
    { header: false, record_delimiter: '\r\n', quoted_match: /[",\r\n]/ }
  );
  fs.mkdirSync(path.dirname(config.paths.users), { recursive: true });
  fs.writeFileSync(config.paths.users, text, 'utf8');
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
