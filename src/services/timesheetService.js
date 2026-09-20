// 工时服务层：状态机（SQL 条件更新）、日期校验、24h 校验、dayEditable/daySummary
// 注意：MySQL 版 db.prepare(...).get/all/run 均返回 Promise，所有函数为 async，调用方必须 await。
import db from '../db.js';
import { err } from '../utils/http.js';
import { serverToday, nowStr, isValidDateStr } from '../utils/date.js';

const SELECT_RECORD = `
  SELECT t.*, u.name AS user_name, d.name AS dept_name, p.name AS project_name, p.owner_id
  FROM timesheets t
  JOIN users u ON u.id = t.user_id
  LEFT JOIN departments d ON d.id = t.dept_id
  JOIN projects p ON p.id = t.project_id`;

export async function getRecord(id) {
  return db.prepare(`${SELECT_RECORD} WHERE t.id = ?`).get(id);
}

/** 本人当日合计（可排除某条） */
export async function dayTotal(userId, date, excludeId = null) {
  const row = await db.prepare(`
    SELECT COALESCE(SUM(hours),0) AS n FROM timesheets
    WHERE user_id = ? AND date = ? AND id != ?`).get(userId, date, excludeId || -1);
  return row.n;
}

/** 某人某日是否可编辑（无记录或有任一非 approved 记录） */
export async function dayEditable(userId, date) {
  const rows = await db.prepare('SELECT status FROM timesheets WHERE user_id = ? AND date = ?').all(userId, date);
  return rows.length === 0 || rows.some(r => r.status !== 'approved');
}

/** 写入侧统一校验链：日期/工时/内容/成员资格/24h/日可编辑 */
async function validatePayload(userId, body, { excludeId = null } = {}) {
  const { projectId, date, hours, content } = body;
  if (!Number.isInteger(Number(projectId)) || Number(projectId) <= 0) {
    throw err('VALIDATION_ERROR', '请选择项目');
  }
  if (!isValidDateStr(date)) throw err('VALIDATION_ERROR', '日期格式非法，应为 YYYY-MM-DD');
  if (date > serverToday()) {
    throw err('FUTURE_DATE', `工时日期不能晚于今天（${serverToday()}）`);
  }
  const h = Number(hours);
  if (!Number.isFinite(h) || h <= 0 || h > 24) {
    throw err('VALIDATION_ERROR', '工时必须大于 0 且不超过 24 小时');
  }
  if (typeof content !== 'string' || !content.trim()) {
    throw err('VALIDATION_ERROR', '工作内容不能为空');
  }
  // 成员资格
  const member = await db.prepare('SELECT 1 AS x FROM project_members WHERE project_id = ? AND user_id = ?')
    .get(Number(projectId), userId);
  if (!member) throw err('NOT_MEMBER', '您不是该项目成员，无法填报该项目工时');
  // 当日合计 > 24 硬校验
  const total = (await dayTotal(userId, date, excludeId)) + h;
  if (total > 24 + 1e-9) {
    throw err('HOURS_EXCEEDED', `每日合计不能超过 24 小时（本次将合计 ${Math.round(total * 100) / 100} 小时）`);
  }
  // 当日已全部通过审核：不可新增/移入
  if (!(await dayEditable(userId, date))) {
    throw err('DAY_NOT_EDITABLE', '该日工时已全部通过审核，不可再填报');
  }
  return { projectId: Number(projectId), date, hours: h, content: content.trim() };
}

