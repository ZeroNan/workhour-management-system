'use strict';
/* 管理员：工时统计页（astats）——KPI 指标卡 + ECharts 双图表 + 项目×部门明细矩阵
 * 交互与「项目统计」改版后的草稿模式完全一致：改筛选不发请求，点「查询」应用；
 * 重置恢复默认并立即查询；筛选控件 Enter 等同查询；起 > 止时前端校验拦截。
 * ECharts 为本地 vendor（/vendor/echarts.min.js，内网无 CDN，与 SheetJS 同策略）；
 * 加载失败时降级显示提示，KPI 与矩阵照常渲染（对齐 SheetJS 缺失降级 CSV 策略）。 */

/* 已应用筛选（仅存已应用值；草稿值留在控件里，点查询才写入） */
const astatsState = { from: '', to: '', scope: 'all' };

/* 模块级图表实例与 resize 监听：renderAStats 开头逐个 dispose / 先移除旧监听再挂新，
 * 避免重复进入页面时出现重复 resize 监听与泄漏的旧实例 */
let astatsCharts = [];
let astatsResizeHandler = null;

/* 默认筛选：本年 1 月 1 日 ~ 今天（今天一律取服务端基准 state.today，勿用本地时钟） */
function astatsDefaults() {
  return { from: state.today.slice(0, 4) + '-01-01', to: state.today, scope: 'all' };
}

