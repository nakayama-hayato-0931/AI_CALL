-- 育成ステータスシート
CREATE TABLE IF NOT EXISTS status_sheets (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id INT UNSIGNED NOT NULL,
  period_from DATE NOT NULL,
  period_to DATE NOT NULL,
  current_status JSON NOT NULL COMMENT '育成状況(summary, can_do, improvements, level)',
  training_plan JSON NOT NULL COMMENT '育成プラン(short_term, mid_term, long_term)',
  next_steps JSON NOT NULL COMMENT 'ネクストステップ(action, reason, deadline, success_criteria)',
  created_by INT UNSIGNED NOT NULL COMMENT '生成した管理者ID',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_status_sheets_user (user_id),
  INDEX idx_status_sheets_period (period_from, period_to),
  CONSTRAINT fk_status_sheets_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_status_sheets_created_by FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
