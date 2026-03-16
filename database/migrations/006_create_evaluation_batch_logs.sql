-- 006: AI評価バッチログテーブル（日次評価回数制限用）

CREATE TABLE IF NOT EXISTS evaluation_batch_logs (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id INT UNSIGNED NOT NULL,
  evaluated_date DATE NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_user_date (user_id, evaluated_date),
  CONSTRAINT fk_eval_batch_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
