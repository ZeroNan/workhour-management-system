'use strict';
/* 通用 UI：Toast / 弹窗 / 确认框 / 必填输入框（v1 原样迁移） */
function toast(msg, type = 'success') {
  const el = document.createElement('div');
  el.className = `toast t-${type}`;
  el.textContent = msg;
  $('#toast-root').appendChild(el);
  setTimeout(() => el.remove(), 2600);
}

/* 通用弹窗：返回弹窗元素，bodyHTML 由调用方拼装。支持嵌套，closeModal 只关最顶层 */
function openModal(title, bodyHTML) {
  const mask = document.createElement('div');
  mask.className = 'modal-mask';
  mask.innerHTML = `
    <div class="modal">
      <div class="modal-head"><h3>${esc(title)}</h3><button class="modal-x" data-close title="关闭">×</button></div>
      <div class="modal-body">${bodyHTML}</div>
    </div>`;
  mask.addEventListener('click', e => {
    if (e.target === mask || e.target.closest('[data-close]')) closeModal();
  });
  document.body.appendChild(mask);
  return mask;
}
function closeModal() { const ms = $$('.modal-mask'); if (ms.length) ms[ms.length - 1].remove(); }

/* 确认框：返回 Promise<boolean> */
function uiConfirm(msg) {
  return new Promise(resolve => {
    const m = openModal('操作提醒', `
      <p class="confirm-msg">${esc(msg)}</p>
      <div class="modal-actions">
        <button class="btn" id="__uc_no">取消</button>
        <button class="btn btn-primary" id="__uc_yes">确定</button>
      </div>`);
    m.querySelector('#__uc_no').onclick  = () => { closeModal(); resolve(false); };
    m.querySelector('#__uc_yes').onclick = () => { closeModal(); resolve(true); };
  });
}

/* 必填输入框（单行/多行）：返回 Promise<string|null> */
function uiPrompt(title, label, initial = '', multiline = true) {
  return new Promise(resolve => {
    const field = multiline
      ? `<textarea id="__p_val" rows="3">${esc(initial)}</textarea>`
      : `<input id="__p_val" value="${esc(initial)}">`;
    const m = openModal(title, `
      <div class="fg"><label>${esc(label)}</label>${field}<span class="ferr" id="__p_err"></span></div>
      <div class="modal-actions">
        <button class="btn" id="__p_no">取消</button>
        <button class="btn btn-primary" id="__p_ok">确定</button>
      </div>`);
    m.querySelector('#__p_no').onclick = () => { closeModal(); resolve(null); };
    m.querySelector('#__p_ok').onclick = () => {
      const v = m.querySelector('#__p_val').value.trim();
      if (!v) { m.querySelector('#__p_err').textContent = '此项为必填，不能为空'; return; }
      closeModal(); resolve(v);
    };
  });
}

/* 绑定筛选控件：值写入筛选状态对象后整页刷新（保持控件选中值） */
function bindFilter(id, obj, key) {
  const el = $('#' + id);
  if (!el) return;
  const handler = () => { obj[key] = el.value; renderView(); };
  el.addEventListener('change', handler);
}
