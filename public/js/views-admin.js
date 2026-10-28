'use strict';
/* 管理员：基础数据管理（部门/项目/人员）+ 全部工时 + 按项目统计 + Excel 导出（本地 vendor SheetJS，降级 CSV） */
let baseTab = 'dept';  // dept | project | user

async function renderBase(main) {
  const tabs = [
    { k:'dept',   label:'部门管理' },
    { k:'project', label:'项目管理' },
    { k:'user',   label:'人员管理' },
  ];
  main.innerHTML = `
    <div class="page-head"><h2>基础数据管理</h2></div>
    <div class="tabbar">${tabs.map(t =>
      `<div class="tab-item ${baseTab === t.k ? 'active' : ''}" data-tab="${t.k}">${t.label}</div>`).join('')}</div>
    <div id="base-body"></div>`;
  $$('.tab-item').forEach(el => el.onclick = () => { baseTab = el.dataset.tab; renderView(); });

  const body = $('#base-body');
  if (baseTab === 'dept') await renderDeptTab(body);
  else if (baseTab === 'project') await renderProjectTab(body);
  else await renderUserTab(body);
}

/* ---------- 部门管理 ---------- */
async function renderDeptTab(body) {
  const departments = await api.get('/api/departments');
  const rows = departments.map(d => `
    <tr>
      <td class="left">${esc(d.name)}</td>
      <td>${d.userCount}</td>
      <td><div class="td-acts">
        <button class="btn btn-sm" data-act="dept-edit" data-id="${d.id}">编辑</button>
        <button class="btn btn-sm btn-danger" data-act="dept-del" data-id="${d.id}">删除</button>
      </div></td>
    </tr>`).join('');
  body.innerHTML = `
    <div class="card">
      <div class="filters">
        <div class="filter"><label>新增部门</label><input id="bd-name" placeholder="请输入部门名称"></div>
        <div class="filter" style="justify-content:flex-end"><button class="btn btn-primary" id="bd-add">添加部门</button></div>
      </div>
      ${departments.length ? `
      <div class="tbl-wrap"><table class="tbl">
        <thead><tr><th class="left">部门名称</th><th>关联人员数</th><th>操作</th></tr></thead>
        <tbody>${rows}</tbody>
      </table></div>` : '<div class="empty">暂无部门数据</div>'}
    </div>`;

  $('#bd-add').onclick = async () => {
    const name = $('#bd-name').value.trim();
    if (!name) { toast('部门名称不能为空', 'error'); return; }
    try {
      await api.post('/api/departments', { name });
      toast('部门添加成功');
      renderView();
    } catch (e) { toast(e.message || '添加失败', 'error'); }
  };

  body.addEventListener('click', async e => {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const id = Number(btn.dataset.id);
    const dep = departments.find(d => d.id === id);
    if (!dep) return;
    if (btn.dataset.act === 'dept-edit') {
      const v = await uiPrompt('编辑部门', '部门名称', dep.name, false);
      if (v === null) return;
      try {
        await api.put(`/api/departments/${id}`, { name: v });
        toast('部门已更新'); renderView();
      } catch (e2) { toast(e2.message || '更新失败', 'error'); }
    } else if (btn.dataset.act === 'dept-del') {
      if (!(await uiConfirm(`确定删除部门「${dep.name}」吗？`))) return;
      try {
        await api.del(`/api/departments/${id}`);
        toast('部门已删除'); renderView();
      } catch (e2) { toast(e2.message || '删除失败', 'error'); }
    }
  });
}

