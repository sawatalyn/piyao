import crypto from 'node:crypto';
import { config } from '../config.js';
import { store } from './jsonStore.js';

const sessions = new Map();
let loaded = false;

function loadOnce() {
  if (loaded) return;
  loaded = true;
  const snapshot = store.read('sessions');
  const now = Date.now();
  for (const item of snapshot.items) {
    if (item.expiresAt > now) sessions.set(item.id, item);
  }
}

function persist() {
  const items = [...sessions.values()];
  store.write("sessions", { version: 1, items });
}

export const sessionStore = {
  create(user) {
    loadOnce();
    const id = crypto.randomBytes(32).toString('base64url');
    const csrf = crypto.randomBytes(24).toString('base64url');
    const record = {
      id,
      csrf,
      user,
      createdAt: Date.now(),
      lastSeenAt: Date.now(),
      expiresAt: Date.now() + config.sessionTtlMs,
    };
    sessions.set(id, record);
    persist();
    return record;
  },
  get(id) {
    loadOnce();
    const record = sessions.get(id);
    if (!record) return null;
    if (record.expiresAt < Date.now()) {
      sessions.delete(id);
      return null;
    }
    record.lastSeenAt = Date.now();
    return record;
  },
  destroy(id) {
    loadOnce();
    const hit = sessions.delete(id);
    if (hit) persist();
    return hit;
  },
  /** 用户被删除或改密后，踢掉其全部会话 */
  dropFor(username) {
    loadOnce();
    let changed = false;
    for (const [id, record] of sessions) {
      if (record.user.username === username) {
        sessions.delete(id);
        changed = true;
      }
    }
    if (changed) persist();
  },
  sweep() {
    loadOnce();
    const now = Date.now();
    let changed = false;
    for (const [id, record] of sessions) {
      if (record.expiresAt < now) {
        sessions.delete(id);
        changed = true;
      }
    }
    if (changed) persist();
  },
};

setInterval(() => sessionStore.sweep(), 10 * 60 * 1000).unref?.();
