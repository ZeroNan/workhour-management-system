-- ============================================================
-- 工时管理系统 · MySQL 初始化脚本
-- ============================================================
-- 适用：MySQL 8.0+（8.0.16+ 支持 CHECK 约束；5.7 会忽略 CHECK，不影响建表）
-- 用法（以具有建库/建用户权限的账号，如 root 执行）：
--   mysql -h 127.0.0.1 -P 3306 -u root -p < scripts/init.sql
--
-- 脚本会依次完成：
--   1) 建库（utf8mb4 / 通用大小写不敏感排序）
--   2) 创建应用专用账号 wtms / wtms123456 并授权
--   3) 建表（departments / users / projects / project_members / timesheets / sessions / app_meta）
--   4) 写入基础数据：3 个部门、9 个账号、2 个项目及成员关系、演示工时
--
-- 说明：演示账号初始密码统一为 12345678，且 must_change_password=1（首次登录需改密）。
-- 演示密码哈希采用与后端一致的 scrypt 算法预生成，保证可直接登录。
-- 重复执行会先 DROP 已有表再重建（会清空数据），如需保留数据请勿重复执行。
-- ============================================================

CREATE DATABASE IF NOT EXISTS wtms
  DEFAULT CHARACTER SET utf8mb4
  DEFAULT COLLATE utf8mb4_general_ci;
USE wtms;

-- 应用专用账号（如已存在则不重复创建）
CREATE USER IF NOT EXISTS 'wtms'@'%' IDENTIFIED BY 'wtms123456';
GRANT SELECT, INSERT, UPDATE, DELETE, INDEX, REFERENCES, CREATE, DROP, ALTER ON wtms.* TO 'wtms'@'%';
FLUSH PRIVILEGES;

SET NAMES utf8mb4;

-- 演示数据基准日期：相对“今天”的最近三天，确保不会是未来日期
SET @d1 = DATE_SUB(CURDATE(), INTERVAL 2 DAY);
SET @d2 = DATE_SUB(CURDATE(), INTERVAL 1 DAY);
SET @d3 = CURDATE();

-- ========================= 表结构 =========================
-- 删除顺序：先子表后父表，避免外键约束报错
DROP TABLE IF EXISTS timesheets;
DROP TABLE IF EXISTS project_members;
DROP TABLE IF EXISTS sessions;
DROP TABLE IF EXISTS projects;
DROP TABLE IF EXISTS users;
DROP TABLE IF EXISTS departments;
DROP TABLE IF EXISTS app_meta;

