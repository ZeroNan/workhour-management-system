// 统一错误响应 {error:{code,message,details}} + 404 兜底
import { ApiError, ERR } from '../utils/http.js';

export function errorHandler(err, _req, res, _next) {
  if (err instanceof ApiError) {
    return res.status(err.status).json({
      error: { code: err.code, message: err.message, ...(err.details ? { details: err.details } : {}) },
    });
  }
  console.error('[error]', err);
  const def = ERR.INTERNAL;
  res.status(def.status).json({ error: { code: def.code, message: '服务器内部错误' } });
}

export function notFoundHandler(req, res) {
  res.status(404).json({ error: { code: 'NOT_FOUND', message: `接口不存在：${req.method} ${req.path}` } });
}
