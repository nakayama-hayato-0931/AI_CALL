# 自動ピックアップ ルール仕様

このドキュメントは「次の架電先を自動で 1 件返す / 候補リストを返す」 処理 (= ピックアップ) のルールをまとめたものです。 該当コード: [`backend/src/controllers/companyController.js`](../backend/src/controllers/companyController.js) の `getNextCallTarget` (1 件) と `getCallList` (リスト)。

最終更新: 2026-06-18

---

## 1. 優先順 (Tier 構成)

候補企業を以下の優先度で取得し、 上から「ある分だけ詰めて」 リスト or 1 件を返す。

| 優先 | Tier | 説明 |
|---|---|---|
| 最優先 | **Tier 1: リコール期限** | 過去にユーザーが「リコール」 設定した企業のうち、 期限到達分。 業種・地域フィルタ不問。 |
| 2 番目 | **Tier 0: 自分割り当て中** | 管理者が手動で割り当てた企業 (オレンジ表示)。 |
| 3 番目 | **Tier 2: ゴールデンタイム** | `industry_time_rules` 業種 × 現在時刻が start_time〜end_time の範囲。 一般・営業以外。 |
| 4 番目 | **Tier 3: 未架電** ★メイン | `last_called_at IS NULL` の企業。 |
| 5 番目 | **Tier 4: 過去 NO_ANSWER + 2 日経過** | 前回不通から 2 日以上経過した企業。 |
| 6 番目 | **Tier 5: 過去 NG + 3 ヶ月経過 + 別オペ** | **2026-06-18 NG永久除外化に伴い実質空クエリ**。 |

### Tier 4/5 のフォールバック条件 (重要)

```js
// companyController.js line 1088-1101 (getCallList)
const hasUntouched = untouchedRows.length > 0;
if (!hasUntouched) {
  // Tier 3 (未架電) が 0 件のときだけ Tier 4/5 を採用
}
```

= **未架電が 1 件でもあれば、 過去 NO_ANSWER の再ピックアップは表示されない**。

`getNextCallTarget` (1 件取得) は単純に Tier 1 → 2 → 3 → 4 → 5 の順で `LIMIT 1`。 Tier 3 で取れれば Tier 4 にはいかない。

---

## 2. 全 Tier 共通の絶対条件 (AND)

全 Tier のクエリで以下が必ず AND される。 どれか 1 つでも該当すれば対象外。

| 条件 | SQL | 設定変更場所 |
|---|---|---|
| **NGリスト除外** | `c.exclusion_flag = 0` | 顧客マスタ画面で個別に「NGリストに追加」 |
| **特別リストでない** | `c.is_special = 0` | 特別リスト管理画面 |
| **営業リストでない** | `c.is_sales_list = 0` | DB 直接 (運用上ほぼ不変) |
| **電話番号必須** (★2026-06-18 追加) | `c.phone_number IS NOT NULL AND c.phone_number <> ''` | FAX のみ顧客はピックアップ対象外 |
| **永久除外** | `NOT EXISTS (calls WHERE result_code IN ('SKIP','PROJECT','RECALL','INTERESTED','NG'))` | 過去にこれらの結果が 1 度でも入っていれば対象外 |
| **②自動ピックアップ対象都道府県** | `c.region IN (有効県) OR c.address LIKE '有効県%'` | 顧客マスタ → 都道府県診断ボタン → システム設定 |
| **ロック中除外** | `c.locked_by_user_id IS NULL` | 別オペレーターが架電中なら除外 |
| **1 時間以内の他者架電除外** | 1 時間以内に他ユーザーが架電した企業は除外 | 自動で適用 |

---

## 3. モード別の追加フィルタ

| モード | 追加 AND |
|---|---|
| `auto` (デフォルト) | Tier 2 で `industry_time_rules` 業種に限定 |
| `industry` (業種別) ★2026-06-18 修正 | `c.industry_category = ?` **厳密一致**。 副業表記の他業種は除外 |
| `industry` + 地域指定 | `c.region IN (...) OR c.address LIKE ...` で都道府県絞り込み |
| `mylist` (自作リスト) | `c.imported_by_user_id = 自分`、 永久除外バイパス |
| `special` (特別リスト) | `c.is_special = 1`、 永久除外バイパス、 1 度でも架電履歴があれば除外 |

### 業種別モードの厳密一致について (重要)

