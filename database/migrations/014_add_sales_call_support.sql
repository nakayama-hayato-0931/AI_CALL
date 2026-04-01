-- 営業架電機能: リスト分離 + 架電種別
ALTER TABLE companies ADD COLUMN is_sales_list TINYINT(1) NOT NULL DEFAULT 0;
ALTER TABLE calls ADD COLUMN call_type ENUM('operator', 'sales') NOT NULL DEFAULT 'operator';
