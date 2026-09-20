// MySQL 连接与数据访问层（mysql2/promise 连接池）。
// 设计目标：对上层（services / routes / seed）暴露与历史（SQLite）版本一致的薄封装接口
//   db.prepare(sql) -> { get(...p), all(...p), run(...p) }
//   db.exec(sql)            -> 执行（DDL 等多语句，需 multipleStatements）
//   db.transaction(fn)      -> 返回一个 async 函数，在单连接事务中执行 fn
// 这样 services/timesheetService.js、routes/*.js、seed.js 不需要改动调用方式。
//
// 建库 / 建表 / 初始数据请见 scripts/init.sql（部署时先执行）。
import mysql from 'mysql2/promise';
import { AsyncLocalStorage } from 'node:async_hooks';
import { config } from './config.js';

const pool = mysql.createPool({
  host: config.db.host,
  port: config.db.port,
  user: config.db.user,
  password: config.db.password,
  database: config.db.database,
  connectionLimit: config.db.connectionLimit,
  charset: 'utf8mb4',
  // DECIMAL 字段（如 hours）返回 JS number 而非字符串，保持与前端/旧版一致的数值语义
  decimalNumbers: true,
  // 允许 init/迁移类脚本一次执行多条语句（应用运行时仅参数化单语句，无注入风险）
  multipleStatements: true,
  waitForConnections: true,
  enableKeepAlive: true,
});

// 事务上下文：让 db.prepare 在事务内复用同一连接，保证事务原子性
const als = new AsyncLocalStorage();

async function doQuery(kind, sql, params) {
  const executor = als.getStore() || pool;
  const [rows] = await executor.query(sql, params || []);
  if (kind === 'get') return rows[0];
  if (kind === 'all') return rows;
  // run：返回与历史（SQLite）版本兼容的结构 { changes, lastInsertRowid }
  return { changes: rows.affectedRows, lastInsertRowid: rows.insertId };
}

function makeStatement(sql) {
  return {
    get: (...p) => doQuery('get', sql, p),
    all: (...p) => doQuery('all', sql, p),
    run: (...p) => doQuery('run', sql, p),
  };
}

const db = {
  /** 返回语句对象：get/all/run 均接受 ...params */
  prepare: (sql) => makeStatement(sql),

  /** 执行任意语句（DDL / 多语句）。事务内自动使用同一连接。 */
  async exec(sql) {
    await (als.getStore() || pool).query(sql);
  },

  /**
   * 事务包装：db.transaction(fn) 返回 async (...args) => result。
   * fn 内部所有 db.prepare(...).run/get/all 都在同一连接、同一事务中执行。
   */
  transaction: (fn) => async (...args) => {
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const result = await als.run(conn, () => fn(...args));
      await conn.commit();
      return result;
    } catch (e) {
      await conn.rollback().catch(() => {});
      throw e;
    } finally {
      conn.release();
    }
  },

  /** 底层连接池，供健康检查 / 诊断使用 */
  pool,
};

export default db;