旧仕様の `OR industry_category IS NULL` や `OR industry LIKE '%xx%'` は撤回 → **`industry_category` で厳密一致のみ**。

理由:
- `IS NULL` を含めると未分類の他業種 (小売・サービス業) が混入
- `LIKE '%農業%'` を含めると副業として農業を記述した建設・飲食企業が混入

未分類企業がある場合は、 顧客マスタ右上の **「業種診断」 ボタン → 「再計算」** で `industry_category` を埋める運用。

---

## 4. Tier 3 (未架電) が 0 件になる典型パターン

「顧客マスタに未架電企業がたくさんあるのに、 ピックアップで過去履歴が出る」 = **絶対条件のどこかで未架電企業が 0 件まで削られている**。

### 原因切り分け

```sql
SELECT
  '1. 業種=農業 全件 (exclusion_flag=0)'             AS step, COUNT(*) AS cnt
  FROM companies WHERE industry_category = '農業' AND exclusion_flag = 0
UNION ALL SELECT
  '2. + 電話番号あり', COUNT(*)
  FROM companies WHERE industry_category = '農業' AND exclusion_flag = 0
    AND phone_number IS NOT NULL AND phone_number <> ''
UNION ALL SELECT
  '3. + 未架電 (last_called_at IS NULL)', COUNT(*)
  FROM companies WHERE industry_category = '農業' AND exclusion_flag = 0
    AND phone_number IS NOT NULL AND phone_number <> ''
    AND last_called_at IS NULL
UNION ALL SELECT
  '4. + 永久除外なし', COUNT(*)
  FROM companies c WHERE c.industry_category = '農業' AND c.exclusion_flag = 0
    AND c.phone_number IS NOT NULL AND c.phone_number <> ''
    AND c.last_called_at IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM calls cl WHERE cl.company_id = c.id
        AND cl.result_code IN ('SKIP','PROJECT','RECALL','INTERESTED','NG')
    );
```

各ステップでどこから 0 件に減るかで原因特定:

| Step で激減 | 原因 | 対処 |
|---|---|---|
| 1 → 2 | FAX のみ顧客が多い | 業種データの電話番号充足率を確認、 受け入れ |
| 2 → 3 | 未架電が少ない (= 既に全部架電済み) | データ追加 (CSV import) で新規顧客を投入 |
| 3 → 4 | 永久除外で大半消費 | 顧客マスタの「件数内訳」 で永久除外件数を確認 |
| ステップ後の最終 0 件 | ②自動ピックアップ対象都道府県の設定 | 顧客マスタ → 都道府県診断ボタン → 必要県を有効化 |

### UI からの確認

顧客マスタ画面の右上ボタン:
- **業種診断** → 「農業」 入力 → カテゴリ件数 + 分類漏れ + 状態内訳 (未架電 / 永久除外 / 前回不通 / 前回NG)
- **都道府県診断** → 自動ピックアップ対象県の現状確認
- **件数内訳** → 全体のピックアップ対象数

---

## 5. 主な過去変更履歴

| 日付 | 変更 | 影響 |
|---|---|---|
| 2026-06-18 | NG 結果を永久除外に追加 | 過去 NG 企業の Tier 4/5 再ピックアップ不可 |
| 2026-06-18 | Tier 0 (assigned) に永久除外フィルタを適用 | 割り当て中でも過去 SKIP/NG 企業は出ない |
| 2026-06-18 | 電話番号必須フィルタを追加 (FAX のみ除外) | ピックアップ対象数が phone_number 充足率に依存 |
| 2026-06-18 | 業種別モード `industry_category` 厳密一致に変更 | 未分類・副業表記の他業種が混入しなくなる代わりに、 未分類企業はピックアップ不可。 業種診断 → 再計算で要対応 |

---

## 6. 関連ファイル

- [`backend/src/controllers/companyController.js`](../backend/src/controllers/companyController.js) — ピックアップロジック本体
- [`backend/src/controllers/adminController.js`](../backend/src/controllers/adminController.js) — 業種診断、 都道府県診断、 件数内訳の各 endpoint
- [`backend/src/server.js`](../backend/src/server.js) — `auto_pickup_prefectures` の system_settings 構造
- [`CLAUDE.md`](../CLAUDE.md) §4 — アーキテクチャ要点 (架電優先度ロジック)
- [`CHANGELOG.md`](../CHANGELOG.md) — 各変更の経緯
