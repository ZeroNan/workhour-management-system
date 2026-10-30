# 工时管理系统 · 云服务器部署方案

> 适用项目：`workhour-management-system`（Node.js 22 + Express 4 + mysql2）
> 配套脚本目录：`scripts/deploy/`（已附带，含注释与「需修改」参数标记）
> 相关文档：`docs/deploy.md`（通用 MySQL 部署说明）、`docs/architecture-v2.md`

## 0. 部署架构与前提
- **应用服务器**：只需装 Node.js 22（≥22.13），**无需安装 MySQL**。
- **数据库**：使用你提供的远端 MySQL（`workhour` 库，`<数据库主机>:<端口>`，账号 `<数据库账号>`）。
  应用通过 `.env` 中的 `DB_*` 连接该库；`.env` 由应用自身用 `dotenv` 加载，**不进版本库**。
- **端口**：应用默认监听 `3456`（见 `src/config.js` 的 `PORT`）。
- **公网访问**：开放防火墙/安全组 `3456` 入站；如需 HTTPS，前置 Nginx 反向代理（见 §6 可选）。

```
[浏览器/公网] --(3456)--> [云服务器] node server.js  --(MySQL 3306/13306)--> [远端 workhour 库]
                          (systemd 守护, 开机自启+异常自重启)
```

---

## 1. 具体操作步骤

### 1.1 服务器环境准备
> 以 Ubuntu 22.04 为例（CentOS 见脚本内 `yum` 分支）。以下命令在**服务器**上执行。

```bash
# (1) 系统更新
sudo apt-get update -y && sudo apt-get upgrade -y

# (2) 安装基础工具（rsync/git 便于后续上传代码，curl 用于装 Node）
sudo apt-get install -y curl git rsync ca-certificates

# (3) 安装 Node.js 22（官方 NodeSource 源，项目要求 >=22.13）
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs
node -v   # 期望 v22.x

# (4) 创建专用运行用户（无登录 shell，禁止用 root 跑业务）
sudo useradd -r -s /usr/sbin/nologin -d /opt/workhour workhour || true
sudo mkdir -p /opt/workhour
sudo chown -R workhour:workhour /opt/workhour
```
> 以上步骤已封装为 `scripts/deploy/setup-env.sh`，可直接 `sudo bash setup-env.sh` 一步完成。

### 1.2 上传项目文件到服务器
> 在项目**本机/开发机**执行。任选其一：
- **方式 A（推荐，增量同步）**：`scripts/deploy/deploy.sh`（基于 rsync，自动排除 `node_modules/.env/.git`）
  ```bash
  # 先按文件顶部「需修改」参数填好：SERVER_HOST / SERVER_USER / SERVER_PORT / APP_DIR
  # 脚本会自动定位项目根目录（不依赖你当前所在的目录），从任意位置调用均可
  bash scripts/deploy/deploy.sh
  ```
- **方式 B（手动 scp）**：
  ```bash
  rsync -avz --delete --exclude node_modules --exclude .env --exclude .git \
    -e "ssh -p 22" ./ root@YOUR_SERVER_IP:/opt/workhour/
  ```
- **方式 C（git）**：服务器 `git clone` 后 `npm install`（需仓库可访问）。

> ⚠️ **切勿上传本地 `.env`**（含密码）。服务器上的 `.env` 须单独生成（见 1.3）。

### 1.3 安装依赖与配置
```bash
# (1) 服务器上安装生产依赖（已上传后）
sudo -u workhour bash -c 'cd /opt/workhour && npm install --omit=dev --no-audit --no-fund'

# (2) 在服务器创建 .env（从模板复制后填写真实值）
sudo -u workhour cp /opt/workhour/.env.example /opt/workhour/.env
sudo -u workhour vi /opt/workhour/.env
```
`.env` 需填写的关键项（**密码含 `#` 必须用双引号包裹**，否则被当作注释截断）：
```ini
PORT=3456
DB_HOST=<数据库主机>      # 远端 MySQL 主机
DB_PORT=13306              # 远端 MySQL 端口
DB_USER=<数据库账号>
DB_PASSWORD="<数据库密码>"   # 注意双引号；替换为你的真实密码
DB_NAME=workhour
```
> 数据库结构已在你之前的会话中通过 `scripts/init-workhour.sql` 初始化完成（7 张表 + 演示数据）。
> 若需在服务器侧重建/重置：`mysql -h <数据库主机> -P <端口> -u <数据库账号> -p workhour < scripts/init-workhour.sql`

