import rateLimit from 'express-rate-limit';
import { Router } from 'express';
import { config } from '../config.js';
import { users } from '../store/users.js';
import { sessionStore } from '../store/sessions.js';
import { bumpAttempt, clearAttempt, waitMs } from '../security/attempts.js';
import { audit } from '../security/audit.js';
import { clearSessionCookie, requireAuth, sessionCookie } from '../security/middleware.js';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 12,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'too-many-logins', message: '登录尝试过于频繁，请稍后再试' },
});

export const authRouter = Router();

authRouter.post('/auth/login', loginLimiter, async (req, res) => {
  const ipKey = `ip:${req.ip}`;
  const nameKey = `u:${String(req.body?.username || '').toLowerCase()}`;
  const wait = Math.max(waitMs(ipKey), waitMs(nameKey));
  if (wait > 0) {
    audit('login-locked', { seconds: Math.ceil(wait / 1000), attempted: nameKey.slice(2) }, req);
    res.set('Retry-After', String(Math.ceil(wait / 1000)));
    return res.status(429).json({ error: 'locked', message: `失败过多，请 ${Math.ceil(wait / 1000)} 秒后重试` });
  }

  // 蜜罐字段：真人不会填写，脚本常会填满所有字段
  if (String(req.body?.company_website ?? '') !== '') {
    audit('honeypot-hit', { attempted: String(req.body?.username || '').slice(0, 32) }, req);
    await sleep(400);
    return res.status(401).json({ error: 'bad-credentials', message: '用户名或密码不正确' });
  }

  const { username, password } = req.body || {};
  const identity = users.verify(String(username || ''), String(password || ''));
  if (!identity) {
    // 统一文案 + 固定最小延迟，避免用户名枚举与计时侧写
    const ipItem = bumpAttempt(ipKey);
    const nameItem = bumpAttempt(nameKey);
    audit(
      'login-failed',
      { attempted: String(username || '').slice(0, 32), ipCount: ipItem.count, nameCount: nameItem.count },
      req
    );
    await sleep(300);
    return res.status(401).json({ error: 'bad-credentials', message: '用户名或密码不正确' });
  }

  clearAttempt(ipKey);
  clearAttempt(nameKey);
  const record = sessionStore.create(identity);
  sessionCookie(res, record.id, Math.floor(config.sessionTtlMs / 1000), Boolean(req.secure));
  req.session = record;
  audit('login-ok', { as: identity.username }, req);
  return res.json({ user: record.user, csrfToken: record.csrf, issuedAt: new Date().toISOString() });
});

authRouter.post('/auth/logout', (req, res) => {
  const id = req.cookies?.[config.cookieName];
  if (id) sessionStore.destroy(id);
  clearSessionCookie(res, Boolean(req.secure));
  res.json({ ok: true });
});

authRouter.get('/auth/me', (req, res) => {
  if (!req.user) return res.json({ user: null, csrfToken: '' });
  return res.json({ user: req.user, csrfToken: req.session.csrf });
});

authRouter.get('/users', requireAuth, (req, res) => {
  const items = users.all();
  res.json({
    items,
    storage: config.hashPasswords ? 'scrypt' : 'plaintext-csv',
    warning: config.hashPasswords
      ? ''
      : '按部署需求以 CSV 明文保存口令。公网实例请设 BW_HASH_PASSWORDS=1 切换为 scrypt，并立即改掉默认 admin/admin。',
    defaultInUse: items.some((u) => u.username === 'admin' && u.storage === 'plain'),
  });
});

authRouter.post('/users', requireAuth, (req, res) => {
  const { username, password, role, displayName } = req.body || {};
  const items = users.upsert({ username, password, role, displayName });
  sessionStore.dropFor(String(username || ''));
  audit('user-write', { target: String(username || '') }, req);
  res.json({ items });
});

authRouter.delete('/users/:username', requireAuth, (req, res) => {
  const items = users.remove(req.params.username);
  sessionStore.dropFor(req.params.username);
  audit('user-delete', { target: req.params.username }, req);
  res.json({ items });
});