/* ---------- 项目管理 ---------- */
async function renderProjectTab(body) {
  const [projects, users] = await Promise.all([api.get('/api/projects'), api.get('/api/users')]);
  const pmUsers = users.filter(u => u.role === 'pm');
  const rows = projects.map(p => `
    <tr>
      <td class="left">${esc(p.name)}</td>
      <td>${esc(p.ownerName)}</td>
      <td class="left td-content" title="${esc(p.memberNames.join('、'))}">${esc(p.memberNames.join('、'))}</td>
      <td>${p.timesheetCount}</td>
      <td><div class="td-acts">
        <button class="btn btn-sm" data-act="proj-edit" data-id="${p.id}">编辑</button>
        <button class="btn btn-sm btn-danger" data-act="proj-del" data-id="${p.id}">删除</button>
      </div></td>
    </tr>`).join('');
  body.innerHTML = `
    <div class="card">
      <div class="filters" style="justify-content:space-between">
        <span class="muted">共 ${projects.length} 个项目</span>
        <button class="btn btn-primary" id="pj-add">添加项目</button>
      </div>
      ${projects.length ? `
      <div class="tbl-wrap"><table class="tbl">
        <thead><tr><th class="left">项目名称</th><th>负责人</th><th class="left">项目成员</th><th>工时记录数</th><th>操作</th></tr></thead>
        <tbody>${rows}</tbody>
      </table></div>` : '<div class="empty">暂无项目数据</div>'}
    </div>`;

  $('#pj-add').onclick = () => openProjectForm(null, users);

  body.addEventListener('click', async e => {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const p = projects.find(x => x.id === Number(btn.dataset.id));
    if (!p) return;
    if (btn.dataset.act === 'proj-edit') openProjectForm(p, users);
    else if (btn.dataset.act === 'proj-del') {
      if (!(await uiConfirm(`确定删除项目「${p.name}」吗？（存在关联工时记录时会被拦截）`))) return;
      try {
        await api.del(`/api/projects/${p.id}`);
        toast('项目已删除'); renderView();
      } catch (e2) { toast(e2.message || '删除失败', 'error'); }
    }
  });
}

/* 项目新增/编辑弹窗 */
function openProjectForm(proj, users) {
  const isEdit = !!proj;
  const pmUsers = users.filter(u => u.role === 'pm');
  const candMembers = users.filter(u => u.role !== 'admin');
  const m = openModal(isEdit ? '编辑项目' : '添加项目', `
    <div class="form-grid">
      <div class="fg"><label>项目名称 *</label>
        <input id="pj-name" value="${proj ? esc(proj.name) : ''}" placeholder="如：电商平台">
        <span class="ferr" id="pj-name-err"></span></div>
      <div class="fg"><label>项目负责人 *</label>
        <select id="pj-owner"><option value="">请选择负责人</option>
          ${pmUsers.map(u => opt(u.id, u.name, proj ? proj.ownerId : '')).join('')}
        </select>
        <span class="ferr" id="pj-owner-err"></span></div>
      <div class="fg wide"><label>项目成员（多选，负责人将自动加入） *</label>
        <div class="member-checks">
          ${candMembers.map(u => `
            <label class="mcheck">
              <input type="checkbox" value="${u.id}" ${proj && proj.memberIds.includes(u.id) ? 'checked' : ''}>
              ${esc(u.name)}（${esc(u.deptName || '—')}）
            </label>`).join('')}
        </div>
        <span class="ferr" id="pj-mem-err"></span></div>
    </div>
    <div class="modal-actions">
      <button class="btn" data-close>取消</button>
      <button class="btn btn-primary" id="pj-save">保存</button>
    </div>`);

  m.querySelector('#pj-save').onclick = async () => {
    const name = m.querySelector('#pj-name').value.trim();
    const ownerId = m.querySelector('#pj-owner').value;
    const memberIds = Array.from(m.querySelectorAll('.mcheck input:checked')).map(c => Number(c.value));
    let ok = true;
    m.querySelector('#pj-name-err').textContent = '';
    m.querySelector('#pj-owner-err').textContent = '';
    m.querySelector('#pj-mem-err').textContent = '';
    if (!name) { m.querySelector('#pj-name-err').textContent = '项目名称不能为空'; ok = false; }
    if (!ownerId) { m.querySelector('#pj-owner-err').textContent = '请选择负责人'; ok = false; }
    if (!memberIds.length) { m.querySelector('#pj-mem-err').textContent = '请至少勾选一名成员'; ok = false; }
    if (!ok) return;
    const payload = { name, ownerId: Number(ownerId), memberIds };
    try {
      if (isEdit) await api.put(`/api/projects/${proj.id}`, payload);
      else await api.post('/api/projects', payload);
      closeModal(); toast('项目保存成功'); renderView();
    } catch (e) {
      if (e.code === 'DUPLICATE_NAME') m.querySelector('#pj-name-err').textContent = e.message;
      else toast(e.message || '保存失败', 'error');
    }
  };
}