### ⚠️ 1.3.1 升级已有部署：先跑数据库迁移（重要前置）

> ✅ **本轮变更（工时列表列宽拖拽 + 记录导出 CSV/Excel）无需数据库迁移**：仅前端静态资源与 `GET /api/timesheets` 的可选 `limit` / `offset` 查询参数，未改动任何表结构。上传代码后重启服务即可（`public/` 为纯静态文件，替换后浏览器刷新生效）。下列迁移脚本仅适用于「人员排序」与「WPS 集成」版本。

**首次全新部署可跳过本节**（`init-workhour.sql` 建表 DDL 已包含全部列）。若是**对已运行的旧版本做代码升级**，先核对 `docs/deploy.md §9` 的迁移清单，按版本执行对应脚本后再启动新服务，例如：

```bash
# 升级到含人员排序的版本（users.sort_order）前，必须执行一次：
mysql -h <数据库主机> -P 13306 -u <数据库账号> -p workhour < scripts/migrate-user-sort.sql
```

不执行的后果：`/api/stats/project` 与 `GET/POST /api/users` 全部 500（`ER_BAD_FIELD_ERROR 1054 Unknown column 'u.sort_order'`）。WPS 集成所需表则对应 `scripts/migrate-integration.sql`。

### 1.4 防火墙与安全组
```bash
# (1) 服务器防火墙（ufw）放行 3456
sudo ufw allow 3456/tcp
sudo ufw reload
sudo ufw status

# (2) 云厂商「安全组」控制台：入站规则新增
#     协议 TCP / 端口 3456 / 源 0.0.0.0/0（或限定你的办公网 IP，更严格）
```
> 若用 Nginx（§6），则放行 80/443，3456 仅监听内网即可。

### 1.5 设为守护进程（开机自启 + 异常自重启）
```bash
# 复制单元文件（按文件内「需修改」核对路径/用户）
sudo cp scripts/deploy/workhour.service /etc/systemd/system/workhour.service
sudo systemctl daemon-reload
sudo systemctl enable workhour      # 开机自启
sudo systemctl start workhour      # 立即启动
sudo systemctl status workhour     # 查看状态
```
> 单元内 `Restart=always` 实现进程崩溃/退出后自动重启；`WantedBy=multi-user.target` 实现开机自启。
> **注意**：若使用 `deploy.sh` 发布，第 3 步已自动完成「复制单元 + daemon-reload + enable + restart」，本节手动步骤仅在**不借助 deploy.sh** 时才需要执行。

---

## 2. 可直接执行的脚本（位于 `scripts/deploy/`）

| 脚本 | 用途 | 在何机执行 | 需修改参数 |
|---|---|---|---|
| `setup-env.sh` | 系统更新 + 装 Node 22 + 建运行用户/目录 | **服务器** | `APP_USER` / `APP_DIR` |
| `deploy.sh` | rsync 上传 + 装依赖 + 重启服务 | **开发机** | `SERVER_HOST` / `SERVER_USER` / `APP_DIR` |
| `start.sh` | 手动 start/stop/restart/status（无 systemd 时备用） | 服务器 | `APP_DIR` |
| `workhour.service` | systemd 守护单元 | 服务器（复制到 /etc/systemd） | `APP_DIR` / `APP_USER` |

每个脚本顶部均有「需根据实际服务器修改的参数」注释块，按顺序改完即可直接 `bash` 执行。

---

## 3. 验证方法

### 3.1 确认进程已运行
```bash
sudo systemctl status workhour --no-pager      # active (running)
sudo journalctl -u workhour -n 50 --no-pager   # 查看启动日志（含 "listening on :3456"）
ss -ltnp | grep 3456                           # 确认端口在监听
```

