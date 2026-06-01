# Phase 3b: fax-crm 読み込み切替 設計書

UNIFIED_CUSTOMER_SCHEMA.md Phase 3 の本丸。fax-crm の顧客読み込みを
callcenter MySQL に切り替える。

## ゴール

fax-crm UI の顧客マスタ系画面が **callcenter.companies + fax_customer_ext**
を直接参照するようにする。fax-crm.customers は当面 write-through で保持
（Phase 4 で削除）。

## なぜ必要

- Phase 2 で書き込みは両方されているが、**読み込みは fax-crm.customers のまま**
- callcenter で新規追加された会社が fax-crm UI に出るのは「shadow write が
  fax-crm に届いた後」 = 数ms 遅延 ＋ 失敗リスクあり
- 読み込みを統一すれば、callcenter で書いた瞬間に fax-crm UI に反映
- ドリフトリスクが消える（fax-crm.customers は事実上のキャッシュ）

## 設計

### 切替単位

リスクが小さい順に段階的に切替:

1. **Tier 1 (最初に切替)**: 顧客一覧表示・検索・facets
   - `GET /api/customers` (listCustomers)
   - `GET /api/customers/facets/industries`
   - `GET /api/customers/facets/prefectures`
2. **Tier 2**: 顧客詳細
   - `GET /api/customers/:id`
   - `GET /api/customers/:id/timeline` — contact_events は fax-crm 側のまま
3. **Tier 3**: 書き込み系（write-through 維持）
   - `POST /api/customers/quick-create`
   - `PATCH /api/customers/:id/blacklist`
4. **Tier 4**: 連動テーブル
   - `extraction_records` などの JOIN 先

### Feature Flag

```
USE_CALLCENTER_DB=1   # fax-crm backend に追加
```

- `0` or 未設定: 現状通り fax-crm.customers から読む
- `1`: callcenter.companies から読む（切替後の動作）

切替単位を環境変数で細かく制御することも可能:
```
USE_CALLCENTER_DB_TIER=1   # Tier 1 のみ切替
USE_CALLCENTER_DB_TIER=2   # Tier 1+2 切替
USE_CALLCENTER_DB_TIER=3   # Tier 1+2+3 切替
USE_CALLCENTER_DB_TIER=4   # フル切替（Phase 4 直前）
```

### ID マッピング

fax-crm 側の他テーブル (contact_events, extraction_records, etc.)
は `customer_id` = fax-crm.customers.id (BIGINT) を参照している。

callcenter.companies.id (INT UNSIGNED) と fax-crm.customers.id (BIGINT UNSIGNED)
は別系統。両者の対応関係:
- callcenter.companies.external_faxcrm_id ← fax-crm.customers.id
- fax-crm.customers.external_callcenter_id ← callcenter.companies.id

fax-crm の Repo は **fax-crm.customers.id を「論理 ID」として返す**:

```sql
SELECT
  COALESCE(NULLIF(c.external_faxcrm_id, 0), -c.id) AS id,    -- fax-crm.id がある時はそれを使い、無ければ負数の callcenter id を返す
  c.id AS callcenter_id,
  c.external_faxcrm_id AS faxcrm_id,
  c.company_name, c.fax_number, c.phone_number, ...
FROM companies c
LEFT JOIN fax_customer_ext fce ON fce.company_id = c.id
```

- `id` > 0: fax-crm.customers.id ⇒ 既存 fax-crm 顧客（contact_events も使える）
- `id` < 0: callcenter-only ⇒ fax-crm 側に未連携。`-id` で callcenter.id を取れる。
  - fax-crm UI 上は表示するが、timeline 取得時は「未連携のため履歴なし」を返す

### 切替時の注意

- **Tier 1 切替後の動作**: 一覧件数が増える（69 callcenter-only が追加表示）
- **Tier 2 切替**: detail を見る時、callcenter-only 顧客は contact_events 履歴が空になる
  → 表示は「callcenter 由来。FAX 履歴なし」のように説明テキスト追加
- **Tier 3 切替**: quickCreate は fax-crm.customers + callcenter.companies 両方に書く
  必要があったが、shadow write が既にやっているので fax-crm 側だけでOK
  → ただし fax-crm.customers の id が必要な後続処理 (contact_events) もあるので、
    INSERT 後の id を確実に取れるロジック維持

## 実装ステップ

### Step 1: customerRepo 抽象化
- `services/customerRepo.js` 新設
- `listCustomers(filters, USE_CALLCENTER_DB)` を実装
- `getById(id, USE_CALLCENTER_DB)` を実装
- `customerService` から呼び出すよう改修

### Step 2: Tier 1 切替（顧客一覧のみ）
- env: `USE_CALLCENTER_DB=1`
- 数日観察、ドリフトチェック通り続ければ次へ

### Step 3: Tier 2 切替（詳細画面も）
- 同 flag、Tier 段階管理 env を導入
- callcenter-only 顧客の表示テストを行う

### Step 4: Tier 3 / 4 切替（書き込みも統合）
- Phase 4 への準備

## ロールバック

各 Tier 切替後に問題があれば `USE_CALLCENTER_DB_TIER` を下げる
or `USE_CALLCENTER_DB=0` に戻す → 即座に旧仕様に復帰。
データ自体は両 DB に存在するので影響なし。

## 工数見積

- Step 1 (Repo 抽象化): 1日
- Step 2 (Tier 1): 半日 + 数日観察
- Step 3 (Tier 2): 1日 + 数日観察
- Step 4 (Tier 3/4): 1日 + 数日観察
- 合計: 1-2 週間（観察期間込み）

## オープン質問

1. callcenter-only 顧客 (569件) を fax-crm UI に表示すべきか？非表示？
2. `id` 負数を返す方式 vs 別フィールドで callcenter_id を返す方式
3. extraction_records などの内部参照テーブルは Tier 4 のままで OK？

→ Step 1 の Repo 実装時に決める
