-- 在应用连接的数据库执行一次；保留全部现有数据。已包含此列的新库无需执行。
ALTER TABLE users ADD COLUMN sort_order INT NOT NULL DEFAULT 0 AFTER dept_id;
