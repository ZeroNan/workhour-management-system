#!/bin/bash
# 冒烟测试：启动服务 → 登录（含首登改密）→ 填报校验链 → 提交（幂等）
#           → PM 审核通过（幂等）→ 自审 403 → 批量审核（本人记录跳过）
#           → admin 代审 → 统计 → 重启验证数据完整、会话不掉线 → 登出失效 → PASS/FAIL
# 数据库：MySQL。默认使用独立测试库 wtms_smoke（端口 3457），不碰真实 wtms / 3456。
# 前置：本机 MySQL 可达；若 mysql CLI 可用会自动建测试库并加载 scripts/init.sql 的 DDL+种子。
#       否则需手动先初始化测试库（建库 + 执行 init.sql 的 DDL/种子部分）。
set -uo pipefail

cd "$(dirname "$0")/.."
NODE=/Users/zhang/.workbuddy/binaries/node/versions/22.22.2/bin/node
PORT=3457
SMOKE_DB="${WTMS_SMOKE_DB_NAME:-wtms_smoke}"
BASE="http://localhost:$PORT"
TMP=$(mktemp -d)
TODAY=$(date +%F)
PASS=0; FAIL=0

say()  { echo "[smoke] $*"; }
ok()   { PASS=$((PASS+1)); echo "  ✓ $*"; }
bad()  { FAIL=$((FAIL+1)); echo "  ✗ $*"; }

# 期望断言：expect <名称> <期望http码> <实际http码> [响应体]
expect() {
  local name="$1" want="$2" got="$3" body="${4:-}"
  if [ "$want" = "$got" ]; then ok "${name}（HTTP ${got}）${body:+ → ${body}}"
  else bad "${name}：期望 HTTP ${want}，实际 ${got} → ${body}"; fi
}

# 登录并完成首登改密（演示账号 must_change_password=1）
# login_and_chpwd <jar> <username> <新密码>
login_and_chpwd() {
  local jar="$1" user="$2" newpwd="$3"
  R=$(J -c "$jar" -X POST "$BASE/api/auth/login" -H 'Content-Type: application/json' \
       -d "{\"username\":\"$user\",\"password\":\"12345678\"}")
  expect "$user 登录" 200 "$(echo "$R" | tail -1)"
  R=$(J -b "$jar" -X PUT "$BASE/api/auth/password" -H 'Content-Type: application/json' \
       -d "{\"oldPassword\":\"12345678\",\"newPassword\":\"$newpwd\"}")
  expect "$user 首登改密" 200 "$(echo "$R" | tail -1)"
}

J() { curl -s -w $'\n%{http_code}' "$@"; }

# ---------- 准备独立测试库（仅当 mysql CLI 可用时自动初始化） ----------
if command -v mysql >/dev/null 2>&1; then
  say "检测 mysql CLI，自动初始化测试库 $SMOKE_DB（CREATE DATABASE + 加载 init.sql DDL/种子）"
  mysql -u root <<SQL
