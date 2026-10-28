'use strict';
/* 填报工时页 + 我的记录列表 + 记录编辑弹窗（v1 迁移，数据层改 REST API） */

/* 某人某日工时合计：调 day-summary 接口；exclude 时由调用方自行扣减 */
async function fetchDayTotal(date, excludeHours = 0) {
  const s = await api.get(`/api/timesheets/day-summary?date=${encodeURIComponent(date)}`);
  return s.total - excludeHours;
}

/* 7 小时校验规则（提醒不阻断，前端确认；>24 后端也会拒绝） */
async function checkHoursRule(date, newHours, excludeHours = 0) {
  const total = await fetchDayTotal(date, excludeHours) + (Number(newHours) || 0);
  if (total > 24 + 1e-9) {
    toast(`每日合计不能超过 24 小时（本次将合计 ${fmtH(total)} 小时）`, 'error');
    return false;
  }
  if (Math.abs(total - 7) > 1e-9) {
    const go = await uiConfirm(`${date} 当日工时合计 ${fmtH(total)} 小时，标准为 7 小时。是否仍要继续？`);
    if (!go) { toast('已取消本次操作', 'info'); return false; }
  }
  return true;
}

/* ---------- 填报页 ---------- */
async function renderFill(main) {
  const me = state.user;
  const projects = await api.get('/api/projects/mine');
  const projOpts = projects.map(p => opt(p.id, p.name, '')).join('');
  main.innerHTML = `
    <div class="page-head"><h2>填报工时</h2></div>
    <div class="card">
      ${projects.length ? `
      <div class="form-grid">
        <div class="fg"><label>姓名</label><input readonly value="${esc(me.name)}"></div>
        <div class="fg"><label>部门</label><input readonly value="${esc(me.deptName || '—')}"></div>
        <div class="fg">
          <label>项目 *</label>
          <select id="f-project"><option value="">请选择项目</option>${projOpts}</select>
          <span class="ferr" id="e-project"></span>
        </div>
        <div class="fg">
          <label>日期（可补录历史日期，不可晚于今天） *</label>
          <input type="date" id="f-date" value="${todayStr()}" max="${todayStr()}">
          <span class="ferr" id="e-date"></span>
          <div class="hint" id="f-daysum"></div>
        </div>
        <div class="fg">
          <label>工时（小时，0 &lt; h ≤ 24） *</label>
          <input type="number" id="f-hours" step="0.5" min="0.5" max="24" placeholder="如 7 或 3.5">
          <span class="ferr" id="e-hours"></span>
        </div>
        <div class="fg wide">
          <label>工作内容 *</label>
          <textarea id="f-content" rows="3" placeholder="请填写当日具体工作内容"></textarea>
          <span class="ferr" id="e-content"></span>
        </div>
      </div>
      <div class="form-actions">
        <button class="btn" id="f-save">保存（未提交）</button>
        <button class="btn btn-primary" id="f-submit">保存并提交</button>
      </div>` : `
      <div class="empty">您暂未加入任何项目，请联系管理员将您添加为项目成员后再填报工时。</div>`}
    </div>`;
  if (!projects.length) return;

  const updDaySum = async () => {
    const d = $('#f-date').value;
    if (!d) { $('#f-daysum').textContent = ''; return; }
    try {
      const s = await api.get(`/api/timesheets/day-summary?date=${encodeURIComponent(d)}`);
      $('#f-daysum').textContent = `该日已填报合计：${fmtH(s.total)} 小时${s.future ? '（该日期为未来日期，不可填报）' : ''}`;
    } catch (e) { $('#f-daysum').textContent = ''; }
  };
  $('#f-date').addEventListener('change', updDaySum);
  updDaySum();

  const doSave = async submitFlag => {
    ['project', 'date', 'hours', 'content'].forEach(k => $('#e-' + k).textContent = '');
    const projectId = $('#f-project').value;
    const date = $('#f-date').value;
    const hours = Number($('#f-hours').value);
    const content = $('#f-content').value.trim();
    let ok = true;
    if (!projectId) { $('#e-project').textContent = '请选择项目'; ok = false; }
    if (!date)      { $('#e-date').textContent = '请选择日期'; ok = false; }
    else if (date > todayStr()) { $('#e-date').textContent = '工时日期不能晚于今天'; ok = false; }
    if (!hours || hours <= 0 || hours > 24) { $('#e-hours').textContent = '工时必须大于 0 且不超过 24 小时'; ok = false; }
    if (!content)   { $('#e-content').textContent = '工作内容不能为空'; ok = false; }
    if (!ok) return;
    if (!(await checkHoursRule(date, hours))) return;
    try {
      await api.post('/api/timesheets', { projectId: Number(projectId), date, hours, content, submit: submitFlag });
      toast(submitFlag ? '已保存并提交，等待项目负责人审核' : '已保存为「未提交」草稿');
      $('#f-hours').value = '';
      $('#f-content').value = '';
      updDaySum();
    } catch (e) {
      if (e.status === 409) { toast(e.message, 'error'); renderView(); }
      else if (e.code === 'HOURS_EXCEEDED' || e.code === 'FUTURE_DATE' || e.code === 'DAY_NOT_EDITABLE' || e.code === 'NOT_MEMBER') {
        toast(e.message, 'error');
      } else toast(e.message || '保存失败', 'error');
    }
  };
  $('#f-save').onclick   = () => doSave(false);
  $('#f-submit').onclick = () => doSave(true);
}

