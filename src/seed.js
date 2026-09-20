// 演示数据种子：迁移 v1 seedData() 逻辑入库
// 用法：node src/seed.js [--reset]；或 import { seedIfEmpty } 供 server.js 启动调用
// 注意：MySQL 版 db.prepare(...).run/get/all 返回 Promise，必须 await 后再取
//       lastInsertRowid / changes / 行数据（SQLite 时代的同步写法会得到 undefined）。
import db from './db.js';
import { hashPassword } from './utils/password.js';
import { serverToday, nowStr } from './utils/date.js';

const DEMO_PASSWORD = '12345678'; // Q8：最短 8 位

async function buildSeed() {
  const today = serverToday();
  const hash = hashPassword(DEMO_PASSWORD);
  const now = nowStr();

  const insDept = db.prepare('INSERT INTO departments(name) VALUES (?)');
  const insUser = db.prepare(`INSERT INTO users(username,password_hash,name,role,dept_id,must_change_password,created_at)
    VALUES (?,?,?,?,?,1,?)`);
  const insProject = db.prepare('INSERT INTO projects(name,owner_id,created_at) VALUES (?,?,?)');
  const insMember = db.prepare('INSERT INTO project_members(project_id,user_id) VALUES (?,?)');
  const insTS = db.prepare(`INSERT INTO timesheets(user_id,dept_id,project_id,date,hours,content,status,submit_time,audit_time,auditor_id,audit_comment,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`);

  // 主键捕获：必须 await 拿到 { lastInsertRowid } 后再用于后续关联插入
  const d1 = (await insDept.run('研发一部')).lastInsertRowid;
  const d2 = (await insDept.run('研发二部')).lastInsertRowid;
  const d3 = (await insDept.run('测试部')).lastInsertRowid;

  // 人员（演示密码统一 12345678，首登强制改密）
  const uid = {};
  for (const [username, name, role, deptId] of [
    ['admin', '系统管理员', 'admin', null],
    ['pm1', '王负责人', 'pm', d1],
    ['pm2', '李负责人', 'pm', d2],
    ['dev1', '张开发', 'dev', d1],
    ['dev2', '刘开发', 'dev', d1],
    ['dev3', '陈开发', 'dev', d2],
    ['dev4', '赵开发', 'dev', d2],
    ['dev5', '孙测试', 'dev', d3],
    ['dev6', '周测试', 'dev', d3],
  ]) {
    uid[username] = (await insUser.run(username, hash, name, role, deptId, now)).lastInsertRowid;
  }

  // 项目（owner 自动并入成员）
  const p1 = (await insProject.run('电商平台', uid.pm1, now)).lastInsertRowid;
  const p2 = (await insProject.run('AI中台', uid.pm2, now)).lastInsertRowid;
  for (const [, pid, members] of [
    ['p1', p1, ['pm1', 'dev1', 'dev2', 'dev5']],
    ['p2', p2, ['pm2', 'dev3', 'dev4', 'dev6']],
  ]) {
    for (const m of members) {
      // 存在性校验：pid / uid[m] 必须是已落库的真实主键
      if (!Number.isInteger(pid) || !Number.isInteger(uid[m])) {
        throw new Error(`[seed] project_members 插入前校验失败：pid=${pid}, user_id=${uid[m]}`);
      }
      await insMember.run(pid, uid[m]);
    }
  }

  // 当月前 3 天工时样本（只到今天，不产生未来日期脏数据）
  const ym = today.slice(0, 7);
  const todayD = Number(today.slice(8, 10));
  const maxD = Math.max(0, Math.min(3, todayD));
  const pad = n => String(n).padStart(2, '0');

  const members = [
    ['dev1', p1, d1, 'dev'], ['dev2', p1, d1, 'dev'], ['dev5', p1, d3, 'dev'], ['pm1', p1, d1, 'pm'],
    ['dev3', p2, d2, 'dev'], ['dev4', p2, d2, 'dev'], ['dev6', p2, d3, 'dev'], ['pm2', p2, d2, 'pm'],
  ];
  const CONTENTS = {
    dev: ['需求评审与开发方案设计', '核心功能开发与自测', '接口联调与缺陷修复'],
    pm: ['项目计划制定与任务拆分', '进度跟踪与风险协调', '项目周报整理与阶段复盘'],
  };

  for (const [uname, pid, deptId, kind] of members) {
    const i = members.findIndex(m => m[0] === uname);
    for (let d = 1; d <= maxD; d++) {
      const date = `${ym}-${pad(d)}`;
      const c = CONTENTS[kind][d - 1] || '日常工作';
      const push = (hours, status, st, at, comment, auditor) =>
        insTS.run(uid[uname], deptId, pid, date, hours, c, status, st, at, auditor, comment || '', now, now);
      if (d === 1) {
        // 第 1 天：全部已通过
        await push(7, 'approved', `${date} 18:00`, `${date} 20:00`, '', kind === 'pm' ? uid.admin : null);
      } else if (d === 2) {
        // 第 2 天：待审核为主，孙测试 6 小时演示「≠7 橙色警示」
        await push(i === 2 ? 6 : 7, 'submitted', `${date} 18:10`, null, '', null);
      } else {
        // 第 3 天：覆盖草稿 / 退回 / 待审核 / 已通过 / 未填满
        if (i === 1) {            // 刘开发：两条草稿合计 7
          await insTS.run(uid[uname], deptId, pid, date, 3.5, c, 'draft', null, null, null, '', now, now);
          await insTS.run(uid[uname], deptId, pid, date, 3.5, c + '（续）', 'draft', null, null, null, '', now, now);
        } else if (i === 2) {     // 孙测试：已退回，带退回意见
          await push(7, 'rejected', `${date} 09:00`, `${date} 10:00`, '工作内容描述过于简单，请补充具体任务后重新提交', uid.pm1);
        } else if (i === 3) {     // 王负责人：8 小时待审核（≠7，需管理员代审）
          await push(8, 'submitted', `${date} 18:00`, null, '', null);
        } else if (i === 4) {     // 陈开发：已通过
          await push(7, 'approved', `${date} 18:00`, `${date} 20:00`, '', uid.pm2);
        } else if (i === 6) {     // 周测试：4.5 小时草稿（未填满）
          await push(4.5, 'draft', null, null, '', null);
        } else {
          await push(7, 'submitted', `${date} 18:00`, null, '', null);
        }
      }
    }
  }

  await db.prepare('INSERT INTO app_meta(key,value) VALUES (\'seeded_at\',?)').run(now);
  return { users: 9, days: maxD };
}

