#!/usr/bin/env bash
# ============================================================
# 工时管理系统 · 云服务器运行环境安装脚本
# 作用：系统更新 + 安装 Node.js 22 + 创建专用运行用户与目录
# 用法：在【服务器】上执行   sudo bash setup-env.sh
# 说明：本应用连接【远端 MySQL】(见 .env 的 DB_HOST)，应用服务器无需安装 MySQL
# ============================================================
set -euo pipefail

# ===================== 需根据实际服务器修改的参数 =====================
APP_USER="workhour"   # 应用专用运行用户（非 root，提升安全性）
APP_DIR="/opt/workhour"  # 项目部署根目录（后续 deploy.sh 上传到这里）
NODE_MAJOR="22"       # Node.js 大版本（项目要求 >=22.13）
# =====================================================================

echo "==> [1/5] 更新系统软件包"
if command -v apt-get >/dev/null 2>&1; then
  apt-get update -y && apt-get upgrade -y
elif command -v yum >/dev/null 2>&1; then
  yum update -y
else
  echo "不支持的包管理器，请手动安装基础依赖" >&2; exit 1
fi

echo "==> [2/5] 安装基础工具（curl/git/rsync，便于装 Node 与上传代码）"
if command -v apt-get >/dev/null 2>&1; then
  apt-get install -y curl git rsync ca-certificates
else
  yum install -y curl git rsync ca-certificates
fi

echo "==> [3/5] 安装 Node.js ${NODE_MAJOR}.x（NodeSource 官方源）"
if command -v node >/dev/null 2>&1 && [ "$(node -v | cut -d. -f1 | tr -d v)" = "${NODE_MAJOR}" ]; then
  echo "    已安装 Node $(node -v)，跳过"
else
  if command -v apt-get >/dev/null 2>&1; then
    curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | bash -
    apt-get install -y nodejs
  else
    curl -fsSL "https://rpm.nodesource.com/setup_${NODE_MAJOR}.x" | bash -
    yum install -y nodejs
  fi
fi
echo "    Node: $(node -v)  npm: $(npm -v)"

echo "==> [4/5] 创建专用运行用户 ${APP_USER}（禁止登录 shell，仅用于运行服务）"
if ! id "${APP_USER}" >/dev/null 2>&1; then
  useradd -r -s /usr/sbin/nologin -d "${APP_DIR}" "${APP_USER}" 2>/dev/null || \
  useradd -r -s /sbin/nologin -d "${APP_DIR}" "${APP_USER}"
fi

echo "==> [5/5] 创建项目目录并赋权"
mkdir -p "${APP_DIR}"
chown -R "${APP_USER}:${APP_USER}" "${APP_DIR}"

echo "✅ 运行环境就绪。后续步骤："
echo "   1) 上传项目文件到 ${APP_DIR}（见 deploy.sh 或 scp 命令）"
echo "   2) 在 ${APP_DIR}/.env 填入数据库连接等配置（DB_HOST/DB_PORT/DB_USER/DB_PASSWORD/DB_NAME）"
echo "   3) 安装依赖并启动：npm install --omit=dev && sudo systemctl start workhour"
