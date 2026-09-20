#!/usr/bin/env bash
# ============================================================
# 工时管理系统 · 项目上传/发布脚本
# 作用：将本机项目 rsync 到服务器 -> 装生产依赖 -> 重启 systemd 服务
# 用法：在【开发机/本机】执行   bash deploy.sh
# 前置：服务器已跑过 setup-env.sh；本地已配置 SSH 免密（或能输密码）
# ============================================================
set -euo pipefail

# ===================== 需修改：服务器连接信息 =====================
SERVER_USER="root"         # 服务器 SSH 用户（先用 root 上传，目录已属 workhour）
SERVER_HOST="your-server-public-ip"  # 服务器公网 IP（必改）
SERVER_PORT="20022"           # SSH 端口（默认 22，改动过请改这里）
APP_DIR="/opt/workhour"    # 与 setup-env.sh / workhour.service 保持一致
APP_USER="workhour"        # 运行用户（用于赋权）
# ================================================================

# 关键修复：LOCAL_DIR 必须锚定到脚本所在的项目根目录，而不是依赖调用时的 CWD。
# deploy.sh 位于 <项目根>/scripts/deploy/ ，上溯两级即为项目根（含 server.js / src / public / package.json）。
# 旧写法 LOCAL_DIR="." 会在「非项目根目录调用脚本」时把错误/空目录 rsync 到服务器，
# 导致 /opt/workhour 没有 package.json，进而 npm install 报「找不到 package.json」。
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOCAL_DIR="$(cd "${SCRIPT_DIR}/../.." && pwd)"

# ----- 本地预检：确保要上传的源目录确实包含项目入口文件 -----
if [[ ! -f "${LOCAL_DIR}/package.json" || ! -f "${LOCAL_DIR}/server.js" ]]; then
  echo "❌ 本地项目根目录校验失败：未在 ${LOCAL_DIR} 找到 package.json / server.js" >&2
  echo "   请确认 deploy.sh 仍在 <项目根>/scripts/deploy/ 下，不要移动本脚本。" >&2
  exit 1
fi
echo "ℹ️  项目根目录（LOCAL_DIR）= ${LOCAL_DIR}"

echo "==> [1/3] rsync 上传项目（排除 node_modules/.env/.git，保护服务器配置）"
# 先确保远端目标目录存在，使 rsync 目标路径确定（避免部分环境 rsync 不自动建多级目录）
ssh -p "${SERVER_PORT}" "${SERVER_USER}@${SERVER_HOST}" "mkdir -p ${APP_DIR}"
rsync -avz --delete \
  --exclude node_modules --exclude .env --exclude .git --exclude '*.log' \
  -e "ssh -p ${SERVER_PORT}" \
  "${LOCAL_DIR}/" "${SERVER_USER}@${SERVER_HOST}:${APP_DIR}/"

# ----- 远端校验：上传后必须存在 package.json，否则绝不进入 npm 步骤 -----
if ! ssh -p "${SERVER_PORT}" "${SERVER_USER}@${SERVER_HOST}" "test -f ${APP_DIR}/package.json"; then
  echo "❌ 上传后校验失败：${APP_DIR}/package.json 在服务器上不存在，停止以避免 npm 误报。" >&2
  echo "   排查：检查 LOCAL_DIR 是否正确、SSH/rsync 是否真的把文件传上去了。" >&2
  exit 1
fi

echo "==> [2/3] 在服务器安装生产依赖"
ssh -p "${SERVER_PORT}" "${SERVER_USER}@${SERVER_HOST}" \
  "cd ${APP_DIR} && npm install --omit=dev --no-audit --no-fund"

echo "==> [3/3] 安装/重启 systemd 守护服务"
# 关键修复：单元文件 workhour.service 必须先落到 /etc/systemd/system/ 才能被 systemctl 识别。
# 之前只执行 systemctl restart 会报「Unit workhour.service not found」。
# 用 ssh 把本地单元文件管道写入服务器（不依赖 scp 是否安装），重复执行幂等。
ssh -p "${SERVER_PORT}" "${SERVER_USER}@${SERVER_HOST}" "cat > /etc/systemd/system/workhour.service" < "${SCRIPT_DIR}/workhour.service"
ssh -p "${SERVER_PORT}" "${SERVER_USER}@${SERVER_HOST}" \
  "sudo chown -R ${APP_USER}:${APP_USER} ${APP_DIR} \
   && sudo systemctl daemon-reload \
   && sudo systemctl enable workhour \
   && sudo systemctl restart workhour \
   && sudo systemctl status workhour --no-pager"

# 友好检查：.env 不在 rsync 范围内，需服务器本地存在；否则服务能起但与数据库连不上
if ! ssh -p "${SERVER_PORT}" "${SERVER_USER}@${SERVER_HOST}" "test -f ${APP_DIR}/.env"; then
  echo "⚠️  服务器 ${APP_DIR}/.env 不存在！服务虽已启动，但读不到 DB 密码会连不上数据库。"
  echo "    请 SSH 登录后执行：cp ${APP_DIR}/.env.example ${APP_DIR}/.env 并填入真实 DB_*，"
  echo "    然后：sudo systemctl restart workhour"
else
  echo "ℹ️  已确认 ${APP_DIR}/.env 存在。"
fi

echo "✅ 发布完成。验证：curl -s -o /dev/null -w '%{http_code}' http://${SERVER_HOST}:3456/"
echo "   若需查看日志：ssh ${SERVER_USER}@${SERVER_HOST} 'sudo journalctl -u workhour -n 50 --no-pager'"
