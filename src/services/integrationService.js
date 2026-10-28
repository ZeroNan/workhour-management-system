// WPS / 开放集成：工时同步业务逻辑 + 密钥管理
// 设计要点：
//  - 单个 API 密钥代表一个集成方，可在一次请求中提交「不同人员」的工时（员工以 employeeNo / username 标识）。
//  - 写入的工时状态统一为 'submitted'（待审核），由 PM/admin 在审核页处理。
//  - 自动把提交员工加入 project_members（INSERT IGNORE），使其工时在项目负责人统计中可见。
//  - 幂等：客户端传 Idempotency-Key；同 Key 重复提交返回首次结果，内容不一致则 409。
//  - 原子：单批次任一记录校验失败 -> 整批拒绝（422），不落任何行。
import { createHash, randomBytes } from 'node:crypto';
import db from '../db.js';
import { err } from '../utils/http.js';
import { serverToday, nowStr, isValidDateStr } from '../utils/date.js';

const MAX_RECORDS = 500;

// ---------------- 密钥管理 ----------------
export function generateRawKey() {
  return 'wtms_' + randomBytes(24).toString('hex');
}
function hashKey(key) {
  return createHash('sha256').update(key).digest('hex');
}

export async function createKey({ name, rateLimit = 120 } = {}) {
  const raw = generateRawKey();
  const now = nowStr();
  const info = await db.prepare(
    "INSERT INTO api_keys(key_hash,name,status,rate_limit,created_at) VALUES (?,?, 'active',?,?)",
  ).run(hashKey(raw), name || '未命名密钥', Number(rateLimit) || 120, now);
  return { id: info.lastInsertRowid, key: raw, name: name || '未命名密钥', rateLimit: Number(rateLimit) || 120, createdAt: now };
}

export async function listKeys() {
  return db.prepare(
    'SELECT id,name,status,rate_limit,created_at,last_used_at,revoked_at FROM api_keys ORDER BY id',
  ).all();
}

export async function revokeKey(id) {
  const info = await db.prepare(
    "UPDATE api_keys SET status='revoked', revoked_at=? WHERE id=? AND status<>'revoked'",
  ).run(nowStr(), Number(id));
  if (info.changes === 0) throw err('NOT_FOUND', '密钥不存在或已停用');
  return { id: Number(id) };
}

