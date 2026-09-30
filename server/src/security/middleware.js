import { config } from '../config.js';
import { sessionStore } from '../store/sessions.js';
import { audit } from './audit.js';

const NO_STORE = 'no-store';
const SCRATCH = 'strict-origin-when-cross-origin';

/** 安全响应头：严格 CSP（正文标注走预置 class，不用 inline style） */
export function securityHeaders(req, res, next) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', SCRATCH);
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), browsing-topics=()');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  res.setHeader('X-Permitted-Cross-Domain-Policies', 'none');
  if (config.isProd) {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  if (req.path.startsWith('/api/')) {
    res.setHeader('Cache-Control', NO_STORE);
    res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive');
  }
  // 生产环境下发严格 CSP：正文批注只用预置 class，因此无需 unsafe-inline
  if (config.isProd) {
    res.setHeader(
      'Content-Security-Policy',
      [
        "default-src 'self'",
        "script-src 'self'",
        "style-src 'self'",
        "img-src 'self'",
        "font-src 'self'",
        "connect-src 'self'",
        "form-action 'self'",
        "base-uri 'self'",
        "object-src 'none'",
        "frame-ancestors 'none'",
        'upgrade-insecure-requests',
      ].join('; ')
    );
  }
  next();
}

/** 去指纹：隐藏上游与框架签名 */
export function fingerprintGuard(req, res, next) {
  res.removeHeader('X-Powered-By');
  next();
}

const BOT_UA =
  /(scrapy|python-requests|python-urllib|go-http-client|java\/|okhttp|curl\/|wget\/|libwww|httpclient|spider|crawl|semrush|ahrefs|majestic|petalbot|bytespider|diffbot|extractor|masscan|zgrab)/i;

/** 反爬第一道：空 UA 与常见抓取库直拒；浏览器仍需通过限流与签名直链
 *  这道在限流之前，所以拒绝事件按 IP 每分钟记一条——否则一次 UA 洪水就能把安全日志刷满。 */
const DENIED_LOGGED = new Map();
const DENIED_WINDOW_MS = 60 * 1000;

function auditDenied(req, event, detail) {
  const now = Date.now();
  const last = DENIED_LOGGED.get(req.ip);
  if (last && now - last < DENIED_WINDOW_MS) return;
  DENIED_LOGGED.set(req.ip, now);
  if (DENIED_LOGGED.size > 2000) {
    for (const [ip, at] of DENIED_LOGGED) {
      if (now - at >= DENIED_WINDOW_MS) DENIED_LOGGED.delete(ip);
    }
  }
  audit(event, { ...detail, ua: String(req.headers['user-agent'] || '').slice(0, 120) }, req);
}

export function botGuard(req, res, next) {
  const ua = req.headers['user-agent'] || '';
  if (!ua) {
    auditDenied(req, 'denied-empty-ua', {});
    return res.status(403).json({ error: 'denied-empty-ua' });
  }
  if (BOT_UA.test(ua) && process.env.BW_ALLOW_TOOL_UA !== '1' && !sessionStore.get(req.cookies?.[config.cookieName])) {
    auditDenied(req, 'denied-client', {});
    return res.status(403).json({ error: 'denied-client' });
  }
  return next();
}

export function attachSession(req, _res, next) {
  const record = sessionStore.get(req.cookies?.[config.cookieName]);
  req.session = record || null;
  req.user = record?.user || null;
  next();
}

export function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'auth-required', message: '此操作需登录' });
  return next();
}

/** 双提交 CSRF：写操作必须回带会话内令牌 */
export function requireCsrf(req, res, next) {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) return next();
  // 中间件挂在 app.use('/api', …) 之下，req.path 已被剥掉前缀，必须用 originalUrl 比对
  const full = req.originalUrl.split('?')[0];
  if (full === '/api/auth/login') return next();
  if (!req.user) return next();
  const token = req.get(config.csrfHeader) || '';
  if (!token || token !== req.session.csrf) {
    // 缺令牌的写操作是撞 CSRF 的直接信号，之前只回 403 不留痕，等于把最该看的事件漏掉了
    audit('csrf-denied', { path: full, method: req.method, hasToken: Boolean(token) }, req);
    return res.status(403).json({ error: 'csrf-token-missing', message: '缺少有效的操作令牌' });
  }
  return next();
}

export function sessionCookie(res, id, maxAgeSeconds) {
  res.setHeader(
    'Set-Cookie',
    [
      `${config.cookieName}=${id}`,
      'Path=/',
      'HttpOnly',
      'SameSite=Strict',
      config.isProd ? 'Secure' : '',
      `Max-Age=${maxAgeSeconds}`,
    ]
      .filter(Boolean)
      .join('; ')
  );
}

export function clearSessionCookie(res) {
  sessionCookie(res, '', 0);
}
