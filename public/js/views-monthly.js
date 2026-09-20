'use strict';
/* 我的月度工时 + 日编辑弹窗（v1 迁移；列只渲染到服务端 today，anomaly 置灰不参与合计） */

async function renderMonthly(main) {
  const ym = state.month || curYM();
  const data = await api.get(`/api/timesheets/monthly?month=${ym}`);
  const today = data.today;   // 服务端基准，不读本地时钟
  const recs = data.records.filter(r => !r.anomaly);
  const anomalies = data.records.filter(r => r.anomaly);

  /* 列只渲染到 today：查看过去月份全渲染；当月只到今天；未来月份不渲染 */
  const nD = daysInMonth(ym);
  const todayYM = today.slice(0, 7);
  const lastDay = ym < todayYM ? nD : (ym === todayYM ? Number(today.slice(8, 10)) : 0);
  const days = [];
  for (let d = 1; d <= lastDay; d++) days.push(`${ym}-${pad(d)}`);

  let inner;
  if (!data.projects.length) {
    inner = `<div class="empty">您在 ${ym} 暂无项目工时数据</div>`;
  } else {
    const head = days.map(dt => `
      <th class="dth ${isWeekend(dt) ? 'we' : ''} ${dt === today ? 'today' : ''}">
        <span class="dnum">${Number(dt.slice(8))}</span><span class="dwk">${weekdayOf(dt)}</span>
      </th>`).join('');

    const bodyRows = data.projects.map(p => {
      const cells = days.map(dt => {
        const h = recs.filter(t => t.projectId === p.id && t.date === dt).reduce((s, t) => s + t.hours, 0);
        if (!h) return `<td class="c-empty editable" data-date="${dt}" title="点击填报/修改当日工时">—</td>`;
        const editable = recs.filter(t => t.date === dt).some(t => t.status !== 'approved');
        return `<td class="c-h ${editable ? 'editable' : 'locked'}" data-date="${dt}" title="${dt}">${fmtH(h)}</td>`;
      }).join('');
      const sum = recs.filter(t => t.projectId === p.id).reduce((s, t) => s + t.hours, 0);
      return `<tr><td class="pcell">${esc(p.name)}</td>${cells}<td class="c-sum">${fmtH(sum)}</td></tr>`;
    }).join('');

    const sumCells = days.map(dt => {
      const h = recs.filter(t => t.date === dt).reduce((s, t) => s + t.hours, 0);
      if (!h) return '<td class="c-empty">—</td>';
      return `<td class="c-h ${Math.abs(h - 7) < 1e-9 ? 'ok' : 'warn'}">${fmtH(h)}</td>`;
    }).join('');
    const total = recs.reduce((s, t) => s + t.hours, 0);
    const body = bodyRows + `<tr class="sumrow"><td class="pcell">每日合计</td>${sumCells}<td class="c-sum">${fmtH(total)}</td></tr>`;

    inner = `
      <div class="tbl-wrap"><table class="tbl monthly">
        <thead><tr><th class="pcell">项目 \\ 日期</th>${head}<th class="c-sum">合计</th></tr></thead>
        <tbody>${body}</tbody>
      </table></div>
      <div class="legend">
        <span class="lg lg-ok"><i></i>合计 = 7 小时（正常）</span>
        <span class="lg lg-warn"><i></i>合计 ≠ 7 小时（警示）</span>
        <span>点击日期单元格可修改当日工时；浅灰底为周末；已全部通过的日期为只读；蓝框为今天</span>
      </div>
      ${anomalies.length ? `
      <div class="anomaly-box">
        <div class="ab-title">异常记录（日期晚于服务器今天，不参与合计，仅置灰展示）</div>
        <ul>${anomalies.map(t => `<li>${t.date} · ${esc(t.projectName)} · ${fmtH(t.hours)} 小时 · ${STATUS[t.status] ? STATUS[t.status].label : t.status}</li>`).join('')}</ul>
      </div>` : ''}`;
  }

  main.innerHTML = `
    <div class="page-head">
      <h2>我的月度工时</h2>
      <div class="page-tools">
        <input type="month" id="mo-month" value="${ym}">
        <span class="muted">本月合计：${fmtH(recs.reduce((s, t) => s + t.hours, 0))} 小时</span>
      </div>
    </div>
    <div class="card">${inner}</div>`;

  const mi = $('#mo-month');
  mi.addEventListener('change', () => { state.month = mi.value || curYM(); renderView(); });

  main.querySelector('.tbl-wrap')?.addEventListener('click', e => {
    const td = e.target.closest('td[data-date]');
    if (!td) return;
    if (td.classList.contains('locked')) { toast('该日记录已全部通过，不可修改', 'info'); return; }
    openDayEditor(td.dataset.date);
  });
}

