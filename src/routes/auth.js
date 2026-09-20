// 认证与会话：login / logout / me / password
// 注意：MySQL 版所有 db 调用返回 Promise，handler 一律 async + wrap() 包装传导错误。
import { Router } from 'express';
import crypto from 'node:crypto';
import db from '../db.js';
import { config } from '../config.js';
import { err, wrap } from '../utils/http.js';
import { verifyPassword, hashPassword, isWeakPassword } from '../utils/password.js';
import { serverToday, nowStr } from '../utils/date.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

/* ---------- 图形验证码（内存缓存 + SVG 生成，无外部依赖） ---------- */
const CAPTCHA_TTL = 5 * 60 * 1000; // 5 分钟
const CAPTCHA_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 去掉易混淆字符
const captchas = new Map();

function cleanupCaptchas() {
  const now = Date.now();
  for (const [token, { expires }] of captchas) {
    if (expires <= now) captchas.delete(token);
  }
}

function randomCode(len = 4) {
  let code = '';
  for (let i = 0; i < len; i++) {
    code += CAPTCHA_CHARS[crypto.randomInt(CAPTCHA_CHARS.length)];
  }
  return code;
}

function svgCaptcha(code) {
  // 简单 SVG 验证码：随机字符 + 噪线，无需外部库
  const width = 120;
  const height = 40;
  const chars = code.split('');
  const step = width / (chars.length + 1);
  const text = chars.map((ch, i) => {
    const x = step * (i + 1);
    const y = 26 + crypto.randomInt(-4, 5);
    const rotate = crypto.randomInt(-18, 19);
    const fontSize = 22 + crypto.randomInt(-3, 4);
    return `<text x="${x}" y="${y}" font-size="${fontSize}" font-family="Arial,sans-serif" fill="#374151" text-anchor="middle" transform="rotate(${rotate} ${x} ${y})">${ch}</text>`;
  }).join('');
  const lines = Array.from({ length: 5 }, () => {
    const x1 = crypto.randomInt(width);
    const y1 = crypto.randomInt(height);
    const x2 = crypto.randomInt(width);
    const y2 = crypto.randomInt(height);
    return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#9ca3af" stroke-width="1"/>`;
  }).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
    <rect width="100%" height="100%" fill="#f3f4f6"/>
    ${lines}${text}
  </svg>`;
}

// 6. 获取验证码
router.get('/captcha', wrap(async (_req, res) => {
  cleanupCaptchas();
  const token = crypto.randomBytes(16).toString('hex');
  const code = randomCode(4);
  captchas.set(token, { code, expires: Date.now() + CAPTCHA_TTL });
  res.json({ token, svg: svgCaptcha(code) });
}));

function publicUser(u) {
  return {
    id: u.id, username: u.username, name: u.name, role: u.role,
    deptId: u.dept_id, deptName: u.dept_name || null,
    mustChangePassword: u.must_change_password === 1,
  };
}

const getUserWithDept = async (id) => db.prepare(`
  SELECT u.*, d.name AS dept_name FROM users u
  LEFT JOIN departments d ON d.id = u.dept_id WHERE u.id = ?`).get(id);

// 1. 登录
router.post('/login', wrap(async (req, res) => {
  const { username, password, captchaToken, captchaCode } = req.body || {};
  if (!username || !password) throw err('VALIDATION_ERROR', '账号与密码不能为空');
  if (!captchaToken || !captchaCode) throw err('VALIDATION_ERROR', '请输入验证码');

  // 验证码校验（大小写不敏感，一次有效）
  const stored = captchas.get(captchaToken);
  captchas.delete(captchaToken); // 无论成败，立即失效
  if (!stored || stored.expires <= Date.now() ||
      stored.code.toUpperCase() !== String(captchaCode).trim().toUpperCase()) {
    throw err('INVALID_CAPTCHA', '验证码错误或已过期，请重新输入');
  }

  const user = await db.prepare('SELECT * FROM users WHERE username = ?').get(String(username).trim());
  if (!user || !verifyPassword(password, user.password_hash)) {
    if (user) {
      // 失败计数与锁定（锁定窗口内直接 423，不计次）
      const attempts = user.failed_attempts + 1;
      if (attempts >= config.lock.maxFailedAttempts) {
        const lockedUntil = Date.now() + config.lock.lockMinutes * 60 * 1000;
        await db.prepare('UPDATE users SET failed_attempts = 0, locked_until = ? WHERE id = ?').run(lockedUntil, user.id);
        return res.status(423).json({ error: { code: 'ACCOUNT_LOCKED', message: `失败次数过多，账号已锁定 ${config.lock.lockMinutes} 分钟`, details: { minutes: config.lock.lockMinutes } } });
      }
      await db.prepare('UPDATE users SET failed_attempts = ? WHERE id = ?').run(attempts, user.id);
    }
    return res.status(401).json({ error: { code: 'INVALID_CREDENTIALS', message: '账号或密码错误' } });
  }

  if (user.locked_until && user.locked_until > Date.now()) {
    const minutes = Math.ceil((user.locked_until - Date.now()) / 60000);
    return res.status(423).json({ error: { code: 'ACCOUNT_LOCKED', message: `账号已锁定，请 ${minutes} 分钟后重试`, details: { minutes } } });
  }

  // 登录成功：清零计数/锁定，创建会话
  await db.prepare('UPDATE users SET failed_attempts = 0, locked_until = NULL WHERE id = ?').run(user.id);
  const token = crypto.randomBytes(32).toString('hex');
  const now = Date.now();
  await db.prepare('INSERT INTO sessions(token,user_id,created_at,last_active_at,expires_at) VALUES (?,?,?,?,?)')
    .run(token, user.id, now, now, now + config.session.ttlMs);

  res.cookie(config.session.cookieName, token, config.session.cookieOpts);
  res.json({ user: publicUser(await getUserWithDept(user.id)) });
}));

// 2. 登出
router.post('/logout', requireAuth, wrap(async (req, res) => {
  if (req.sessionToken) await db.prepare('DELETE FROM sessions WHERE token = ?').run(req.sessionToken);
  res.clearCookie(config.session.cookieName, { path: '/' });
  res.json({ ok: true });
}));

// 3. 当前用户信息（today 是前端渲染的唯一日期基准）
router.get('/me', requireAuth, (req, res) => {
  res.json({ user: req.user, today: serverToday(), serverTime: nowStr() });
});

// 4. 修改密码（首登强制改密 / 用户自改）
router.put('/password', requireAuth, wrap(async (req, res) => {
  const { oldPassword, newPassword } = req.body || {};
  const user = await db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);

  if (!user || !verifyPassword(oldPassword || '', user.password_hash)) {
    throw err('WRONG_OLD_PASSWORD', '原密码不正确');
  }
  if (isWeakPassword(newPassword)) {
    throw err('WEAK_PASSWORD', `新密码最短 ${config.password.minLength} 位`);
  }
  await db.prepare('UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?')
    .run(hashPassword(newPassword), user.id);
  res.json({ ok: true });
}));

export default router;
