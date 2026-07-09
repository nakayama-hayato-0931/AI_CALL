-- ============================================
-- Railway MySQL 初期セットアップ (全マイグレーション統合)
-- ============================================

-- ユーザーテーブル
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

-- 企業テーブル
CREATE TABLE IF NOT EXISTS companies (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  company_name VARCHAR(255) NOT NULL COMMENT '企業名',
  phone_number VARCHAR(20) NOT NULL COMMENT '電話番号',
  industry VARCHAR(100) DEFAULT NULL COMMENT '業種',
  job_type VARCHAR(255) DEFAULT NULL COMMENT '職種',
  comment TEXT DEFAULT NULL COMMENT 'コメント',
  region VARCHAR(100) DEFAULT NULL COMMENT '地域',
  address TEXT DEFAULT NULL COMMENT '住所',
  priority_score INT NOT NULL DEFAULT 0 COMMENT '優先スコア',
  exclusion_flag TINYINT(1) NOT NULL DEFAULT 0 COMMENT '除外フラグ',
  last_called_at DATETIME DEFAULT NULL COMMENT '最終架電日時',
  locked_by_user_id INT UNSIGNED DEFAULT NULL COMMENT 'ロック中のオペレーターID',
  locked_at DATETIME DEFAULT NULL COMMENT 'ロック取得日時',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_companies_phone (phone_number),
  INDEX idx_companies_industry (industry),
  INDEX idx_companies_priority (priority_score DESC),
  INDEX idx_companies_exclusion (exclusion_flag),
  INDEX idx_companies_locked (locked_by_user_id)
) ENGINE=InnoDB COMMENT='架電先企業';

