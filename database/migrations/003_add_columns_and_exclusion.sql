-- ============================================
-- Migration 003: 職種・コメント追加 + 除外リストテーブル + 企業割り当てテーブル
-- ============================================

USE callcenter_crm;

-- 1. companies テーブルに job_type, comment カラムを追加
ALTER TABLE companies
  ADD COLUMN job_type VARCHAR(255) DEFAULT NULL COMMENT '職種' AFTER industry,
  ADD COLUMN comment TEXT DEFAULT NULL COMMENT 'コメント' AFTER job_type;

-- 2. 除外リストテーブル (NG / 既存案件)
CREATE TABLE IF NOT EXISTS exclusion_lists (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  company_name VARCHAR(255) NOT NULL COMMENT '企業名',
  phone_number VARCHAR(20) DEFAULT NULL COMMENT '電話番号',
  list_type ENUM('ng', 'existing_project') NOT NULL COMMENT 'リスト種別',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_exclusion_phone (phone_number),
  INDEX idx_exclusion_name (company_name),
  INDEX idx_exclusion_type (list_type)
) ENGINE=InnoDB COMMENT='除外リスト';

-- 3. 企業割り当てテーブル
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