/* ---------- 人员管理 ---------- */
async function renderUserTab(body) {
  const [users, departments] = await Promise.all([api.get('/api/users'), api.get('/api/departments')]);
  const rows = users.map(u => `
    <tr>
      <td class="left">${esc(u.name)}</td>
      <td>${esc(u.username)}</td>
      <td>${ROLE_LABEL[u.role] || u.role}</td>
      <td>${esc(u.deptName || '—')}</td>
      <td>${u.sortOrder ?? 0}</td>
      <td>${u.mustChangePassword ? '<span class="tag-daishen">待改密</span>' : '<span class="muted">正常</span>'}</td>
      <td><div class="td-acts">
        <button class="btn btn-sm" data-act="user-edit" data-id="${u.id}">编辑</button>
        <button class="btn btn-sm" data-act="user-pwd" data-id="${u.id}">重置密码</button>
      </div></td>
    </tr>`).join('');
  const deptOpts = departments.map(d => opt(d.id, d.name, '')).join('');
  const roleOpts = opt('dev', '研发人员', 'dev') + opt('pm', '项目负责人', '');

  body.innerHTML = `
    <div class="card">
      <div class="form-grid" style="margin-bottom:16px">
        <div class="fg"><label>姓名 *</label><input id="us-name" placeholder="真实姓名"></div>
        <div class="fg"><label>登录名 *</label><input id="us-username" placeholder="登录账号，如 dev7"></div>
        <div class="fg"><label>初始密码（最短 8 位） *</label><input id="us-password" placeholder="初始密码"></div>
        <div class="fg"><label>角色 *</label><select id="us-role">${roleOpts}</select></div>
        <div class="fg"><label>部门 *</label><select id="us-dept"><option value="">请选择部门</option>${deptOpts}</select></div>
        <div class="fg"><label>排列顺序（越小越靠前）</label><input id="us-sort" type="number" min="0" max="2147483647" step="1" value="0"></div>
        <div class="fg" style="justify-content:flex-end"><button class="btn btn-primary" id="us-add">创建账号</button></div>
      </div>
      ${users.length ? `
      <div class="tbl-wrap"><table class="tbl">
        <thead><tr><th class="left">姓名</th><th>登录名</th><th>角色</th><th>部门</th><th>排列顺序</th><th>密码状态</th><th>操作</th></tr></thead>
        <tbody>${rows}</tbody>
      </table></div>` : '<div class="empty">暂无人员数据</div>'}
    </div>`;

  $('#us-add').onclick = async () => {
    const name = $('#us-name').value.trim();
    const username = $('#us-username').value.trim();
    const password = $('#us-password').value;
    const role = $('#us-role').value;
    const deptId = $('#us-dept').value;
    const sortOrder = Number($('#us-sort').value);
    if (!name || !username || !password || !role || !deptId) {
      toast('所有字段均为必填，请完整填写', 'error'); return;
    }
    if (password.length < 8) { toast('初始密码最短 8 位', 'error'); return; }
    try {
      await api.post('/api/users', { name, username, password, role, deptId: Number(deptId), sortOrder });
      toast(`账号「${name}」创建成功，首次登录需修改密码`);
      renderView();
    } catch (e) { toast(e.message || '创建失败', 'error'); }
  };

  body.addEventListener('click', async e => {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const u = users.find(x => x.id === Number(btn.dataset.id));
    if (!u) return;
    if (btn.dataset.act === 'user-edit') {
      openUserForm(u, departments);
    } else if (btn.dataset.act === 'user-pwd') {
      const v = await uiPrompt(`重置密码 - ${u.name}`, `新密码（最短 8 位，重置后 ${u.name} 的全部会话将失效）`, '', false);
      if (v === null) return;
      try {
        await api.put(`/api/users/${u.id}/password`, { newPassword: v });
        toast(`已重置 ${u.name} 的密码`);
      } catch (e2) { toast(e2.message || '重置失败', 'error'); }
    }
  });
}