/* ---------- 我的记录列表 ---------- */
const myListFilters = { project:'', status:'', from:'', to:'' };

async function renderMyList(main) {
  const me = state.user;
  const f = myListFilters;
  const projects = await api.get('/api/projects/mine');
  const qs = new URLSearchParams();
  if (f.project) qs.set('projectId', f.project);
  if (f.status) qs.set('status', f.status);
  if (f.from) qs.set('from', f.from);
  if (f.to) qs.set('to', f.to);
  const list = await api.get('/api/timesheets' + (qs.toString() ? '?' + qs : ''));

  const statusOpts = ['<option value="">全部状态</option>']
    .concat(Object.keys(STATUS).map(k => opt(k, STATUS[k].label, f.status))).join('');

  const rows = list.map(t => {
    const acts = t.status === 'approved'
      ? '<span class="muted">已生效，只读</span>'
      : t.status === 'submitted'
        ? `<button class="btn btn-sm" data-act="edit" data-id="${t.id}">编辑</button>
           <button class="btn btn-sm" data-act="withdraw" data-id="${t.id}">撤回</button>
           <button class="btn btn-sm btn-danger" data-act="del" data-id="${t.id}">删除</button>`
        : `<button class="btn btn-sm" data-act="edit" data-id="${t.id}">编辑</button>
           <button class="btn btn-sm btn-primary" data-act="submit" data-id="${t.id}">提交</button>
           <button class="btn btn-sm btn-danger" data-act="del" data-id="${t.id}">删除</button>`;
    return `
      <tr${t.anomaly ? ' style="opacity:.55"' : ''}>
        <td>${t.date}${t.anomaly ? ' <span class="badge b-rej">异常</span>' : ''}</td>
        <td class="left">${esc(t.projectName)}</td>
        <td>${fmtH(t.hours)}</td>
        <td class="left td-content" title="${esc(t.content)}">${esc(t.content)}</td>
        <td>${badge(t.status)}</td>
        <td class="left td-content">${t.auditComment ? '<span class="t-warn">' + esc(t.auditComment) + '</span>' : '<span class="muted">—</span>'}</td>
        <td><div class="td-acts">${acts}</div></td>
      </tr>`;
  }).join('');

  main.innerHTML = `
    <div class="page-head"><h2>工时记录列表</h2></div>
    <div class="card">
      <div class="filters">
        <div class="filter"><label>项目</label>
          <select id="ml-proj"><option value="">全部项目</option>${projects.map(p => opt(p.id, p.name, f.project)).join('')}</select></div>
        <div class="filter"><label>状态</label><select id="ml-status">${statusOpts}</select></div>
        <div class="filter"><label>日期从</label><input type="date" id="ml-from" value="${f.from}"></div>
        <div class="filter"><label>至</label><input type="date" id="ml-to" value="${f.to}"></div>
      </div>
      ${list.length ? `
      <div class="tbl-wrap"><table class="tbl">
        <thead><tr>
          <th>日期</th><th>项目</th><th>工时(h)</th><th class="left">工作内容</th>
          <th>状态</th><th class="left">退回意见</th><th>操作</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table></div>` : '<div class="empty">暂无符合条件的工时记录</div>'}
    </div>`;

  bindFilter('ml-proj', f, 'project');
  bindFilter('ml-status', f, 'status');
  bindFilter('ml-from', f, 'from');
  bindFilter('ml-to', f, 'to');

  main.querySelector('.tbl-wrap')?.addEventListener('click', async e => {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const id = Number(btn.dataset.id);
    const t = list.find(x => x.id === id);
    if (!t) return;
    if (btn.dataset.act === 'edit') { openRecordEditor(t, projects); }
    else if (btn.dataset.act === 'withdraw') {
      if (!(await uiConfirm(`确定撤回 ${t.date} 的这条工时记录吗？撤回后将变为草稿，可重新修改后再提交。`))) return;
      try {
        await api.post(`/api/timesheets/${t.id}/withdraw`);
        toast('已撤回为草稿');
      } catch (e2) {
        if (e2.status === 409) return handleConflict(e2);
        toast(e2.message, 'error');
      }
      renderView();
    }
    else if (btn.dataset.act === 'submit') {
      if (!(await checkHoursRule(t.date, t.hours, t.hours))) return;
      try {
        await api.post(`/api/timesheets/${t.id}/submit`);
        toast('已提交，等待项目负责人审核');
      } catch (e2) {
        if (e2.status === 409) return handleConflict(e2);
        toast(e2.message, 'error');
      }
      renderView();
    } else if (btn.dataset.act === 'del') {
      if (!(await uiConfirm(`确定删除 ${t.date} 的这条工时记录（${fmtH(t.hours)} 小时）吗？`))) return;
      try {
        await api.del(`/api/timesheets/${t.id}`);
        toast('已删除');
      } catch (e2) {
        if (e2.status === 409) return handleConflict(e2);
        toast(e2.message, 'error');
      }
      renderView();
    }
  });
}

