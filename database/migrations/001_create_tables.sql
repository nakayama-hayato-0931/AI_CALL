-- ============================================
-- AIコールセンターCRM データベーススキーマ
-- 実行順序: このファイルを上から順に実行
-- ============================================

-- データベース作成
CREATE DATABASE IF NOT EXISTS callcenter_crm
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE callcenter_crm;

-- ============================================
-- ユーザーテーブル (オペレーター/管理者)
-- ============================================
CREATE TABLE IF NOT EXISTS users (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100) NOT NULL COMMENT 'ユーザー名',
  email VARCHAR(255) NOT NULL UNIQUE COMMENT 'メールアドレス',
  password_hash VARCHAR(255) NOT NULL COMMENT 'bcryptハッシュ化パスワード',
  role ENUM('admin', 'operator', 'manager') NOT NULL DEFAULT 'operator' COMMENT '権限ロール',
  is_active TINYINT(1) NOT NULL DEFAULT 1 COMMENT '有効フラグ',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_users_email (email),
  INDEX idx_users_role (role)
) ENGINE=InnoDB COMMENT='オペレーター・管理者';

-- ============================================
-- 企業テーブル (架電先リスト)
-- ============================================
CREATE TABLE IF NOT EXISTS companies (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  company_name VARCHAR(255) NOT NULL COMMENT '企業名',
  phone_number VARCHAR(20) NOT NULL COMMENT '電話番号',
  industry VARCHAR(100) DEFAULT NULL COMMENT '業種',
  region VARCHAR(100) DEFAULT NULL COMMENT '地域',
  address TEXT DEFAULT NULL COMMENT '住所',
  priority_score INT NOT NULL DEFAULT 0 COMMENT '優先スコア (高いほど優先)',
  exclusion_flag TINYINT(1) NOT NULL DEFAULT 0 COMMENT '除外フラグ',
  last_called_at DATETIME DEFAULT NULL COMMENT '最終架電日時',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_companies_phone (phone_number),
  INDEX idx_companies_industry (industry),
  INDEX idx_companies_priority (priority_score DESC),
  INDEX idx_companies_exclusion (exclusion_flag)
) ENGINE=InnoDB COMMENT='架電先企業';

-- ============================================
-- 通話テーブル (架電履歴)
-- ============================================
CREATE TABLE IF NOT EXISTS calls (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id INT UNSIGNED NOT NULL COMMENT 'オペレーターID',
  company_id INT UNSIGNED NOT NULL COMMENT '企業ID',
  call_started_at DATETIME NOT NULL COMMENT '架電開始日時',
  call_ended_at DATETIME DEFAULT NULL COMMENT '架電終了日時',
  result_code ENUM('NO_ANSWER', 'NG', 'RECALL', 'INTERESTED', 'PROJECT') DEFAULT NULL COMMENT '通話結果コード',
  memo TEXT DEFAULT NULL COMMENT 'メモ',
  recall_at DATETIME DEFAULT NULL COMMENT 'リコール予定日時',
  is_effective_connection TINYINT(1) NOT NULL DEFAULT 0 COMMENT '有効接続フラグ',
  is_person_in_charge TINYINT(1) NOT NULL DEFAULT 0 COMMENT '担当者接続フラグ',
  is_project_created TINYINT(1) NOT NULL DEFAULT 0 COMMENT '案件化フラグ',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_calls_user (user_id),
  INDEX idx_calls_company (company_id),
  INDEX idx_calls_result (result_code),
  INDEX idx_calls_started (call_started_at),
  INDEX idx_calls_recall (recall_at),
  CONSTRAINT fk_calls_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT,
  CONSTRAINT fk_calls_company FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT
) ENGINE=InnoDB COMMENT='通話履歴';

-- ============================================
-- 案件テーブル (PROJECT化された商談)
-- ============================================
CREATE TABLE IF NOT EXISTS projects (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  company_id INT UNSIGNED NOT NULL COMMENT '企業ID',
  created_call_id INT UNSIGNED DEFAULT NULL COMMENT '案件化した通話ID',
  owner_user_id INT UNSIGNED NOT NULL COMMENT '担当オペレーターID',
  interview_date DATETIME DEFAULT NULL COMMENT '面接日時',
  interview_type ENUM('online', 'in_person') DEFAULT NULL COMMENT '面接形式',
  document_screening ENUM('required', 'not_required') DEFAULT NULL COMMENT '書類選考',
  mail_sent TINYINT(1) NOT NULL DEFAULT 0 COMMENT 'メール送信済み',
  status ENUM('NEW', 'MAIL_SENT', 'INTERVIEW_SET', 'INTERVIEW_DONE', 'WAITING_RESULT', 'HIRED', 'LOST') NOT NULL DEFAULT 'NEW' COMMENT '案件ステータス',
  memo TEXT DEFAULT NULL COMMENT 'メモ',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_projects_company (company_id),
  INDEX idx_projects_owner (owner_user_id),
  INDEX idx_projects_status (status),
  INDEX idx_projects_created (created_at DESC),
  CONSTRAINT fk_projects_company FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT,
  CONSTRAINT fk_projects_call FOREIGN KEY (created_call_id) REFERENCES calls(id) ON DELETE SET NULL,
  CONSTRAINT fk_projects_owner FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE RESTRICT
) ENGINE=InnoDB COMMENT='案件管理';

