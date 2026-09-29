import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import cookieParser from 'cookie-parser';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import { users } from './store/users.js';
import { attachSession, botGuard, fingerprintGuard, requireCsrf, securityHeaders } from './security/middleware.js';
import { authRouter } from './routes/auth.js';
import { contentRouter } from './routes/content.js';
import { mediaRouter } from './routes/media.js';
import { resourceRouter } from './routes/resources.js';
import { libraryRouter } from './routes/library.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.resolve(here, '../../web/dist');

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);

app.use(fingerprintGuard);
app.use(securityHeaders);
app.use(express.json({ limit: '640kb' }));
app.use(express.urlencoded({ extended: false, limit: '640kb' }));
app.use(cookieParser());

const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  // 一次整页加载要发 5 个请求（bootstrap/menu/话题导轨/资源库/镜像），240/分钟＝约 48 次刷新就自伤；
  // 抓取与爆破另有 loginLimiter、writeLimiter、深翻页门槛与签名直链兜底，这里只挡无脑洪水。
  limit: 600,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'rate-limited', message: '请求过于频繁，请稍候再试' },
});
const writeLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 40,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  keyGenerator: (req) => (req.user ? `u:${req.user.username}` : `ip:${ipKeyGenerator(req.ip)}`),
  message: { error: 'write-rate-limited', message: '保存操作过于频繁' },
});

app.use('/api', botGuard, apiLimiter, attachSession, requireCsrf);

app.get('/api/health', (_req, res) => res.json({ ok: true, at: new Date().toISOString() }));
app.use('/api', (req, _res, next) =>
  ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) ? writeLimiter(req, _res, next) : next()
);
app.use('/api', authRouter);
app.use('/api', mediaRouter);
app.use('/api', contentRouter);
app.use('/api', resourceRouter);
app.use('/api', libraryRouter);

app.get('/robots.txt', (_req, res) => {
  res.type('text/plain').send('User-agent: *\nDisallow: /api/\nDisallow: /edit\nDisallow: /reorder\nDisallow: /menu-editor\nDisallow: /users\nDisallow: /login\n');
});

if (fs.existsSync(DIST)) {
  app.use(express.static(DIST, { index: false, fallthrough: true, maxAge: config.isProd ? '1h' : 0 }));
  app.get(/^(?!\/api\/).*/i, (_req, res) => res.sendFile(path.join(DIST, 'index.html')));
}

app.use((req, res) => res.status(404).json({ error: 'no-route', path: req.path }));

app.use((err, _req, res, _next) => {
  const multerOverflow = err?.code === 'LIMIT_FILE_SIZE' || err?.code === 'LIMIT_UNEXPECTED_FILE';
  const status =
    Number(err?.status) ||
    (err?.type === 'entity.too.large' || multerOverflow ? 413 : 500);
  if (status >= 500) console.error('[api]', err);
  res.status(status).json({
    error: err?.code || 'server-error',
    message:
      multerOverflow && err?.code === 'LIMIT_FILE_SIZE'
        ? `图片超出 ${(config.maxImageBytes / 1024 / 1024).toFixed(0)}MB 上限`
        : status >= 500
          ? '服务内部错误，请稍后重试'
          : err?.message || '请求不被接受',
  });
});

users.init();

const server = app.listen(config.port, config.host, () => {
  console.log(`辨妄阁 API 已启动： http://${config.host}:${config.port}`);
  console.log(`数据目录： ${path.resolve(config.paths.posts, '..')}`);
  console.log(`口令存储： ${config.hashPasswords ? 'scrypt 哈希' : 'CSV 明文（按需求指定）'}`);
  if (!fs.existsSync(DIST)) console.log('提示：未检测到 web/dist，仅暴露 API。前端开发服务请用 pnpm dev:web。');
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
