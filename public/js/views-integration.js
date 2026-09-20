'use strict';
/* 系统管理员：开放接口集成管理（API 密钥 + 同步日志） */
async function renderIntegration(main) {
  main.innerHTML = `
    <div class="page-head">
      <h2>集成管理</h2>
      <div style="display:flex;gap:8px">
        <button class="btn" id="int-refresh-log">刷新日志</button>
        <button class="btn btn-primary" id="int-newkey">新建密钥</button>
      </div>
    </div>

    <div class="card" style="margin-bottom:18px">
      <div class="sub-title">API 密钥（WPS 推送工时鉴权用）</div>
      <div id="int-keys"><div class="empty">加载中…</div></div>
      <p class="hint">说明：一个密钥可提交不同人员的数据；密钥明文仅显示一次，请妥善保存。停用后 WPS 将无法继续推送（已入库数据不受影响）。</p>
    </div>

    <div class="card">
      <div class="sub-title">同步调用日志（最近优先）</div>
      <div id="int-logs"><div class="empty">加载中…</div></div>
    </div>`;

  $('#int-newkey').onclick = () => openNewKeyModal();
  $('#int-refresh-log').onclick = () => loadLogs();

  await loadKeys();
  await loadLogs();
}

async function loadKeys() {
  const box = $('#int-keys');
  if (!box) return;
  try {
    const keys = await api.get('/api/integrations/keys');
    if (!keys.length) { box.innerHTML = empty('暂无密钥，点击右上角「新建密钥」生成'); return; }
    box.innerHTML = `<div class="tbl-wrap"><table class="tbl">
      <thead><tr>
        <th class="left">ID</th><th class="left">名称</th><th>状态</th>
        <th>限流(次/分)</th><th>创建时间</th><th>最近使用</th><th>操作</th>
      </tr></thead>
      <tbody>${keys.map(k => `
        <tr>
          <td class="left">${k.id}</td>
          <td class="left">${esc(k.name)}</td>
          <td>${keyBadge(k.status)}</td>
          <td>${k.rate_limit}</td>
          <td>${esc(k.created_at || '-')}</td>
          <td>${esc(k.last_used_at || '-')}</td>
          <td>${k.status === 'active'
            ? `<button class="btn btn-sm btn-danger" data-revoke="${k.id}">停用</button>`
            : '<span class="muted">已停用</span>'}</td>
        </tr>`).join('')}</tbody>
    </table></div>`;
    $$('#int-keys [data-revoke]').forEach(b => b.onclick = () => revokeKey(b.dataset.revoke));
  } catch (e) { box.innerHTML = `<div class="empty">加载失败：${esc(e.message)}</div>`; }
}

async function loadLogs() {
  const box = $('#int-logs');
  if (!box) return;
  try {
    const logs = await api.get('/api/integrations/logs?limit=200');
    if (!logs.length) { box.innerHTML = empty('暂无同步日志'); return; }
    box.innerHTML = `<div class="tbl-wrap"><table class="tbl">
      <thead><tr>
        <th class="left">ID</th><th class="left">密钥</th><th>结果</th><th>错误码</th>
        <th>入库条数</th><th>客户端IP</th><th>耗时(ms)</th><th>时间</th>
      </tr></thead>
      <tbody>${logs.map(l => `
        <tr>
          <td class="left">${l.id}</td>
          <td class="left">${esc(l.key_name || ('#' + l.key_id))}</td>
          <td>${logBadge(l.status)}</td>
          <td>${esc(l.error_code || '-')}</td>
          <td>${l.accepted}</td>
          <td>${esc(l.client_ip || '-')}</td>
          <td>${l.duration_ms}</td>
          <td>${esc(l.created_at || '-')}</td>
        </tr>`).join('')}</tbody>
    </table></div>`;
  } catch (e) { box.innerHTML = `<div class="empty">加载失败：${esc(e.message)}</div>`; }
}

function openNewKeyModal() {
  const body = `
    <div class="form-row">
      <label>密钥名称</label>
      <input id="nk-name" class="input" placeholder="如：WPS集成" value="WPS集成" />
    </div>
    <div class="form-row">
      <label>限流（次/分钟）</label>
      <input id="nk-rate" class="input" type="number" min="1" max="1000" value="120" />
    </div>
    <div class="modal-actions">
      <button class="btn" id="nk-cancel">取消</button>
      <button class="btn btn-primary" id="nk-ok">生成密钥</button>
    </div>`;
  openModal('新建 API 密钥', body);
  $('#nk-cancel').onclick = closeModal;
  $('#nk-ok').onclick = createKey;
}

async function createKey() {
  const name = $('#nk-name').value.trim() || '未命名密钥';
  const rate = Number($('#nk-rate').value) || 120;
  try {
    const r = await api.post('/api/integrations/keys', { name, rateLimit: rate });
    closeModal();
    showNewKey(r.data);
    await loadKeys();
  } catch (e) { toast(e.message || '生成失败', 'error'); }
}

// 明文仅此一次展示
function showNewKey(k) {
  const body = `
    <p class="warn">⚠️ 以下为密钥<strong>明文，仅显示这一次</strong>，系统不另存。请立即复制保存到安全位置（如 WPS 脚本配置），关闭后将无法再次查看。</p>
    <div class="form-row">
      <label>API Key</label>
      <input id="nk-show" class="input" readonly value="${esc(k.key)}" />
    </div>
    <div class="modal-actions">
      <button class="btn" id="nk-close">关闭</button>
      <button class="btn btn-primary" id="nk-copy">复制</button>
    </div>`;
  openModal('密钥已生成', body);
  $('#nk-close').onclick = closeModal;
  $('#nk-copy').onclick = () => {
    const inp = $('#nk-show');
    inp.select();
    try { navigator.clipboard.writeText(inp.value); toast('已复制到剪贴板'); }
    catch (_) { document.execCommand('copy'); toast('已复制'); }
  };
}

async function revokeKey(id) {
  if (!(await uiConfirm('确定停用该密钥吗？停用后 WPS 将无法通过此密钥推送工时（已入库数据不受影响）。'))) return;
  try {
    await api.del(`/api/integrations/keys/${id}`);
    toast('密钥已停用');
    await loadKeys();
  } catch (e) { toast(e.message || '操作失败', 'error'); }
}

function keyBadge(status) {
  return status === 'active'
    ? '<span class="badge" style="background:#e7f6ec;color:#1a7f37">启用</span>'
    : '<span class="badge" style="background:#f1f3f7;color:#6b7280">已停用</span>';
}
function logBadge(status) {
  return status === 'success'
    ? '<span class="badge" style="background:#e7f6ec;color:#1a7f37">成功</span>'
    : '<span class="badge" style="background:#fdeaea;color:#c0392b">失败</span>';
}
