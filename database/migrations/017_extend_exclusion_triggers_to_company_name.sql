-- 017_extend_exclusion_triggers_to_company_name.sql
-- 2026-07-09
--
-- 背景:
-- 016 で追加した exclusion_lists 連携トリガー (trg_companies_bi_exclusion /
-- trg_exclusion_lists_ai) は phone_number の一致のみを条件にしており、
-- company_name のみが一致するケース(電話番号の表記ゆれ・変更等)を捕捉できていなかった。
-- そのため NG/既存案件リストに登録済みの企業が架電リストに残ったまま除外されない
-- 事例が確認された(例: 株式会社ツバキ、有限会社信栄商会、株式会社レーベン 等)。
--
-- 対応:
-- 1) companies.company_name にインデックスを追加(現状 phone_number のみ)
-- 2) 2つのトリガーを company_name も条件に含めるよう再作成
-- 3) 過去分の不整合を一括是正するバックフィルUPDATEを実行(company_name一致分)
--    ※ phone_number 一致分は 016 で backfill 済みのため対象外
--
-- 適用手順:
-- Railway MySQL Console 等で本ファイルを一度だけ実行してください。

-- 1) company_name にインデックス追加
ALTER TABLE companies ADD INDEX idx_companies_name (company_name);

-- 2) トリガー再作成 (phone_number OR company_name)
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

-- 3) 過去分バックフィル (company_name 一致分。一度だけ実行すればOK)
UPDATE companies c
INNER JOIN exclusion_lists e ON e.company_name = c.company_name
SET c.exclusion_flag = 1,
    c.exclusion_reason = IF(e.list_type = 'ng', 'NG登録', '既存案件登録')
WHERE c.exclusion_flag = 0
  AND e.company_name IS NOT NULL AND e.company_name <> '';
