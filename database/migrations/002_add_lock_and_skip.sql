-- ============================================
-- Migration 002: ロック機能 + SKIPコード追加
-- 複数オペレーターの排他制御と架電スキップ機能
-- ============================================

USE callcenter_crm;

-- 1. companies テーブルにロック用カラムを追加
ALTER TABLE companies
  ADD COLUMN locked_by_user_id INT UNSIGNED DEFAULT NULL COMMENT 'ロック中のオペレーターID' AFTER last_called_at,
  ADD COLUMN locked_at DATETIME DEFAULT NULL COMMENT 'ロック取得日時' AFTER locked_by_user_id,
  ADD INDEX idx_companies_locked (locked_by_user_id),
  ADD CONSTRAINT fk_companies_locked_user FOREIGN KEY (locked_by_user_id) REFERENCES users(id) ON DELETE SET NULL;

-- 2. calls.result_code に SKIP を追加
ALTER TABLE calls
  MODIFY COLUMN result_code ENUM('NO_ANSWER', 'NG', 'RECALL', 'INTERESTED', 'PROJECT', 'SKIP') DEFAULT NULL COMMENT '通話結果コード';
