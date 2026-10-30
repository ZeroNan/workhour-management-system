# 更新日志 (Changelog)

本文件遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/) 规范，
版本号遵循 [语义化版本 (Semantic Versioning)](https://semver.org/lang/zh-CN/)。

## [Unreleased]

### 新增 (Added)
- 人员排序：`users` 增加 `sort_order` 字段。**升级前置：存量库必须先执行 `scripts/migrate-user-sort.sql`，否则 `/api/stats/project` 与 `GET/POST /api/users` 全部 500**（全新部署的 `init.sql` 已包含该列，无需执行）。
- 工时记录列表支持导出 CSV / Excel：「工时记录列表」页筛选行右侧提供「导出 CSV / 导出 Excel」按钮与状态位，空列表时禁用；导出条件 = 当前筛选条件（与列表共用同一查询串），字段为日期、项目、工时(h)、工作内容、状态、退回意见（不含「操作」列，工作内容不截断）。
- 导出分批拉取：每批 500 条调用 `GET /api/timesheets`，不足一批即止；最多 100 批（约 5 万条），达到上限且仍为满批则中止并提示「数据量过大，请缩小日期范围后重试」，**绝不静默截断**（完整可导出上限 49999 条）；导出中按钮禁用并显示「正在获取数据… 已获取 N 条」，结束显示「已导出 N 条」。
- Excel 导出使用本地 vendor 的 SheetJS（`public/vendor/xlsx.full.min.js`）写 `.xlsx` 并设置列宽（工作内容 60 字符）；组件缺失或写文件失败自动降级为 CSV 并在提示中说明。
- 工时列表（我的记录 / 工时审核 / 全部工时）列宽支持拖拽调整：拖动表头右缘改变列宽，宽度按视图记忆到 localStorage，刷新后自动恢复；「工作内容」列拖宽后同步解除 280px 截断。

### 变更 (Changed)
- `GET /api/timesheets` 支持可选分页参数 `limit`（1~1000 整数）/ `offset`（≥0 整数），非法值返回 400 `VALIDATION_ERROR`；**不传时行为与旧版完全一致**（仍返回裸数组、不分页），仅供前端分批导出使用，权限仍为登录并强制本人。
- 导出的「工时(h)」列改为数值类型，Excel 中可直接 SUM / 透视；CSV 侧仍统一双引号包裹（主流表格软件按数字识别）。

### 安全 (Security)
- CSV 导出增加公式注入中和：单元格内容以 `=`、`+`、`-`、`@` 或制表符 / 回车开头时前置一个单引号，表格软件按文本处理（仅作用于字符串，数值与日期不误伤）。

### 修复 (Fixed)
- 验证码错误由 500 修正为 400 `INVALID_CAPTCHA`；`err()` 对未注册错误码改为 fail-fast（构造期抛显式错误，不再静默劣化为 500）。
- WPS 同步：幂等重放前移到业务校验之前——单日工时较大的批次重放不再被 400 `HOURS_EXCEEDED` 抢先拒绝（重放返回 200 `duplicate:true`；同 Key 不同内容返回 409）。
- 变更类接口（新增/修改/提交/撤回/通过/退回）响应统一 camelCase，不再泄漏 `user_id` / `dept_id` / `owner_id` 等内部字段。
- 月度视图：整日已通过的日期，空单元格同样置为只读，与"界面即约束"一致（此前保存时才报 409）。

## [2.0.0] - 2026-09

### 新增 (Added)
- 后端化重构：从 v1 单文件前端（localStorage）迁移至 Node.js + Express + MySQL 架构。
- 三方角色：管理员 (admin)、项目负责人 (pm)、研发人员 (dev)。
- 工时填报：按项目、按天填报，含任务描述与工时数，单日合计上限校验。
- 审核流：草稿 → 待审核 (submitted) → 通过 (approved) / 退回 (rejected)，退回须填意见；PM 禁止自审。
- 统计与导出：按项目/按月的成员工时矩阵，支持 Excel 导出（仅姓名）。
- 报表：每日项目日报（PM/管理员）、日报看板（全员）。
- WPS 集成：开放 API（`POST /api/integrations/wps/sync`）以 API Key 鉴权，将 WPS 脚本的工时批量写入为「待审核」，支持限流、幂等与审计日志；管理员端「集成管理」菜单可管理密钥与查看日志。
- 登录安全：图片验证码、账号锁定策略、首登强制改密。

### 变更 (Changed)
- 服务默认端口由 3000 改为 3456。
- 登录页移除测试账号提示。

### 安全 (Security)
- `.env` 等含密配置文件通过 `.gitignore` 排除，不进入版本库。
- 数据库密码仅允许来自环境变量 / `.env`，禁止硬编码。
- API Key 库内仅存 SHA-256 哈希，明文仅创建时一次性返回。

## [1.0.0] - 2026-09（v1 基线）

- 单文件 SPA 演示版（localStorage 存储），见 `legacy/v1-index.html`。
