// 全局配置：端口、会话、时区、锁定策略、密码策略、数据库连接
import dotenv from 'dotenv';
dotenv.config({ override: true }); // 从项目根目录 .env 加载（.env 已被 .gitignore 忽略，不进入交付/版本库）；override 确保带 # 等符号的密码正确生效

process.env.TZ ||= 'Asia/Shanghai'; // 必须在任何 Date 使用前执行（serverToday 的确定性基准）

export const config = {
  port: Number(process.env.PORT) || 3456, // 默认端口（需求：由 3000 改为 3456）
  session: {
    cookieName: 'wtms_session',
    ttlMs: 8 * 60 * 60 * 1000, // 8 小时滚动过期
    cookieOpts: { httpOnly: true, sameSite: 'lax', path: '/' },
  },
  lock: {
    maxFailedAttempts: 5,       // 连续失败 5 次
    lockMinutes: 10,            // 锁定 10 分钟
  },
  password: {
    minLength: 8,               // Q8：最短 8 位
    scrypt: { N: 16384, r: 8, p: 1, keylen: 64 },
  },
  // MySQL 连接配置（支持环境变量覆盖，便于部署）
  db: {
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER || 'wtms',
    // 注意：密码只允许来自环境变量 / .env，绝不在此硬编码明文（已用 .gitignore 排除 .env）
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'wtms',
    connectionLimit: 10,
  },
};
