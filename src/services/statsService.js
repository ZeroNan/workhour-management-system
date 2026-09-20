// 统计矩阵计算（渲染与导出共用口径）：排除未来日期，anomalies 单列
// 注意：MySQL 版 db.prepare(...).get/all 返回 Promise，函数为 async，调用方必须 await。
import db from '../db.js';
import { err } from '../utils/http.js';
import { serverToday, isValidMonthStr } from '../utils/date.js';

/**
 * 按项目统计矩阵
 * @param {number} projectId
 * @param {string} month 'YYYY-MM'
 * @param {'all'|'approved'} scope
 */
// projectId: number | null（null = 聚合 accessibleProjectIds 范围内的全部项目）
// accessibleProjectIds: 当前用户可见的项目 id 列表（admin 全量 / pm 仅自己负责）
export async function projectStats(projectId, month, scope, accessibleProjectIds) {
  if (projectId != null) {
    if (!Number.isInteger(Number(projectId))) throw err('VALIDATION_ERROR', 'projectId 非法');
    if (accessibleProjectIds && !accessibleProjectIds.includes(Number(projectId))) {
      throw err('FORBIDDEN', '无权查看该项目统计');
    }
  }
  if (!isValidMonthStr(month)) throw err('VALIDATION_ERROR', 'month 格式应为 YYYY-MM');
  if (scope !== 'all' && scope !== 'approved') scope = 'all';

  const today = serverToday();
  const pids = projectId != null ? [Number(projectId)] : (accessibleProjectIds || []);

  // 当月天数
  const [y, m] = month.split('-').map(Number);
  const nD = new Date(y, m, 0).getDate();
  const pad = n => String(n).padStart(2, '0');
  const days = [];
  for (let d = 1; d <= nD; d++) days.push(`${month}-${pad(d)}`);

  // 无可见项目：返回空矩阵（全部项目聚合时可能为空）
  if (!pids.length) {
    return { projectId: null, projectName: '全部项目', month, today, scope, memberRows: [], totals: days.map(() => 0), grand: 0, anomalies: [] };
  }

  let projectName = '全部项目';
  let ownerId = null;
  if (projectId != null) {
    const project = await db.prepare('SELECT * FROM projects WHERE id = ?').get(Number(projectId));
    if (!project) throw err('NOT_FOUND', '项目不存在');
    projectName = project.name;
    ownerId = project.owner_id;
  }

  const placeholders = pids.map(() => '?').join(',');

  // 未来日期记录 → anomalies（不参与合计/导出）
  const anomalies = await db.prepare(`
    SELECT t.id, t.date, t.hours, t.status, u.name AS userName
    FROM timesheets t JOIN users u ON u.id = t.user_id
    WHERE t.project_id IN (${placeholders}) AND t.date LIKE ? AND t.date > ?
    ORDER BY t.date`).all(...pids, `${month}-%`, today);

  // 矩阵数据：date <= today 才参与
  const statusCond = scope === 'approved' ? "AND t.status = 'approved'" : '';
  const rows = await db.prepare(`
    SELECT t.user_id, t.date, t.hours FROM timesheets t
    WHERE t.project_id IN (${placeholders}) AND t.date LIKE ? AND t.date <= ? ${statusCond}
  `).all(...pids, `${month}-%`, today);

  // 成员行 = 可见项目成员并集（单项目时确保 owner 在内）
  const memberIds = [];
  (await db.prepare(`SELECT DISTINCT user_id FROM project_members WHERE project_id IN (${placeholders})`)
    .all(...pids)).forEach(r => { if (!memberIds.includes(r.user_id)) memberIds.push(r.user_id); });
  if (projectId != null && ownerId != null && !memberIds.includes(ownerId)) memberIds.push(ownerId);

  const users = {};
  if (memberIds.length) {
    (await db.prepare(`SELECT u.id, u.name, d.name AS dept FROM users u
      LEFT JOIN departments d ON d.id = u.dept_id WHERE u.id IN (${memberIds.map(() => '?').join(',')})`)
      .all(...memberIds)).forEach(u => { users[u.id] = u; });
  }

  const byUser = {}; // uid -> {date -> hours}
  const byDate = {}; // date -> hours
  rows.forEach(r => {
    (byUser[r.user_id] ||= {})[r.date] = (byUser[r.user_id]?.[r.date] || 0) + r.hours;
    byDate[r.date] = (byDate[r.date] || 0) + r.hours;
  });

  const memberRows = memberIds.map(uid => {
    const u = users[uid] || { name: '—', dept: null };
    const cells = days.map(dt => byUser[uid]?.[dt] || 0);
    return {
      userId: uid, name: u.name, dept: u.dept,
      cells, sum: cells.reduce((s, x) => s + x, 0),
    };
  });
  const totals = days.map(dt => byDate[dt] || 0);
  const grand = totals.reduce((s, x) => s + x, 0);

  return {
    projectId: projectId != null ? Number(projectId) : null, projectName, month, today, scope,
    memberRows, totals, grand,
    anomalies: anomalies.map(a => ({ id: a.id, date: a.date, hours: a.hours, status: a.status, userName: a.userName })),
  };
}
