import { Router } from 'express';
import { RESOURCE_GROUPS, resources } from '../store/resources.js';
import { requireAuth } from '../security/middleware.js';
import { audit } from '../security/audit.js';

export const resourceRouter = Router();

/** 侧栏与资源库页共用：只出可见条目，按分组排好 */
resourceRouter.get('/resources', (_req, res) => {
  res.json({ groups: resources.groups(), total: resources.visible().length });
});

/** 管理视图含隐藏条目，需登录 */
resourceRouter.get('/resources/all', requireAuth, (_req, res) => {
  res.json({ items: resources.all(), groups: RESOURCE_GROUPS });
});

resourceRouter.post('/resources', requireAuth, (req, res) => {
  const record = resources.create(req.body, req.user);
  audit('resource-write', { id: record.id, name: record.name }, req);
  res.status(201).json({ resource: record });
});

resourceRouter.put('/resources/:id', requireAuth, (req, res) => {
  const record = resources.update(req.params.id, req.body);
  audit('resource-write', { id: record.id, name: record.name }, req);
  res.json({ resource: record });
});

resourceRouter.delete('/resources/:id', requireAuth, (req, res) => {
  const removed = resources.remove(req.params.id);
  audit('resource-delete', { id: removed.id, name: removed.name }, req);
  res.json({ ok: true, id: removed.id });
});
