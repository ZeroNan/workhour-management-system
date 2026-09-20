# 工时管理系统 · WPS 开放接口对接文档（V1）

> 适用版本：workhour-management-system v2（Node.js 22 + Express 4 + MySQL）
> 配套代码：`src/routes/integration.js`、`src/services/integrationService.js`、`src/middleware/apiKeyAuth.js`、`src/middleware/rateLimit.js`
> 数据库迁移：`scripts/migrate-integration.sql`
> 密钥生成：`scripts/gen-apikey.mjs`

---

## 1. 接口概述与使用场景

### 1.1 一句话说明
WPS 脚本（VBA / JSA 宏）把**指定项目的多名员工工时**通过一次 HTTPS POST 推送到本系统，系统将每条工时以 **「待审核（submitted）」** 状态写入数据库，由项目负责人 / 管理员在审核页统一处理。**一个 API 密钥可提交不同人员的信息**。

### 1.2 核心接口

| 项 | 值 |
|---|---|
| 方法 | `POST` |
| URL | `https://<域名或IP>:3456/api/integrations/wps/sync` |
| 鉴权 | `X-API-Key` 或 `Authorization: Bearer <key>` |
| 内容类型 | `application/json` |
| 幂等键 | 请求头 `Idempotency-Key`（建议必带） |

### 1.3 典型使用场景
- WPS 表格中维护员工每日工时，点击按钮「一键同步到工时系统」。
- 定时任务（WPS 计划任务 / 外部调度）每日批量上报。
- 多项目分别调用，或单项目一次携带多员工。

### 1.4 数据安全与稳定性特性
- **HTTPS 传输加密**：接口必须走 HTTPS（TLS 在 Nginx 反向代理 / 负载均衡层终止，见 §7）。
- **API Key 鉴权**：密钥仅存 SHA-256 哈希，明文不落库；可随时停用（revoke）。
- **请求频率限制**：按密钥维度滑动窗口限流（默认 120 次/分钟，可在 `api_keys.rate_limit` 调整）。
- **幂等性**：同一 `Idempotency-Key` 重复提交返回首次结果，不会重复入库。
- **原子写入**：单批次任一记录校验失败则整批拒绝，不落任何行，便于修正后整体重发。
- **审计日志**：每次调用写入 `sync_log`（成功/失败、错误码、条数、客户端 IP、耗时）。

---

## 2. 鉴权流程

1. **申请密钥**：管理员登录系统后，调用管理接口（`POST /api/integrations/keys`）或在本机执行：
   ```bash
   node scripts/gen-apikey.mjs "WPS集成" 120
   ```
   输出中 `data.key` 为明文密钥（形如 `wtms_xxxx...`），**仅显示一次**，请妥善保存。
2. **WPS 脚本携带密钥**：每次请求在 HTTP 头加入
   ```
   X-API-Key: wtms_xxxx...
   ```
   或使用标准头 `Authorization: Bearer wtms_xxxx...`。
3. **服务端校验**：计算 `SHA256(密钥)` 比对 `api_keys.key_hash`；密钥不存在 → `401 API_KEY_INVALID`；状态非 active → `403 API_KEY_DISABLED`；缺失 → `401 API_KEY_MISSING`。
4. **停用密钥**：`DELETE /api/integrations/keys/:id`（管理员），即刻失效。

> ⚠️ 密钥等同于「可写入工时的凭证」，请勿写入 WPS 文档正文或提交到版本库；通过 WPS 宏变量 / 配置文件注入更安全。

---

## 3. 请求 / 响应示例

### 3.1 请求头
```
POST /api/integrations/wps/sync HTTP/1.1
Host: <域名>:3456
Content-Type: application/json
X-API-Key: wtms_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
Idempotency-Key: 1f3c9a2e-7b6d-4e21-9c5a-0b8d2f4e6c10
```

