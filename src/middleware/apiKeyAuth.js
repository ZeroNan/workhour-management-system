// API 密钥鉴权中间件（开放接口专用，独立于会话 Cookie）
// 支持两种传参：请求头 `X-API-Key: <key>` 或 `Authorization: Bearer <key>`
// 数据库只存密钥的 SHA-256 哈希（key_hash），明文密钥仅在创建时返回一次，杜绝泄露。
import { createHash } from 'node:crypto';
import db from '../db.js';
import { err } from '../utils/http.js';

function hashKey(key) {
  return createHash('sha256').update(key).digest('hex');
}

/** 从请求中解析并校验密钥，返回 api_keys 行（附带 req.apiKey） */
export async function resolveApiKey(req) {
  let key = req.get('X-API-Key');
  if (!key) {
    const auth = req.get('Authorization') || '';
    const m = auth.match(/^Bearer\s+(.+)$/i);
    if (m) key = m[1].trim();
  }
  if (!key) {
    throw err('API_KEY_MISSING', '缺少 API 密钥，请在请求头携带 X-API-Key 或 Authorization: Bearer <key>');
  }
  const row = await db.prepare('SELECT * FROM api_keys WHERE key_hash = ?').get(hashKey(key));
  if (!row) throw err('API_KEY_INVALID', 'API 密钥无效');
  if (row.status !== 'active') throw err('API_KEY_DISABLED', 'API 密钥已被停用');
  return row;
}

/** Express 中间件：校验密钥并挂载 req.apiKey */
export function apiKeyAuth(req, res, next) {
  resolveApiKey(req)
    .then(async (row) => {
      req.apiKey = row;
      // 尽力更新最近使用时间（失败不影响主流程）
      try {
        await db.prepare("UPDATE api_keys SET last_used_at = ? WHERE id = ?").run(
          new Date().toISOString().slice(0, 16).replace('T', ' '), row.id,
        );
      } catch (_) { /* ignore */ }
      next();
    })
    .catch(next);
}