CREATE USER IF NOT EXISTS 'wtms'@'%' IDENTIFIED BY 'wtms123456';
CREATE DATABASE IF NOT EXISTS \`$SMOKE_DB\` CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci;
GRANT SELECT, INSERT, UPDATE, DELETE, INDEX, REFERENCES, CREATE, DROP, ALTER ON \`$SMOKE_DB\`.* TO 'wtms'@'%';
FLUSH PRIVILEGES;
SQL
  # 去掉 init.sql 里的建库/建用户/授权语句，仅加载 DDL + 种子到测试库
  grep -vE '^(CREATE DATABASE|USE |CREATE USER|GRANT |FLUSH PRIVILEGES)' scripts/init.sql | mysql -u root "$SMOKE_DB"
else
  echo "[smoke] 未找到 mysql CLI，假定测试库 $SMOKE_DB 已由您手动初始化（建表+种子见 scripts/init.sql）。" >&2
fi

# ---------- 注入数据库连接环境变量（与 config.js 一致），并指定独立端口 ----------
export DB_HOST="${DB_HOST:-127.0.0.1}"
export DB_PORT="${DB_PORT:-3306}"
export DB_USER="${DB_USER:-wtms}"
export DB_PASSWORD="${DB_PASSWORD:-wtms123456}"
export DB_NAME="$SMOKE_DB"
export PORT=$PORT

# ---------- 启动服务 ----------
PORT=$PORT $NODE server.js > "$TMP/server.log" 2>&1 &
SRV=$!
sleep 2

if ! curl -s -o /dev/null "$BASE/api/auth/login"; then
  echo "[smoke] 服务启动失败，查看 $TMP/server.log"; kill $SRV 2>/dev/null; exit 1
fi
say "服务已启动（PID ${SRV}）"

# ---------- 登录（含首登强制改密闭环） ----------
login_and_chpwd "$TMP/dev1.jar" dev1 "smoke-dev1-9"

# ---------- 填报校验链 ----------
R=$(J -b "$TMP/dev1.jar" -X POST "$BASE/api/timesheets" -H 'Content-Type: application/json' -d "{\"projectId\":1,\"date\":\"2099-01-01\",\"hours\":7,\"content\":\"未来\"}")
expect "未来日期 400 拦截(FUTURE_DATE)" 400 "$(echo "$R" | tail -1)" "$(echo "$R" | head -1)"

R=$(J -b "$TMP/dev1.jar" -X POST "$BASE/api/timesheets" -H 'Content-Type: application/json' -d "{\"projectId\":1,\"date\":\"$TODAY\",\"hours\":7,\"content\":\"\"}")
expect "工作内容为空 400 拦截(VALIDATION_ERROR)" 400 "$(echo "$R" | tail -1)"

R=$(J -b "$TMP/dev1.jar" -X POST "$BASE/api/timesheets" -H 'Content-Type: application/json' -d "{\"projectId\":1,\"date\":\"$TODAY\",\"hours\":25,\"content\":\"单条超24\"}")
expect "单条工时>24 400 拦截" 400 "$(echo "$R" | tail -1)"

# dev1 当日已有种子 7 小时 → 再填 18 小时合计 25 → HOURS_EXCEEDED
R=$(J -b "$TMP/dev1.jar" -X POST "$BASE/api/timesheets" -H 'Content-Type: application/json' -d "{\"projectId\":1,\"date\":\"$TODAY\",\"hours\":18,\"content\":\"当日合计超24\"}")
expect "当日合计>24 400 拦截(HOURS_EXCEEDED)" 400 "$(echo "$R" | tail -1)" "$(echo "$R" | head -1)"

# 非项目成员填报 → 403 NOT_MEMBER
R=$(J -b "$TMP/dev1.jar" -X POST "$BASE/api/timesheets" -H 'Content-Type: application/json' -d "{\"projectId\":2,\"date\":\"$TODAY\",\"hours\":1,\"content\":\"非成员项目\"}")
expect "非项目成员 403 拦截(NOT_MEMBER)" 403 "$(echo "$R" | tail -1)" "$(echo "$R" | head -1)"

# ---------- 正常填报（草稿→提交） ----------
R=$(J -b "$TMP/dev1.jar" -X POST "$BASE/api/timesheets" -H 'Content-Type: application/json' -d "{\"projectId\":1,\"date\":\"$TODAY\",\"hours\":2,\"content\":\"冒烟-新功能开发\"}")
expect "当天填报草稿 201" 201 "$(echo "$R" | tail -1)"
TS_ID=$(echo "$R" | head -1 | "$NODE" -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{console.log(JSON.parse(s).record.id)})")

R=$(J -b "$TMP/dev1.jar" -X POST "$BASE/api/timesheets/$TS_ID/submit")
expect "提交待审核" 200 "$(echo "$R" | tail -1)"

R=$(J -b "$TMP/dev1.jar" -X POST "$BASE/api/timesheets/$TS_ID/submit")
expect "重复提交幂等 200" 200 "$(echo "$R" | tail -1)"

# ---------- PM 登录并审核 ----------
login_and_chpwd "$TMP/pm1.jar" pm1 "smoke-pm1-9"

R=$(J -b "$TMP/pm1.jar" -X POST "$BASE/api/timesheets/$TS_ID/approve")
expect "PM 审核通过" 200 "$(echo "$R" | tail -1)"

R=$(J -b "$TMP/pm1.jar" -X POST "$BASE/api/timesheets/$TS_ID/approve")
expect "重复审核幂等 200" 200 "$(echo "$R" | tail -1)"

# ---------- 自审 403：pm1 提交自己项目工时后自审 ----------
R=$(J -b "$TMP/pm1.jar" -X POST "$BASE/api/timesheets" -H 'Content-Type: application/json' -d "{\"projectId\":1,\"date\":\"$TODAY\",\"hours\":1,\"content\":\"冒烟-PM自己的记录\",\"submit\":true}")
PM_TS=$(echo "$R" | head -1 | "$NODE" -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{console.log(JSON.parse(s).record.id)})")
R=$(J -b "$TMP/pm1.jar" -X POST "$BASE/api/timesheets/$PM_TS/approve")
expect "PM 自审 403 拦截(SELF_AUDIT_FORBIDDEN)" 403 "$(echo "$R" | tail -1)" "$(echo "$R" | head -1)"

# ---------- 批量审核：混入 PM 本人记录 → skipped ----------
R=$(J -b "$TMP/pm1.jar" "$BASE/api/audit/list?status=submitted&projectId=1")
IDS=$(echo "$R" | head -1 | "$NODE" -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const a=JSON.parse(s);console.log(JSON.stringify(a.map(x=>x.id)))})")
say "批量审核目标 ids: $IDS"
R=$(J -b "$TMP/pm1.jar" -X POST "$BASE/api/audit/batch" -H 'Content-Type: application/json' -d "{\"ids\":$IDS,\"action\":\"approve\"}")
SUMMARY=$(echo "$R" | head -1 | "$NODE" -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const r=JSON.parse(s);console.log('ok='+r.summary.ok+' skipped='+r.summary.skipped+' conflict='+r.summary.conflict)})")
expect "批量审核 200（本人记录自动跳过）" 200 "$(echo "$R" | tail -1)" "$SUMMARY"

# ---------- admin 代审 PM 记录 ----------
login_and_chpwd "$TMP/admin.jar" admin "smoke-admin-9"
R=$(J -b "$TMP/admin.jar" -X POST "$BASE/api/timesheets/$PM_TS/approve")
expect "admin 代审 PM 本人记录" 200 "$(echo "$R" | tail -1)"

# ---------- 统计接口（口径同源） ----------
R=$(J -b "$TMP/admin.jar" "$BASE/api/stats/project?projectId=1&month=$(date +%Y-%m)&scope=all")
expect "统计矩阵接口" 200 "$(echo "$R" | tail -1)"

# ---------- 会话与安全 ----------
R=$(J "$BASE/api/timesheets")
expect "未登录 401" 401 "$(echo "$R" | tail -1)"

# ---------- 重启验证持久化 + 会话落库 ----------
BEFORE=$(J -b "$TMP/dev1.jar" "$BASE/api/timesheets" | head -1 | "$NODE" -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{console.log('count='+JSON.parse(s).length)})")
say "重启前记录数: $BEFORE"
kill $SRV; sleep 1
PORT=$PORT $NODE server.js > "$TMP/server2.log" 2>&1 &
SRV=$!
sleep 2

R=$(J -b "$TMP/dev1.jar" "$BASE/api/timesheets")
AFTER=$(echo "$R" | head -1 | "$NODE" -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{console.log('count='+JSON.parse(s).length)})")
if [ "$BEFORE" = "$AFTER" ] && [ "$(echo "$AFTER" | cut -d= -f2)" -gt 0 ]; then
  ok "重启后数据完整（${AFTER}）"
else
  bad "重启后数据不一致：${BEFORE} → ${AFTER}"
fi
expect "重启后会话不掉线（会话落库）" 200 "$(echo "$R" | tail -1)"

# ---------- 登出后会话失效 ----------
R=$(J -b "$TMP/dev1.jar" -c "$TMP/dev1.jar" -X POST "$BASE/api/auth/logout")
expect "登出" 200 "$(echo "$R" | tail -1)"
R=$(J -b "$TMP/dev1.jar" "$BASE/api/timesheets")
expect "登出后访问 401" 401 "$(echo "$R" | tail -1)"

kill $SRV 2>/dev/null
echo
echo "================ 冒烟结果：PASS=$PASS FAIL=$FAIL ================"
if [ "$FAIL" -eq 0 ]; then echo "SMOKE: PASS"; else echo "SMOKE: FAIL"; exit 1; fi