-- 通話テーブル
CREATE TABLE IF NOT EXISTS calls (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id INT UNSIGNED NOT NULL COMMENT 'オペレーターID',
  company_id INT UNSIGNED NOT NULL COMMENT '企業ID',
  call_started_at DATETIME NOT NULL COMMENT '架電開始日時',
  call_ended_at DATETIME DEFAULT NULL COMMENT '架電終了日時',
  result_code ENUM('NO_ANSWER', 'NG', 'RECALL', 'INTERESTED', 'PROJECT', 'SKIP') DEFAULT NULL COMMENT '通話結果コード',
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

-- 案件テーブル
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

-- リコールタスクテーブル
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

-- AI通話評価テーブル
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

-- 業種別ゴールデンタイムルール
CREATE TABLE IF NOT EXISTS industry_time_rules (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  industry_name VARCHAR(100) NOT NULL COMMENT '業種名',
  start_time TIME NOT NULL COMMENT '開始時刻',
  end_time TIME NOT NULL COMMENT '終了時刻',
  priority_weight INT NOT NULL DEFAULT 10 COMMENT '優先度重み',
  INDEX idx_rules_industry (industry_name)
) ENGINE=InnoDB COMMENT='業種別ゴールデンタイム';

-- 除外リストテーブル
CREATE TABLE IF NOT EXISTS exclusion_lists (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  company_name VARCHAR(255) DEFAULT NULL COMMENT '企業名',
  phone_number VARCHAR(20) DEFAULT NULL COMMENT '電話番号',
  list_type ENUM('ng', 'existing_project') NOT NULL COMMENT 'リスト種別',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_exclusion_phone (phone_number),
  INDEX idx_exclusion_name (company_name),
  INDEX idx_exclusion_type (list_type)
) ENGINE=InnoDB COMMENT='除外リスト';

-- 企業割り当てテーブル
CREATE TABLE IF NOT EXISTS company_assignments (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  company_id INT UNSIGNED NOT NULL,
  user_id INT UNSIGNED NOT NULL,
  assigned_by INT UNSIGNED NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_company_user (company_id, user_id),
  CONSTRAINT fk_assignment_company FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE,
  CONSTRAINT fk_assignment_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_assignment_by FOREIGN KEY (assigned_by) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB COMMENT='企業割り当て';

-- 外部キー (companies → users ロック)
ALTER TABLE companies
  ADD CONSTRAINT fk_companies_locked_user FOREIGN KEY (locked_by_user_id) REFERENCES users(id) ON DELETE SET NULL;

-- 初期データ: 業種別ゴールデンタイム
INSERT INTO industry_time_rules (industry_name, start_time, end_time, priority_weight) VALUES
  ('飲食', '10:00:00', '11:30:00', 20),
  ('飲食', '15:00:00', '17:00:00', 15),
  ('製造', '09:00:00', '11:00:00', 20),
  ('製造', '14:00:00', '16:00:00', 15),
  ('小売', '11:00:00', '13:00:00', 20),
  ('小売', '16:00:00', '18:00:00', 15);

-- 業種×地域ルール（架電エリア制御）
CREATE TABLE IF NOT EXISTS industry_region_rules (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  industry_name VARCHAR(100) NOT NULL,
  region VARCHAR(100) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_industry_region (industry_name, region),
  INDEX idx_industry (industry_name)
) ENGINE=InnoDB COMMENT='業種×地域の架電エリアルール';

-- 業種別NGワード（職種除外キーワード）
CREATE TABLE IF NOT EXISTS industry_exclude_words (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  industry_name VARCHAR(100) NOT NULL,
  keyword VARCHAR(100) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_industry_keyword (industry_name, keyword),
  INDEX idx_industry (industry_name)
) ENGINE=InnoDB COMMENT='業種別NGワード（職種除外キーワード）';

-- 初期データ: 管理者ユーザー (パスワード: admin123)
INSERT INTO users (name, email, password_hash, role) VALUES
  ('管理者', 'admin@example.com', '$2b$10$8K1p/a0dL1LXMIgoEDFrwOfMQkT.RZfL1IdBCemO3vGKCVjnZPGlG', 'admin');


-- ============================================================
-- 除外リスト連携 (companies <-> exclusion_lists)
-- 016/017 migrations: NG/既存案件リストとの整合性をDBトリガーで自動維持する
-- ============================================================

ALTER TABLE companies ADD INDEX idx_companies_name (company_name);

DROP TRIGGER IF EXISTS trg_companies_bi_exclusion;

CREATE TRIGGER trg_companies_bi_exclusion
BEFORE INSERT ON companies
FOR EACH ROW
SET
  NEW.exclusion_reason = IF(
        NEW.exclusion_flag = 0 AND (
          (SELECT COUNT(*) FROM exclusion_lists WHERE phone_number = NEW.phone_number) > 0
          OR (SELECT COUNT(*) FROM exclusion_lists WHERE company_name = NEW.company_name) > 0
        ),
        (SELECT IF(SUM(list_type = 'ng') > 0, 'NG登録', '既存案件登録')
           FROM exclusion_lists
           WHERE phone_number = NEW.phone_number OR company_name = NEW.company_name),
        NEW.exclusion_reason
      ),
  NEW.exclusion_flag = IF(
        NEW.exclusion_flag = 0 AND (
          (SELECT COUNT(*) FROM exclusion_lists WHERE phone_number = NEW.phone_number) > 0
          OR (SELECT COUNT(*) FROM exclusion_lists WHERE company_name = NEW.company_name) > 0
        ),
        1,
        NEW.exclusion_flag
      );

DROP TRIGGER IF EXISTS trg_exclusion_lists_ai;

CREATE TRIGGER trg_exclusion_lists_ai
AFTER INSERT ON exclusion_lists
FOR EACH ROW
UPDATE companies
SET exclusion_flag = 1,
    exclusion_reason = IF(NEW.list_type = 'ng', 'NG登録', '既存案件登録')
WHERE exclusion_flag = 0
  AND (
      (NEW.phone_number IS NOT NULL AND NEW.phone_number <> '' AND phone_number = NEW.phone_number)
      OR (NEW.company_name IS NOT NULL AND NEW.company_name <> '' AND company_name = NEW.company_name)
    );