/* 人员编辑弹窗 */
function openUserForm(u, departments) {
  const deptOpts = departments.map(d => opt(d.id, d.name, u.deptId)).join('');
  const roleOpts = opt('dev', '研发人员', u.role) + opt('pm', '项目负责人', u.role) + opt('admin', '系统管理员', u.role);
  const m = openModal(`编辑人员 - ${u.name}`, `
    <div class="form-grid">
      <div class="fg"><label>姓名 *</label><input id="ue-name" value="${esc(u.name)}"><span class="ferr" id="ue-err"></span></div>
      <div class="fg"><label>登录名 *</label><input id="ue-username" value="${esc(u.username)}"></div>
      <div class="fg"><label>角色 *</label><select id="ue-role">${roleOpts}</select></div>
      <div class="fg"><label>部门 *</label><select id="ue-dept">${deptOpts}</select></div>
      <div class="fg"><label>排列顺序（越小越靠前）</label><input id="ue-sort" type="number" min="0" max="2147483647" step="1" value="${u.sortOrder ?? 0}"></div>
    </div>
    <div class="modal-actions">
      <button class="btn" data-close>取消</button>
      <button class="btn btn-primary" id="ue-save">保存</button>
    </div>`);
  m.querySelector('#ue-save').onclick = async () => {
    const name = m.querySelector('#ue-name').value.trim();
    const username = m.querySelector('#ue-username').value.trim();
    const role = m.querySelector('#ue-role').value;
    const deptId = m.querySelector('#ue-dept').value;
    const sortOrder = Number(m.querySelector('#ue-sort').value);
    if (!name || !username || !role || !deptId) {
      m.querySelector('#ue-err').textContent = '所有字段均为必填'; return;
    }
    try {
      await api.put(`/api/users/${u.id}`, { name, username, role, deptId: Number(deptId), sortOrder });
      closeModal(); toast('人员信息已更新'); renderView();
    } catch (e) {
      if (e.code === 'DUPLICATE_USERNAME') m.querySelector('#ue-err').textContent = e.message;
      else m.querySelector('#ue-err').textContent = e.message || '保存失败';
    }
  };
}

/* ---------- 全部工时信息 ---------- */
const allTSFilters = { dept:'', project:'', user:'', from:'', to:'', status:'' };

