// 开放集成路由
//  /api/integrations/wps/sync   POST  开放接口：WPS 脚本推送工时（API Key 鉴权 + 限流）
//  /api/integrations/keys        GET/POST/DELETE  密钥管理（admin 会话鉴权）
import express from 'express';
import { wrap } from '../utils/http.js';
import { requireRole } from '../middleware/auth.js';
import { apiKeyAuth } from '../middleware/apiKeyAuth.js';
import { rateLimit } from '../middleware/rateLimit.js';
import * as svc from '../services/integrationService.js';

const router = express.Router();

// ---------------- 开放接口：WPS 同步 ----------------
router.post('/wps/sync', apiKeyAuth, rateLimit(), wrap(async (req, res) => {
  const idemKey = req.get('Idempotency-Key') || req.get('X-Idempotency-Key') || null;
  const ip = (req.headers['x-forwarded-for']?.split(',')[0]?.trim()) || req.ip || '';
  const t0 = Date.now();
  try {
    const result = await svc.syncWorkHours(req.apiKey, req.body, idemKey);
    const status = result.duplicate ? 200 : 201;
    await svc.recordSyncLog({ keyId: req.apiKey.id, status: 'success', accepted: result.accepted, ip, ms: Date.now() - t0 });
    res.status(status).json({
      code: 'OK',
      message: result.duplicate ? '重复提交，已返回首次处理结果（未重复入库）' : `已接收 ${result.accepted} 条工时，状态：待审核`,
      data: result,
    });
  } catch (e) {
    await svc.recordSyncLog({
      keyId: req.apiKey.id, status: 'fail', errorCode: e.code || 'INTERNAL', accepted: 0, ip, ms: Date.now() - t0,
    });
    throw e; // 交给全局 errorHandler 统一格式化
  }
}));

// ---------------- 密钥管理（admin 会话鉴权） ----------------
router.get('/keys', requireRole('admin'), wrap(async (_req, res) => {
  res.json(await svc.listKeys());
}));

router.post('/keys', requireRole('admin'), wrap(async (req, res) => {
  const { name, rateLimit } = req.body || {};
  const k = await svc.createKey({ name, rateLimit: Number(rateLimit) || 120 });
  res.status(201).json({
    code: 'OK',
    message: '密钥已创建（明文仅此一次返回，请妥善保存，系统不另存明文）',
    data: k,
  });
}));

router.delete('/keys/:id', requireRole('admin'), wrap(async (req, res) => {
  res.json(await svc.revokeKey(req.params.id));
}));

// 同步调用日志（admin 审计/监控）
router.get('/logs', requireRole('admin'), wrap(async (req, res) => {
  const limit = Number(req.query.limit) || 200;
  res.json(await svc.listLogs(limit));
}));

export default router;
