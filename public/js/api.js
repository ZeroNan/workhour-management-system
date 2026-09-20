'use strict';
/* 前端 API 层：fetch 封装（同源 Cookie、JSON、401/409 归一化拦截） */
class ApiErr extends Error {
  constructor(status, code, message) {
    super(message || code);
    this.status = status;
    this.code = code;
  }
}

let _onSessionExpired = () => {};

const request = (method, path, body) => fetch(path, {
  method, credentials: 'same-origin',
  headers: body ? { 'Content-Type': 'application/json' } : {},
  body: body ? JSON.stringify(body) : undefined,
}).then(async res => {
  if (res.status === 401) {
    _onSessionExpired();
    throw new ApiErr(401, 'UNAUTHORIZED', '登录已过期');
  }
  const data = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) {
    const e = data && data.error;
    throw new ApiErr(res.status, e ? e.code : 'UNKNOWN', e ? e.message : `请求失败（HTTP ${res.status}）`);
  }
  return data;
});

const api = {
  get: p => request('GET', p),
  post: (p, b) => request('POST', p, b || {}),
  put: (p, b) => request('PUT', p, b || {}),
  del: p => request('DELETE', p),
};

/* 通用 409 冲突处理：提示 + 自动刷新当前视图（P0-8③） */
async function handleConflict(err) {
  toast(err.message || '该记录已被处理或已被修改，请刷新', 'error');
  renderView();
}
