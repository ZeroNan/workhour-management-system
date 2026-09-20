// 审核路由：audit/list（pm 限自己项目 / admin 全量）+ batch
// 注意：MySQL 版所有 db 调用返回 Promise，handler 一律 async + wrap() 包装传导错误。
import { Router } from 'express';
import db from '../db.js';
import { err, wrap } from '../utils/http.js';
import { requireRole } from '../middleware/auth.js';
import * as svc from '../services/timesheetService.js';

const router = Router();

// 26. 审核列表
router.get('/list', requireRole('pm', 'admin'), wrap(async (req, res) => {
  const me = req.user;
  const { projectId, userId, from, to, status } = req.query;
  const conds = [];
  const params = [];
  // pm 仅看自己负责的项目；admin 全量
  if (me.role !== 'admin') {
    conds.push('t.project_id IN (SELECT id FROM projects WHERE owner_id = ?)');
    params.push(me.id);
  }
  if (projectId) { conds.push('t.project_id = ?'); params.push(Number(projectId)); }
  if (userId) { conds.push('t.user_id = ?'); params.push(Number(userId)); }
  if (from) { conds.push('t.date >= ?'); params.push(from); }
  if (to) { conds.push('t.date <= ?'); params.push(to); }
  if (status) { conds.push('t.status = ?'); params.push(status); }
  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
  const rows = await db.prepare(`
    SELECT t.*, u.name AS user_name, d.name AS dept_name, p.name AS project_name, p.owner_id
    FROM timesheets t
    JOIN users u ON u.id = t.user_id
    LEFT JOIN departments d ON d.id = t.dept_id
    JOIN projects p ON p.id = t.project_id ${where}
    ORDER BY t.date DESC, t.user_id, t.id DESC`).all(...params);
  res.json(rows.map(t => ({
    id: t.id, userId: t.user_id, userName: t.user_name, deptId: t.dept_id, deptName: t.dept_name,
    projectId: t.project_id, projectName: t.project_name,
    date: t.date, hours: t.hours, content: t.content, status: t.status,
    submitTime: t.submit_time, auditTime: t.audit_time, auditComment: t.audit_comment,
    selfSubmitted: t.user_id === me.id,       // PM 本人提交 → 需管理员代审
    canAudit: t.user_id !== me.id && (me.role === 'admin' || t.owner_id === me.id),
  })));
}));

// 29. 批量审核（单条 approve/reject 已挂在 timesheets 路由）
router.post('/batch', requireRole('pm', 'admin'), wrap(async (req, res) => {
  const { ids, action, comment } = req.body || {};
  if (!Array.isArray(ids) || !ids.length) throw err('VALIDATION_ERROR', 'ids 不能为空');
  res.json(await svc.batchAudit(req.user, ids, action, comment));
}));

export default router;
