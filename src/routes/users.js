// 人员 CRUD + 重置密码（admin）
// 注意：MySQL 版所有 db 调用返回 Promise，handler 一律 async + wrap() 包装传导错误。
import { Router } from 'express';
import db from '../db.js';
import { config } from '../config.js';
import { err, wrap } from '../utils/http.js';
import { hashPassword, isWeakPassword } from '../utils/password.js';
import { requireRole } from '../middleware/auth.js';
import { nowStr } from '../utils/date.js';

const router = Router();

const listUsers = () => db.prepare(`
    SELECT u.id, u.username, u.name, u.role, u.dept_id AS deptId, d.name AS deptName,
           u.sort_order AS sortOrder, u.must_change_password AS mustChangePassword
    FROM users u LEFT JOIN departments d ON d.id = u.dept_id ORDER BY u.sort_order, u.id`).all();

// 14. 人员列表
router.get('/', requireRole('admin'), wrap(async (_req, res) => {
  res.json(await listUsers());
}));

// 15. 新建账号（must_change_password=1）
router.post('/', requireRole('admin'), wrap(async (req, res) => {
  const { name, username, password, role, deptId, sortOrder = 0 } = req.body || {};
  const order = Number(sortOrder);
  if (!Number.isInteger(order) || order < 0 || order > 2147483647) {
    throw err('VALIDATION_ERROR', '排列顺序须为 0 到 2147483647 的整数');
  }
  const n = String(name || '').trim();
  const un = String(username || '').trim();
  if (!n || !un) throw err('VALIDATION_ERROR', '姓名与登录名不能为空');
  if (!['admin', 'pm', 'dev'].includes(role)) throw err('VALIDATION_ERROR', '角色非法');
  if (!(await db.prepare('SELECT 1 AS x FROM departments WHERE id = ?').get(Number(deptId)))) {
    throw err('VALIDATION_ERROR', '请选择有效部门');
  }
  if (await db.prepare('SELECT 1 AS x FROM users WHERE username = ?').get(un)) {
    throw err('DUPLICATE_USERNAME', '该登录名已存在');
  }
  if (isWeakPassword(password)) throw err('WEAK_PASSWORD', `密码最短 ${config.password.minLength} 位`);
  const info = await db.prepare(`
    INSERT INTO users(username,password_hash,name,role,dept_id,sort_order,must_change_password,failed_attempts,created_at)
    VALUES (?,?,?,?,?,?,1,0,?)`).run(un, hashPassword(password), n, role, Number(deptId), order, nowStr());
  res.status(201).json({ id: info.lastInsertRowid, name: n, username: un, role, deptId: Number(deptId), sortOrder: order, mustChangePassword: true });
}));

// 16. 编辑（不允许将自己从 admin 降级，防锁死）
router.put('/:id', requireRole('admin'), wrap(async (req, res) => {
  const id = Number(req.params.id);
  const u = await db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!u) throw err('NOT_FOUND', '人员不存在');
  const { name, username, role, deptId, sortOrder = u.sort_order } = req.body || {};
  const order = Number(sortOrder);
  if (!Number.isInteger(order) || order < 0 || order > 2147483647) {
    throw err('VALIDATION_ERROR', '排列顺序须为 0 到 2147483647 的整数');
  }
  const n = String(name || '').trim();
  const un = String(username || '').trim();
  if (!n || !un) throw err('VALIDATION_ERROR', '姓名与登录名不能为空');
  if (!['admin', 'pm', 'dev'].includes(role)) throw err('VALIDATION_ERROR', '角色非法');
  if (id === req.user.id && role !== 'admin') {
    throw err('VALIDATION_ERROR', '不能将自己的管理员角色降级');
  }
  if (await db.prepare('SELECT 1 AS x FROM users WHERE username = ? AND id != ?').get(un, id)) {
    throw err('DUPLICATE_USERNAME', '该登录名已存在');
  }
  if (!(await db.prepare('SELECT 1 AS x FROM departments WHERE id = ?').get(Number(deptId)))) {
    throw err('VALIDATION_ERROR', '请选择有效部门');
  }
  await db.prepare('UPDATE users SET name=?, username=?, role=?, dept_id=?, sort_order=? WHERE id=?')
    .run(n, un, role, Number(deptId), order, id);
  res.json({ ok: true });
}));

// 17. 管理员重置密码（目标用户全部会话失效，must_change_password=1）
router.put('/:id/password', requireRole('admin'), wrap(async (req, res) => {
  const id = Number(req.params.id);
  const u = await db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!u) throw err('NOT_FOUND', '人员不存在');
  const { newPassword } = req.body || {};
  if (isWeakPassword(newPassword)) throw err('WEAK_PASSWORD', `密码最短 ${config.password.minLength} 位`);
  const update = db.transaction(async () => {
    await db.prepare('UPDATE users SET password_hash=?, must_change_password=1, failed_attempts=0, locked_until=NULL WHERE id=?')
      .run(hashPassword(newPassword), id);
    await db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id);
  });
  await update();
  res.json({ ok: true });
}));

export default router;
