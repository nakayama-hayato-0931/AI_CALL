-- テストアカウントフラグ追加
-- テストアカウントはデータを記録せず、集計にも含まれない
ALTER TABLE users ADD COLUMN is_test_account TINYINT(1) NOT NULL DEFAULT 0 AFTER is_active;