async function renderAllTS(main) {
  const f = allTSFilters;
  const [departments, projects, users] = await Promise.all([
    api.get('/api/departments'), api.get('/api/projects'), api.get('/api/users')]);
  const qs = new URLSearchParams();
  if (f.dept) qs.set('deptId', f.dept);
  if (f.project) qs.set('projectId', f.project);
  if (f.user) qs.set('userId', f.user);
  if (f.from) qs.set('from', f.from);
  if (f.to) qs.set('to', f.to);
  if (f.status) qs.set('status', f.status);
  const list = await api.get('/api/timesheets/all' + (qs.toString() ? '?' + qs : ''));

  const rows = list.map(t => `
    <tr${t.anomaly ? ' style="opacity:.55"' : ''}>
      <td>${esc(t.userName)}</td>
      <td>${esc(t.deptName || '—')}</td>
      <td class="left">${esc(t.projectName)}</td>
      <td>${t.date}${t.anomaly ? ' <span class="badge b-rej">异常</span>' : ''}</td>
      <td>${fmtH(t.hours)}</td>
      <td class="left td-content" title="${esc(t.content)}">${esc(t.content)}</td>
      <td>${badge(t.status)}</td>
      <td>${t.submitTime || '—'}</td>
      <td>${t.auditTime || '—'}</td>
      <td class="left td-content">${t.auditComment ? '<span class="t-warn">' + esc(t.auditComment) + '</span>' : '<span class="muted">—</span>'}</td>
    </tr>`).join('');

  const statusOpts = ['<option value="">全部状态</option>']
    .concat(Object.keys(STATUS).map(k => opt(k, STATUS[k].label, f.status))).join('');

  main.innerHTML = `
    <div class="page-head"><h2>全部工时信息</h2><span class="muted">共 ${list.length} 条记录</span></div>
    <div class="card">
      <div class="filters">
        <div class="filter"><label>部门</label>
          <select id="al-dept"><option value="">全部部门</option>${departments.map(d => opt(d.id, d.name, f.dept)).join('')}</select></div>
        <div class="filter"><label>项目</label>
          <select id="al-proj"><option value="">全部项目</option>${projects.map(p => opt(p.id, p.name, f.project)).join('')}</select></div>
        <div class="filter"><label>人员</label>
          <select id="al-user"><option value="">全部人员</option>${users.map(u => opt(u.id, u.name, f.user)).join('')}</select></div>
        <div class="filter"><label>日期从</label><input type="date" id="al-from" value="${f.from}"></div>
        <div class="filter"><label>至</label><input type="date" id="al-to" value="${f.to}"></div>
        <div class="filter"><label>状态</label><select id="al-status">${statusOpts}</select></div>
      </div>
      ${list.length ? `
      <div class="tbl-wrap"><table class="tbl">
        <thead><tr>
          <th>姓名</th><th>部门</th><th class="left">项目</th><th>日期</th><th>工时(h)</th>
          <th class="left">工作内容</th><th>状态</th><th>提交时间</th><th>审核时间</th><th class="left">退回意见</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table></div>` : '<div class="empty">暂无符合条件的工时记录</div>'}
    </div>`;

  bindFilter('al-dept', f, 'dept');
  bindFilter('al-proj', f, 'project');
  bindFilter('al-user', f, 'user');
  bindFilter('al-from', f, 'from');
  bindFilter('al-to', f, 'to');
  bindFilter('al-status', f, 'status');

  makeTableResizable(main.querySelector('.tbl'), 'admin-list');
}

/* ---------- 按项目统计 + Excel 导出 ---------- */
const statsState = { project:'', month:'', scope:'all' };

