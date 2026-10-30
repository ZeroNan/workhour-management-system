# 工时管理系统 (WorkHour Management System)

> 面向研发团队的多角色工时填报、审核、统计与导出系统。支持研发人员填报、项目负责人审核、管理员统筹，并提供 WPS 脚本批量同步工时与开放 API 集成能力。

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D22.13-brightgreen.svg)](https://nodejs.org)

---

## 一、项目简介

工时管理系统用于解决研发团队「工时谁填、谁来审、怎么统计」的问题：

- **研发人员 (dev)**：按项目、按天填报工时（含任务描述），支持补录与修改未审核记录。
- **项目负责人 (pm)**：审核本人负责项目的工时（禁止自审），查看所负责项目的统计与每日日报。
- **管理员 (admin)**：部门/项目/人员等基础数据管理、全量工时查看、项目统计与 Excel 导出、WPS 集成密钥管理与同步日志审计。

系统采用 **Node.js + Express + MySQL** 后端化架构（v2），前端为原生 JS 单页应用。v1 演示版（localStorage 单文件）保留在 [`legacy/v1-index.html`](legacy/v1-index.html) 作为历史基线。

---

## 二、核心特性

| 特性 | 说明 |
|------|------|
| 三角色协作 | admin / pm / dev，权限按角色与项目归属收敛 |
| 工时填报 | 按项目按天填报，单日合计上限校验，退回须填意见 |
| 记录导出 | 「工时记录列表」支持按当前筛选条件导出 CSV / Excel：分批拉取（每批 500 条）后前端生成文件，仅含本人记录；对以 `=` `+` `-` `@` 开头的单元格做公式注入中和 |
| 列表列宽 | 工时相关列表的列宽可拖拽调整，宽度按视图记忆到本地，刷新后自动恢复 |
| 审核流 | 草稿 → 待审核 (submitted) → 通过 (approved) / 退回 (rejected) |
| 统计与导出 | 按项目/按月的成员工时矩阵，支持 Excel 导出 |
| 报表 | 每日项目日报（PM/管理员）、日报看板（全员） |
| WPS / 开放 API 集成 | 以 API Key 将外部工时批量写入为「待审核」，支持限流、幂等、审计 |
| 登录安全 | 图片验证码、连续失败锁定、首登强制改密 |
| 部署友好 | 提供 systemd 单元与一键发布脚本 |

---

## 三、技术栈

- **运行时**：Node.js ≥ 22.13（ES Module）
- **后端**：Express 4、`mysql2`（连接池 + 事务）
- **数据库**：MySQL 8.0+
- **前端**：原生 JavaScript（ES Module）+ SheetJS（Excel 导出）
- **部署**：systemd + rsync 发布脚本（见 `scripts/deploy/`）

---

## 四、环境要求

| 依赖 | 版本 |
|------|------|
| Node.js | ≥ 22.13 |
| MySQL | 8.0+ |
| npm | 随 Node 附带 |

> 应用服务器只需 Node.js，无需本地安装 MySQL（可连接远端数据库）。

---

## 五、快速开始

### 1. 获取代码

```bash
git clone <仓库地址>
cd workhour-management-system
```

### 2. 安装依赖

```bash
npm install
```

### 3. 配置环境变量

复制模板并按需修改：

```bash
cp .env.example .env
```

编辑 `.env`（**切勿提交真实 `.env`**）：

```ini
PORT=3456
DB_HOST=your-mysql-host
DB_PORT=3306
DB_USER=your-db-user
DB_PASSWORD="your-strong-password"   # 含 # / @ 等符号须用英文双引号包裹
DB_NAME=your-db-name
```

### 4. 初始化数据库

```bash
# 本地/演示库（建表 + 演示数据）
mysql -h <主机> -P <端口> -u <账号> -p <库名> < scripts/init.sql

# 若使用指定名称的远端库，可改用 scripts/init-workhour.sql
```

### 5. 启动

```bash
npm start
# 浏览器访问 http://localhost:3456
```

默认演示账号（v2，首次登录强制改密）：

| 角色 | 账号 | 初始密码 |
|------|------|----------|
| 管理员 | `admin` | `12345678` |
| 项目负责人 | `pm1` / `pm2` | `12345678` |
| 研发人员 | `dev1` ~ `dev6` | `12345678` |

> 生产环境请务必修改默认密码，并通过 `scripts/seed.js` 重置或对接真实组织数据。

---

## 六、配置说明

所有敏感配置均通过环境变量（`.env`）注入，**不硬编码**。可用 `PORT=3456 DB_HOST=... npm start` 形式在启动命令前覆盖，无需 dotenv。

| 变量 | 说明 | 默认 |
|------|------|------|
| `PORT` | 服务监听端口 | `3456` |
| `DB_HOST` | MySQL 主机 | `127.0.0.1` |
| `DB_PORT` | MySQL 端口 | `3306` |
| `DB_USER` | 数据库账号 | — |
| `DB_PASSWORD` | 数据库密码（含特殊符号需双引号） | — |
| `DB_NAME` | 数据库名 | — |

完整模板见 [`.env.example`](.env.example)。

---

## 七、目录结构

```text
workhour-management-system/
├── server.js                 # 服务入口（装配路由、静态服务、启动）
├── package.json              # 依赖与脚本
├── .env.example              # 配置模板（已脱敏，可提交）
├── .gitignore                # 忽略依赖/密钥/运行时数据/IDE 等
├── LICENSE                   # MIT 许可证
├── CHANGELOG.md              # 版本变更记录
├── CONTRIBUTING.md           # 贡献指南
├── legacy/
│   └── v1-index.html         # v1 单文件演示版（历史基线，不提供服务）
├── public/                   # v2 前端
│   ├── index.html            # 前端入口
│   ├── css/style.css
│   ├── js/                   # 视图与工具模块（app/util/ui/api/views-*）
│   └── vendor/xlsx.full.min.js
├── src/                      # 后端源码
│   ├── config.js             # 端口/会话/密码策略/DB 配置
│   ├── db.js                 # mysql2 连接池
│   ├── seed.js               # 演示数据播种
│   ├── middleware/           # 鉴权、API Key、限流、错误处理
│   ├── routes/               # 路由（auth/audit/projects/stats/timesheets/reports/integration/users/departments）
│   ├── services/             # 业务逻辑（timesheetService/statsService/integrationService）
│   └── utils/                # date/http/password 工具
├── scripts/                  # 部署与维护脚本
│   ├── deploy/               # 一键发布（deploy.sh）、环境准备、systemd 单元
│   ├── init.sql              # 本地库建表 + 演示数据
│   ├── init-workhour.sql     # 指定库建表
│   ├── migrate-integration.sql  # WPS 集成所需表迁移
│   ├── gen-apikey.mjs        # 生成首个 API Key
│   ├── backup.sh             # 数据库备份
│   └── smoke.sh              # 隔离冒烟测试
└── docs/                     # 文档
    ├── architecture-v2.md    # 架构设计
    ├── deploy.md             # 部署指南
    ├── deploy-cloud.md       # 云服务器部署
    ├── integration-wps.md    # WPS 集成对接文档
    └── PRD-increment-v2.md   # 增量 PRD
```

> 说明：`.env`、`data/`、`.workbuddy/` 等已被 `.gitignore` 排除，不会进入版本库。

---

## 八、使用示例

### 1. 普通接口（需登录会话）

以研发人员身份填报工时（前端操作或调用 `/api/timesheets`）；以 PM 身份在「工时审核」页审核所负责项目。

### 2. WPS / 开放 API 同步

WPS 脚本可将指定项目多名员工的工时一次性推送到本系统，写入状态为「待审核」。接口概要：

```http
POST /api/integrations/wps/sync
Headers:
  Content-Type: application/json
  X-API-Key: <你的 API Key>          # 或 Authorization: Bearer <Key>
  Idempotency-Key: <可选幂等键>
```

请求体（节选）：

```json
{
  "project": { "projectId": 1, "projectName": "示例项目" },
  "records": [
    {
      "employeeNo": "E1001",
      "date": "2026-09-20",
      "hours": 8,
      "taskDesc": "需求评审与方案设计"
    }
  ]
}
```

成功响应（节选）：

```json
{ "ok": true, "accepted": 1, "rejected": 0, "syncId": 12 }
```

完整字段定义、错误码、WPS VBA/JSA 调用示例与 FAQ 见 [docs/integration-wps.md](docs/integration-wps.md)。

> API Key 在管理员端「集成管理」菜单创建；明文仅在创建时显示一次，库内仅存 SHA-256 哈希。

---

## 九、常见问题 (FAQ)

**Q1：启动报 `ER_NO_SUCH_TABLE`？**
未初始化数据库。先执行 `scripts/init.sql`（或 `init-workhour.sql`）建表。

**Q2：登录提示密码错误，但账号密码没错？**
若密码含 `#` 或 `@`，`.env` 中必须写成 `DB_PASSWORD="..."`（双引号），否则 `#` 会被当作注释截断。

**Q3：PM 能看到/审核所有项目吗？**
不能。PM 仅可见并审核**本人负责**的项目；且禁止审核自己填报的记录（自审被禁止）。

**Q4：`.env` 能提交到 Git 吗？**
不能。`.env` 已在 `.gitignore` 中排除。请把 `.env.example`（已脱敏）作为模板提交。

**Q5：WPS 同步报 `EMPLOYEE_NOT_FOUND`？**
目标员工尚未建档或缺少工号（`employee_no`）。请在基础数据管理补充，或启用迁移脚本末尾的 `UPDATE users SET employee_no = username`。

**Q6：如何部署到服务器？**
参考 [docs/deploy-cloud.md](docs/deploy-cloud.md) 与 `scripts/deploy/deploy.sh`（请将脚本中的服务器地址占位符替换为你的真实地址）。

---

## 十、贡献指南

欢迎 Issue 与 Pull Request。请先阅读 [CONTRIBUTING.md](CONTRIBUTING.md)：包含本地启动、分支与提交规范、代码约定与安全披露方式。

---

## 十一、许可证

本项目基于 [MIT License](LICENSE) 开源。

## 人员排序与本次升级

已有数据库升级前，在应用所用数据库执行一次 `scripts/migrate-user-sort.sql`，
例如：`mysql -h <主机> -P <端口> -u <账号> -p <库名> < scripts/migrate-user-sort.sql`。
该迁移仅新增 `users.sort_order` 列，不改动现有记录。新库初始化脚本已包含该列，勿重复执行迁移。

在「基础数据管理 → 人员管理」的新建或编辑表单维护「排列顺序」。
数值越小越靠前；相同数值按人员 ID 升序。默认值为 0，保持原有人员顺序。
项目统计页面、Excel 与 CSV 导出共用此顺序；已移除成员的历史工时仍保留在统计明细中。
修改顺序后重新加载统计页面再导出。

回归测试：`npm test`（无需数据库，使用隔离数据库桩与弹窗事件模拟）。
测试覆盖首登改密、并发每日工时上限、并发审核、WPS 幂等重试、历史统计及月度弹窗保存/提交。
真实 MySQL 的事务锁行为仍需在测试数据库验收，勿对生产数据运行演示冒烟脚本。
