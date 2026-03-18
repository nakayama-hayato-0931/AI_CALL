-- 内定者情報テーブル
CREATE TABLE IF NOT EXISTS project_hires (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  project_id INT UNSIGNED NOT NULL COMMENT '案件ID',
  registration_number VARCHAR(50) DEFAULT NULL COMMENT '登録番号 (例: AB1234)',
  course ENUM('国内', '転職', '海外') NOT NULL DEFAULT '国内' COMMENT 'コース',
  initial_payment INT UNSIGNED DEFAULT NULL COMMENT '初回入金 (円)',
  expected_revenue INT UNSIGNED DEFAULT NULL COMMENT '見込売上 (円)',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_project_hires_project (project_id),
  CONSTRAINT fk_project_hires_project FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
) ENGINE=InnoDB COMMENT='内定者情報';