// ---------------- 同步主流程 ----------------
export async function syncWorkHours(apiKey, body, idempotencyKey) {
  // 1) 顶层结构校验
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw err('VALIDATION_ERROR', '请求体必须是 JSON 对象');
  }
  const project = body.project;
  if (!project || (!project.projectId && !project.projectName)) {
    throw err('VALIDATION_ERROR', '缺少 project（需提供 projectId 或 projectName）');
  }
  const records = body.records;
  if (!Array.isArray(records) || records.length === 0) {
    throw err('VALIDATION_ERROR', 'records 不能为空数组');
  }
  if (records.length > MAX_RECORDS) {
    throw err('PAYLOAD_TOO_LARGE', `单次最多提交 ${MAX_RECORDS} 条工时`, { max: MAX_RECORDS });
  }

  return db.transaction(async () => {
    await db.prepare('SELECT id FROM api_keys WHERE id = ? FOR UPDATE').get(apiKey.id);
    // 幂等重放先于业务校验；API 密钥行锁防止同一集成的并发重试重复入库。
    const bodyHash = createHash('sha256').update(JSON.stringify(body)).digest('hex');
    if (idempotencyKey) {
      const existing = await db.prepare('SELECT body_hash,response_code,response_body FROM sync_idempotency WHERE idem_key=?')
        .get(idempotencyKey);
      if (existing) {
        if (existing.body_hash === bodyHash) {
          const payload = JSON.parse(existing.response_body || '{}');
          return { ...payload, duplicate: true, idempotencyKey };
        }
        throw err('IDEMPOTENCY_CONFLICT', '同一 Idempotency-Key 对应的请求内容不一致', { idempotencyKey });
      }
    }

    // 2) 解析项目
    let proj;
    if (project.projectId) {
      proj = await db.prepare('SELECT id,owner_id,name FROM projects WHERE id=?').get(Number(project.projectId));
    } else {
      proj = await db.prepare('SELECT id,owner_id,name FROM projects WHERE name=?').get(project.projectName);
    }
    if (!proj) throw err('PROJECT_NOT_FOUND', '项目不存在，请确认 projectId 或 projectName', { project });

    // 3) 逐条解析 + 校验
    const errors = [];
    const parsed = [];
    const dailyTotals = new Map(); // `${userId}|${date}` -> hours（本批内合计）
    for (let i = 0; i < records.length; i++) {
      const r = records[i] || {};
      const idx = i + 1;

      const employeeNo = r.employeeNo ?? body.employee?.employeeNo;
      const username = r.username;
      if (!employeeNo && !username) {
        errors.push({ index: idx, field: 'employeeNo', message: '缺少 employeeNo 或 username' });
        continue;
      }
      let emp;
      if (employeeNo) {
        emp = await db.prepare('SELECT id,name,dept_id FROM users WHERE employee_no=?').get(String(employeeNo));
      }
      if (!emp && username) {
        emp = await db.prepare('SELECT id,name,dept_id FROM users WHERE username=?').get(String(username));
      }
      if (!emp) {
        errors.push({ index: idx, field: 'employeeNo', message: `员工不存在：${employeeNo || username}` });
        continue;
      }

      const date = r.date;
      if (!isValidDateStr(date)) {
        errors.push({ index: idx, field: 'date', message: '日期非法，应为 YYYY-MM-DD' });
        continue;
      }
      if (date > serverToday()) {
        errors.push({ index: idx, field: 'date', message: '工时日期不能晚于今天' });
        continue;
      }
      const h = Number(r.hours);
      if (!Number.isFinite(h) || h <= 0 || h > 24) {
        errors.push({ index: idx, field: 'hours', message: '工时须为 0 < h <= 24 的数字' });
        continue;
      }
      const content = (typeof r.taskDesc === 'string' && r.taskDesc.trim()) ? r.taskDesc.trim() : '(WPS 同步)';
      parsed.push({ userId: emp.id, deptId: emp.dept_id, date, hours: h, content, name: emp.name });
      const k = `${emp.id}|${date}`;
      dailyTotals.set(k, (dailyTotals.get(k) || 0) + h);
    }
    if (errors.length) {
      throw err('INVALID_RECORD', `有 ${errors.length} 条记录校验未通过`, { errors });
    }

    // 与网页填报使用相同用户锁；多员工批次按 ID 顺序加锁，避免交叉死锁。
    const userIds = [...new Set(parsed.map(p => p.userId))].sort((a, b) => a - b);
    for (const uid of userIds) {
      await db.prepare('SELECT id FROM users WHERE id = ? FOR UPDATE').get(uid);
    }
    // 4) 每日合计 <= 24（含库中已有）
    for (const [k, add] of dailyTotals) {
      const [userId, date] = k.split('|');
      const row = await db.prepare('SELECT COALESCE(SUM(hours),0) AS t FROM timesheets WHERE user_id=? AND date=?')
        .get(Number(userId), date);
      const total = (Number(row.t) || 0) + add;
      if (total > 24 + 1e-9) {
        const who = parsed.find((p) => String(p.userId) === userId && p.date === date)?.name || '';
        throw err('HOURS_EXCEEDED', `员工 ${who} 在 ${date} 的工时合计将超 24 小时（含已有 ${Number(row.t) || 0}）`);
      }
    }

    // 6) 入库（事务，状态 submitted）
    const now = nowStr();
    const insertTs = db.prepare(
      `INSERT INTO timesheets(user_id,dept_id,project_id,date,hours,content,status,submit_time,audit_time,auditor_id,audit_comment,created_at,updated_at)
       VALUES (?,?,?,?,?,?, 'submitted',?,NULL,NULL,'',?,?)`,
    );
    const ids = [];
    for (const p of parsed) {
      const info = await insertTs.run(p.userId, p.deptId, proj.id, p.date, p.hours, p.content, now, now, now);
      ids.push(info.lastInsertRowid);
      await db.prepare('INSERT IGNORE INTO project_members(project_id,user_id) VALUES (?,?)').run(proj.id, p.userId);
    }
    const response = {
      code: 'OK', accepted: ids.length, timesheetIds: ids,
      idempotencyKey: idempotencyKey || null, duplicate: false,
      projectId: proj.id, projectName: proj.name,
    };
    if (idempotencyKey) {
      await db.prepare('INSERT INTO sync_idempotency(idem_key,key_id,body_hash,response_code,response_body,created_at) VALUES (?,?,?,?,?,?)')
        .run(idempotencyKey, apiKey.id, bodyHash, 201, JSON.stringify(response), now);
    }
    return response;
  })();
}

// ---------------- 运行日志 ----------------
export async function recordSyncLog({ keyId, status, errorCode, accepted, ip, ms }) {
  try {
    await db.prepare(
      'INSERT INTO sync_log(key_id,status,error_code,accepted,client_ip,duration_ms,created_at) VALUES (?,?,?,?,?,?,?)',
    ).run(keyId, status, errorCode || null, accepted || 0, ip, ms, nowStr());
  } catch (_) { /* 日志失败不影响主流程 */ }
}

// 同步调用日志（管理员审计/监控；最近优先）
export async function listLogs(limit = 200) {
  const n = Math.min(Math.max(Number(limit) || 200, 1), 1000);
  return db.prepare(`
    SELECT l.id, l.key_id, k.name AS key_name, l.status, l.error_code,
           l.accepted, l.client_ip, l.duration_ms, l.created_at
    FROM sync_log l
    LEFT JOIN api_keys k ON k.id = l.key_id
    ORDER BY l.id DESC
    LIMIT ?
  `).all(n);
}
