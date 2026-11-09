'use strict';
/* 常量与基础工具函数（v1 迁移；today 一律取服务端基准 state.today，禁用本地时钟） */
const $  = s => document.querySelector(s);
const $$ = s => Array.from(document.querySelectorAll(s));
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g,
  c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const pad = n => String(n).padStart(2, '0');
const todayStr = () => state.today;                          // 唯一日期基准（来自 /api/auth/me）
const curYM = () => state.today.slice(0, 7);
const WEEK = ['日','一','二','三','四','五','六'];
const weekdayOf = ds => WEEK[new Date(ds + 'T00:00:00').getDay()];
const isWeekend = ds => { const w = new Date(ds + 'T00:00:00').getDay(); return w === 0 || w === 6; };
const daysInMonth = ym => { const a = ym.split('-'); return new Date(+a[0], +a[1], 0).getDate(); };
const fmtH = h => String(Math.round(h * 100) / 100);

/* ---------- 工时显示单位（小时 / 人天） ----------
 * 1 人天 = 7 小时。HOURS_PER_DAY 是唯一换算来源，页面里禁止再出现字面量 7。
 * 单位是纯显示偏好：只存 localStorage，不进接口入参——后端始终以「小时」存储与聚合。
 * 换算只做展示，接口返回的数值永远是小时；写库、校验、导出仍按小时口径。 */
const HOURS_PER_DAY = 7;
const UNIT_KEY = 'wtms_unit';
const UNIT_TEXT = { h: 'h', d: '人天' };
/* 会话内兜底：隐私模式（Safari 无痕等）下 localStorage 读写抛异常，写不进去时靠它保证
 * 「点了人天就生效」，否则 setUnit 之后紧跟的 getUnit 又会读回小时，按钮看起来没反应。 */
let unitMemo = null;
/** 当前显示单位：'h' 小时（默认）| 'd' 人天；localStorage 不可用/值非法时回落会话内兜底 */
function getUnit() {
  let stored = null;
  try { stored = localStorage.getItem(UNIT_KEY); } catch (e) { stored = null; }
  const v = stored === 'd' || stored === 'h' ? stored : unitMemo;
  return v === 'd' ? 'd' : 'h';
}
/** 写入显示单位，非法值一律落回 'h'；返回最终生效值 */
function setUnit(u) {
  const v = u === 'd' ? 'd' : 'h';
  unitMemo = v;   /* 先记内存，再尽量持久化：写失败也不影响本次会话生效 */
  try { localStorage.setItem(UNIT_KEY, v); } catch (e) { /* 隐私模式：仅当次会话生效 */ }
  return v;
}
/** 原始小时 → 当前单位数值（人天保留 2 位小数；小时原值不四舍五入，交给 fmtH 控制显示） */
function toUnit(hours, unit) {
  const n = Number(hours) || 0;
  return (unit || getUnit()) === 'd' ? Number((n / HOURS_PER_DAY).toFixed(2)) : n;
}
/** 原始小时 → 当前单位的显示文本（人天固定 2 位小数；小时 ≤2 位且去尾零，与既有 fmtH 一致） */
function fmtUnit(hours, unit) {
  const u = unit || getUnit();
  const n = Number(hours) || 0;
  return u === 'd' ? (n / HOURS_PER_DAY).toFixed(2) : fmtH(n);
}
/** 单位后缀：'h' | '人天'（用于 KPI 小字、图表标题、表头） */
const unitText = unit => UNIT_TEXT[unit || getUnit()] || 'h';
const empty = msg => `<div class="card"><div class="empty">${esc(msg)}</div></div>`;
const opt = (v, l, sel) => `<option value="${esc(v)}" ${String(sel) === String(v) ? 'selected' : ''}>${esc(l)}</option>`;

const ROLE_LABEL = { admin:'系统管理员', pm:'项目负责人', dev:'研发人员' };
const STATUS = {
  draft:     { label:'未提交', cls:'b-draft' },
  submitted: { label:'待审核', cls:'b-sub'   },
  approved:  { label:'已通过', cls:'b-ok'    },
  rejected:  { label:'已退回', cls:'b-rej'   },
};
const badge = st => `<span class="badge ${STATUS[st] ? STATUS[st].cls : ''}">${STATUS[st] ? STATUS[st].label : esc(st)}</span>`;

/* 全局状态：当前用户、当前视图、月度视图选中月份、服务端今天 */
const state = { user:null, view:'fill', month:'', today:'' };

/* 静默清理 v1 localStorage 旧业务数据（Q7：不读取、不迁移） */
try {
  localStorage.removeItem('wtms_data');
  localStorage.removeItem('wtms_session');
} catch (e) { /* 隐私模式下不可用则忽略 */ }

/* 视图刷新统一入口（各 views 文件会重定义/复用；app.js 中定义实际实现） */

/* ---------- 表格列宽拖拽 ----------
 * 在 thead th 上生成拖拽手柄（最后一列除外），拖动调整该列宽度；
 * 宽度按 key 记忆到 localStorage，下次渲染自动恢复。
 * 用法：表格 innerHTML 渲染完成后调用 makeTableResizable(table, '视图-表格唯一标识')。
 */
function setColWidth(table, idx, w) {
  const n = Math.round(parseFloat(w));
  if (!Number.isFinite(n)) return NaN;             // 宽度非法（如非数字字符串）直接忽略
  const px = Math.max(48, n);
  table.querySelectorAll('tr').forEach(tr => {
    const cell = tr.children[idx];
    if (!cell) return;
    cell.style.width = px + 'px';
    if (cell.classList.contains('td-content')) cell.style.maxWidth = px + 'px'; // 解除 280px 截断
  });
  return px;
}

function makeTableResizable(table, key) {
  if (!table) return;
  const ths = Array.from(table.querySelectorAll('thead th'));
  if (ths.length < 2) return;
  const LS = 'wtms_colw_' + key;
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(LS) || '{}') || {}; } catch (e) { saved = {}; }
  ths.forEach((th, i) => {
    if (saved[i]) setColWidth(table, i, saved[i]);       // 恢复记忆宽度
    if (i === ths.length - 1) return;                    // 末列（多为操作列）不加手柄
    const grip = document.createElement('span');
    grip.className = 'col-grip';
    grip.title = '拖动调整列宽';
    grip.addEventListener('mousedown', ev => {
      ev.preventDefault();
      ev.stopPropagation();
      const startX = ev.clientX;
      const startW = th.offsetWidth;
      document.body.classList.add('col-resizing');
      const onMove = e => { th.style.width = setColWidth(table, i, startW + e.clientX - startX) + 'px'; };
      const onUp = () => {
        document.body.classList.remove('col-resizing');
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        saved[i] = th.offsetWidth;
        try { localStorage.setItem(LS, JSON.stringify(saved)); } catch (e) { /* 忽略 */ }
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
    th.appendChild(grip);
  });
}
