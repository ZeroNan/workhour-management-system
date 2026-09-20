'use strict';
/* 每日项目日报（pm/admin，聚焦任务完成情况，不含成员信息）+ 日报看板（全部角色，按项目分列） */

/* ---------- 每日项目日报 ---------- */
async function renderDailyReport(main) {
  const me = state.user;
  const date = state.dailyReportDate || state.today;
  main.innerHTML = `
    <div class="page-head"><h2>每日项目日报</h2>
      <div class="page-tools">
        <input type="date" id="dr-date" value="${date}" max="${state.today}">
      </div>
    </div>
    <div class="card"><div id="dr-body" class="empty">加载中…</div></div>`;
  const di = $('#dr-date');
  di.addEventListener('change', () => { state.dailyReportDate = di.value || state.today; renderView(); });

  try {
    const data = await api.get(`/api/reports/daily?date=${encodeURIComponent(date)}`);
    const body = $('#dr-body');
    if (!data.projects.length) { body.innerHTML = '<div class="empty">您当前没有负责的项目</div>'; return; }
    const projs = data.projects.filter(p => p.tasks.length);
    if (!projs.length) { body.innerHTML = `<div class="empty">${date} 暂无已通过的工时填报</div>`; return; }
    body.innerHTML = projs.map(p => `
      <div class="report-proj">
        <h3>${esc(p.projectName)} <span class="rsum">· 合计 ${fmtH(p.totalHours)} 小时</span></h3>
        <ul class="task-list">
          ${p.tasks.map(t => `<li>${esc(t.content)} <span class="muted">（${fmtH(t.hours)} 小时）</span></li>`).join('')}
        </ul>
      </div>`).join('');
  } catch (e) {
    $('#dr-body').innerHTML = `<div class="empty">加载失败：${esc(e.message)}</div>`;
  }
}

/* ---------- 日报看板 ---------- */
async function renderKanban(main) {
  const me = state.user;
  const date = state.kanbanDate || state.today;
  main.innerHTML = `
    <div class="page-head"><h2>日报看板</h2>
      <div class="page-tools">
        <input type="date" id="kb-date" value="${date}" max="${state.today}">
      </div>
    </div>
    <div class="card"><div id="kb-body" class="empty">加载中…</div></div>`;
  const di = $('#kb-date');
  di.addEventListener('change', () => { state.kanbanDate = di.value || state.today; renderView(); });

  try {
    const data = await api.get(`/api/reports/kanban?date=${encodeURIComponent(date)}`);
    const body = $('#kb-body');
    if (!data.projects.length) { body.innerHTML = '<div class="empty">您暂无可见的项目</div>'; return; }
    const byProj = {};
    data.cards.forEach(c => { (byProj[c.projectId] ||= []).push(c); });
    body.innerHTML = `<div class="kanban">${data.projects.map(p => {
      const cards = byProj[p.id] || [];
      return `<div class="kanban-col">
        <h3>${esc(p.name)} <span class="muted">(${cards.length})</span></h3>
        <div class="kanban-cards">
          ${cards.length ? cards.map(c => `
            <div class="kcard">
              <div class="kwho">${esc(c.userName)}</div>
              <div class="kcontent">${esc(c.content)}</div>
              <div class="kh">${fmtH(c.hours)} 小时</div>
            </div>`).join('') : '<div class="muted" style="padding:8px">无已通过工时</div>'}
        </div>
      </div>`;
    }).join('')}</div>`;
  } catch (e) {
    $('#kb-body').innerHTML = `<div class="empty">加载失败：${esc(e.message)}</div>`;
  }
}