/** 新增（submit=true 直接落为 submitted） */
export async function create(user, body) {
  const { projectId, date, hours, content } = await validatePayload(user.id, body);
  const submit = body.submit === true;
  const now = nowStr();
  const dept = await db.prepare('SELECT dept_id FROM users WHERE id = ?').get(user.id);
  const info = await db.prepare(`
    INSERT INTO timesheets(user_id,dept_id,project_id,date,hours,content,status,submit_time,audit_time,auditor_id,audit_comment,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(user.id, dept.dept_id, projectId, date, hours, content,
    submit ? 'submitted' : 'draft', submit ? now : null, null, null, '', now, now);
  const record = await getRecord(info.lastInsertRowid);
  return { record, dayTotal: await dayTotal(user.id, date) };
}

/**
 * 修改（本人；draft/rejected/submitted 均可改，条件更新保证并发安全）。
 * 对应需求：未提交/未审核/未通过 的工时记录均可修改。
 * - submitted（待审核）记录允许编辑：保存为草稿则回到 draft，保存并提交则重新 submitted。
 * - approved（已生效）记录只读，不可修改。
 */
export async function update(user, id, body) {
  const old = await db.prepare('SELECT * FROM timesheets WHERE id = ?').get(id);
  if (!old || old.user_id !== user.id) throw err('NOT_FOUND', '记录不存在');
  if (old.status === 'approved') {
    throw err('STATE_CONFLICT', '该记录已通过审核并生效，不可修改', { currentStatus: old.status });
  }
  if (!['draft', 'rejected', 'submitted'].includes(old.status)) {
    throw err('STATE_CONFLICT', '当前状态不可修改，请刷新后重试', { currentStatus: old.status });
  }
  const { projectId, date, hours, content } = await validatePayload(user.id, body, { excludeId: id });
  const submit = body.submit === true;
  const now = nowStr();
  // 条件更新：status 未变才生效（并发保护）
  const info = await db.prepare(`
    UPDATE timesheets SET project_id=?, date=?, hours=?, content=?,
      status=?, submit_time=?, audit_time=NULL, auditor_id=NULL, audit_comment='', updated_at=?
    WHERE id=? AND status IN ('draft','rejected','submitted')
  `).run(projectId, date, hours, content, submit ? 'submitted' : 'draft',
    submit ? now : null, now, id);
  if (info.changes === 0) {
    throw err('STATE_CONFLICT', '该记录已被审核或已被修改，请刷新后重试');
  }
  const record = await getRecord(id);
  return { record, dayTotal: await dayTotal(user.id, date) };
}

/**
 * 删除（提交者本人 / 项目 owner / admin 均可；仅非生效记录可删）。
 * 对应需求：未提交(draft)、未审核(submitted)、未通过(rejected) 的工时记录均可删除。
 */
export async function remove(user, id) {
  const old = await getRecord(id);
  if (!old) throw err('NOT_FOUND', '记录不存在');
  const isSubmitter = user.id === old.user_id;
  const isProjectOwner = user.role !== 'admin' && user.id === old.owner_id;
  if (!isSubmitter && !isProjectOwner && user.role !== 'admin') {
    throw err('FORBIDDEN', '无权删除该工时记录');
  }
  if (old.status === 'approved') {
    throw err('STATE_CONFLICT', '该记录已通过审核并生效，不可删除', { currentStatus: old.status });
  }
  const info = await db.prepare(`DELETE FROM timesheets WHERE id = ? AND status != 'approved'`).run(id);
  if (info.changes === 0) {
    throw err('STATE_CONFLICT', '该记录已通过审核并生效，不可删除', { currentStatus: 'approved' });
  }
}

/**
 * 撤回（submitted → draft；提交者本人 / 项目 owner / admin）。
 * 对应需求：未审核记录应可修改——先撤回为草稿再编辑。条件更新保证并发安全。
 */
export async function withdraw(user, id) {
  const old = await getRecord(id);
  if (!old) throw err('NOT_FOUND', '记录不存在');
  const isSubmitter = user.id === old.user_id;
  const isProjectOwner = user.role !== 'admin' && user.id === old.owner_id;
  if (!isSubmitter && !isProjectOwner && user.role !== 'admin') {
    throw err('FORBIDDEN', '无权撤回该工时记录');
  }
  if (old.status !== 'submitted') {
    throw err('STATE_CONFLICT', '仅待审核记录可撤回', { currentStatus: old.status });
  }
  const now = nowStr();
  const info = await db.prepare(`
    UPDATE timesheets SET status='draft', submit_time=NULL, audit_time=NULL, auditor_id=NULL, audit_comment='', updated_at=?
    WHERE id=? AND status='submitted'`).run(now, id);
  if (info.changes === 0) {
    throw err('STATE_CONFLICT', '该记录已被处理，请刷新后重试');
  }
  return { record: await getRecord(id) };
}

/** 提交（本人；draft/rejected → submitted，幂等：已 submitted 直接返回） */
export async function submit(user, id) {
  const old = await db.prepare('SELECT * FROM timesheets WHERE id = ?').get(id);
  if (!old || old.user_id !== user.id) throw err('NOT_FOUND', '记录不存在');
  if (old.status === 'submitted') return { record: await getRecord(id), idempotent: true };
  if (old.status !== 'draft' && old.status !== 'rejected') {
    throw err('STATE_CONFLICT', '当前状态不允许提交', { currentStatus: old.status });
  }
  const now = nowStr();
  const info = await db.prepare(`
    UPDATE timesheets SET status='submitted', submit_time=?, audit_time=NULL, auditor_id=NULL, audit_comment='', updated_at=?
    WHERE id=? AND status IN ('draft','rejected')`).run(now, now, id);
  if (info.changes === 0) {
    throw err('STATE_CONFLICT', '该记录已被审核或已被修改，请刷新后重试');
  }
  return { record: await getRecord(id) };
}

/**
 * 审核（通过/退回）。行级权限 + 自审拦截 + 条件更新 + 幂等。
 * @returns {Promise<{record, idempotent?}>}
 */
export async function audit(actor, id, action, comment) {
  const old = await db.prepare(`
    SELECT t.*, p.owner_id FROM timesheets t JOIN projects p ON p.id = t.project_id WHERE t.id = ?`).get(id);
  if (!old) throw err('NOT_FOUND', '记录不存在');
  // 权限：项目 owner(pm) 或 admin
  if (actor.role !== 'admin' && actor.id !== old.owner_id) {
    throw err('FORBIDDEN', '您不是该项目负责人，无权审核');
  }
  // 自审拦截（admin 亦不可审自己，规则统一：审核人==提交者即 403）
  if (actor.id === old.user_id) {
    throw err('SELF_AUDIT_FORBIDDEN', '本人记录由管理员代审');
  }
  if (action === 'approve') {
    // 幂等：已 approved → 200
    if (old.status === 'approved') return { record: await getRecord(id), idempotent: true };
    const now = nowStr();
    const info = await db.prepare(`
      UPDATE timesheets SET status='approved', audit_time=?, auditor_id=?, updated_at=?
      WHERE id=? AND status='submitted'`).run(now, actor.id, now, id);
    if (info.changes === 0) {
      const cur = await db.prepare('SELECT status FROM timesheets WHERE id = ?').get(id);
      if (cur && cur.status === 'approved') return { record: await getRecord(id), idempotent: true };
      throw err('STATE_CONFLICT', '该记录已被处理或已被修改，请刷新后重试', { currentStatus: cur ? cur.status : null });
    }
    return { record: await getRecord(id) };
  } else if (action === 'reject') {
    const c = String(comment || '').trim();
    if (!c) throw err('COMMENT_REQUIRED', '退回意见不能为空');
    if (old.status === 'rejected' && old.audit_comment === c) {
      return { record: await getRecord(id), idempotent: true };
    }
    const now = nowStr();
    const info = await db.prepare(`
      UPDATE timesheets SET status='rejected', audit_time=?, auditor_id=?, audit_comment=?, updated_at=?
      WHERE id=? AND status='submitted'`).run(now, actor.id, c, now, id);
    if (info.changes === 0) {
      const cur = await db.prepare('SELECT status, audit_comment FROM timesheets WHERE id = ?').get(id);
      if (cur && cur.status === 'rejected' && cur.audit_comment === c) {
        return { record: await getRecord(id), idempotent: true };
      }
      throw err('STATE_CONFLICT', '该记录已被处理或已被修改，请刷新后重试', { currentStatus: cur ? cur.status : null });
    }
    return { record: await getRecord(id) };
  }
  throw err('VALIDATION_ERROR', '未知审核操作');
}

/** 批量审核：逐条独立处理、不整体回滚；selfSubmitted → skipped */
export async function batchAudit(actor, ids, action, comment) {
  if (action !== 'approve' && action !== 'reject') {
    throw err('VALIDATION_ERROR', 'action 必须为 approve 或 reject');
  }
  if (action === 'reject' && !String(comment || '').trim()) {
    throw err('COMMENT_REQUIRED', '退回意见不能为空');
  }
  const results = [];
  const summary = { ok: 0, skipped: 0, conflict: 0, not_found: 0 };
  for (const rawId of ids) {
    const id = Number(rawId);
    try {
      await audit(actor, id, action, comment);
      results.push({ id, result: 'ok' });
      summary.ok++;
    } catch (e) {
      if (e.code === 'SELF_AUDIT_FORBIDDEN') {
        results.push({ id, result: 'skipped', reason: '本人记录，由管理员代审' });
        summary.skipped++;
      } else if (e.code === 'STATE_CONFLICT') {
        results.push({ id, result: 'conflict', reason: e.message });
        summary.conflict++;
      } else if (e.code === 'NOT_FOUND') {
        results.push({ id, result: 'not_found', reason: '记录不存在' });
        summary.not_found++;
      } else if (e.code === 'FORBIDDEN') {
        // 无权审（非本人项目）按 skipped 反馈
        results.push({ id, result: 'skipped', reason: '无该项目审核权限' });
        summary.skipped++;
      } else {
        throw e; // 参数类错误（如退回意见缺失）整体 400
      }
    }
  }
  return { results, summary };
}

/** 日汇总（20 号接口） */
export async function daySummary(user, date) {
  if (!isValidDateStr(date)) throw err('VALIDATION_ERROR', '日期格式非法，应为 YYYY-MM-DD');
  const today = serverToday();
  const total = await dayTotal(user.id, date);
  return { date, total, editable: await dayEditable(user.id, date), future: date > today };
}
