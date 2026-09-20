// 部门 CRUD（读：全员；写：admin）
// 注意：MySQL 版所有 db 调用返回 Promise，handler 一律 async + wrap() 包装传导错误。
import { Router } from 'express';
import db from '../db.js';
import { err, wrap } from '../utils/http.js';
import { requireAuth, requireRole } from '../middleware/auth.js';

const router = Router();

router.get('/', requireAuth, wrap(async (_req, res) => {
  const list = await db.prepare(`
    SELECT d.id, d.name, (SELECT COUNT(*) FROM users u WHERE u.dept_id = d.id) AS userCount
    FROM departments d ORDER BY d.id`).all();
  res.json(list);
}));

router.post('/', requireRole('admin'), wrap(async (req, res) => {
  const name = String(req.body?.name || '').trim();
  if (!name) throw err('VALIDATION_ERROR', '部门名称不能为空');
  if (await db.prepare('SELECT 1 AS x FROM departments WHERE name = ?').get(name)) {
    throw err('DUPLICATE_NAME', '该部门名称已存在');
  }
  const info = await db.prepare('INSERT INTO departments(name) VALUES (?)').run(name);
  res.status(201).json({ id: info.lastInsertRowid, name });
}));

router.put('/:id', requireRole('admin'), wrap(async (req, res) => {
  const id = Number(req.params.id);
  const dep = await db.prepare('SELECT * FROM departments WHERE id = ?').get(id);
  if (!dep) throw err('NOT_FOUND', '部门不存在');
  const name = String(req.body?.name || '').trim();
  if (!name) throw err('VALIDATION_ERROR', '部门名称不能为空');
  const dup = await db.prepare('SELECT 1 AS x FROM departments WHERE name = ? AND id != ?').get(name, id);
  if (dup) throw err('DUPLICATE_NAME', '该部门名称已存在');
  await db.prepare('UPDATE departments SET name = ? WHERE id = ?').run(name, id);
  res.json({ ok: true });
}));

router.delete('/:id', requireRole('admin'), wrap(async (req, res) => {
  const id = Number(req.params.id);
  const dep = await db.prepare('SELECT * FROM departments WHERE id = ?').get(id);
  if (!dep) throw err('NOT_FOUND', '部门不存在');
  if (await db.prepare('SELECT 1 AS x FROM users WHERE dept_id = ?').get(id)) {
    throw err('REFERENCED', '该部门下仍有人员，不能删除');
  }
  if (await db.prepare('SELECT 1 AS x FROM timesheets WHERE dept_id = ?').get(id)) {
    throw err('REFERENCED', '该部门存在关联工时记录，不能删除');
  }
  await db.prepare('DELETE FROM departments WHERE id = ?').run(id);
  res.status(204).end();
}));

export default router;
