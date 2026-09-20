// 会话解析 + 角色校验中间件
import db from '../db.js';
import { config } from '../config.js';
import { err } from '../utils/http.js';

/** 从 Cookie 头解析 wtms_session */
function parseToken(req) {
  const header = req.headers.cookie || '';
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    if (part.slice(0, idx).trim() === config.session.cookieName) {
      return decodeURIComponent(part.slice(idx + 1).trim());
    }
  }
  return null;
}

/** 会话解析：cookie → sessions 表 → req.user；滚动续期；过期会话惰性删除 */
export async function sessionParser(req, _res, next) {
  req.user = null;
  req.sessionToken = null;
  const token = parseToken(req);
  if (!token) return next();

  try {
    // 顺手清理过期会话行
    await db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(Date.now());

    const now = Date.now();
    const row = await db.prepare(`
      SELECT s.token, s.user_id, u.username, u.name, u.role, u.dept_id,
             d.name AS dept_name, u.must_change_password
      FROM sessions s
      JOIN users u ON u.id = s.user_id
      LEFT JOIN departments d ON d.id = u.dept_id
      WHERE s.token = ? AND s.expires_at > ?
    `).get(token, now);

    if (row) {
      // 滚动续期：每次请求将过期时间推至 now + 8h
      const newExpires = now + config.session.ttlMs;
      await db.prepare('UPDATE sessions SET last_active_at = ?, expires_at = ? WHERE token = ?')
        .run(now, newExpires, token);
      req.sessionToken = token;
      req.user = {
        id: row.user_id, username: row.username, name: row.name, role: row.role,
        deptId: row.dept_id, deptName: row.dept_name,
        mustChangePassword: row.must_change_password === 1,
      };
    }
    next();
  } catch (e) {
    next(e); // DB 异常必须传导给 errorHandler，不能吞掉
  }
}

/** 需登录；must_change_password=1 时仅放行 /api/auth/* */
export function requireAuth(req, _res, next) {
  if (!req.user) return next(err('UNAUTHORIZED', '未登录或登录已过期'));
  const fullPath = (req.baseUrl || '') + req.path; // req.path 在挂载的 router 内是相对路径
  if (req.user.mustChangePassword && !fullPath.startsWith('/api/auth/')) {
    return next(err('FORBIDDEN', '首次登录请先修改密码'));
  }
  next();
}

/** 需指定角色之一 */
export function requireRole(...roles) {
  return (req, _res, next) => {
    if (!req.user) return next(err('UNAUTHORIZED', '未登录或登录已过期'));
    if (!roles.includes(req.user.role)) return next(err('FORBIDDEN', '无权访问该接口'));
    next();
  };
}