async function renderStats(main) {
  const me = state.user;
  /* 项目范围：admin 全部；pm 仅自己负责的 */
  const allProjects = await api.get('/api/projects');
  const projects = me.role === 'admin' ? allProjects : allProjects.filter(p => p.ownerId === me.id);
  if (!projects.length) { main.innerHTML = empty(me.role === 'admin' ? '暂无项目数据，请先在「基础数据管理」中添加项目' : '您当前没有负责的项目'); return; }
  const f = statsState;
  /* 默认：全部项目（聚合）；仅当保存的值仍可见时保留 */
  if (!f.project || !projects.some(p => p.id === Number(f.project))) f.project = '';
  const ym = f.month || curYM();
  const sd = await api.get(`/api/stats/project?projectId=${f.project}&month=${ym}&scope=${f.scope}`);

  const days = [];
  for (let d = 1; d <= daysInMonth(ym); d++) days.push(`${ym}-${pad(d)}`);

  const head = days.map(dt => `
    <th class="dth ${isWeekend(dt) ? 'we' : ''} ${dt === sd.today ? 'today' : ''}">
      <span class="dnum">${Number(dt.slice(8))}</span><span class="dwk">${weekdayOf(dt)}</span>
    </th>`).join('');
  const bodyRows = sd.memberRows.map(r => `
    <tr>
      <td class="pcell">${esc(r.name)}<div class="muted" style="font-weight:400;font-size:11px">${esc(r.dept || '—')}</div></td>
      ${r.cells.map(h => h ? `<td class="c-h">${fmtH(h)}</td>` : '<td class="c-empty">—</td>').join('')}
      <td class="c-sum">${fmtH(r.sum)}</td>
    </tr>`).join('');
  const totalRow = `
    <tr class="sumrow">
      <td class="pcell">全员合计</td>
      ${sd.totals.map(h => h ? `<td class="c-h">${fmtH(h)}</td>` : '<td class="c-empty">—</td>').join('')}
      <td class="c-sum">${fmtH(sd.grand)}</td>
    </tr>`;

  main.innerHTML = `
    <div class="page-head">
      <h2>按项目统计</h2>
      <div class="page-tools">
        <select id="st-proj"><option value="">全部项目</option>${projects.map(p => opt(p.id, p.name, f.project)).join('')}</select>
        <input type="month" id="st-month" value="${ym}">
        <select id="st-scope">
          ${opt('all', '统计口径：全部状态', f.scope)}
          ${opt('approved', '统计口径：仅已通过', f.scope)}
        </select>
        <button class="btn btn-primary" id="st-export">导出 Excel</button>
      </div>
    </div>
    <div class="card">
      <div class="tbl-wrap"><table class="tbl monthly">
        <thead><tr><th class="pcell">姓名 / 部门</th>${head}<th class="c-sum">合计</th></tr></thead>
        <tbody>${bodyRows}${totalRow}</tbody>
      </table></div>
      <div class="legend">
        <span>行 = 项目成员（含负责人），列 = 该月每一天，末行为全员合计；浅灰表头为周末；蓝框为今天；统计列截止今天（今天之后的列不含数据）</span>
      </div>
      ${sd.anomalies.length ? `
      <div class="anomaly-box">
        <div class="ab-title">异常记录（日期晚于今天，不参与合计与导出）</div>
        <ul>${sd.anomalies.map(a => `<li>${a.date} · ${esc(a.userName)} · ${fmtH(a.hours)} 小时 · ${STATUS[a.status] ? STATUS[a.status].label : a.status}</li>`).join('')}</ul>
      </div>` : ''}
    </div>`;

  bindFilter('st-proj', f, 'project');
  bindFilter('st-scope', f, 'scope');
  const mi = $('#st-month');
  mi.addEventListener('change', () => { f.month = mi.value || curYM(); renderView(); });
  $('#st-export').onclick = () => exportStats(sd, days, ym);
}

/* 导出：本地 vendor SheetJS（数据来自统计 API 同源）；SheetJS 不可用时降级 CSV（BOM 头） */
function exportStats(sd, days, ym) {
  const header = ['姓名'].concat(
    days.map(dt => `${dt.slice(5).replace('-', '/')} ${weekdayOf(dt)}${isWeekend(dt) ? '（休）' : ''}`)
  ).concat(['合计']);
  const rows = sd.memberRows.map(r => [r.name].concat(r.cells.map(h => h || '')).concat([r.sum]));
  const matrix = [header].concat(rows, [['全员合计'].concat(sd.totals.map(h => h || '')).concat([sd.grand])]);
  const fname = `项目统计_${sd.projectName}_${ym}`;

  if (typeof XLSX !== 'undefined') {
    try {
      const ws = XLSX.utils.aoa_to_sheet(matrix);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, '项目统计');
      XLSX.writeFile(wb, fname + '.xlsx');
      toast(`导出成功：${fname}.xlsx`);
      return;
    } catch (err) { /* 导出失败时降级为 CSV */ }
  }
  const csv = matrix.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\r\n');
  const blob = new Blob(['\uFEFF' + csv], { type:'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = fname + '.csv';
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(a.href);
  toast(`SheetJS 不可用，已降级导出 CSV：${fname}.csv`, 'info');
}
