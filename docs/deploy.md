# 部署与运维手册（工时管理系统 v2 · MySQL 版）

> 本文档对应代码已切换为 **MySQL** 存储（原 SQLite 版本不再使用）。默认服务端口 **3456**。

## 1. 环境依赖

| 项 | 要求 |
|---|---|
| Node.js | >= 22.13（当前开发机 22.22.2，使用 WorkBuddy 托管运行时） |
| MySQL | 8.0+（8.0.16+ 原生支持 CHECK 约束；5.7 会忽略 CHECK 但不影响建表）；MariaDB 10.5+ 亦可 |
| 依赖包 | express ^4.21.2、mysql2 ^3.24.3、xlsx 0.18.5（仅构建期复制到 public/vendor，服务端运行时不依赖） |
| 客户端工具 | `mysqldump`（用于每日备份，见 §7）；冒烟脚本可选 `mysql` CLI |
| 时区 | 服务端进程强制 `TZ=Asia/Shanghai`（src/config.js 内设置），日期判断以服务器当天为准 |

> 说明：本版数据库引擎统一为 MySQL，建库/建表/初始数据全部由 `scripts/init.sql` 接管；db.js 仅做 mysql2 连接池 + 薄封装（prepare/exec/transaction），业务代码无需感知驱动差异。

## 2. 目录约定

```
工时管理系统/
├── server.js            # 入口
├── package.json
├── .env.example         # 环境变量示例（PORT / DB_*）
├── data/backups/        # 运行时目录（gitignore，mysqldump 备份落于此）
├── public/              # 前端静态资源（v2）
├── scripts/
│   ├── init.sql         # MySQL 建库 / 建用户 / 建表 DDL / 演示数据（部署首步执行）
│   ├── backup.sh        # 每日备份（mysqldump，保留 30 份）
│   └── smoke.sh         # 冒烟自测（独立测试库 wtms_smoke，端口 3457）
└── src/                 # 后端源码（config.js / db.js / routes / services / seed.js）
```

环境变量（均可用进程环境变量覆盖，便于部署）：

| 变量 | 默认 | 说明 |
|---|---|---|
| `PORT` | 3456 | HTTP 监听端口 |
| `DB_HOST` | 127.0.0.1 | MySQL 主机 |
| `DB_PORT` | 3306 | MySQL 端口 |
| `DB_USER` | wtms | 应用专用账号 |
| `DB_PASSWORD` | <请替换为你的数据库密码> | 应用专用账号密码 |
| `DB_NAME` | wtms | 数据库名 |

## 3. 安装与初始化（首次部署）

```bash
cd /Users/zhang/Workbuddy/工时管理系统
npm install        # 安装 express / mysql2 / xlsx

# 1) 初始化 MySQL（以具备建库/建用户权限的账号，如 root 执行一次）：
mysql -h 127.0.0.1 -P 3306 -u root -p < scripts/init.sql
#    init.sql 会：建库 wtms(utf8mb4) → 建应用账号 wtms/wtms123456 并授权
#    → 建 7 张表 → 写入演示数据（3 部门 / 9 账号 / 2 项目 / 当月前 3 天样本工时）

# 2) 启动服务
npm start          # http://localhost:3456
```

> 启动时会自动检测 `users` 表：若为空则由 `seedIfEmpty()` 重种演示数据；因为 `init.sql` 已写入数据，正常启动会跳过种子。若你手动清空过表，启动即自动补种。

演示账号：admin / pm1 / pm2 / dev1 ~ dev6；初始密码统一 **12345678**，首次登录强制改密（must_change_password）。

## 4. 启动与停止

**前台启动（调试）**

```bash
npm start
# 日志：[wtms] 工时管理系统已启动: http://localhost:3456 (TZ=Asia/Shanghai)
```

**后台 / 生产（任选其一）**

- pm2：
  ```bash
  npm i -g pm2          # 或走团队规范安装方式
  pm2 start server.js --name wtms --time
  pm2 save
  ```
- systemd（/etc/systemd/system/wtms.service 示例）：
  ```ini
  [Unit]
  Description=WTMS 工时管理系统
  After=network.target mysql.service

  [Service]
  WorkingDirectory=/Users/zhang/Workbuddy/工时管理系统
  ExecStart=/Users/zhang/.workbuddy/binaries/node/versions/22.22.2/bin/node server.js
  Environment=PORT=3456
  Environment=DB_HOST=127.0.0.1
  Environment=DB_PORT=3306
  Environment=DB_USER=wtms
  Environment=DB_PASSWORD=<请替换为你的数据库密码>
  Environment=DB_NAME=wtms
  Restart=on-failure

  [Install]
  WantedBy=multi-user.target
  ```
  然后 `systemctl daemon-reload && systemctl enable --now wtms`。

**停止**

```bash
# 前台：Ctrl+C
# pm2：pm2 stop wtms
# systemd：systemctl stop wtms
# 杂项：pkill -f "node server.js"
```

## 5. 重置演示数据（危险）

```bash
npm run seed:reset    # 清空全部业务表后重种演示数据（会丢失所有正式数据，请先备份）
```

> 前置：表结构必须已存在（即 §3 的 init.sql 已执行过）。该命令只清数据、不删表。

## 6. 备份与恢复

- 手动备份：`bash scripts/backup.sh`（调用 `mysqldump` 导出 `data/backups/wtms_<时间戳>.sql.gz`，保留最近 30 份）
- 定时任务（每日凌晨 2 点）：
  ```bash
  crontab -e
  # 0 2 * * * cd /Users/zhang/Workbuddy/工时管理系统 && bash scripts/backup.sh >> data/backup.log 2>&1
  ```

