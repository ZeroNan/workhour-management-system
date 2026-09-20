-- ============================================================
-- 工时管理系统 · WPS / 开放集成接口 数据库迁移
-- 适用库：workhour（远端 MySQL 8.0+）
-- 执行方式（在能连库的机器上）：
--   mysql -h 120.46.49.174 -P 13306 -u db_workhour_admin -p workhour < scripts/migrate-integration.sql
-- 或经应用服务器：
--   mysql -h 120.46.49.174 -P 13306 -u db_workhour_admin -p workhour < scripts/migrate-integration.sql
-- 说明：本脚本仅新增列/表，不改动既有数据；可重复执行（幂等）。
-- ============================================================

-- 1) users 增加工号列（WPS 按工号匹配员工；NULL 表示未登记工号）
--    MySQL 中 UNIQUE 允许多个 NULL，故存量用户不受影响。
ALTER TABLE users
  ADD COLUMN employee_no VARCHAR(50) NULL UNIQUE
  AFTER username;

-- 2) api_keys：开放接口密钥（仅存 SHA-256 哈希，明文不落库）
CREATE TABLE IF NOT EXISTS api_keys (
  id          INT PRIMARY KEY AUTO_INCREMENT,
  key_hash    VARCHAR(64) NOT NULL UNIQUE,
  name        VARCHAR(100) NOT NULL,
  status      VARCHAR(10) NOT NULL DEFAULT 'active',
  rate_limit  INT NOT NULL DEFAULT 120,            -- 每分钟请求上限
  created_at  VARCHAR(32) NOT NULL,
  last_used_at VARCHAR(32),
  revoked_at  VARCHAR(32),
  CONSTRAINT chk_key_status CHECK (status IN ('active','revoked'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- 3) sync_idempotency：幂等去重（同一 Idempotency-Key 重复提交返回首次结果）
CREATE TABLE IF NOT EXISTS sync_idempotency (
  idem_key      VARCHAR(128) NOT NULL,
  key_id        INT NOT NULL,
  body_hash     CHAR(64) NOT NULL,
  response_code INT NOT NULL,
  response_body MEDIUMTEXT NOT NULL,
  created_at    VARCHAR(32) NOT NULL,
  PRIMARY KEY (idem_key),
  CONSTRAINT fk_idem_key FOREIGN KEY (key_id) REFERENCES api_keys(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- 4) sync_log：调用审计/监控日志
CREATE TABLE IF NOT EXISTS sync_log (
  id          BIGINT PRIMARY KEY AUTO_INCREMENT,
  key_id      INT NOT NULL,
  status      VARCHAR(10) NOT NULL,                -- success / fail
  error_code  VARCHAR(32),
  accepted    INT NOT NULL DEFAULT 0,              -- 成功入库的工时条数
  client_ip   VARCHAR(64),
  duration_ms INT,
  created_at  VARCHAR(32) NOT NULL,
  INDEX idx_sync_log_created (created_at),
  CONSTRAINT fk_log_key FOREIGN KEY (key_id) REFERENCES api_keys(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- 5)（可选）为存量员工补全工号：将 employee_no 设为 username，便于 WPS 按工号对接
--    如不需要，可整段注释掉。仅当确认 username 即工号时启用。
-- UPDATE users SET employee_no = username WHERE employee_no IS NULL;