### 3.2 请求体（JSON）
```json
{
  "batchNo": "WPS-20260909-001",
  "project": { "projectId": 12 },
  "employee": { "employeeNo": "E1001" },
  "records": [
    { "employeeNo": "E1001", "name": "张三", "date": "2026-09-08", "hours": 8, "taskDesc": "完成模块A接口开发" },
    { "employeeNo": "E1002", "name": "李四", "date": "2026-09-08", "hours": 7.5, "taskDesc": "测试用例编写与执行" },
    { "employeeNo": "E1001", "name": "张三", "date": "2026-09-09", "hours": 6, "taskDesc": "代码评审" }
  ]
}
```

**字段定义**

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `batchNo` | string | 否 | 业务批次号，仅用于对账/日志展示 |
| `project` | object | **是** | 目标项目；`projectId`(number) 或 `projectName`(string) 二选一 |
| `employee` | object | 否 | 默认员工信息；记录级可覆盖 |
| `records` | array | **是** | 工时明细，1–500 条 |
| `records[].employeeNo` | string | 否* | 员工工号（匹配 `users.employee_no`）；与 `username` 二选一 |
| `records[].username` | string | 否* | 登录账号（兜底匹配 `users.username`） |
| `records[].name` | string | 否 | 员工姓名，仅用于日志/展示，不参与匹配 |
| `records[].date` | string | **是** | 工时日期 `YYYY-MM-DD`，不能晚于今天 |
| `records[].hours` | number | **是** | 工时数，0 < h ≤ 24，同一人同一天合计 ≤ 24 |
| `records[].taskDesc` | string | 否 | 任务描述，写入 `timesheets.content`；缺省为「(WPS 同步)」 |

> *每条记录需至少提供 `employeeNo` 或 `username` 之一，用于在本系统定位员工（员工须已存在于本系统）。

### 3.3 成功响应（首次写入）
```json
HTTP/1.1 201 Created
{
  "code": "OK",
  "message": "已接收 3 条工时，状态：待审核",
  "data": {
    "code": "OK",
    "accepted": 3,
    "timesheetIds": [101, 102, 103],
    "idempotencyKey": "1f3c9a2e-7b6d-4e21-9c5a-0b8d2f4e6c10",
    "duplicate": false,
    "projectId": 12,
    "projectName": "某研发项目"
  }
}
```

### 3.4 成功响应（幂等重放）
同一 `Idempotency-Key` 再次提交相同内容 → 返回 **200** 且 `duplicate: true`，**不重复入库**：
```json
HTTP/1.1 200 OK
{
  "code": "OK",
  "message": "重复提交，已返回首次处理结果（未重复入库）",
  "data": { "accepted": 3, "timesheetIds": [101,102,103], "duplicate": true, "...": "..." }
}
```

### 3.5 失败响应（示例：部分记录校验失败）
```json
HTTP/1.1 422 Unprocessable Entity
{
  "code": "INVALID_RECORD",
  "message": "有 1 条记录校验未通过",
  "details": {
    "errors": [
      { "index": 2, "field": "employeeNo", "message": "员工不存在：E1002" }
    ]
  }
}
```

---

## 4. 错误码说明及处理建议

