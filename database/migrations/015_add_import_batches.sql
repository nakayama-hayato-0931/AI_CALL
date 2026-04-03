-- インポートバッチ管理テーブル
CREATE TABLE IF NOT EXISTS import_batches (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  list_type ENUM('special','calllist') NOT NULL DEFAULT 'special',
  total_count INT UNSIGNED DEFAULT 0,
  created_by INT UNSIGNED,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- companiesにバッチID追加
ALTER TABLE companies ADD COLUMN import_batch_id INT UNSIGNED DEFAULT NULL;
