#!/bin/bash
# 每日备份 MySQL 数据库（mysqldump → gzip），保留最近 30 份
# 用法：./scripts/backup.sh（建议 crontab 每日凌晨执行，见 docs/deploy.md）
# 连接参数可用环境变量覆盖，与 config.js 保持一致：
#   DB_HOST / DB_PORT / DB_USER / DB_PASSWORD / DB_NAME
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
BACKUP_DIR="$PROJECT_DIR/data/backups"
KEEP=30

DB_HOST="${DB_HOST:-127.0.0.1}"
DB_PORT="${DB_PORT:-3306}"
DB_USER="${DB_USER:-wtms}"
DB_PASSWORD="${DB_PASSWORD:-wtms123456}"
DB_NAME="${DB_NAME:-wtms}"

if ! command -v mysqldump >/dev/null 2>&1; then
  echo "[backup] 未找到 mysqldump，请先安装 MySQL 客户端（或 apt/yum install mysql-client）" >&2
  exit 1
fi

mkdir -p "$BACKUP_DIR"
STAMP=$(date +%Y%m%d_%H%M%S)
DEST="$BACKUP_DIR/wtms_${STAMP}.sql.gz"

echo "[backup] 备份 $DB_USER@$DB_HOST:$DB_PORT/$DB_NAME -> $DEST"
MYSQL_PWD="$DB_PASSWORD" mysqldump -h "$DB_HOST" -P "$DB_PORT" -u "$DB_USER" \
  --single-transaction --routines --events --triggers --no-tablespaces \
  "$DB_NAME" | gzip > "$DEST"

# 清理超出保留份数的旧备份（按文件名时间戳排序）
ls -1 "$BACKUP_DIR"/wtms_*.sql.gz 2>/dev/null | sort | head -n -"$KEEP" | while read -r f; do
  rm -f "$f"
  echo "[backup] 已清理过期备份：$f"
done

echo "[backup] 备份完成：$DEST（保留最近 $KEEP 份）"
