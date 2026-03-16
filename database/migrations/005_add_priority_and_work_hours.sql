-- 005: 優先オペレーター猶予期間 + 稼働時間テーブル

-- 架電猶予期間: 期間中は指定オペレーターのみピックアップ可能
ALTER TABLE companies
  ADD COLUMN priority_expires_at DATETIME DEFAULT NULL AFTER imported_by_user_id;

-- 稼働時間: オペレーターが手動で開始/終了時間を記録
CREATE TABLE IF NOT EXISTS work_hours (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id INT UNSIGNED NOT NULL,
  date DATE NOT NULL,
  start_time VARCHAR(5) NOT NULL,
  end_time VARCHAR(5) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_user_date (user_id, date),
  CONSTRAINT fk_work_hours_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
