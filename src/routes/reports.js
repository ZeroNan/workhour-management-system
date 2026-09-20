// 报表路由：每日项目日报（pm/admin，聚焦任务完成情况，不含成员信息）+ 日报看板（全部角色）
// 注意：MySQL 版所有 db 调用返回 Promise，handler 一律 async + wrap() 包装传导错误。
import { Router } from 'express';
import db from '../db.js';
import { err, wrap } from '../utils/http.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { isValidDateStr } from '../utils/date.js';

const router = Router();

// 31. 每日项目日报：聚合可见项目当日已通过工时，按项目分组，聚焦任务（content）完成情况
router.get('/daily', requireRole('pm', 'admin'), wrap(async (req, res) => {
  const me = req.user;
  const date = String(req.query.date || '');
  if (!isValidDateStr(date)) throw err('VALIDATION_ERROR', 'date 格式应为 YYYY-MM-DD');

  const projects = me.role === 'admin'
    ? await db.prepare('SELECT id, name FROM projects ORDER BY id').all()
    : await db.prepare('SELECT id, name FROM projects WHERE owner_id = ? ORDER BY id').all(me.id);
  const pids = projects.map(p => p.id);

  const result = [];
  if (pids.length) {
    const placeholders = pids.map(() => '?').join(',');
    const rows = await db.prepare(`
      SELECT t.project_id, t.content, t.hours
      FROM timesheets t
      WHERE t.project_id IN (${placeholders}) AND t.date = ? AND t.status = 'approved'
    `).all(...pids, date);
    const byProject = {};
    projects.forEach(p => { byProject[p.id] = { projectName: p.name, totalHours: 0, tasks: {} }; });
    rows.forEach(r => {
      const g = byProject[r.project_id];
      if (!g) return;
      g.totalHours += r.hours;
      g.tasks[r.content] = (g.tasks[r.content] || 0) + r.hours;
    });
    for (const p of projects) {
      const g = byProject[p.id];
      const tasks = Object.entries(g.tasks)
        .map(([content, hours]) => ({ content, hours }))
        .sort((a, b) => b.hours - a.hours);
      result.push({ projectId: p.id, projectName: g.projectName, totalHours: g.totalHours, tasks });
    }
  }
  res.json({ date, projects: result });
}));

// 32. 日报看板：所选日期各项目已通过工时卡片，按项目分列（全部角色可见，范围按角色收窄）
router.get('/kanban', requireAuth, wrap(async (req, res) => {
  const me = req.user;
  const date = String(req.query.date || '');
  if (!isValidDateStr(date)) throw err('VALIDATION_ERROR', 'date 格式应为 YYYY-MM-DD');

  let projects;
  if (me.role === 'admin') {
    projects = await db.prepare('SELECT id, name FROM projects ORDER BY id').all();
  } else if (me.role === 'pm') {
    projects = await db.prepare('SELECT id, name FROM projects WHERE owner_id = ? ORDER BY id').all(me.id);
  } else {
    projects = await db.prepare(`
      SELECT p.id, p.name FROM projects p
      JOIN project_members pm ON pm.project_id = p.id
      WHERE pm.user_id = ? ORDER BY p.id`).all(me.id);
  }
  const pids = projects.map(p => p.id);

  const cards = [];
  if (pids.length) {
    const placeholders = pids.map(() => '?').join(',');
    const rows = await db.prepare(`
      SELECT t.project_id, u.name AS userName, t.content, t.hours
      FROM timesheets t JOIN users u ON u.id = t.user_id
      WHERE t.project_id IN (${placeholders}) AND t.date = ? AND t.status = 'approved'
      ORDER BY t.project_id, u.name
    `).all(...pids, date);
    rows.forEach(r => cards.push({
      projectId: r.project_id, userName: r.userName, content: r.content, hours: r.hours,
    }));
  }
  res.json({ date, projects, cards });
}));

export default router;
