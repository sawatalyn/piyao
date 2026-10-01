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
  // HSTS 与 upgrade-insecure-requests 只跟着**这一条请求实际走的协议**（`trust proxy` 已开，
  // Nginx 侧 `proxy_set_header X-Forwarded-Proto $scheme`）——判据与会话 cookie 的 Secure 同一个，也和
  // `nginx/bianwang-http.conf` 的"HTTP 版故意不发 HSTS"对齐。
  // 不能按 NODE_ENV 判：生产实况就是"暂无证书、内网明文 HTTP"，而 UIR 会让浏览器把每个 http:// 请求
  // 改写成 https://，直连后端时起站机不必有 TLS 监听，整站白屏（2026-10-01 用 192.168.10.11 实跑取证）。
  // 127.0.0.1 与 localhost 属"可信来源"、浏览器不升级，所以本机走查永远看不见这个坏法。
  const overTls = req.secure;
  if (config.isProd && overTls) {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  if (req.path.startsWith('/api/')) {
    res.setHeader('Cache-Control', NO_STORE);
    res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive');
  }
  // 生产环境下发严格 CSP：正文批注只用预置 class，因此无需 unsafe-inline
  if (config.isProd) {
    const csp = [
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
    ];
    if (overTls) csp.push('upgrade-insecure-requests');
    res.setHeader('Content-Security-Policy', csp.join('; '));
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

/**
 * Secure 只看**这一条请求是不是走 TLS 进来的**（`req.secure`，`trust proxy` 已开所以认 X-Forwarded-Proto）。
 * 不能按 `NODE_ENV=production` 判：本项目当前的生产实况就是"暂无证书、只能 HTTP"，
 * 那样发出去的会话 cookie 会被浏览器直接拒收（http://内网IP 不是可信来源），症状是"密码对却登录不上"。
 * 反过来 TLS 一开（后端自签或 Nginx 终结）就自动带上 Secure，不需要额外开关。
 */
export function sessionCookie(res, id, maxAgeSeconds, secure = false) {
  res.setHeader(
    'Set-Cookie',
    [
      `${config.cookieName}=${id}`,
      'Path=/',
      'HttpOnly',
      'SameSite=Strict',
      secure ? 'Secure' : '',
      `Max-Age=${maxAgeSeconds}`,
    ]
      .filter(Boolean)
      .join('; ')
  );
}

export function clearSessionCookie(res, secure = false) {
  sessionCookie(res, '', 0, secure);
}
