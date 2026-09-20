'use strict';
/* 工时审核页（v1 迁移；PM 本人记录无按钮并打「待代审」标签，批量结果逐条反馈，409 自动刷新） */
const auditFilters = { project:'', member:'', from:'', to:'', status:'submitted' };

async function renderAudit(main) {
  const me = state.user;
  /* 项目筛选：admin 全部项目；pm 仅自己负责的 */
  const allProjects = await api.get('/api/projects');
  const projects = me.role === 'admin' ? allProjects : allProjects.filter(p => p.ownerId === me.id);
  if (!projects.length) { main.innerHTML = empty('您当前没有负责的项目，暂无审核权限内的工时'); return; }
  if (!auditFilters.project || !projects.some(p => p.id === Number(auditFilters.project))) {
    auditFilters.project = '';
  }
  const f = auditFilters;

  const qs = new URLSearchParams();
  if (f.project) qs.set('projectId', f.project);
  if (f.member) qs.set('userId', f.member);
  if (f.from) qs.set('from', f.from);
  if (f.to) qs.set('to', f.to);
  if (f.status) qs.set('status', f.status);
  const list = await api.get('/api/audit/list' + (qs.toString() ? '?' + qs : ''));

  const memberIds = [...new Set(projects.flatMap(p => p.memberIds))];
  /* 姓名映射：来自 /api/projects 的 memberIds/memberNames（pm 也有该接口权限） */
  const nameMap = {};
  allProjects.forEach(p => p.memberIds.forEach((id, i) => { nameMap[id] = p.memberNames[i]; }));
  const nameOf = id => nameMap[id] || (list.find(x => x.userId === id) || {}).userName || `用户#${id}`;

  const rows = list.map(t => {
    const editable = t.status === 'submitted' && t.canAudit;
    return `
      <tr${t.selfSubmitted ? ' style="background:#fffbeb"' : ''}>
        <td>${editable ? `<input type="checkbox" class="au-row" value="${t.id}">` : ''}</td>
        <td>${esc(t.userName)}${t.selfSubmitted ? '<span class="tag-daishen">本人记录 · 待代审</span>' : ''}</td>
        <td>${esc(t.deptName || '—')}</td>
        <td class="left">${esc(t.projectName)}</td>
        <td>${t.date}</td>
        <td>${fmtH(t.hours)}</td>
        <td class="left td-content" title="${esc(t.content)}">${esc(t.content)}</td>
        <td>${badge(t.status)}</td>
        <td class="left td-content">${t.auditComment ? '<span class="t-warn">' + esc(t.auditComment) + '</span>' : '<span class="muted">—</span>'}</td>
        <td><div class="td-acts">
          ${editable
            ? `<button class="btn btn-sm btn-primary" data-act="approve" data-id="${t.id}">通过</button>
               <button class="btn btn-sm btn-danger" data-act="reject" data-id="${t.id}">退回</button>
               <button class="btn btn-sm btn-danger" data-act="del" data-id="${t.id}">删除</button>`
            : (t.selfSubmitted
                ? `<span class="muted">由管理员代审</span> <button class="btn btn-sm btn-danger" data-act="del" data-id="${t.id}">删除</button>`
                : (t.status !== 'approved'
                    ? `<button class="btn btn-sm btn-danger" data-act="del" data-id="${t.id}">删除</button>`
                    : '<span class="muted">—</span>'))}
        </div></td>
      </tr>`;
  }).join('');

  const statusOpts = ['<option value="">全部状态</option>']
    .concat(Object.keys(STATUS).map(k => opt(k, STATUS[k].label, f.status))).join('');

  main.innerHTML = `
    <div class="page-head"><h2>工时审核</h2>
      ${me.role === 'admin' ? '<span class="muted">管理员视角：全量记录，可代审 PM 本人提交的记录</span>' : ''}
    </div>
    <div class="card">
      <div class="filters">
        <div class="filter"><label>项目</label>
          <select id="au-proj"><option value="">全部项目</option>${projects.map(p => opt(p.id, p.name, f.project)).join('')}</select></div>
        <div class="filter"><label>成员</label>
          <select id="au-member"><option value="">全部成员</option>${memberIds.map(id => opt(id, nameOf(id), f.member)).join('')}</select></div>
        <div class="filter"><label>日期从</label><input type="date" id="au-from" value="${f.from}"></div>
        <div class="filter"><label>至</label><input type="date" id="au-to" value="${f.to}"></div>
        <div class="filter"><label>状态</label><select id="au-status">${statusOpts}</select></div>
      </div>
      ${list.length ? `
      <div class="batch-bar">
        <label class="mcheck"><input type="checkbox" id="au-checkall"> 全选</label>
        <button class="btn btn-sm" id="au-invert">反选</button>
        <span class="cnt" id="au-count">已选 0 条</span>
        <button class="btn btn-sm btn-primary" id="au-batch-ok">批量通过</button>
        <button class="btn btn-sm btn-danger" id="au-batch-rej">批量退回</button>
      </div>
      <div class="tbl-wrap"><table class="tbl">
        <thead><tr>
          <th></th><th>姓名</th><th>部门</th><th class="left">项目</th><th>日期</th>
          <th>工时(h)</th><th class="left">工作内容</th><th>状态</th><th class="left">退回意见</th><th>操作</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table></div>` : '<div class="empty">暂无符合条件的工时记录（默认仅显示待审核，可调整筛选）</div>'}
    </div>`;

  bindFilter('au-proj', f, 'project');
  bindFilter('au-member', f, 'member');
  bindFilter('au-from', f, 'from');
  bindFilter('au-to', f, 'to');
  bindFilter('au-status', f, 'status');

  const checkedIds = () => $$('.au-row').filter(c => c.checked).map(c => Number(c.value));
  const updCount = () => {
    const cnt = $('#au-count');
    if (cnt) cnt.textContent = `已选 ${checkedIds().length} 条`;
  };

  const tbl = main.querySelector('.tbl-wrap');
  const checkall = $('#au-checkall');
  const invert = $('#au-invert');

  if (tbl) {
    tbl.addEventListener('change', e => { if (e.target.classList.contains('au-row')) updCount(); });
    tbl.addEventListener('click', async e => {
      const btn = e.target.closest('[data-act]');
      if (!btn) return;
      const id = Number(btn.dataset.id);
      if (btn.dataset.act === 'del') {
        if (!(await uiConfirm('确定删除这条工时记录吗？（仅未生效记录可删）'))) return;
        try {
          await api.del(`/api/timesheets/${id}`);
          toast('已删除');
        } catch (e2) {
          if (e2.status === 409) return handleConflict(e2);
          toast(e2.message || '删除失败', 'error');
        }
        renderView();
        return;
      }
      if (btn.dataset.act === 'approve') {
        try {
          const r = await api.post(`/api/timesheets/${id}/approve`);
          toast(r.idempotent ? '该记录已是通过状态（幂等，无需重复操作）' : '已通过该条工时');
        } catch (e2) {
          if (e2.status === 409) return handleConflict(e2);
          toast(e2.message, 'error');
        }
        renderView();
      } else if (btn.dataset.act === 'reject') {
        const c = await uiPrompt('退回工时', '退回意见（必填，提交者可见）');
        if (c === null) return;
        try {
          const r = await api.post(`/api/timesheets/${id}/reject`, { comment: c });
          toast(r.idempotent ? '该记录已是退回状态（幂等）' : '已退回该条工时');
        } catch (e2) {
          if (e2.status === 409) return handleConflict(e2);
          toast(e2.message, 'error');
        }
        renderView();
      }
    });
  }

  if (checkall) {
    checkall.addEventListener('change', e => {
      $$('.au-row').forEach(c => c.checked = e.target.checked);
      updCount();
    });
  }
  if (invert) {
    invert.onclick = () => { $$('.au-row').forEach(c => c.checked = !c.checked); updCount(); };
  }

  /* 批量审核：结果逐条反馈「通过 N / 跳过 M / 冲突 K」 */
  const doBatch = async (action, comment) => {
    const ids = checkedIds();
    if (!ids.length) { toast('请先勾选要审核的记录', 'info'); return 0; }
    try {
      const { results, summary } = await api.post('/api/audit/batch', { ids, action, comment });
      const parts = [`通过 ${summary.ok} 条`];
      if (summary.skipped) parts.push(`跳过 ${summary.skipped} 条（本人记录，由管理员代审）`);
      if (summary.conflict) parts.push(`冲突 ${summary.conflict} 条（需刷新后处理）`);
      if (summary.not_found) parts.push(`不存在 ${summary.not_found} 条`);
      toast(`批量${action === 'approve' ? '通过' : '退回'}：${parts.join('，')}`, summary.ok ? 'success' : 'info');
      return summary.ok;
    } catch (e2) {
      if (e2.status === 409) { handleConflict(e2); return 0; }
      toast(e2.message, 'error');
      return 0;
    }
  };

  const batchOk = $('#au-batch-ok');
  const batchRej = $('#au-batch-rej');
  if (batchOk) {
    batchOk.onclick = async () => {
      const ids = checkedIds();
      if (!ids.length) { toast('请先勾选要审核的记录', 'info'); return; }
      if (!(await uiConfirm(`确定批量通过选中的 ${ids.length} 条工时记录吗？（本人提交的记录会自动跳过）`))) return;
      await doBatch('approve');
      renderView();
    };
  }
  if (batchRej) {
    batchRej.onclick = async () => {
      const ids = checkedIds();
      if (!ids.length) { toast('请先勾选要审核的记录', 'info'); return; }
      const c = await uiPrompt('批量退回', '统一退回意见（必填，将应用于所有选中记录，本人记录自动跳过）');
      if (c === null) return;
      await doBatch('reject', c);
      renderView();
    };
  }
}