### 3.2 本地（服务器内）连通性
```bash
# 首页应返回 200 + HTML
curl -s -o /dev/null -w "HTTP %{http_code}\n" http://localhost:3456/

# 登录接口端到端验证（同时验证 DB 连通）：返回 200 且含 token 即正常
curl -s -X POST http://localhost:3456/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"12345678"}'
# 注：演示账号首登需改密，但 login 本身返回 200；若返回 401 多为密码/账号问题
```

### 3.3 公网访问验证
```bash
# 在你的本地电脑执行（替换公网 IP）
curl -s -o /dev/null -w "公网 HTTP %{http_code}\n" http://YOUR_SERVER_IP:3456/
```
浏览器打开 `http://YOUR_SERVER_IP:3456/` 看到登录页即部署成功。
> 不通时优先排查：安全组是否放行 3456、ufw 是否 allow、服务是否监听 0.0.0.0（本应用默认即全网卡监听）。

---

## 4. 常见问题排查

| 现象 | 可能原因 | 排查/修复命令 |
|---|---|---|
| `systemctl status` 显示 `failed` / 反复重启 | 看日志定位 | `sudo journalctl -u workhour -n 100 --no-pager` |
| `node: command not found` 或版本 <22.13 | Node 未装/版本低 | `node -v`；重跑 `setup-env.sh` |
| 端口被占用 `Address already in use` | 3456 被占 | `ss -ltnp \| grep 3456`；改 `PORT` 或停掉占用进程 |
| 启动即退（DB 连不上） | 远端 MySQL 不可达/拒绝 | 见下「数据库专项」 |
| 公网打不开页面 | 安全组/防火墙未开 3456 | `sudo ufw status`；检查云控制台安全组入站 |
| 登录返回 401 / 应用报密码错误 | `.env` 密码被 `#` 截断 | 确认 `DB_PASSWORD="..."` 已加双引号（见 §1.3） |
| 用 root 绑 <1024 端口报错 | 需 root 或 Nginx | 用 3456，或 Nginx 反代 80/443 |

### 数据库专项（远端 MySQL 连接失败）
远端库连接失败多为**账号 host 白名单**或**网络不通**：
```bash
# (1) 从应用服务器测试到远端 MySQL 的 TCP 连通
nc -zv <数据库主机> <端口>        # 或：telnet <数据库主机> <端口>

# (2) 错误码含义
#   ECONNREFUSED        -> 端口不通/MySQL 未监听/安全组未开
#   ER_ACCESS_DENIED_   -> 账号或密码错误（重点查 .env 密码引号）
#   ER_HOST_NOT_PRIVILEGED -> MySQL 账号限定了来源 IP，应用服务器 IP 不在允许列表
```
> ⚠️ **关键坑**：`db_workhour_admin` 在 MySQL 端可能只允许特定来源主机（`'db_workhour_admin'@'某IP'`）。
> 若应用服务器 IP 不在白名单，会出现 `ER_HOST_NOT_PRIVILEGED`。
> 解决：在 MySQL 端为该账号授权来源为应用服务器公网/私网 IP，或 `'db_workhour_admin'@'%'`（不限制来源，需评估安全性）。

---

## 5. 常用运维命令
```bash
sudo systemctl start|stop|restart|status workhour   # 服务控制
sudo journalctl -u workhour -f                       # 实时日志
sudo systemctl enable|disable workhour              # 开机自启开关
bash scripts/deploy/deploy.sh                        # 改代码后重新发布
```

## 6. 可选：Nginx 反向代理 + HTTPS（生产建议）
若希望用 80/443 而非裸 3456：
```nginx
# /etc/nginx/sites-available/workhour
server {
    listen 80; server_name your.domain.com;   # 改为你的域名
    location / {
        proxy_pass http://127.0.0.1:3456;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }
}
```
之后：`sudo ufw allow 80,443/tcp`、安全组放行 80/443、3456 改为仅内网监听。证书可用 `certbot`。
