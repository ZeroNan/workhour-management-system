// 统计矩阵计算（渲染与导出共用口径）：排除未来日期，anomalies 单列
// adminOverview：管理员工时统计总览（按项目/部门聚合，只读）
// 注意：MySQL 版 db.prepare(...).get/all 返回 Promise，函数为 async，调用方必须 await。
import db from '../db.js';
import { err } from '../utils/http.js';
import { serverToday, isValidMonthStr } from '../utils/date.js';

/**
 * 按项目统计矩阵
 * @param {number|null} projectId 单项目 id（null = 聚合）
 * @param {string} month 'YYYY-MM'
 * @param {'all'|'approved'} scope
 * @param {number[]} [accessibleProjectIds] 当前用户可见的项目 id 列表
 * @param {number[]} [selectedProjectIds] 多选项目 id（已由路由校验权限）；非空时以它为准
 */
// projectId: number | null（null = 聚合 accessibleProjectIds 范围内的全部项目，或 selectedProjectIds 指定的子集）
// accessibleProjectIds: 当前用户可见的项目 id 列表（admin 全量 / pm 仅自己负责）
export async function projectStats(projectId, month, scope, accessibleProjectIds, selectedProjectIds) {
  if (projectId != null) {
    if (!Number.isInteger(Number(projectId))) throw err('VALIDATION_ERROR', 'projectId 非法');
    if (accessibleProjectIds && !accessibleProjectIds.includes(Number(projectId))) {
      throw err('FORBIDDEN', '无权查看该项目统计');
    }
  }
  // 多选子集：路由已鉴权，此处再做一次可见性校验（纵深防御）
  const multi = Array.isArray(selectedProjectIds) && selectedProjectIds.length ? selectedProjectIds.map(Number) : null;
  if (multi) {
    if (multi.some(id => !Number.isInteger(id))) throw err('VALIDATION_ERROR', 'projectIds 非法');
    if (accessibleProjectIds && multi.some(id => !accessibleProjectIds.map(Number).includes(id))) {
      throw err('FORBIDDEN', '无权查看所选项目统计');
    }
  }
  if (!isValidMonthStr(month)) throw err('VALIDATION_ERROR', 'month 格式应为 YYYY-MM');
  if (scope !== 'all' && scope !== 'approved') scope = 'all';

  const today = serverToday();
  const pids = projectId != null ? [Number(projectId)] : (multi || accessibleProjectIds || []);

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

  // 项目负责人并集（全路径统一口径）：统计范围（单项目 / projectIds 子集 / 全部可见项目）内
  // projects.owner_id 的并集。负责人即便无工时、又不在 project_members，也必须出现在成员行，
  // 否则「只勾某项目显示其负责人、勾全部项目负责人反而消失」这类反直觉行为会出现。
  const ownerIds = [...new Set((await db.prepare(
    `SELECT DISTINCT owner_id FROM projects WHERE id IN (${placeholders}) AND owner_id IS NOT NULL`).all(...pids)
  ).map(r => Number(r.owner_id)).filter(id => Number.isInteger(id)))];

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

  // 成员行 = 统计范围内「项目成员 ∪ 项目负责人 ∪ 有工时记录的人」（与路径/是否多选无关）
  // 所有 user id 统一转 number 后再入数组，避免成员下标与 users/byUser 的键类型错位
  const memberIds = [];
  (await db.prepare(`SELECT DISTINCT user_id FROM project_members WHERE project_id IN (${placeholders})`)
    .all(...pids)).forEach(r => { const uid = Number(r.user_id); if (!memberIds.includes(uid)) memberIds.push(uid); });
  if (projectId != null && ownerId != null && !memberIds.includes(Number(ownerId))) memberIds.push(Number(ownerId));
  ownerIds.forEach(id => { if (id != null && !memberIds.includes(id)) memberIds.push(id); });

  rows.forEach(r => { const uid = Number(r.user_id); if (!memberIds.includes(uid)) memberIds.push(uid); });

  const users = {};
  if (memberIds.length) {
    (await db.prepare(`SELECT u.id, u.name, u.sort_order, d.name AS dept FROM users u
      LEFT JOIN departments d ON d.id = u.dept_id WHERE u.id IN (${memberIds.map(() => '?').join(',')})`)
      .all(...memberIds)).forEach(u => { users[Number(u.id)] = u; });
  }

  const byUser = {}; // uid(number) -> {date -> hours}
  const byDate = {}; // date -> hours
  rows.forEach(r => {
    const uid = Number(r.user_id); // 与 memberIds 的 number 口径对齐（对象键同为字符串，纯归一化、零行为变化）
    (byUser[uid] ||= {})[r.date] = (byUser[uid]?.[r.date] || 0) + r.hours;
    byDate[r.date] = (byDate[r.date] || 0) + r.hours;
  });

  memberIds.sort((a, b) => (users[a]?.sort_order || 0) - (users[b]?.sort_order || 0) || a - b);
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

/* ---------- 管理员工时统计总览（工时统计页 astats，只读聚合） ---------- */

const DATE_STR_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * 管理员工时统计总览：指定日期范围内的总工时 / 记录数 / 项目数 / 部门数 / 人数，
 * 以及按部门、按项目（均按工时降序）与「项目 × 部门」交叉矩阵。
 * 口径与 projectStats / 全部工时列表对齐：
 *  - scope=approved 时仅统计 t.status='approved'（与 /api/stats/project 一致）
 *  - date > today 的异常记录不参与合计（沿用统计矩阵口径）
 *  - 部门取工时记录上的部门快照（t.dept_id，与「全部工时信息」列表同源），
 *    LEFT JOIN departments 取名，无部门显示「未分组」
 *  - 项目按 id 分组（同名项目不合并）、部门按 id 分组，名称仅作展示
 * @param {{from:string, to:string, scope?:string}} q 查询参数
 * @returns {Promise<object>} overview 聚合结果
 */
export async function adminOverview(q) {
  const from = String(q?.from || '');
  const to = String(q?.to || '');
  const scope = q?.scope === undefined || q?.scope === null ? 'all' : String(q.scope);
  if (!DATE_STR_RE.test(from) || !DATE_STR_RE.test(to)) {
    throw err('VALIDATION_ERROR', 'from / to 必须为 YYYY-MM-DD 格式的日期');
  }
  if (from > to) throw err('VALIDATION_ERROR', 'from 不能晚于 to');
  if (scope !== 'all' && scope !== 'approved') {
    throw err('VALIDATION_ERROR', 'scope 仅支持 all（全部状态）或 approved（仅已通过）');
  }

  const today = serverToday();
  const statusCond = scope === 'approved' ? "AND t.status = 'approved'" : '';
  // 与「全部工时信息」列表同源的三表 join；t.date <= today 排除异常（未来日期）记录
  const fromClause = `
    FROM timesheets t
    JOIN users u ON u.id = t.user_id
    LEFT JOIN departments d ON d.id = t.dept_id
    JOIN projects p ON p.id = t.project_id
    WHERE t.date >= ? AND t.date <= ? AND t.date <= ? ${statusCond}`;
  const rangeParams = [from, to, today];

  // 1. 汇总：总工时 / 记录数 / 参与人数（SUM 兜底 0；decimalNumbers:true → number）
  const sum = await db.prepare(`
    SELECT COALESCE(SUM(t.hours), 0) AS total, COUNT(*) AS recordCount,
           COUNT(DISTINCT t.user_id) AS userCount${fromClause}`).get(...rangeParams);

  // 2. 按部门（含「未分组」）：按工时降序
  const deptRows = await db.prepare(`
    SELECT t.dept_id AS deptId, COALESCE(d.name, '未分组') AS name, SUM(t.hours) AS hours${fromClause}
    GROUP BY t.dept_id, d.name
    ORDER BY hours DESC, name`).all(...rangeParams);

  // 3. 按项目：按工时降序（项目按 id 分组，同名不合并）
  const projRows = await db.prepare(`
    SELECT t.project_id AS projectId, p.name AS name, SUM(t.hours) AS hours${fromClause}
    GROUP BY t.project_id, p.name
    ORDER BY hours DESC, name`).all(...rangeParams);

  // 4. 项目 × 部门交叉矩阵：行列分别按合计降序，缺省补 0
  const cellRows = await db.prepare(`
    SELECT t.project_id AS projectId, t.dept_id AS deptId, SUM(t.hours) AS hours${fromClause}
    GROUP BY t.project_id, t.dept_id`).all(...rangeParams);

  const pIndex = new Map(projRows.map((r, i) => [r.projectId, i]));
  const dIndex = new Map(deptRows.map((r, i) => [r.deptId, i]));
  const cells = projRows.map(() => deptRows.map(() => 0));
  cellRows.forEach(r => {
    const i = pIndex.get(r.projectId);
    const j = dIndex.get(r.deptId);
    if (i !== undefined && j !== undefined) cells[i][j] += r.hours;
  });

  return {
    from, to, scope,
    total: sum.total,
    recordCount: sum.recordCount,
    projectCount: projRows.length,
    deptCount: deptRows.length,
    userCount: sum.userCount,
    byDept: deptRows.map(r => ({ name: r.name, hours: r.hours })),
    byProject: projRows.map(r => ({ name: r.name, hours: r.hours })),
    matrix: {
      projects: projRows.map(r => r.name),
      depts: deptRows.map(r => r.name),
      cells,
    },
  };
}