async function renderAStats(main) {
  /* 清理上一轮图表实例与 resize 监听 */
  astatsCharts.forEach(c => { try { c.dispose(); } catch (e) { /* 已销毁则忽略 */ } });
  astatsCharts = [];
  if (astatsResizeHandler) {
    window.removeEventListener('resize', astatsResizeHandler);
    astatsResizeHandler = null;
  }

  /* 初始化已应用筛选（首次进入 = 默认值） */
  const def = astatsDefaults();
  const f = astatsState;
  if (!f.from) f.from = def.from;
  if (!f.to) f.to = def.to;
  if (f.scope !== 'all' && f.scope !== 'approved') f.scope = 'all';

  const data = await api.get(`/api/stats/admin/overview?from=${f.from}&to=${f.to}&scope=${f.scope}`);
  const noData = data.recordCount === 0;
  const scopeLabel = f.scope === 'approved' ? '仅已通过' : '全部状态';
  const hasChart = typeof echarts !== 'undefined';

  /* ---------- KPI 指标卡 ---------- */
  const kpis = `
    <div class="kpi">
      <div class="k-label">总工时（所有项目 / 所有部门）</div>
      <div class="k-value">${fmtH(data.total)}<small>h</small></div>
      <div class="k-sub">共 ${data.recordCount} 条工时记录</div>
    </div>
    <div class="kpi">
      <div class="k-label">涉及项目</div>
      <div class="k-value">${data.projectCount}<small>个</small></div>
      <div class="k-sub">有工时记录的项目数</div>
    </div>
    <div class="kpi">
      <div class="k-label">涉及部门</div>
      <div class="k-value">${data.deptCount}<small>个</small></div>
      <div class="k-sub">有工时记录的部门数</div>
    </div>
    <div class="kpi">
      <div class="k-label">参与人数</div>
      <div class="k-value">${data.userCount}<small>人</small></div>
      <div class="k-sub">有工时记录的人数</div>
    </div>`;

  /* ---------- 双图表（ECharts 缺失时降级为提示，KPI 与矩阵照常） ---------- */
  const deptChartBody = !hasChart
    ? '<div class="empty">图表组件未加载，以下方数据矩阵为准</div>'
    : (noData ? '<div class="empty">该时间范围内暂无工时数据</div>' : '<div class="chart-box" id="as-chart-dept"></div>');
  const projChartBody = !hasChart
    ? '<div class="empty">图表组件未加载，以下方数据矩阵为准</div>'
    : (noData ? '<div class="empty">该时间范围内暂无工时数据</div>' : '<div class="chart-box" id="as-chart-proj"></div>');

  /* ---------- 明细矩阵：行 = 项目（按合计降序）、列 = 部门（按合计降序） ---------- */
  let matrixHTML = '<div class="empty">该时间范围内暂无工时数据</div>';
  if (!noData) {
    const m = data.matrix;
    const colSums = m.depts.map((_, j) => m.cells.reduce((s, row) => s + row[j], 0));
    const head = `<tr><th class="left">项目 \\ 部门</th>${m.depts.map(d => `<th>${esc(d)}</th>`).join('')}<th class="c-sum">合计</th></tr>`;
    const body = m.projects.map((p, i) => `
      <tr>
        <td class="left">${esc(p)}</td>
        ${m.cells[i].map(h => h ? `<td>${fmtH(h)}</td>` : '<td class="muted">—</td>').join('')}
        <td class="c-sum">${fmtH(m.cells[i].reduce((s, x) => s + x, 0))}</td>
      </tr>`).join('');
    const sumRow = `
      <tr class="sumrow">
        <td class="left">合计</td>
        ${colSums.map(h => `<td>${fmtH(h)}</td>`).join('')}
        <td class="c-sum">${fmtH(data.total)}</td>
      </tr>`;
    matrixHTML = `
      <div class="tbl-wrap"><table class="tbl">
        <thead>${head}</thead>
        <tbody>${body}${sumRow}</tbody>
      </table></div>
      <div class="legend"><span>行 = 项目，列 = 部门，交叉值 = 该时间范围内该项目·该部门的工时合计（h）；末行末列为合计；与上方两图同源数据</span></div>`;
  }

  main.innerHTML = `
    <div class="page-head">
      <h2>工时统计</h2>
      <span class="muted">仅管理员可见 · ${f.from} ~ ${f.to} · ${scopeLabel}</span>
    </div>
    <div class="card">
      <div class="filters">
        <div class="filter"><label>日期从</label><input type="date" id="as-from" value="${f.from}"></div>
        <div class="filter"><label>至</label><input type="date" id="as-to" value="${f.to}"></div>
        <div class="filter"><label>统计口径</label>
          <select id="as-scope">
            ${opt('all', '统计口径：全部状态', f.scope)}
            ${opt('approved', '统计口径：仅已通过', f.scope)}
          </select></div>
        <div class="filter filter-export">
          <span class="hint" id="as-dirty"></span>
          <button class="btn btn-sm" id="as-reset" type="button">重置</button>
          <button class="btn btn-primary" id="as-query" type="button">查询</button>
        </div>
      </div>
    </div>
    <div class="kpi-grid">${kpis}</div>
    <div class="chart-grid">
      <div class="chart-card">
        <h3>各部门总工时（h）</h3>
        ${deptChartBody}
      </div>
      <div class="chart-card">
        <h3>各项目工时数量及占比</h3>
        ${projChartBody}
      </div>
    </div>
    <div class="card">${matrixHTML}</div>`;

  bindAStatsFilters(f);
  if (hasChart && !noData) {
    renderDeptChart($('#as-chart-dept'), data);
    renderProjChart($('#as-chart-proj'), data);
    /* 统一 resize：模块级 handler，先移除旧再挂新，避免重复监听 */
    astatsResizeHandler = () => astatsCharts.forEach(c => c.resize());
    window.addEventListener('resize', astatsResizeHandler);
  }
}

/* 筛选草稿模式：改控件只标脏，点「查询」才应用（与 renderStats 交互一致） */
function bindAStatsFilters(f) {
  const fromEl = $('#as-from');
  const toEl = $('#as-to');
  const scopeEl = $('#as-scope');
  const dirtyTip = $('#as-dirty');

  const readDraft = () => ({ from: fromEl.value, to: toEl.value, scope: scopeEl.value });
  const appliedKey = () => [f.from, f.to, f.scope].join('|');
  const draftKey = d => [d.from, d.to, d.scope].join('|');
  const markDirty = () => { dirtyTip.textContent = draftKey(readDraft()) === appliedKey() ? '' : '有未应用的修改'; };

  [fromEl, toEl, scopeEl].forEach(el => {
    el.addEventListener('change', markDirty);
    el.addEventListener('keydown', e => { if (e.key === 'Enter') $('#as-query').click(); });
  });

  /* 查询：应用草稿（前端校验：日期不完整或起 > 止时报错不发请求） */
  $('#as-query').onclick = () => {
    const d = readDraft();
    if (!d.from || !d.to) { toast('请完整选择开始与结束日期', 'error'); return; }
    if (d.from > d.to) { toast('开始日期不能晚于结束日期', 'error'); return; }
    f.from = d.from; f.to = d.to; f.scope = d.scope;
    renderView();
  };
  /* 重置：恢复默认（本年 1 月 1 日 ~ 今天 + 全部状态）并立即查询 */
  $('#as-reset').onclick = () => {
    const def = astatsDefaults();
    f.from = def.from; f.to = def.to; f.scope = def.scope;
    renderView();
  };
}