/* ---------- 日编辑弹窗 ---------- */
async function openDayEditor(date) {
  const me = state.user;
  const m = openModal(`编辑 ${date}（星期${weekdayOf(date)}）工时`, '<div id="de-body"></div>');
  const body = m.querySelector('#de-body');
  let myProjectsCache = null;

  const getMyRecs = async () => (await api.get(`/api/timesheets?from=${date}&to=${date}`))
    .filter(r => r.date === date);

  async function refresh() {
    const [list, projects] = await Promise.all([
      getMyRecs(),
      myProjectsCache ? Promise.resolve(myProjectsCache) : api.get('/api/projects/mine'),
    ]);
    myProjectsCache = projects;
    const total = list.reduce((s, t) => s + t.hours, 0);
    body.innerHTML = `
      <div class="day-sum">今日合计：<b class="${total === 7 ? 't-ok' : total > 0 ? 't-warn' : ''}">${fmtH(total)}</b> 小时（标准 7 小时）</div>
      ${list.length ? list.map(t => recCardHTML(t, projects)).join('') : '<div class="empty" style="padding:18px">该日暂无工时记录，可在下方新增</div>'}
      ${addFormHTML(projects)}`;
  }

  function recCardHTML(t, projects) {
    if (t.status === 'approved') {  /* 已通过：只读展示 */
      return `
        <div class="rec-card ro">
          <div class="rc-row"><b>${esc(t.projectName)}</b>
            <span>${fmtH(t.hours)} 小时</span>${badge(t.status)}
            <span class="muted">已生效，不可修改</span></div>
          <div class="ro-content">${esc(t.content)}</div>
        </div>`;
    }
    let ps = projects;
    if (!ps.some(p => p.id === t.projectId)) ps = ps.concat([{ id: t.projectId, name: t.projectName }]);
    return `
      <div class="rec-card" data-id="${t.id}">
        <div class="rc-row">
          <select data-f="project">${ps.map(p => opt(p.id, p.name, t.projectId)).join('')}</select>
          <input type="number" data-f="hours" step="0.5" min="0.5" max="24" value="${t.hours}" title="工时">
          ${badge(t.status)}
          <button class="btn btn-sm btn-danger" data-act="del">删除</button>
        </div>
        ${t.status === 'rejected' ? `<div class="audit-c">退回意见：${esc(t.auditComment)}</div>` : ''}
        <textarea data-f="content" rows="2">${esc(t.content)}</textarea>
        <div class="rc-acts">
          <button class="btn btn-sm" data-act="save">保存</button>
          <button class="btn btn-sm btn-primary" data-act="submit">保存并提交</button>
        </div>
      </div>`;
  }

  function addFormHTML(projects) {
    if (!projects.length) return '';
    return `
      <div class="rec-card add-card">
        <div class="rc-row">
          <select data-f="project"><option value="">选择项目</option>${projects.map(p => opt(p.id, p.name, '')).join('')}</select>
          <input type="number" data-f="hours" step="0.5" min="0.5" max="24" placeholder="工时">
          <span class="muted">新增记录</span>
        </div>
        <textarea data-f="content" rows="2" placeholder="工作内容"></textarea>
        <div class="rc-acts">
          <button class="btn btn-sm" data-act="add-save">保存草稿</button>
          <button class="btn btn-sm btn-primary" data-act="add-submit">保存并提交</button>
        </div>
      </div>`;
  }

  await refresh();

  body.addEventListener('click', async e => {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const act = btn.dataset.act;
    const card = btn.closest('.rec-card');
    if (act === 'save' || act === 'submit') {
      const projectId = card.querySelector('[data-f="project"]').value;
      const hours = Number(card.querySelector('[data-f="hours"]').value);
      const content = card.querySelector('[data-f="content"]').value.trim();
      if (!projectId || !hours || hours <= 0 || hours > 24 || !content) {
        toast('请完整填写项目、工时（0~24）与工作内容', 'error'); return;
      }
      try {
        if (card.classList.contains('add-card')) {
          const exclude = 0;
          if (!(await checkHoursRule(date, hours, exclude))) return;
          await api.post('/api/timesheets', { projectId: Number(projectId), date, hours, content, submit: act === 'submit' });
          toast(act === 'submit' ? '已保存并提交' : '已保存草稿');
        } else {
          const id = Number(card.dataset.id);
          const old = (await api.get(`/api/timesheets?from=${date}&to=${date}`)).find(x => x.id === id);
          if (!(await checkHoursRule(date, hours, old ? old.hours : 0))) return;
          await api.put(`/api/timesheets/${id}`, { projectId: Number(projectId), date, hours, content, submit: act === 'submit' });
          toast(act === 'submit' ? '已保存并提交' : '已保存');
        }
        refresh();
      } catch (e2) {
        if (e2.status === 409) { handleConflict(e2); refresh(); return; }
        toast(e2.message || '保存失败', 'error');
        refresh();
      }
    } else if (act === 'del' && card && !card.classList.contains('add-card')) {
      const id = Number(card.dataset.id);
      const old = (await api.get(`/api/timesheets?from=${date}&to=${date}`)).find(x => x.id === id);
      if (!(await uiConfirm(`确定删除这条 ${fmtH(old ? old.hours : 0)} 小时的工时记录吗？`))) return;
      try {
        await api.del(`/api/timesheets/${id}`);
        toast('已删除');
        refresh();
      } catch (e2) {
        if (e2.status === 409) { handleConflict(e2); refresh(); return; }
        toast(e2.message, 'error');
      }
    }
  });
}
