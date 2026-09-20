// 服务器时间工具：业务日期唯一事实源（TZ 已在 config.js 固定为 Asia/Shanghai）
const pad = n => String(n).padStart(2, '0');

/** 服务器今天，'YYYY-MM-DD' */
export function serverToday() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** 服务器当前时间戳，'YYYY-MM-DD HH:mm'（展示格式，与 v1 一致） */
export function nowStr() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** 校验 'YYYY-MM-DD' 格式且为真实日历日期 */
export function isValidDateStr(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  if (m < 1 || m > 12 || d < 1) return false;
  const dim = new Date(y, m, 0).getDate();
  return d <= dim;
}

/** 校验 'YYYY-MM' 格式 */
export function isValidMonthStr(s) {
  return typeof s === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(s);
}
