import { store } from '../store/jsonStore.js';

const DEFAULTS = { max: 5, lockMs: 10 * 60 * 1000, windowMs: 15 * 60 * 1000 };

/** 计数落盘：进程重启不得清零锁定；调用方自行约定 key 前缀（如 u:/ip:/lib:） */
function state() {
  const now = Date.now();
  const snapshot = store.read('attempts');
  snapshot.items = snapshot.items.filter((item) => item.lockedUntil > now || item.resetAt > now);
  return snapshot;
}

export function waitMs(key) {
  const item = state().items.find((entry) => entry.key === key);
  return item && item.lockedUntil > Date.now() ? item.lockedUntil - Date.now() : 0;
}

export function bumpAttempt(key, options = {}) {
  const { max, lockMs, windowMs } = { ...DEFAULTS, ...options };
  const snapshot = state();
  const now = Date.now();
  let item = snapshot.items.find((entry) => entry.key === key);
  if (!item || item.resetAt < now) {
    item = { key, count: 0, resetAt: now + windowMs, lockedUntil: 0 };
    snapshot.items.push(item);
  }
  item.count += 1;
  if (item.count >= max) item.lockedUntil = now + lockMs;
  store.write('attempts', snapshot);
  return item;
}

export function clearAttempt(key) {
  const snapshot = state();
  snapshot.items = snapshot.items.filter((entry) => entry.key !== key);
  store.write('attempts', snapshot);
}