| HTTP | code | 含义 | 处理建议 |
|---|---|---|---|
| 401 | `API_KEY_MISSING` | 缺少密钥头 | 在请求头加 `X-API-Key` |
| 401 | `API_KEY_INVALID` | 密钥错误 | 检查密钥拼写 / 是否已被重置 |
| 403 | `API_KEY_DISABLED` | 密钥已停用 | 联系管理员重新签发 |
| 429 | `RATE_LIMITED` | 触发限流 | 读取 `Retry-After` 头，退避后重试；或申请调高 `rate_limit` |
| 409 | `IDEMPOTENCY_CONFLICT` | 同 Key 内容不一致 | 检查是否误用相同 Key 发不同数据；换用新 Key 或修正内容 |
| 400 | `VALIDATION_ERROR` | 结构/字段缺失 | 按 `message` 修正请求体 |
| 422 | `PROJECT_NOT_FOUND` | 项目不存在 | 核对 `projectId`/`projectName` |
| 422 | `EMPLOYEE_NOT_FOUND` | 员工不存在 | 员工须先在本系统建档；核对 `employeeNo`/`username` |
| 422 | `INVALID_RECORD` | 记录级校验失败 | 查看 `details.errors` 逐条修正后整体重发（幂等 Key 可不变） |
| 413 | `PAYLOAD_TOO_LARGE` | 记录超 500 条 | 分批提交 |
| 400 | `FUTURE_DATE` | 日期晚于今天 | 不允许未来日期 |
| 400 | `HOURS_EXCEEDED` | 当日合计超 24h | 拆分或修正工时 |
| 500 | `INTERNAL` | 服务端异常 | 保留 `Idempotency-Key` 与响应，联系研发；可安全重试（幂等） |

> 所有错误响应均为 `{ "code": "<CODE>", "message": "...", "details": {...} }` 结构。

---

## 5. WPS 脚本端调用示例

### 5.1 VBA 宏（WPS 表格）
```vb
Sub SyncToWorkHour()
    Dim http As Object, url As String, apiKey As String, body As String
    url = "https://<域名>:3456/api/integrations/wps/sync"
    apiKey = "wtms_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"   ' 建议从单元格/配置文件读取，勿硬编码明文

    ' 组装 JSON（示例：当前表第2行起，列 A=工号 B=姓名 C=日期 D=工时 E=任务）
    Dim i As Long, arr() As String, n As Long
    n = 0: ReDim arr(1 To 1000)
    For i = 2 To Cells(Rows.Count, 1).End(xlUp).Row
        If Trim(Cells(i, 1).Value) = "" Then Exit For
        n = n + 1
        arr(n) = "{\"employeeNo\":""" & CStr(Cells(i,1).Value) & """," & _
                 """name\":""" & CStr(Cells(i,2).Value) & """," & _
                 """date\":""" & Format(Cells(i,3).Value, "yyyy-mm-dd") & """," & _
                 """hours\":" & CDbl(Cells(i,4).Value) & "," & _
                 """taskDesc\":""" & Replace(CStr(Cells(i,5).Value), """", "'") & """}"
    Next i
    ReDim Preserve arr(1 To n)
    body = "{" & _
        """project"":{""projectId"":12}," & _
        """records"":[" & Join(arr, ",") & "]}"

    Set http = CreateObject("MSXML2.ServerXMLHTTP.6.0")
    http.Open "POST", url, False
    http.setRequestHeader "Content-Type", "application/json"
    http.setRequestHeader "X-API-Key", apiKey
    http.setRequestHeader "Idempotency-Key", CStr(Now()) & "-" & CStr(Timer())  ' 每次提交用唯一Key
    On Error Resume Next
    http.Send body
    If http.Status = 201 Or http.Status = 200 Then
        MsgBox "同步成功：" & http.responseText, vbInformation
    Else
        MsgBox "同步失败(" & http.Status & ")：" & http.responseText, vbCritical
    End If
End Sub
```

### 5.2 JSA（WPS JavaScript 宏）
```javascript
async function syncToWorkHour() {
  const apiKey = "wtms_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"; // 同上为安全从配置读取
  const url = "https://<域名>:3456/api/integrations/wps/sync";
  const sheet = Application.Sheet; // 取当前表
  const rows = [];
  let i = 2;
  while (sheet.Cells(i, 1).Value) {
    rows.push({
      employeeNo: String(sheet.Cells(i, 1).Value),
      name: String(sheet.Cells(i, 2).Value),
      date: sheet.Cells(i, 3).Value.toISOString
        ? sheet.Cells(i, 3).Value.toISOString().slice(0, 10)
        : sheet.Cells(i, 3).Value,
      hours: Number(sheet.Cells(i, 4).Value),
      taskDesc: String(sheet.Cells(i, 5).Value),
    });
    i++;
  }
  const body = JSON.stringify({
    project: { projectId: 12 },
    records: rows,
  });
  const idem = "wps-" + Date.now() + "-" + Math.random().toString(36).slice(2);
  const resp = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-API-Key": apiKey,
      "Idempotency-Key": idem,
    },
    body,
  });
  const text = await resp.text();
  if (resp.ok) Application.Alert("同步成功：" + text);
  else Application.Alert("同步失败(" + resp.status + ")：" + text);
}
```

