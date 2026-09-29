import fs from 'node:fs';
import path from 'node:path';
import { Router } from 'express';
import multer from 'multer';
import { config, MEDIA_DIR } from '../config.js';
import { media } from '../security/media.js';
import { requireAuth } from '../security/middleware.js';
import { audit } from '../security/audit.js';


const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.maxImageBytes, files: 1, fields: 8 },
});

export const mediaRouter = Router();

mediaRouter.post('/media', requireAuth, upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'no-file', message: '未收到图片数据' });
  const record = media.add({
    buffer: req.file.buffer,
    originalName: req.file.originalname,
    type: req.file.mimetype,
    uploader: req.user?.username,
  });
  audit('media-upload', { id: record.id, bytes: record.bytes, type: record.type }, req);
  return res.status(201).json({
    id: record.id,
    alt: record.alt,
    type: record.type,
    bytes: record.bytes,
    url: media.signedUrl(record.id),
  });
});

/** 图片读取需带签名与时效，阻断盗链与批量爬取 */
mediaRouter.get('/media/:id', (req, res) => {
  const { id } = req.params;
  const granted = media.verify(id, req.query.exp, req.query.sig);
  if (!granted) return res.status(403).json({ error: 'link-expired', message: '图片链接已过期' });
  const record = media.get(id);
  if (!record) return res.status(404).json({ error: 'not-found' });
  const target = path.join(MEDIA_DIR, path.basename(record.file));
  if (!target.startsWith(MEDIA_DIR) || !fs.existsSync(target)) return res.status(404).json({ error: 'not-found' });
  res.setHeader('Cache-Control', 'private, max-age=1200');
  res.setHeader('Content-Security-Policy', "default-src 'none'; img-src 'self'; sandbox");
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Type', record.type);
  return res.sendFile(target);
});
