import { Router } from 'express';
import { requireAuth } from '../security/middleware.js';
import { audit } from '../security/audit.js';
import { inspect } from '../security/logInsight.js';
import { report, purge } from '../store/mediaInventory.js';
import { revisions } from '../store/revisions.js';
import { posts } from '../store/posts.js';

/**
 * 馆务台账：媒体对账 + 安全日志聚合，都是登录后可见的运维视角。
 * 刻意与 /api/media/* 分开建路由：那里有 GET /media/:id 的签名直链门控，
 * 把管理类端点塞进同一前缀只会被它吃掉。
 */
export const opsRouter = Router();

opsRouter.get('/ops/media-report', requireAuth, (_req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.json(report());
});

/** 清理必须点名 + confirm=true；不带 confirm 只回预演结果，一个字节都不动 */
opsRouter.post('/ops/media-gc', requireAuth, (req, res) => {
  const body = req.body || {};
  const result = purge({
    ids: Array.isArray(body.ids) ? body.ids : [],
    files: Array.isArray(body.files) ? body.files : [],
    confirm: body.confirm === true,
  });
  audit('ops-media-gc', { dryRun: result.dryRun, removed: result.removed.indexRecords.length + result.removed.orphanFiles.length, skipped: result.skipped.length, bytes: result.bytesFreed }, req);
  res.json(result);
});

opsRouter.get('/ops/security-log', requireAuth, (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.json(
    inspect({
      event: String(req.query.event ?? ''),
      ip: String(req.query.ip ?? ''),
      user: String(req.query.user ?? ''),
      q: String(req.query.q ?? ''),
      limit: Number(req.query.limit) || undefined,
    })
  );
});

/**
 * 全站版本台账：每档留了几版、占多少体积、最新一版是谁在什么时候改的。
 * 撤档不抹历史（DEVELOPMENT §七 R-14），所以行上要标出"档案还在不在"，
 * 否则馆员会以为台账里那些标题是漏删的脏数据。
 */
opsRouter.get('/ops/revisions', requireAuth, (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const ledger = revisions.ledger({
    limit: Number(req.query.limit) || 200,
    postId: String(req.query.post ?? ''),
    kind: String(req.query.kind ?? ''),
  });
  const alive = new Set(posts.all().map((post) => post.id));
  for (const row of ledger.items) row.alive = alive.has(row.postId);
  for (const row of ledger.posts) row.alive = alive.has(row.postId);
  ledger.totals.orphanPosts = ledger.posts.filter((row) => !row.alive).length;
  res.json(ledger);
});
