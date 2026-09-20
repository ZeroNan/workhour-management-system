// 项目 CRUD + /mine（读：全员；写：admin）
// 注意：MySQL 版所有 db 调用返回 Promise，handler 一律 async + wrap() 包装传导错误。
import { Router } from 'express';
import db from '../db.js';
import { err, wrap } from '../utils/http.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { nowStr } from '../utils/date.js';

const router = Router();

async function listAll() {
  const projects = await db.prepare(`
    SELECT p.id, p.name, p.owner_id AS ownerId, u.name AS ownerName,
           (SELECT COUNT(*) FROM timesheets t WHERE t.project_id = p.id) AS timesheetCount
    FROM projects p JOIN users u ON u.id = p.owner_id ORDER BY p.id`).all();
  for (const p of projects) {
    p.memberIds = (await db.prepare('SELECT user_id FROM project_members WHERE project_id = ? ORDER BY user_id').all(p.id)).map(r => r.user_id);
    p.memberNames = (await db.prepare(`
      SELECT u.name FROM project_members pm JOIN users u ON u.id = pm.user_id
      WHERE pm.project_id = ? ORDER BY u.id`).all(p.id)).map(r => r.name);
  }
  return projects;
}

async function one(id) {
  return (await listAll()).find(p => p.id === id);
}

// 9. 全部项目
router.get('/', requireAuth, wrap(async (_req, res) => {
  res.json(await listAll());
}));

// 10. 我参与的项目
router.get('/mine', requireAuth, wrap(async (req, res) => {
  const all = (await listAll()).filter(p => p.memberIds.includes(req.user.id));
  res.json(all);
}));

// 11. 新建（owner 自动并入成员）
router.post('/', requireRole('admin'), wrap(async (req, res) => {
  const { name, ownerId, memberIds } = req.body || {};
  const n = String(name || '').trim();
  if (!n) throw err('VALIDATION_ERROR', '项目名称不能为空');
  if (!Number.isInteger(Number(ownerId))) throw err('VALIDATION_ERROR', '请选择项目负责人');
  if (await db.prepare('SELECT 1 AS x FROM projects WHERE name = ?').get(n)) {
    throw err('DUPLICATE_NAME', '该项目名称已存在');
  }
  const owner = await db.prepare('SELECT * FROM users WHERE id = ?').get(Number(ownerId));
  if (!owner) throw err('VALIDATION_ERROR', '负责人不存在');
  let members = Array.isArray(memberIds) ? memberIds.map(Number).filter(Number.isInteger) : [];
  if (!members.includes(Number(ownerId))) members.push(Number(ownerId));

  const now = nowStr();
  const insert = db.transaction(async () => {
    const pid = (await db.prepare('INSERT INTO projects(name,owner_id,created_at) VALUES (?,?,?)')
      .run(n, Number(ownerId), now)).lastInsertRowid;
    const ins = db.prepare('INSERT INTO project_members(project_id,user_id) VALUES (?,?)');
    for (const uid of members) {
      if (!(await db.prepare('SELECT 1 AS x FROM users WHERE id = ?').get(uid))) {
        throw err('VALIDATION_ERROR', `成员不存在（id=${uid}）`);
      }
      await ins.run(pid, uid);
    }
    return pid;
  });
  const pid = await insert();
  res.status(201).json(await one(pid));
}));

// 12. 编辑
router.put('/:id', requireRole('admin'), wrap(async (req, res) => {
  const id = Number(req.params.id);
  const p = await db.prepare('SELECT * FROM projects WHERE id = ?').get(id);
  if (!p) throw err('NOT_FOUND', '项目不存在');
  const { name, ownerId, memberIds } = req.body || {};
  const n = String(name || '').trim();
  if (!n) throw err('VALIDATION_ERROR', '项目名称不能为空');
  if (await db.prepare('SELECT 1 AS x FROM projects WHERE name = ? AND id != ?').get(n, id)) {
    throw err('DUPLICATE_NAME', '该项目名称已存在');
  }
  if (!(await db.prepare('SELECT 1 AS x FROM users WHERE id = ?').get(Number(ownerId)))) {
    throw err('VALIDATION_ERROR', '负责人不存在');
  }
  let members = Array.isArray(memberIds) ? memberIds.map(Number).filter(Number.isInteger) : [];
  if (!members.length) throw err('VALIDATION_ERROR', '请至少选择一名成员');
  if (!members.includes(Number(ownerId))) members.push(Number(ownerId));

  const update = db.transaction(async () => {
    await db.prepare('UPDATE projects SET name=?, owner_id=? WHERE id=?').run(n, Number(ownerId), id);
    await db.prepare('DELETE FROM project_members WHERE project_id = ?').run(id);
    const ins = db.prepare('INSERT INTO project_members(project_id,user_id) VALUES (?,?)');
    for (const uid of members) {
      if (!(await db.prepare('SELECT 1 AS x FROM users WHERE id = ?').get(uid))) {
        throw err('VALIDATION_ERROR', `成员不存在（id=${uid}）`);
      }
      await ins.run(id, uid);
    }
  });
  await update();
  res.json({ ok: true });
}));

// 13. 删除（存在关联工时则 409）
router.delete('/:id', requireRole('admin'), wrap(async (req, res) => {
  const id = Number(req.params.id);
  const p = await db.prepare('SELECT * FROM projects WHERE id = ?').get(id);
  if (!p) throw err('NOT_FOUND', '项目不存在');
  if (await db.prepare('SELECT 1 AS x FROM timesheets WHERE project_id = ?').get(id)) {
    throw err('REFERENCED', '该项目存在关联工时记录，不能删除');
  }
  const del = db.transaction(async () => {
    await db.prepare('DELETE FROM project_members WHERE project_id = ?').run(id);
    await db.prepare('DELETE FROM projects WHERE id = ?').run(id);
  });
  await del();
  res.status(204).end();
}));

export default router;