/* 单条工时记录编辑弹窗（列表页「编辑」入口） */
function openRecordEditor(t, myProjectsCache) {
  let ps = myProjectsCache || [];
  if (!ps.some(p => p.id === t.projectId)) ps = ps.concat([{ id: t.projectId, name: t.projectName }]);
  const m = openModal('编辑工时记录', `
    <div class="form-grid">
      <div class="fg"><label>项目 *</label>
        <select id="re-proj">${ps.map(p => opt(p.id, p.name, t.projectId)).join('')}</select></div>
      <div class="fg"><label>日期（不可晚于今天） *</label><input type="date" id="re-date" value="${t.date}" max="${todayStr()}"></div>
      <div class="fg"><label>工时（小时） *</label>
        <input type="number" id="re-hours" step="0.5" min="0.5" max="24" value="${t.hours}"></div>
      <div class="fg wide"><label>工作内容 *</label>
        <textarea id="re-content" rows="3">${esc(t.content)}</textarea></div>
      ${t.status === 'rejected' ? `<div class="fg wide"><label>退回意见</label><div class="audit-c">${esc(t.auditComment)}</div></div>` : ''}
    </div>
    <div class="modal-actions">
      <button class="btn" data-close>取消</button>
      <button class="btn" id="re-save">保存</button>
      <button class="btn btn-primary" id="re-submit">保存并提交</button>
    </div>`);
  const doSave = async submitFlag => {
    const projectId = m.querySelector('#re-proj').value;
    const date = m.querySelector('#re-date').value;
    const hours = Number(m.querySelector('#re-hours').value);
    const content = m.querySelector('#re-content').value.trim();
    if (!projectId || !date || !hours || hours <= 0 || hours > 24 || !content) {
      toast('请完整填写项目、日期、工时（0~24）与工作内容', 'error'); return;
    }
    if (date > todayStr()) { toast('工时日期不能晚于今天', 'error'); return; }
    if (!(await checkHoursRule(date, hours, date === t.date ? t.hours : 0))) return;  // 当日合计排除本条现有工时
    try {
      await api.put(`/api/timesheets/${t.id}`, { projectId: Number(projectId), date, hours, content, submit: submitFlag });
      closeModal();
      toast(submitFlag ? '已保存并提交' : '已保存');
      renderView();
    } catch (e) {
      if (e.status === 409) { closeModal(); return handleConflict(e); }
      toast(e.message || '保存失败', 'error');
    }
  };
  m.querySelector('#re-save').onclick   = () => doSave(false);
  m.querySelector('#re-submit').onclick = () => doSave(true);
}