恢复（停服后执行）：

```bash
# 整库恢复
mysql -h 127.0.0.1 -P 3306 -u wtms -p wtms < data/backups/wtms_YYYYMMDD_HHMMSS.sql.gz
# 或先 gunzip 再导入
gunzip -c data/backups/wtms_*.sql.gz | mysql -h 127.0.0.1 -P 3306 -u wtms -p wtms
```

## 7. 冒烟自测清单

```bash
bash scripts/smoke.sh
```

覆盖：启动 → 登录/改密 → 填报校验（未来日期 400、内容空 400、单条 >24h 400、当日合计 >24h 400、非项目成员 403）→ 草稿 → 提交（幂等）→ PM 审核通过（幂等）→ 自审 403 → 批量审核（跳过自审）→ 管理员代审 → 统计接口 → 未登录 401 → 重启后数据与会话均在 → 登出失效。输出 `SMOKE: PASS` / `FAIL`。

- 脚本默认使用**独立测试库** `wtms_smoke` + 独立端口 **3457**，不污染真实 `wtms` / 3456。
- 若本机 `mysql` CLI 可用，脚本会自动建测试库并加载 `init.sql` 的 DDL+演示数据；否则需你先手动初始化测试库。

## 8. 常见问题排查

- **启动报 `EADDRINUSE` / `listen EADDRINUSE: 3456`**：端口被占用。改 `PORT` 环境变量或先停掉占用进程（`pkill -f "node server.js"`）。
- **`ECONNREFUSED` / 启动即 500**：MySQL 不可达。检查 `DB_HOST`/`DB_PORT`、MySQL 是否运行、防火墙。
- **`ER_ACCESS_DENIED_ERROR`**：账号或密码不对。核对 `DB_USER`/`DB_PASSWORD`（请替换为你的数据库账号与密码），并确认 init.sql 已对该账号授权。
- **启动即 500 且日志含 `ER_NO_SUCH_TABLE`**：忘记执行 `scripts/init.sql` 建表。回到 §3 先初始化数据库。
- **除 `/api/auth/*` 外全部 403（`MUST_CHANGE_PASSWORD`）**：演示账号首次登录强制改密，需先调用修改密码接口再访问其它接口。前端会在登录后弹出改密框。
- **忘记 admin 密码**：用 root 登录 MySQL 重置（演示哈希对应密码 `12345678`）：
  ```bash
  mysql -u root wtms -e "UPDATE users SET password_hash='scrypt\$16384\$8\$1\$48db25bd3316ff9cdeef1003cb6f24d8\$f29cfb202553023a998c58c2b63356af5fa3700c1d9b0891373f2da126104c405c3bdf2aa5d6488d83aa0caf97dc0ae9990b61f4924b9afbfae6477d6592ed60', must_change_password=1 WHERE username='admin';"
  ```
- **MySQL 5.7 报错 `CHECK` 相关**：5.7 会忽略 CHECK 约束（仅警告，不影响建表）；建议用 8.0+ 以获得完整约束校验。
- **日期/时区异常**：确认服务器 `TZ=Asia/Shanghai`（config.js 强制；不要在本机临时改 TZ 跑服务）。
- **升级前端**：public/ 为纯静态文件，替换后刷新即可；服务端无前端构建步骤。

## 9. 版本升级与数据库迁移（重要前置）

升级已有部署的代码后，如该版本变更了表结构，**必须先执行对应迁移脚本、再启动新版本服务**，否则相关接口会直接报错。

> ✅ **本轮变更（工时列表列宽拖拽 + 记录导出 CSV/Excel）无数据库迁移要求**：改动仅涉及前端静态资源（`public/js/views-fill.js`、`public/js/util.js`、`public/css/style.css`）与 `GET /api/timesheets` 的可选查询参数 `limit` / `offset`（纯查询层，**未改表结构**）。升级时替换代码并重启服务即可，**无需执行任何迁移脚本**。下表的迁移清单仅适用于「WPS 集成」与「人员排序（`users.sort_order`）」版本升级。

| 迁移脚本 | 适用版本 | 作用 | 不执行的后果 |
|---|---|---|---|
| `scripts/migrate-integration.sql` | WPS 集成功能上线前（一次性） | `users` 加 `employee_no`；建 `api_keys` / `sync_idempotency` / `sync_log` | WPS 同步与集成管理接口不可用 |
| `scripts/migrate-user-sort.sql` | **人员排序版本（users.sort_order）起** | `users` 加 `sort_order` 列 | **`/api/stats/project` 与 `GET/POST /api/users` 全部 500（日志 `ER_BAD_FIELD_ERROR 1054 Unknown column 'u.sort_order'`）** |

```bash
# 升级到含人员排序的版本前，在应用连接的库执行一次：
mysql -h 127.0.0.1 -P 3306 -u root -p wtms < scripts/migrate-user-sort.sql
```

> 说明：
> - **全新部署无需执行**——`scripts/init.sql` / `init-workhour.sql` 建表 DDL 已包含 `sort_order` 列，此脚本只针对**从旧版本升级的存量库**。
> - `ALTER TABLE` 重复执行会报"列已存在"，执行一次即可；迁移保留全部现有数据。
> - 建议升级前先做一次备份（见 §6）。

## 10. 从 SQLite 旧版迁移说明

本版数据库已统一为 MySQL，**不读取也不迁移**旧 SQLite 文件（`data/workhours.db` 若存在可直接删除）。如需保留历史工时，请在旧实例导出为 SQL/CSV 后，按 `timesheets` 表结构手工导入新 MySQL 库；演示数据由 `init.sql` / `seed:reset` 重新生成。
