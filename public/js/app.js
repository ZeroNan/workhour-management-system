'use strict';
/* 入口：state、render、导航、登录页、首登强制改密、退出 */
/* 依赖（普通 script 顺序加载，全局命名空间）：util.js / ui.js / api.js / views-*.js */

_onSessionExpired = () => {
  toast('登录已过期，请重新登录', 'info');
  try { sessionStorage.setItem('wtms_last_view', state.view); } catch (e) {}
  state.user = null;
  render();
};

const NAV = [
  { view:'fill',    label:'填报工时',     roles:['dev', 'pm'] },
  { view:'mylist',  label:'工时记录列表', roles:['dev', 'pm'] },
  { view:'monthly', label:'我的月度工时', roles:['admin', 'pm', 'dev'] },
  { view:'audit',   label:'工时审核',     roles:['pm', 'admin'] },
  { view:'report',  label:'每日项目日报', roles:['pm', 'admin'] },
  { view:'kanban',  label:'日报看板',     roles:['dev', 'pm', 'admin'] },
  { view:'allts',   label:'全部工时信息', roles:['admin'] },
  { view:'stats',   label:'项目统计',     roles:['admin', 'pm'] },
  { view:'base',    label:'基础数据管理', roles:['admin'] },
  { view:'integration', label:'集成管理', roles:['admin'] },
];

function render() {
  const app = $('#app');
  if (!state.user) { app.innerHTML = loginHTML(); bindLogin(); return; }
  const me = state.user;
  const items = NAV.filter(n => n.roles.includes(me.role));
  app.innerHTML = `
    <header class="topbar">
      <div class="brand">研发团队工时管理系统</div>
      <div class="user-box">
        <span class="who">${esc(me.name)}</span>
        <span>（${ROLE_LABEL[me.role]}${me.deptName ? ' · ' + esc(me.deptName) : ''}）</span>
        <button class="btn btn-sm btn-ghost" id="btn-chpwd" title="修改密码">改密</button>
        <button class="btn btn-sm btn-ghost" id="btn-logout">退出登录</button>
      </div>
    </header>
    <div class="layout">
      <aside class="sidebar">
        ${items.map(n => `<div class="nav-item ${state.view === n.view ? 'active' : ''}" data-view="${n.view}">${n.label}</div>`).join('')}
      </aside>
      <main class="main" id="main"></main>
    </div>`;
  $('#btn-logout').onclick = logout;
  $('#btn-chpwd').onclick = () => openChangePassword();
  $$('.nav-item').forEach(el => el.onclick = () => { state.view = el.dataset.view; render(); });
  renderView();
}

/* 按当前视图分发渲染（全部 async） */
async function renderView() {
  const main = $('#main');
  if (!main) return;
  try {
    switch (state.view) {
      case 'fill':    await renderFill(main);    break;
      case 'mylist':  await renderMyList(main);  break;
      case 'monthly': await renderMonthly(main); break;
      case 'audit':   await renderAudit(main);   break;
      case 'report':  await renderDailyReport(main);  break;
      case 'kanban':  await renderKanban(main);        break;
      case 'allts':   await renderAllTS(main);   break;
      case 'stats':   await renderStats(main);   break;
      case 'base':    await renderBase(main);    break;
      case 'integration': await renderIntegration(main); break;
      default:        main.innerHTML = empty('未知页面');
    }
  } catch (e) {
    if (e.status !== 401) {   // 401 已由 api.js 统一拦截跳登录
      console.error(e);
      toast(e.message || '页面加载失败', 'error');
    }
  }
}

async function logout() {
  closeModal();
  try { await api.post('/api/auth/logout'); } catch (e) { /* 会话可能已过期 */ }
  state.user = null;
  toast('已退出登录', 'info');
  render();
}

/* ---------- 登录页 ---------- */
function loginHTML() {
  return `
    <div class="login-wrap">
      <div class="login-card">
        <h1>研发团队工时管理系统</h1>
        <p class="login-sub">R&amp;D WORKHOUR MANAGEMENT SYSTEM</p>
        <form id="login-form">
          <div class="fg"><label>账号</label><input id="lg-user" placeholder="请输入登录账号" autocomplete="username"></div>
          <div class="fg"><label>密码</label><input id="lg-pass" type="password" placeholder="请输入密码" autocomplete="current-password"></div>
          <div class="fg">
            <label>验证码</label>
            <div class="captcha-row">
              <input id="lg-captcha-code" placeholder="请输入验证码" autocomplete="off">
              <img id="lg-captcha-img" alt="验证码" title="点击刷新">
            </div>
            <input type="hidden" id="lg-captcha-token">
          </div>
          <span class="ferr" id="lg-err"></span>
          <button class="btn btn-primary btn-block" type="submit">登 录</button>
        </form>
      </div>
    </div>`;
}

