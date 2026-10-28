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
