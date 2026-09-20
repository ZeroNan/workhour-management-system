// 滑动窗口限流中间件（按 API 密钥维度，进程内存储）
// 适用于单实例部署；若后续多实例横向扩展，请将存储替换为 Redis 等共享后端。
// 限流阈值取自 api_keys.rate_limit（每分钟请求数），缺省使用 defaultLimit。
import { err } from '../utils/http.js';
const windows = new Map(); // keyId -> number[]（请求时间戳 ms）

export function rateLimit({ windowMs = 60_000, defaultLimit = 120 } = {}) {
  return (req, res, next) => {
    const key = req.apiKey;
    if (!key) return next(); // 未经过 apiKeyAuth 时不限流（理论上不会到这）
    const limit = Number(key.rate_limit) > 0 ? Number(key.rate_limit) : defaultLimit;
    const now = Date.now();
    const arr = windows.get(key.id) || [];
    const cut = now - windowMs;
    while (arr.length && arr[0] <= cut) arr.shift(); // 清理窗口外

    if (arr.length >= limit) {
      const oldest = arr[0];
      const retryAfter = Math.max(1, Math.ceil((oldest + windowMs - now) / 1000));
      res.set('Retry-After', String(retryAfter));
      return next(errLimit(retryAfter, limit, windowMs));
    }
    arr.push(now);
    windows.set(key.id, arr);
    res.set('X-RateLimit-Limit', String(limit));
    res.set('X-RateLimit-Remaining', String(Math.max(0, limit - arr.length)));
    res.set('X-RateLimit-Reset', String(Math.ceil((now + windowMs) / 1000)));
    next();
  };
}

// 局部构造 429 错误
function errLimit(retryAfter, limit, windowMs) {
  return err('RATE_LIMITED', `请求过于频繁，请在 ${retryAfter}s 后重试`, { limit, windowMs, retryAfter });
}
