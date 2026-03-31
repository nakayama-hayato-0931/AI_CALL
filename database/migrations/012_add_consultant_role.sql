-- コンサルタントロール追加（読み取り専用マネージャー）
ALTER TABLE users MODIFY COLUMN role ENUM('admin', 'operator', 'manager', 'sales', 'consultant') NOT NULL DEFAULT 'operator';