async function loadCaptcha() {
  try {
    const { token, svg } = await api.get('/api/auth/captcha');
    $('#lg-captcha-token').value = token;
    $('#lg-captcha-img').src = 'data:image/svg+xml;base64,' + btoa(svg);
    $('#lg-captcha-code').value = '';
  } catch (e) {
    console.error('验证码加载失败', e);
  }
}

function bindLogin() {
  $('#login-form').addEventListener('submit', e => { e.preventDefault(); doLogin(); });
  $('#lg-captcha-img').addEventListener('click', loadCaptcha);
  loadCaptcha();
}

async function doLogin() {
  const un = $('#lg-user').value.trim();
  const pw = $('#lg-pass').value;
  const captchaToken = $('#lg-captcha-token').value;
  const captchaCode = $('#lg-captcha-code').value;
  if (!un || !pw) { $('#lg-err').textContent = '请输入账号与密码'; return; }
  if (!captchaCode) { $('#lg-err').textContent = '请输入验证码'; return; }
  try {
    const { user } = await api.post('/api/auth/login', { username: un, password: pw, captchaToken, captchaCode });
    await afterLogin(user);
  } catch (e) {
    $('#lg-err').textContent = e.message || '登录失败';
    loadCaptcha();
  }
}

/* 登录成功后：拉取服务端 today，回跳上次视图，处理首登强制改密 */
async function afterLogin(user) {
  state.user = user;
  const me = await api.get('/api/auth/me');
  state.today = me.today;
  state.month = curYM();
  state.view = me.user.role === 'admin' ? 'allts' : 'fill';
  try {
    const last = sessionStorage.getItem('wtms_last_view');
    sessionStorage.removeItem('wtms_last_view');
    if (last && NAV.some(n => n.view === last && n.roles.includes(user.role))) state.view = last;
  } catch (e) { /* 回跳失败则用默认视图 */ }
  toast(`欢迎，${user.name}`);
  render();
  if (user.mustChangePassword) {
    toast('首次登录（或密码已被重置），请先修改密码', 'info');
    await openChangePassword(true);
  }
}

/* ---------- 修改密码 ---------- */
function openChangePassword(force = false) {
  const m = openModal(force ? '首次登录：请修改初始密码' : '修改密码', `
    <div class="form-grid">
      <div class="fg"><label>原密码 *</label><input type="password" id="cp-old" autocomplete="current-password"></div>
      <div class="fg"><label>新密码（最短 8 位） *</label><input type="password" id="cp-new" autocomplete="new-password"></div>
      <div class="fg"><label>确认新密码 *</label><input type="password" id="cp-new2" autocomplete="new-password"></div>
      <div class="fg wide"><span class="ferr" id="cp-err"></span></div>
    </div>
    <div class="modal-actions">
      ${force ? '' : '<button class="btn" data-close>取消</button>'}
      <button class="btn btn-primary" id="cp-save">修改密码</button>
    </div>`);
  m.querySelector('#cp-save').onclick = async () => {
    const oldP = m.querySelector('#cp-old').value;
    const newP = m.querySelector('#cp-new').value;
    const newP2 = m.querySelector('#cp-new2').value;
    const errEl = m.querySelector('#cp-err');
    errEl.textContent = '';
    if (newP.length < 8) { errEl.textContent = '新密码最短 8 位'; return; }
    if (newP !== newP2) { errEl.textContent = '两次输入的新密码不一致'; return; }
    try {
      await api.put('/api/auth/password', { oldPassword: oldP, newPassword: newP });
      state.user.mustChangePassword = false;
      closeModal();
      toast('密码修改成功');
      if (force) renderView();
    } catch (e) {
      errEl.textContent = e.message || '修改失败';
    }
  };
}

/* ---------- 启动：恢复会话 + 每小时刷新服务端 today ---------- */
(async function init() {
  // 静默清理 v1 localStorage（util.js 已做）；尝试恢复已有会话
  try {
    const me = await api.get('/api/auth/me');
    state.user = me.user;
    state.today = me.today;
    state.month = curYM();
    state.view = me.user.role === 'admin' ? 'allts' : 'fill';
  } catch (e) {
    state.user = null; // 未登录 / 会话过期 → 登录页
  }
  render();
  setInterval(async () => {   // 每小时静默刷新 today（跨天校正）
    if (!state.user) return;
    try {
      const me = await api.get('/api/auth/me');
      state.today = me.today;
      state.user = me.user;
    } catch (e) { /* 401 已由 api.js 拦截 */ }
  }, 60 * 60 * 1000);
})();