-- ============================================
-- リコールタスクテーブル
-- ============================================
CREATE TABLE IF NOT EXISTS recall_tasks (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  call_id INT UNSIGNED NOT NULL COMMENT '元通話ID',
  company_id INT UNSIGNED NOT NULL COMMENT '企業ID',
  user_id INT UNSIGNED NOT NULL COMMENT '担当オペレーターID',
  recall_at DATETIME NOT NULL COMMENT 'リコール予定日時',
  status ENUM('pending', 'completed', 'overdue', 'cancelled') NOT NULL DEFAULT 'pending' COMMENT 'リコール状態',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_recall_user (user_id),
  INDEX idx_recall_at (recall_at),
  INDEX idx_recall_status (status),
  CONSTRAINT fk_recall_call FOREIGN KEY (call_id) REFERENCES calls(id) ON DELETE RESTRICT,
  CONSTRAINT fk_recall_company FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT,
  CONSTRAINT fk_recall_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT
) ENGINE=InnoDB COMMENT='リコールタスク';

-- ============================================
-- AI通話評価テーブル
-- ============================================
CREATE TABLE IF NOT EXISTS ai_evaluations (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id INT UNSIGNED NOT NULL COMMENT 'オペレーターID',
  call_id INT UNSIGNED NOT NULL COMMENT '通話ID',
  overall_score INT DEFAULT NULL COMMENT '総合スコア (0-100)',
  opening_score INT DEFAULT NULL COMMENT '第一声スコア (0-100)',
  clarity_score INT DEFAULT NULL COMMENT '明瞭さスコア (0-100)',
  hearing_score INT DEFAULT NULL COMMENT 'ヒアリングスコア (0-100)',
  rebuttal_score INT DEFAULT NULL COMMENT '切り返しスコア (0-100)',
  closing_score INT DEFAULT NULL COMMENT 'クロージングスコア (0-100)',
  summary TEXT DEFAULT NULL COMMENT '通話要約',
  good_points TEXT DEFAULT NULL COMMENT '良かった点',
  improvement_points TEXT DEFAULT NULL COMMENT '改善点',
  next_improvement TEXT DEFAULT NULL COMMENT '次回改善ポイント',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_eval_user (user_id),
  INDEX idx_eval_call (call_id),
  CONSTRAINT fk_eval_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT,
  CONSTRAINT fk_eval_call FOREIGN KEY (call_id) REFERENCES calls(id) ON DELETE RESTRICT
) ENGINE=InnoDB COMMENT='AI通話評価';

-- ============================================
-- 業種別ゴールデンタイムルール
-- ============================================
CREATE TABLE IF NOT EXISTS industry_time_rules (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  industry_name VARCHAR(100) NOT NULL COMMENT '業種名',
  start_time TIME NOT NULL COMMENT '開始時刻',
  end_time TIME NOT NULL COMMENT '終了時刻',
  priority_weight INT NOT NULL DEFAULT 10 COMMENT '優先度重み',
  INDEX idx_rules_industry (industry_name)
) ENGINE=InnoDB COMMENT='業種別ゴールデンタイム';

-- ============================================
-- 初期データ: 業種別ゴールデンタイム
-- ============================================
INSERT INTO industry_time_rules (industry_name, start_time, end_time, priority_weight) VALUES
  ('飲食', '10:00:00', '11:30:00', 20),
  ('飲食', '15:00:00', '17:00:00', 15),
  ('製造', '09:00:00', '11:00:00', 20),
  ('製造', '14:00:00', '16:00:00', 15),
  ('小売', '11:00:00', '13:00:00', 20),
  ('小売', '16:00:00', '18:00:00', 15);

-- ============================================
-- 初期データ: 管理者ユーザー
-- パスワード: admin123 (bcryptハッシュ)
-- 本番運用時は必ず変更してください
-- ============================================
INSERT INTO users (name, email, password_hash, role) VALUES
  ('管理者', 'admin@example.com', '$2b$10$8K1p/a0dL1LXMIgoEDFrwOfMQkT.RZfL1IdBCemO3vGKCVjnZPGlG', 'admin');
