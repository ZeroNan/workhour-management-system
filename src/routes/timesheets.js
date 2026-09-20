// 工时路由：CRUD / 提交 / 日汇总 / 月度视图 / 全部工时 / 清空演示工时（P1-5）
// 注意：MySQL 版所有 db 调用返回 Promise，handler 一律 async + wrap() 包装传导错误。
import { Router } from 'express';
import db from '../db.js';
import { err, wrap } from '../utils/http.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { isValidMonthStr, serverToday } from '../utils/date.js';
import * as svc from '../services/timesheetService.js';

const router = Router();

function serialize(t) {
  return {
    id: t.id, userId: t.user_id, userName: t.user_name, deptId: t.dept_id, deptName: t.dept_name,
    projectId: t.project_id, projectName: t.project_name,
    date: t.date, hours: t.hours, content: t.content, status: t.status,
    submitTime: t.submit_time, auditTime: t.audit_time, auditComment: t.audit_comment,
    anomaly: t.date > serverToday(), // 历史脏数据标记（>服务器今天的记录）
  };
}

// 25. 月度视图（放在参数路由前，避免 :id 吞掉）
router.get('/monthly', requireAuth, wrap(async (req, res) => {
  const month = String(req.query.month || '');
  if (!isValidMonthStr(month)) throw err('VALIDATION_ERROR', 'month 格式应为 YYYY-MM');
  const today = serverToday();
  const rows = await db.prepare(`
    SELECT t.*, p.name AS project_name FROM timesheets t
    JOIN projects p ON p.id = t.project_id
    WHERE t.user_id = ? AND t.date LIKE ? ORDER BY t.date, t.id`).all(req.user.id, `${month}-%`);
  const projectIds = [];
  const projects = [];
  // 我所在的项目 ∪ 有记录的项目
  (await db.prepare(`
    SELECT p.id, p.name FROM projects p
    JOIN project_members pm ON pm.project_id = p.id
    WHERE pm.user_id = ? ORDER BY p.id`).all(req.user.id))
    .forEach(p => { if (!projectIds.includes(p.id)) { projectIds.push(p.id); projects.push(p); } });
  rows.forEach(r => {
    if (!projectIds.includes(r.project_id)) {
      projectIds.push(r.project_id);
      projects.push({ id: r.project_id, name: r.project_name });
    }
  });
  res.json({
    month, today, projects,
    records: rows.map(t => serialize(t)),
  });
}));

// 19. 全部工时（admin）
router.get('/all', requireRole('admin'), wrap(async (req, res) => {
  const { deptId, projectId, userId, from, to, status } = req.query;
  const conds = [];
  const params = [];
  if (deptId) { conds.push('t.dept_id = ?'); params.push(Number(deptId)); }
  if (projectId) { conds.push('t.project_id = ?'); params.push(Number(projectId)); }
  if (userId) { conds.push('t.user_id = ?'); params.push(Number(userId)); }
  if (from) { conds.push('t.date >= ?'); params.push(from); }
  if (to) { conds.push('t.date <= ?'); params.push(to); }
  if (status) { conds.push('t.status = ?'); params.push(status); }
  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
  const rows = await db.prepare(`
    SELECT t.*, u.name AS user_name, d.name AS dept_name, p.name AS project_name
    FROM timesheets t
    JOIN users u ON u.id = t.user_id
    LEFT JOIN departments d ON d.id = t.dept_id
    JOIN projects p ON p.id = t.project_id ${where}
    ORDER BY t.date DESC, t.id DESC`).all(...params);
  res.json(rows.map(serialize));
}));

// 20. 日汇总
router.get('/day-summary', requireAuth, wrap(async (req, res) => {
  res.json(await svc.daySummary(req.user, String(req.query.date || '')));
}));

// 22. 修改
router.put('/:id', requireAuth, wrap(async (req, res) => {
  res.json(await svc.update(req.user, Number(req.params.id), req.body || {}));
}));

// 23. 删除
router.delete('/:id', requireAuth, wrap(async (req, res) => {
  await svc.remove(req.user, Number(req.params.id));
  res.status(204).end();
}));

// 24. 提交（幂等）
router.post('/:id/submit', requireAuth, wrap(async (req, res) => {
  res.json(await svc.submit(req.user, Number(req.params.id)));
}));

// 26. 撤回（submitted → draft；提交者/项目 owner/admin）
router.post('/:id/withdraw', requireAuth, wrap(async (req, res) => {
  res.json(await svc.withdraw(req.user, Number(req.params.id)));
}));

// 27/28. 单条审核（挂在这里供审核页调用；行级权限在 service 内）
router.post('/:id/approve', requireRole('pm', 'admin'), wrap(async (req, res) => {
  res.json(await svc.audit(req.user, Number(req.params.id), 'approve'));
}));
router.post('/:id/reject', requireRole('pm', 'admin'), wrap(async (req, res) => {
  res.json(await svc.audit(req.user, Number(req.params.id), 'reject', req.body?.comment));
}));

// 18. 本人记录列表（自动限定本人；放最后避免与子路径冲突）
router.get('/', requireAuth, wrap(async (req, res) => {
  const { projectId, status, from, to } = req.query;
  const conds = ['t.user_id = ?'];
  const params = [req.user.id];
  if (projectId) { conds.push('t.project_id = ?'); params.push(Number(projectId)); }
  if (status) { conds.push('t.status = ?'); params.push(status); }
  if (from) { conds.push('t.date >= ?'); params.push(from); }
  if (to) { conds.push('t.date <= ?'); params.push(to); }
  const rows = await db.prepare(`
    SELECT t.*, u.name AS user_name, d.name AS dept_name, p.name AS project_name
    FROM timesheets t
    JOIN users u ON u.id = t.user_id
    LEFT JOIN departments d ON d.id = t.dept_id
    JOIN projects p ON p.id = t.project_id
    WHERE ${conds.join(' AND ')}
    ORDER BY t.date DESC, t.id DESC`).all(...params);
  res.json(rows.map(serialize));
}));

// 21. 新增（放 GET / 之后无碍，POST 与 GET 路径互不冲突）
router.post('/', requireAuth, wrap(async (req, res) => {
  const result = await svc.create(req.user, req.body || {});
  res.status(201).json(result);
}));

export default router;