---

## 6. 管理员密钥管理接口（会话鉴权）

| 方法 | URL | 说明 |
|---|---|---|
| `GET` | `/api/integrations/keys` | 列出密钥（隐藏明文） |
| `POST` | `/api/integrations/keys` | 创建密钥，body `{ "name":"WPS集成", "rateLimit":120 }`，返回明文 `data.key` |
| `DELETE` | `/api/integrations/keys/:id` | 停用指定密钥 |

均需管理员登录会话（Cookie），与开放接口的 API Key 鉴权相互独立。

---

## 7. 部署与运维

### 7.1 执行数据库迁移（必须，先于首次调用）
```bash
mysql -h <数据库主机> -P <端口> -u <数据库账号> -p workhour < scripts/migrate-integration.sql
```
完成后为存量员工补登工号（如确认 username 即工号，取消 `migrate-integration.sql` 末尾注释的 UPDATE 行并重新执行）。

### 7.2 生成首个密钥
```bash
node scripts/gen-apikey.mjs "WPS集成" 120
```

### 7.3 HTTPS / 反向代理（推荐）
在 Nginx 中终止 TLS 并反代到 `127.0.0.1:3456`：
```nginx
server {
    listen 443 ssl; server_name wh.your-domain.com;
    ssl_certificate     /path/fullchain.pem;
    ssl_certificate_key /path/privkey.pem;
    location / {
        proxy_pass http://127.0.0.1:3456;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```
客户端统一访问 `https://wh.your-domain.com/api/integrations/wps/sync`；3456 仅监听内网。

### 7.4 监控
- 实时日志：`sudo journalctl -u workhour -f`
- 调用审计：`SELECT * FROM sync_log ORDER BY id DESC LIMIT 50;`
- 密钥使用：`SELECT id,name,status,last_used_at FROM api_keys;`

---

## 8. 常见问题 FAQ

**Q1：WPS 报 401 API_KEY_INVALID？**
密钥拼写错误，或尚未执行迁移/尚未创建密钥。先跑 `gen-apikey.mjs` 拿到明文密钥。

**Q2：报 422 EMPLOYEE_NOT_FOUND？**
员工未在本系统建档，或 `employee_no` 未填。先通过基础数据管理创建员工并补充工号（迁移脚本末尾的 UPDATE 可把 username 作为工号）。

**Q3：限流 429 怎么办？**
读取 `Retry-After` 退避重试；如业务量大，调高该密钥的 `rate_limit`（管理接口或 `UPDATE api_keys SET rate_limit=?`）。

**Q4：重复点击会写两遍吗？**
不会。每次提交带唯一 `Idempotency-Key` 即幂等；同一 Key 重发返回首次结果。建议每次提交生成新 Key（如时间戳+随机），网络重试也安全。

**Q5：能自动创建员工/项目吗？**
不能。为保数据一致，员工与项目须先在本系统存在；接口只做匹配与写入工时。

**Q6：同步后在哪里审核？**
「工时审核」页（PM/管理员）即可看到状态为「待审核」的工时，按项目/人员审核通过或退回。

**Q7：数据安全如何保障？**
传输层强制 HTTPS；密钥仅存哈希、可随时停用；每次调用有审计日志；按密钥限流防滥用。

---

## 9. 变更记录
- V1（2026-09-09）：新增 `/api/integrations/wps/sync` 及密钥管理接口、幂等/限流/日志、迁移脚本与本文档。