/* ---------- 各部门总工时：横向条形图，按工时降序（最大在顶部） ---------- */
function renderDeptChart(el, data) {
  if (!el) return;
  const total = data.total;
  const pct = h => (total > 0 ? (h / total * 100).toFixed(1) : '0.0');
  const chart = echarts.init(el);
  chart.setOption({
    grid: { left: 8, right: 48, top: 10, bottom: 6, containLabel: true },
    tooltip: {
      trigger: 'item',
      formatter: p => `${esc(p.name)} · 工时(h)：${fmtH(p.value)} · 占比：${pct(p.value)}%`,
    },
    xAxis: {
      type: 'value',
      axisLabel: { fontSize: 11, color: '#8a94a6' },
      splitLine: { lineStyle: { color: '#e5e8ef' } },
    },
    yAxis: {
      type: 'category',
      inverse: true,  /* 分类轴默认第 0 项在底部，反转后最大值（首项）在顶部 */
      data: data.byDept.map(d => d.name),
      axisLabel: { fontSize: 12, color: '#4b5563' },
      axisTick: { show: false },
      axisLine: { lineStyle: { color: '#e5e8ef' } },
    },
    series: [{
      type: 'bar',
      data: data.byDept.map(d => d.hours),
      itemStyle: { color: '#2f6fed', borderRadius: [0, 4, 4, 0] },
      barMaxWidth: 22,
      label: {
        show: true, position: 'right',
        fontSize: 12, fontWeight: 600, color: '#1f2937',
        formatter: p => fmtH(p.value),
      },
    }],
  });
  astatsCharts.push(chart);
}

/* ---------- 各项目工时及占比：环形图 + 中心总工时 + 右侧图例 ---------- */
/* 色序（超出循环取色） */
const ASTATS_PIE_COLORS = ['#2f6fed', '#16a34a', '#ea8a00', '#8b5cf6', '#94a3b8', '#0ea5e9', '#d946ef', '#f43f5e', '#14b8a6', '#f59e0b'];

function renderProjChart(el, data) {
  if (!el) return;
  const total = data.total;
  const valueMap = new Map(data.byProject.map(p => [p.name, p.hours]));  /* 图例 formatter 闭包查值 */
  const pct = h => (total > 0 ? (h / total * 100).toFixed(1) : '0.0');
  const chart = echarts.init(el);
  chart.setOption({
    color: ASTATS_PIE_COLORS,
    tooltip: {
      trigger: 'item',
      formatter: p => `${esc(p.name)} · 工时(h)：${fmtH(p.value)} · 占比：${p.percent}%`,
    },
    legend: {
      orient: 'vertical',
      right: 0,
      top: 'middle',
      itemWidth: 10,
      itemHeight: 10,
      textStyle: { fontSize: 12, color: '#4b5563' },
      formatter: name => {
        const h = valueMap.get(name) || 0;
        return `${name}  ${fmtH(h)}h  ${pct(h)}%`;
      },
    },
    /* 环形中心显示「总工时 / Nh」 */
    title: {
      text: '总工时',
      subtext: `${fmtH(total)}h`,
      left: '36%',
      top: '38%',
      textAlign: 'center',
      itemGap: 2,
      textStyle: { fontSize: 12, fontWeight: 400, color: '#8a94a6' },
      subtextStyle: { fontSize: 20, fontWeight: 700, color: '#1f2937' },
    },
    series: [{
      type: 'pie',
      radius: ['55%', '80%'],
      center: ['36%', '50%'],  /* 左移为右侧图例留空间，与 title 中心对齐 */
      label: { show: false },
      emphasis: {
        scaleSize: 6,  /* 悬浮扇区外扩 */
      },
      data: data.byProject.map(p => ({ name: p.name, value: p.hours })),
    }],
  });
  astatsCharts.push(chart);
}
