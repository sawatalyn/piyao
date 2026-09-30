import fs from 'node:fs';
import path from 'node:path';
import { auditFile } from './audit.js';

/**
 * security.log 的读取与聚合：不引第三方日志栈。
 * 理由写进许可台账——Loki / Grafana / Tempo 为 AGPL-3.0、Graylog 为 SSPL、Vector 为 MPL-2.0，
 * 按本馆"仅宽松许可入库"的约束都不能作为依赖引入；日志本身保持 JSONL 原样，
 * 运维要把它们接进外部栈时，直接 tail 这些文件即可（见 DEPLOY.md 的对接口径）。
 */

const ROTATED = 5;
const MAX_LINES = 20000;
const RECENT_KEEP = 120;

/** 聚合口径里算"值得盯"的事件：新增门控事件时要一并登记，否则台账会假装有增无险 */
export const SIGNAL_EVENTS = [
  'login-denied',
  'login-locked',
  'csrf-denied',
  'denied-client',
  'denied-empty-ua',
  'honeypot-hit',
  'media-reject',
  'library-unlock-denied',
  'library-unlock-locked',
  'library-scope-denied',
  'library-preview-denied',
  'library-asset-mismatch',
  'sign-tampered',
];

let cache = { key: '', entries: [], truncated: false, scanned: [] };

function sources() {
  const active = auditFile();
  const list = [];
  if (fs.existsSync(active)) list.push(active);
  for (let level = 1; level <= ROTATED; level += 1) {
    const rotated = `${active}.${level}`;
    if (fs.existsSync(rotated)) list.push(rotated);
  }
  return list;
}

/** 逐行解析：一行坏掉只丢那一行，不让半截轮转文件把整个台账打成 500 */
function parse(file) {
  const out = [];
  const text = fs.readFileSync(file, 'utf8');
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const entry = JSON.parse(trimmed);
      if (entry && typeof entry === 'object') out.push(entry);
    } catch {
      /* 轮转切割留下的半行 */
    }
  }
  return out;
}

function load() {
  const files = sources();
  const key = files
    .map((file) => {
      const stat = fs.statSync(file);
      return `${path.basename(file)}:${stat.size}:${Math.round(stat.mtimeMs)}`;
    })
    .join('|');
  if (cache.key === key) return cache;
  const entries = [];
  let truncated = false;
  for (const file of files) {
    const rows = parse(file);
    // 轮转号越大越旧：旧的先进数组，新的后进，读起来就是时间序
    entries.push(...rows);
    if (entries.length >= MAX_LINES) {
      truncated = true;
      break;
    }
  }
  entries.sort((a, b) => String(a.at ?? '').localeCompare(String(b.at ?? '')));
  cache = { key, entries, truncated, scanned: files.map((f) => path.basename(f)) };
  return cache;
}

const bump = (map, key, extra) => {
  if (!key) return;
  const row = map.get(key) || { key, count: 0, ...extra };
  row.count += 1;
  Object.assign(row, extra?.at ? { last: extra.at } : {});
  map.set(key, row);
};

const top = (map, n) => [...map.values()].sort((a, b) => b.count - a.count || String(a.key).localeCompare(String(b.key))).slice(0, n);

/**
 * @param {{event?: string, ip?: string, user?: string, q?: string, limit?: number}} filters
 */
export function inspect(filters = {}) {
  const { entries, truncated, scanned } = load();
  const byEvent = new Map();
  const byIp = new Map();
  const byUser = new Map();
  const byDay = new Map();
  const signals = new Map();

  for (const entry of entries) {
    bump(byEvent, String(entry.event ?? '—'));
    bump(byIp, String(entry.ip ?? '—'), { at: entry.at });
    bump(byUser, String(entry.user ?? ''), { at: entry.at });
    if (entry.at) bump(byDay, String(entry.at).slice(0, 10));
    if (SIGNAL_EVENTS.includes(entry.event)) bump(signals, String(entry.event), { at: entry.at });
  }

  const event = String(filters.event ?? '').trim();
  const ip = String(filters.ip ?? '').trim();
  const user = String(filters.user ?? '').trim();
  const needle = String(filters.q ?? '').trim().toLowerCase();

  const matched = entries.filter((entry) => {
    if (event && entry.event !== event) return false;
    if (ip && String(entry.ip ?? '') !== ip) return false;
    if (user && String(entry.user ?? '') !== user) return false;
    if (needle && !JSON.stringify(entry).toLowerCase().includes(needle)) return false;
    return true;
  });

  const limit = Math.min(Math.max(Number(filters.limit) || RECENT_KEEP, 1), 500);
  const first = entries[0]?.at || '';
  const last = entries[entries.length - 1]?.at || '';

  return {
    generatedAt: new Date().toISOString(),
    file: path.basename(auditFile()),
    scanned,
    totals: {
      entries: entries.length,
      matched: matched.length,
      from: first,
      to: last,
      distinctIps: byIp.size,
      distinctEvents: byEvent.size,
      truncated,
    },
    byEvent: top(byEvent, 40),
    byIp: top(byIp, 20),
    byUser: top(byUser, 20),
    byDay: top(byDay, 30).sort((a, b) => String(a.key).localeCompare(String(b.key))),
    signals: SIGNAL_EVENTS.map((name) => ({ key: name, count: signals.get(name)?.count || 0, last: signals.get(name)?.last || '' })),
    recent: matched.slice(-limit).reverse(),
  };
}
