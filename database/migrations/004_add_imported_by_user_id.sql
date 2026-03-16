-- 004: imported_by_user_id カラム追加
-- オペレーターがインポートしたリストを識別するため
-- NULL = 全員にピックアップ可能（管理者/マネージャーインポート）
-- user_id = そのオペレーターの自作リスト

ALTER TABLE companies
  ADD COLUMN imported_by_user_id INT UNSIGNED DEFAULT NULL AFTER address,
  ADD INDEX idx_imported_by (imported_by_user_id);
