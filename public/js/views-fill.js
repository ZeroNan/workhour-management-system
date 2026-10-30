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

/* 当前筛选条件 → 查询串（列表请求与导出请求共用，保证条件完全一致） */
function myListQuery(filters) {
  const f = filters || myListFilters;
  const qs = new URLSearchParams();
  if (f.project) qs.set('projectId', f.project);
  if (f.status) qs.set('status', f.status);
  if (f.from) qs.set('from', f.from);
  if (f.to) qs.set('to', f.to);
  return qs.toString();
}

async function renderMyList(main) {
  const me = state.user;
  const f = myListFilters;
  const projects = await api.get('/api/projects/mine');
  const qs = myListQuery(f);
  const list = await api.get('/api/timesheets' + (qs ? '?' + qs : ''));

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
        <div class="filter filter-export">
          <button class="btn" id="ml-export-csv">导出 CSV</button>
          <button class="btn" id="ml-export-xlsx">导出 Excel</button>
          <span class="hint" id="ml-export-status"></span>
        </div>
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

  /* 导出控件：仅在列表非空时可用；导出条件是当前筛选条件（与列表请求同一份 qs） */
  const listEmpty = list.length === 0;
  const csvBtn  = $('#ml-export-csv');
  const xlsxBtn = $('#ml-export-xlsx');
  if (csvBtn)  csvBtn.disabled  = listEmpty;
  if (xlsxBtn) xlsxBtn.disabled = listEmpty;
  const onExport = format => {
    if (listEmpty) { toast('当前筛选条件下无记录', 'info'); return; }
    exportMyList(format);
  };
  if (csvBtn)  csvBtn.onclick  = () => onExport('csv');
  if (xlsxBtn) xlsxBtn.onclick = () => onExport('xlsx');
  const exportStatusEl = $('#ml-export-status');
  if (exportStatusEl) exportStatusEl.textContent = listEmpty ? '无记录可导出' : '';

  makeTableResizable(main.querySelector('.tbl'), 'fill-list');

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

/* ---------- 记录导出（CSV / Excel）----------
 * 数据来源：GET /api/timesheets 分批拉取（limit=500），筛选条件与列表请求一致。
 * 文件生成：优先本地 vendor SheetJS（index.html 已加载），不可用时自动降级 CSV。
 * 说明：api.get 只能拿 JSON，因此导出统一走「JSON 数据 + 前端生成文件」。
 */
const EXPORT_PAGE_SIZE = 500;    // 每批条数（后端 limit 上限 1000，取 500 更平稳）
const EXPORT_MAX_BATCHES = 100;  // 最多 100 批 = 5 万条；第 100 批仍满批时无法确认后面是否还有数据，按超限中止（可完整导出的上限为 49999 条）
const EXPORT_HEADER = ['日期', '项目', '工时(h)', '工作内容', '状态', '退回意见'];
const EXPORT_COL_WIDTHS = [{ wch: 12 }, { wch: 24 }, { wch: 9 }, { wch: 60 }, { wch: 10 }, { wch: 32 }];

/* 单条记录 → 导出行（与列表可见列一致，「操作」列不导出） */
function myListExportRow(t) {
  return [
    t.date == null ? '' : t.date,
    t.projectName == null ? '' : t.projectName,
    Number(fmtH(Number(t.hours) || 0)),   // 数值类型：Excel 中可直接 SUM/透视
    t.content == null ? '' : t.content,                                   // 工作内容不截断
    (STATUS[t.status] && STATUS[t.status].label) || t.status || '',
    t.auditComment || '',
  ];
}

/* 单元格以这些字符开头时，Excel/WPS 打开 CSV 会当成公式执行（OWASP CSV 注入） */
const CSV_INJECT_PREFIX = /^[=+\-@\t\r]/;

/* 二维数组 → CSV 文本：每格双引号包裹并转义内部双引号，\r\n 换行。
 * 说明：工时为 number 类型，经 String() 后仍加引号输出（Excel/主流解析器对 "7.5" 按数字识别）；
 * 在 xlsx 路径中该 number 会写入数值单元格（type 'n'），可直接 SUM。
 * CSV 注入防护：字符串以 = + - @ 或制表符/回车开头时，前置一个单引号，
 * 表格软件即按文本处理（该单引号不显示在单元格里）；数值不受影响。 */
function toCsvText(matrix) {
  return matrix
    .map(row => row.map(cell => {
      const raw = cell == null ? '' : String(cell);
      const text = typeof cell === 'string' && CSV_INJECT_PREFIX.test(raw) ? "'" + raw : raw;
      return `"${text.replace(/"/g, '""')}"`;
    }).join(','))
    .join('\r\n');
}

/* 触发浏览器下载 CSV（BOM 头保证 Excel 正确识别中文） */
function downloadCsvFile(csvText, filename) {
  const blob = new Blob(['\uFEFF' + csvText], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(a.href);
}

/**
 * 按当前筛选条件导出我的工时记录。
 * @param {'csv'|'xlsx'} format 目标格式；xlsx 时若 SheetJS 不可用则降级 CSV
 * @returns {Promise<void>}
 */
async function exportMyList(format) {
  const csvBtn    = $('#ml-export-csv');
  const xlsxBtn   = $('#ml-export-xlsx');
  const statusEl  = $('#ml-export-status');
  const setBusy = busy => {
    if (csvBtn)  { csvBtn.disabled  = busy; csvBtn.textContent  = busy ? '导出中…' : '导出 CSV'; }
    if (xlsxBtn) { xlsxBtn.disabled = busy; xlsxBtn.textContent = busy ? '导出中…' : '导出 Excel'; }
  };
  const setStatus = msg => { if (statusEl) statusEl.textContent = msg; };
  const base = myListQuery(myListFilters);

  setBusy(true);
  setStatus('正在获取数据…');
  const rows = [];
  try {
    let batch = 0;
    for (;;) {
      const offset = batch * EXPORT_PAGE_SIZE;
      const qs = `${base ? base + '&' : ''}limit=${EXPORT_PAGE_SIZE}&offset=${offset}`;
      const page = await api.get('/api/timesheets?' + qs);
      if (!Array.isArray(page)) throw new Error('导出失败：服务端返回数据格式异常');
      rows.push(...page);
      batch += 1;
      setStatus(`正在获取数据… 已获取 ${rows.length} 条`);
      if (page.length < EXPORT_PAGE_SIZE) break;   // 不足一批说明已取完，正常结束
      // 仍满批时才判断是否到上限：满批意味着后面可能还有数据，宁可提示缩小范围也不静默截断
      if (batch >= EXPORT_MAX_BATCHES) throw new Error('数据量过大，请缩小日期范围后重试');
    }

    if (!rows.length) {
      setStatus('当前筛选条件下无记录');
      toast('当前筛选条件下无记录', 'info');
      return;
    }

    const matrix = [EXPORT_HEADER].concat(rows.map(myListExportRow));
    const filenameBase = `工时记录_${todayStr()}`;
    const isXlsx = format === 'xlsx';

    if (isXlsx && typeof XLSX !== 'undefined') {
      try {
        const ws = XLSX.utils.aoa_to_sheet(matrix);
        ws['!cols'] = EXPORT_COL_WIDTHS;
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, '工时记录');
        XLSX.writeFile(wb, `${filenameBase}.xlsx`);
        setStatus(`已导出 ${rows.length} 条`);
        toast(`已导出 ${rows.length} 条记录（Excel）`);
        return;
      } catch (e2) { /* SheetJS 写文件失败 → 继续走下方 CSV 降级 */ }
    }

    downloadCsvFile(toCsvText(matrix), `${filenameBase}.csv`);
    setStatus(`已导出 ${rows.length} 条`);
    if (isXlsx) {
      toast(`Excel 组件不可用，已降级导出 CSV：${filenameBase}.csv（共 ${rows.length} 条）`, 'info');
    } else {
      toast(`已导出 ${rows.length} 条记录（CSV）`);
    }
  } catch (e) {
    setStatus('导出失败');
    toast(e.message || '导出失败', 'error');
  } finally {
    setBusy(false);   // 无论成败都恢复按钮可用态
  }
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
