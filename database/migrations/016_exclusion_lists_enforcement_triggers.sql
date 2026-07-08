-- 016_exclusion_lists_enforcement_triggers.sql
-- 2026-07-08
--
-- 背景:
-- CSVインポート時にアプリケーション側で exclusion_lists (NGリスト/既存案件リスト) と
-- 照合して exclusion_flag を立てる処理があるが、2026-06-22の一括インポートの際に
-- 235社でこのチェックが機能せず、除外リスト登録済みの企業が架電対象(exclusion_flag=0)
-- のまま残ってしまう不具合が発生した(原因は特定できず、ログも既に消失)。
--
-- 対応:
-- アプリケーション側のチェックに加えて、DBトリガーで二重に担保する。
-- これにより、将来同様のアプリケーション側の取りこぼしが発生しても、
-- companies テーブルと exclusion_lists テーブルの整合性が自動的に保たれる。

-- 1) companies へのINSERT時、phone_number が exclusion_lists に存在すれば
--    自動的に exclusion_flag=1 / exclusion_reason を設定する
CREATE TRIGGER trg_companies_bi_exclusion
BEFORE INSERT ON companies
FOR EACH ROW
SET
  NEW.exclusion_reason = IF(
      NEW.exclusion_flag = 0 AND (SELECT COUNT(*) FROM exclusion_lists WHERE phone_number = NEW.phone_number) > 0,
      (SELECT IF(SUM(list_type = 'ng') > 0, 'NG登録', '既存案件登録') FROM exclusion_lists WHERE phone_number = NEW.phone_number),
      NEW.exclusion_reason
    ),
  NEW.exclusion_flag = IF(
      NEW.exclusion_flag = 0 AND (SELECT COUNT(*) FROM exclusion_lists WHERE phone_number = NEW.phone_number) > 0,
      1,
      NEW.exclusion_flag
    );

-- 2) exclusion_lists へのINSERT時 (NGリスト/既存案件リストの新規登録)、
--    既に companies に存在する同一電話番号の企業を遡って除外フラグを立てる
CREATE TRIGGER trg_exclusion_lists_ai
AFTER INSERT ON exclusion_lists
FOR EACH ROW
UPDATE companies
SET exclusion_flag = 1,
    exclusion_reason = IF(NEW.list_type = 'ng', 'NG登録', '既存案件登録')
WHERE phone_number = NEW.phone_number AND exclusion_flag = 0;

-- 適用済み: 上記2トリガーは2026-07-08に本番DBへ直接適用済み。
-- また、過去分のデータ不整合(235社)も本マイグレーション適用と同時に以下で修正済み:
--
-- UPDATE companies c
-- INNER JOIN (
--   SELECT phone_number, MAX(list_type='ng') as is_ng
--   FROM exclusion_lists WHERE phone_number IS NOT NULL GROUP BY phone_number
-- ) e ON e.phone_number = c.phone_number
-- SET c.exclusion_flag = 1,
--     c.exclusion_reason = IF(e.is_ng, 'NG登録', '既存案件登録')
-- WHERE c.exclusion_flag = 0;