CREATE TABLE departments (
  id   INT PRIMARY KEY AUTO_INCREMENT,
  name VARCHAR(50) NOT NULL UNIQUE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE users (
  id                   INT PRIMARY KEY AUTO_INCREMENT,
  username             VARCHAR(50) NOT NULL UNIQUE,
  password_hash        VARCHAR(255) NOT NULL,
  name                 VARCHAR(50) NOT NULL,
  role                 VARCHAR(10) NOT NULL,
  dept_id              INT,
  must_change_password TINYINT NOT NULL DEFAULT 0,
  failed_attempts      INT NOT NULL DEFAULT 0,
  locked_until         BIGINT,
  created_at           VARCHAR(32) NOT NULL,
  CONSTRAINT fk_user_dept   FOREIGN KEY (dept_id) REFERENCES departments(id),
  CONSTRAINT chk_user_role CHECK (role IN ('admin','pm','dev'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE projects (
  id         INT PRIMARY KEY AUTO_INCREMENT,
  name       VARCHAR(100) NOT NULL UNIQUE,
  owner_id   INT NOT NULL,
  created_at VARCHAR(32) NOT NULL,
  CONSTRAINT fk_proj_owner FOREIGN KEY (owner_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE project_members (
  project_id INT NOT NULL,
  user_id    INT NOT NULL,
  PRIMARY KEY (project_id, user_id),
  CONSTRAINT fk_pm_proj FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  CONSTRAINT fk_pm_user FOREIGN KEY (user_id)    REFERENCES users(id)    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE timesheets (
  id            INT PRIMARY KEY AUTO_INCREMENT,
  user_id       INT NOT NULL,
  dept_id       INT,
  project_id    INT NOT NULL,
  `date`        VARCHAR(10) NOT NULL,
  hours         DECIMAL(5,2) NOT NULL,
  content       TEXT NOT NULL,
  status        VARCHAR(20) NOT NULL DEFAULT 'draft',
  submit_time   VARCHAR(32),
  audit_time    VARCHAR(32),
  auditor_id    INT,
  audit_comment TEXT NOT NULL DEFAULT '',
  created_at    VARCHAR(32) NOT NULL,
  updated_at    VARCHAR(32) NOT NULL,
  CONSTRAINT fk_ts_user     FOREIGN KEY (user_id)   REFERENCES users(id),
  CONSTRAINT fk_ts_dept     FOREIGN KEY (dept_id)   REFERENCES departments(id),
  CONSTRAINT fk_ts_proj     FOREIGN KEY (project_id) REFERENCES projects(id),
  CONSTRAINT fk_ts_auditor  FOREIGN KEY (auditor_id) REFERENCES users(id),
  CONSTRAINT chk_ts_status  CHECK (status IN ('draft','submitted','approved','rejected')),
  CONSTRAINT chk_ts_hours   CHECK (hours > 0 AND hours <= 24)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE sessions (
  token          VARCHAR(64) PRIMARY KEY,
  user_id        INT NOT NULL,
  created_at     BIGINT NOT NULL,
  last_active_at BIGINT NOT NULL,
  expires_at     BIGINT NOT NULL,
  CONSTRAINT fk_sess_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE app_meta (
  `key`   VARCHAR(50) PRIMARY KEY,
  value   TEXT NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE INDEX idx_ts_user_date    ON timesheets(user_id, `date`);
CREATE INDEX idx_ts_project_date ON timesheets(project_id, `date`);
CREATE INDEX idx_ts_status       ON timesheets(status);
CREATE INDEX idx_sessions_expires ON sessions(expires_at);

-- ========================= 基础数据 =========================
-- 部门（字典数据）
INSERT INTO departments (id, name) VALUES
  (1, '研发一部'),
  (2, '研发二部'),
  (3, '测试部');

-- 账号（演示密码统一 12345678；密码哈希为 scrypt 预生成值，与后端算法一致）
-- must_change_password=1：首次登录强制改密
INSERT INTO users (id, username, password_hash, name, role, dept_id, must_change_password, failed_attempts, locked_until, created_at) VALUES
  (1, 'admin', 'scrypt$16384$8$1$48db25bd3316ff9cdeef1003cb6f24d8$f29cfb202553023a998c58c2b63356af5fa3700c1d9b0891373f2da126104c405c3bdf2aa5d6488d83aa0caf97dc0ae9990b61f4924b9afbfae6477d6592ed60', '系统管理员', 'admin', NULL, 1, 0, NULL, '2026-09-03 09:00'),
  (2, 'pm1',   'scrypt$16384$8$1$48db25bd3316ff9cdeef1003cb6f24d8$f29cfb202553023a998c58c2b63356af5fa3700c1d9b0891373f2da126104c405c3bdf2aa5d6488d83aa0caf97dc0ae9990b61f4924b9afbfae6477d6592ed60', '王负责人',   'pm',   1, 1, 0, NULL, '2026-09-03 09:00'),
  (3, 'pm2',   'scrypt$16384$8$1$48db25bd3316ff9cdeef1003cb6f24d8$f29cfb202553023a998c58c2b63356af5fa3700c1d9b0891373f2da126104c405c3bdf2aa5d6488d83aa0caf97dc0ae9990b61f4924b9afbfae6477d6592ed60', '李负责人',   'pm',   2, 1, 0, NULL, '2026-09-03 09:00'),
  (4, 'dev1',  'scrypt$16384$8$1$48db25bd3316ff9cdeef1003cb6f24d8$f29cfb202553023a998c58c2b63356af5fa3700c1d9b0891373f2da126104c405c3bdf2aa5d6488d83aa0caf97dc0ae9990b61f4924b9afbfae6477d6592ed60', '张开发',     'dev',  1, 1, 0, NULL, '2026-09-03 09:00'),
  (5, 'dev2',  'scrypt$16384$8$1$48db25bd3316ff9cdeef1003cb6f24d8$f29cfb202553023a998c58c2b63356af5fa3700c1d9b0891373f2da126104c405c3bdf2aa5d6488d83aa0caf97dc0ae9990b61f4924b9afbfae6477d6592ed60', '刘开发',     'dev',  1, 1, 0, NULL, '2026-09-03 09:00'),
  (6, 'dev3',  'scrypt$16384$8$1$48db25bd3316ff9cdeef1003cb6f24d8$f29cfb202553023a998c58c2b63356af5fa3700c1d9b0891373f2da126104c405c3bdf2aa5d6488d83aa0caf97dc0ae9990b61f4924b9afbfae6477d6592ed60', '陈开发',     'dev',  2, 1, 0, NULL, '2026-09-03 09:00'),
  (7, 'dev4',  'scrypt$16384$8$1$48db25bd3316ff9cdeef1003cb6f24d8$f29cfb202553023a998c58c2b63356af5fa3700c1d9b0891373f2da126104c405c3bdf2aa5d6488d83aa0caf97dc0ae9990b61f4924b9afbfae6477d6592ed60', '赵开发',     'dev',  2, 1, 0, NULL, '2026-09-03 09:00'),
  (8, 'dev5',  'scrypt$16384$8$1$48db25bd3316ff9cdeef1003cb6f24d8$f29cfb202553023a998c58c2b63356af5fa3700c1d9b0891373f2da126104c405c3bdf2aa5d6488d83aa0caf97dc0ae9990b61f4924b9afbfae6477d6592ed60', '孙测试',     'dev',  3, 1, 0, NULL, '2026-09-03 09:00'),
  (9, 'dev6',  'scrypt$16384$8$1$48db25bd3316ff9cdeef1003cb6f24d8$f29cfb202553023a998c58c2b63356af5fa3700c1d9b0891373f2da126104c405c3bdf2aa5d6488d83aa0caf97dc0ae9990b61f4924b9afbfae6477d6592ed60', '周测试',     'dev',  3, 1, 0, NULL, '2026-09-03 09:00');

-- 项目（owner 自动并入成员）
INSERT INTO projects (id, name, owner_id, created_at) VALUES
  (1, '电商平台', 2, '2026-09-03 09:00'),
  (2, 'AI中台',   3, '2026-09-03 09:00');

-- 项目成员关系
INSERT INTO project_members (project_id, user_id) VALUES
  (1, 2), (1, 4), (1, 5), (1, 8),
  (2, 3), (2, 6), (2, 7), (2, 9);

-- 演示工时（最近三天）：d1 全部已通过、d2 全部待审核、d3 含草稿/退回等多样状态
INSERT INTO timesheets (user_id, dept_id, project_id, `date`, hours, content, status, submit_time, audit_time, auditor_id, audit_comment, created_at, updated_at) VALUES
  -- 电商平台（项目 1）
  (2, 1, 1, @d1, 7.00, '项目计划制定与任务拆分', 'approved', CONCAT(@d1,' 18:00'), CONCAT(@d1,' 20:00'), 1, '', CONCAT(@d1,' 18:00'), CONCAT(@d1,' 18:00')),
  (4, 1, 1, @d1, 7.00, '需求评审与开发方案设计', 'approved', CONCAT(@d1,' 18:00'), CONCAT(@d1,' 20:00'), 1, '', CONCAT(@d1,' 18:00'), CONCAT(@d1,' 18:00')),
  (5, 1, 1, @d1, 7.00, '核心功能开发与自测',       'approved', CONCAT(@d1,' 18:00'), CONCAT(@d1,' 20:00'), 1, '', CONCAT(@d1,' 18:00'), CONCAT(@d1,' 18:00')),
  (8, 3, 1, @d1, 7.00, '测试用例设计与执行',       'approved', CONCAT(@d1,' 18:00'), CONCAT(@d1,' 20:00'), 1, '', CONCAT(@d1,' 18:00'), CONCAT(@d1,' 18:00')),
  (2, 1, 1, @d2, 7.00, '进度跟踪与风险协调',     'submitted', CONCAT(@d2,' 18:00'), NULL, NULL, '', CONCAT(@d2,' 18:00'), CONCAT(@d2,' 18:00')),
  (4, 1, 1, @d2, 7.00, '接口联调与缺陷修复',     'submitted', CONCAT(@d2,' 18:00'), NULL, NULL, '', CONCAT(@d2,' 18:00'), CONCAT(@d2,' 18:00')),
  (5, 1, 1, @d2, 7.00, '代码评审与单测补全',     'submitted', CONCAT(@d2,' 18:00'), NULL, NULL, '', CONCAT(@d2,' 18:00'), CONCAT(@d2,' 18:00')),
  (8, 3, 1, @d2, 6.00, '自动化测试脚本编写',     'submitted', CONCAT(@d2,' 18:10'), NULL, NULL, '', CONCAT(@d2,' 18:10'), CONCAT(@d2,' 18:10')),
  -- AI中台（项目 2）
  (3, 2, 2, @d1, 7.00, '项目计划制定与任务拆分', 'approved', CONCAT(@d1,' 18:00'), CONCAT(@d1,' 20:00'), 1, '', CONCAT(@d1,' 18:00'), CONCAT(@d1,' 18:00')),
  (6, 2, 2, @d1, 7.00, '模型调研与方案设计',     'approved', CONCAT(@d1,' 18:00'), CONCAT(@d1,' 20:00'), 1, '', CONCAT(@d1,' 18:00'), CONCAT(@d1,' 18:00')),
  (7, 2, 2, @d1, 7.00, '数据管线搭建',           'approved', CONCAT(@d1,' 18:00'), CONCAT(@d1,' 20:00'), 1, '', CONCAT(@d1,' 18:00'), CONCAT(@d1,' 18:00')),
  (9, 3, 2, @d1, 7.00, '测试策略制定',           'approved', CONCAT(@d1,' 18:00'), CONCAT(@d1,' 20:00'), 1, '', CONCAT(@d1,' 18:00'), CONCAT(@d1,' 18:00')),
  (3, 2, 2, @d2, 7.00, '进度跟踪与风险协调',     'submitted', CONCAT(@d2,' 18:00'), NULL, NULL, '', CONCAT(@d2,' 18:00'), CONCAT(@d2,' 18:00')),
  (6, 2, 2, @d2, 7.00, '模型微调实验',           'submitted', CONCAT(@d2,' 18:00'), NULL, NULL, '', CONCAT(@d2,' 18:00'), CONCAT(@d2,' 18:00')),
  (7, 2, 2, @d2, 7.00, '特征工程实现',           'submitted', CONCAT(@d2,' 18:00'), NULL, NULL, '', CONCAT(@d2,' 18:00'), CONCAT(@d2,' 18:00')),
  (9, 3, 2, @d2, 7.00, '回归测试执行',           'submitted', CONCAT(@d2,' 18:00'), NULL, NULL, '', CONCAT(@d2,' 18:00'), CONCAT(@d2,' 18:00')),
  -- d3 多样状态（草稿 / 退回），展示编辑与审核入口
  (4, 1, 1, @d3, 3.50, '核心功能开发与自测（上午）', 'draft', NULL, NULL, NULL, '', CONCAT(@d3,' 18:00'), CONCAT(@d3,' 18:00')),
  (4, 1, 1, @d3, 3.50, '核心功能开发与自测（下午）', 'draft', NULL, NULL, NULL, '', CONCAT(@d3,' 18:00'), CONCAT(@d3,' 18:00')),
  (5, 1, 1, @d3, 7.00, '缺陷修复与验证', 'rejected', CONCAT(@d3,' 09:00'), CONCAT(@d3,' 10:00'), 2, '工作内容描述过于简单，请补充具体任务后重新提交', CONCAT(@d3,' 09:00'), CONCAT(@d3,' 10:00'));

-- 元信息
INSERT INTO app_meta (`key`, value) VALUES ('seeded_at', NOW());

SELECT 'init done: wtms database initialized.' AS result;
