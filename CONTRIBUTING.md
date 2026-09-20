# 贡献指南 (Contributing)

感谢你关注工时管理系统！在提交代码前，请阅读以下约定。

## 开发环境

- Node.js ≥ 22.13（建议 22 LTS）
- 一个可用的 MySQL 8.0+ 数据库
- 包管理器：npm

## 本地启动

```bash
cp .env.example .env      # 填入你的数据库连接信息
npm install
mysql -h <主机> -P <端口> -u <账号> -p <库名> < scripts/init.sql   # 首次建表
npm start                 # 访问 http://localhost:3456
```

> ⚠️ 切勿将真实 `.env`、密钥、Token 提交到仓库。`.env.example` 已脱敏，可作为模板提交。

## 分支与提交流程

1. Fork 本仓库并克隆到本地。
2. 从 `main`（或 `master`）切出特性分支：`git checkout -b feat/your-feature`。
3. 保持提交原子化，信息清晰（建议中文或英文均可，例如 `fix: 修复审核页空数据报错`）。
4. 提交前确认：`node --check` 通过、未引入新密钥、`.env` 未被跟踪。
5. 推送分支并发起 Pull Request，描述改动目的与验证方式。

## 代码规范

- 后端：ES Module（`"type": "module"`），异步全程 `async/await`，路由统一用 `wrap()` 包裹以传导异常。
- 前端：`public/js` 下为原生 JS 模块，新增视图请复用 `util.js` / `ui.js` 的 `$`、`toast`、`uiConfirm` 等工具。
- 数据库变更：通过 `scripts/*.sql` 迁移脚本执行，禁止在代码里隐式 `CREATE TABLE`。

## 安全披露

如发现安全漏洞（如密钥泄露、越权、注入等），**请勿公开 Issue**，请通过私信或邮件联系维护者，我们将优先处理。

## 行为准则

请友善、专业地交流，尊重所有贡献者。