const resetAndSeed = db.transaction(() => buildSeed());

/** server.js 启动调用：库为空才种 */
export async function seedIfEmpty() {
  const row = await db.prepare('SELECT COUNT(*) AS n FROM users').get();
  if (row.n > 0) return false;
  const r = await resetAndSeed();
  console.log(`[seed] 检测到空库，已自动重种演示数据（${r.users} 人 / 当月前 ${r.days} 天样本），演示密码统一为 ${DEMO_PASSWORD}`);
  return true;
}

// 直接执行：node src/seed.js [--reset]
if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  (async () => {
    try {
      const RESET = process.argv.includes('--reset');
      const hasUsers = (await db.prepare('SELECT COUNT(*) AS n FROM users').get()).n > 0;
      if (RESET) {
        const r = await resetAndSeed();
        console.log(`[seed] 已清空并重种演示数据（${r.users} 人），演示密码统一为 ${DEMO_PASSWORD}`);
      } else if (!hasUsers) {
        await seedIfEmpty();
      } else {
        console.log('[seed] 库中已有用户数据，跳过种子（如需重种请用 npm run seed:reset）');
      }
    } catch (e) {
      console.error('[seed] 失败：', e);
      process.exitCode = 1;
    } finally {
      await db.pool.end(); // CLI 模式必须显式关池，否则事件循环挂住不退出
    }
  })();
}
