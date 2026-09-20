#!/usr/bin/env bash
# ============================================================
# 工时管理系统 · 手动启停脚本（无 systemd 时备用 / 临时调试）
# 用法：bash start.sh [start|stop|restart|status]
# 说明：.env 由应用通过 dotenv 自动加载，无需在此导出
# ============================================================
set -euo pipefail

# ===================== 需修改：部署目录 =====================
APP_DIR="/opt/workhour"
# =======================================================
PID_FILE="${APP_DIR}/workhour.pid"
LOG_FILE="${APP_DIR}/logs/workhour.log"

cd "${APP_DIR}"

start() {
  if [ -f "${PID_FILE}" ] && kill -0 "$(cat "${PID_FILE}")" 2>/dev/null; then
    echo "已在运行 (PID $(cat "${PID_FILE}"))"
    return
  fi
  mkdir -p "$(dirname "${LOG_FILE}")"
  # NODE_ENV=production；应用自身用 dotenv 读取 .env
  NODE_ENV=production nohup /usr/bin/node server.js >"${LOG_FILE}" 2>&1 &
  echo $! >"${PID_FILE}"
  echo "已启动 PID $(cat "${PID_FILE}")，日志见 ${LOG_FILE}"
  echo "验证：curl -s -o /dev/null -w '%{http_code}' http://localhost:3456/"
}

stop() {
  if [ -f "${PID_FILE}" ]; then
    PID="$(cat "${PID_FILE}")"
    kill "${PID}" 2>/dev/null && echo "已发送停止信号 (PID ${PID})"
    rm -f "${PID_FILE}"
  else
    echo "未找到 PID 文件，可能未运行"
  fi
}

status() {
  if [ -f "${PID_FILE}" ] && kill -0 "$(cat "${PID_FILE}")" 2>/dev/null; then
    echo "运行中 (PID $(cat "${PID_FILE}"))"
  else
    echo "未运行"
  fi
}

case "${1:-start}" in
  start)   start ;;
  stop)    stop ;;
  restart) stop; sleep 1; start ;;
  status)  status ;;
  *) echo "用法: $0 [start|stop|restart|status]"; exit 1 ;;
esac
