-- 面接人数カラム追加（案件単位の総面接人数）
ALTER TABLE projects ADD COLUMN interview_attendees INT UNSIGNED DEFAULT NULL;
-- 内定日カラム追加
ALTER TABLE projects ADD COLUMN naitei_date DATE DEFAULT NULL;
