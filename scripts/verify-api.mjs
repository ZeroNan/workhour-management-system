// 接口端到端冒烟验证（可复用）：node scripts/verify-api.mjs [BASE_URL]
// 默认打 http://localhost:3456，覆盖：登录/首登改密闸门/月度视图/新增/编辑/提交/
// 待审核编辑/审核/统计/权限；结束后自动还原演示数据（密码重置 + 删除测试工时 + 清会话）。
const BASE = process.argv[2] || 'http://localhost:3456';
let pass = 0, fail = 0;
const fails = [];
function check(name, cond, extra) {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; fails.push(name); console.log(`  ❌ ${name}`, extra !== undefined ? JSON.stringify(extra).slice(0, 300) : ''); }
}
async function api(method, path, { body, cookie } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const setCookie = res.headers.get('set-cookie');
  let data = null;
  try { data = await res.json(); } catch { /* 204 等 */ }
  return { status: res.status, data, cookie: setCookie ? setCookie.split(';')[0] : null };
}
const login = (u, p) => api('POST', '/api/auth/login', { body: { username: u, password: p } });

// ---------- dev1 链路 ----------
let r = await login('dev1', '12345678');
check('dev1 登录（首登标记）', r.status === 200 && r.data?.user?.mustChangePassword === true, r);
let cookie = r.cookie;

r = await api('GET', '/api/timesheets', { cookie });
check('首登未改密访问业务接口被拦（403）', r.status === 403, r);

r = await api('PUT', '/api/auth/password', { cookie, body: { oldPassword: '12345678', newPassword: 'E2eTest@2026' } });
check('修改密码', r.status === 200, r);

r = await login('dev1', 'E2eTest@2026');
check('新密码重新登录（闸门解除）', r.status === 200 && r.data?.user?.mustChangePassword === false, r);
cookie = r.cookie;

r = await api('GET', '/api/auth/me', { cookie });
check('GET /me（含 today）', r.status === 200 && /^\d{4}-\d{2}-\d{2}$/.test(r.data?.today || ''), r);
const today = r.data.today;
const month = today.slice(0, 7);

r = await api('GET', `/api/timesheets/monthly?month=${month}`, { cookie });
check('月度视图', r.status === 200 && Array.isArray(r.data?.records) && Array.isArray(r.data?.projects), r);
const pid = r.data.projects[0]?.id;
check('月度视图含项目', !!pid, r.data?.projects);

r = await api('POST', '/api/timesheets', { cookie, body: { projectId: pid, date: today, hours: 2, content: 'e2e异步化验证-创建' } });
check('新增草稿（201）', r.status === 201 && r.data?.record?.status === 'draft', r);
const id = r.data?.record?.id;

r = await api('PUT', `/api/timesheets/${id}`, { cookie, body: { projectId: pid, date: today, hours: 3, content: 'e2e异步化验证-编辑' } });
check('编辑草稿', r.status === 200 && Number(r.data?.record?.hours) === 3, r);

r = await api('POST', `/api/timesheets/${id}/submit`, { cookie });
check('提交（draft→submitted）', r.status === 200 && r.data?.record?.status === 'submitted', r);

r = await api('PUT', `/api/timesheets/${id}`, { cookie, body: { projectId: pid, date: today, hours: 4, content: 'e2e异步化验证-待审核编辑', submit: true } });
check('待审核状态编辑（原 PM 编辑 Bug）', r.status === 200 && r.data?.record?.status === 'submitted' && Number(r.data?.record?.hours) === 4, r);

r = await api('GET', `/api/timesheets/day-summary?date=${today}`, { cookie });
check('日汇总（total 为数值）', r.status === 200 && typeof r.data?.total === 'number' && r.data.total >= 4, r);

r = await api('GET', '/api/departments', { cookie });
check('部门列表（3 个）', r.status === 200 && r.data?.length === 3, r);

// ---------- pm1 审核链路 ----------
r = await login('pm1', '12345678');
check('pm1 登录', r.status === 200, r);
let pmCookie = r.cookie;
await api('PUT', '/api/auth/password', { cookie: pmCookie, body: { oldPassword: '12345678', newPassword: 'E2eTest@2026' } });
r = await login('pm1', 'E2eTest@2026');
pmCookie = r.cookie;
check('pm1 改密并重登', r.status === 200, r);

r = await api('GET', '/api/audit/list?status=submitted', { cookie: pmCookie });
check('审核列表', r.status === 200 && Array.isArray(r.data), r);
const target = (r.data || []).find(t => t.id === id);
check('审核列表含测试记录且可审', !!target && target.canAudit === true, target);

r = await api('POST', `/api/timesheets/${id}/approve`, { cookie: pmCookie });
check('pm1 审核通过', r.status === 200 && r.data?.record?.status === 'approved', r);

r = await api('PUT', `/api/timesheets/${id}`, { cookie, body: { projectId: pid, date: today, hours: 5, content: 'x' } });
check('已通过记录编辑被拒（409）', r.status === 409, r);

// ---------- admin 链路 ----------
r = await login('admin', '12345678');
check('admin 登录', r.status === 200, r);
let adminCookie = r.cookie;
await api('PUT', '/api/auth/password', { cookie: adminCookie, body: { oldPassword: '12345678', newPassword: 'E2eTest@2026' } });
r = await login('admin', 'E2eTest@2026');
adminCookie = r.cookie;
check('admin 改密并重登', r.status === 200, r);

r = await api('GET', '/api/users', { cookie: adminCookie });
check('人员列表（9 人）', r.status === 200 && r.data?.length === 9, r);
r = await api('GET', '/api/projects', { cookie: adminCookie });
check('项目列表（2 个）', r.status === 200 && r.data?.length === 2, r);
r = await api('GET', `/api/stats/project?projectId=${pid}&month=${month}`, { cookie: adminCookie });
check('项目统计矩阵', r.status === 200 && Array.isArray(r.data?.memberRows) && Array.isArray(r.data?.totals), r);
r = await api('GET', `/api/timesheets/all?status=approved`, { cookie: adminCookie });
check('全部工时（admin）', r.status === 200 && Array.isArray(r.data), r);
r = await api('GET', `/api/audit/list?status=submitted`, { cookie: adminCookie });
check('admin 审核列表', r.status === 200 && Array.isArray(r.data), r);

// ---------- 还原演示数据 ----------
console.log('\n---------- 还原演示数据 ----------');
for (const uid of [4, 2, 1]) { // dev1, pm1, admin → 密码回到 12345678 + must_change=1
  r = await api('PUT', `/api/users/${uid}/password`, { cookie: adminCookie, body: { newPassword: '12345678' } });
  check(`重置密码 uid=${uid}`, r.status === 200, r);
}

// SQL 清理：删测试工时 + 清会话
const { config } = await import('../src/config.js');
const mysql = (await import('mysql2/promise')).default;
const conn = await mysql.createConnection({ host: config.db.host, port: config.db.port, user: config.db.user, password: config.db.password, database: config.db.database, connectTimeout: 10000 });
const [del] = await conn.query("DELETE FROM timesheets WHERE content LIKE 'e2e异步化验证%'");
check('删除测试工时', del.affectedRows >= 1, del.affectedRows);
await conn.query('DELETE FROM sessions');
await conn.end();
check('清空会话表', true);

console.log(`\n========== 结果：${pass} PASS / ${fail} FAIL ==========`);
if (fail) { console.log('失败项：', fails.join(' | ')); process.exit(1); }
