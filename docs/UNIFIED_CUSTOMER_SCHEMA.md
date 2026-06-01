# 顧客マスタ統合 設計書

callcenter-ai-system と fax-crm-system を 1 つの「共有顧客マスタ」に統合するための設計。

## ゴール

- 顧客本体（社名・電話・FAX・業種・地域・住所・ブラックリスト 等）を **1 つのテーブル**で管理する
- 同期コードを撤去する
- ID と参照を 1 系統に統一する
- callcenter 固有 (architects: locked_*, priority_*, is_special, …) と fax-crm 固有 (manuscripts, send_count, …) の情報は**それぞれの拡張テーブル**に逃がす

## スケール想定

- 顧客レコード: **150 万件** (callcenter 単独 83k → 5x = 415k → 将来 1.5M)
- 同時アクセス: callcenter (オペレーター数十名) + fax-crm (営業数名)

MySQL 8 で 1.5M 行は問題なし（インデックス次第で全件 SELECT も数秒）。
**問題はサイズではなく、双重保管と同期のドリフト**。

---

## 新スキーマ

### `customers` (共有テーブル)

```sql
CREATE TABLE customers (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,

  -- 同一性キー
  company_name        VARCHAR(255) NOT NULL,
  phone_number        VARCHAR(32)  DEFAULT NULL,
  fax_number          VARCHAR(32)  DEFAULT NULL,

  -- 業種・地域
  industry            VARCHAR(100) DEFAULT NULL,
  industry_category   VARCHAR(20)  DEFAULT NULL,  -- 飲食/製造/小売/建設/宿泊/その他
  prefecture          VARCHAR(20)  DEFAULT NULL,
  city                VARCHAR(100) DEFAULT NULL,
  region              VARCHAR(20)  DEFAULT NULL,  -- 関東/中部/... の広域
  address             TEXT         DEFAULT NULL,
  postal_code         VARCHAR(10)  DEFAULT NULL,

  -- 補足情報
  url                 VARCHAR(500) DEFAULT NULL,
  employee_count      INT          DEFAULT NULL,
  representative      VARCHAR(100) DEFAULT NULL,
  note                TEXT         DEFAULT NULL,
  comment             TEXT         DEFAULT NULL,

  -- フラグ
  is_blacklisted      TINYINT(1)   NOT NULL DEFAULT 0,
  blacklisted_reason  VARCHAR(255) DEFAULT NULL,

  -- 由来
  source_file         VARCHAR(255) DEFAULT NULL,
  imported_at         DATETIME     DEFAULT NULL,

  created_at          DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at          DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  UNIQUE KEY uk_customers_fax  (fax_number),
  INDEX idx_customers_phone    (phone_number),
  INDEX idx_customers_name     (company_name),
  INDEX idx_customers_industry (industry_category),
  INDEX idx_customers_pref     (prefecture)
);
```

### `callcenter_company_ext` (callcenter 固有)

```sql
CREATE TABLE callcenter_company_ext (
  customer_id           BIGINT UNSIGNED PRIMARY KEY,

  priority_score        INT          NOT NULL DEFAULT 0,
  exclusion_flag        TINYINT(1)   NOT NULL DEFAULT 0,
  exclusion_reason      VARCHAR(255) DEFAULT NULL,
  is_special            TINYINT(1)   NOT NULL DEFAULT 0,
  is_sales_list         TINYINT(1)   NOT NULL DEFAULT 0,
  data_source           VARCHAR(50)  DEFAULT NULL,

  -- 排他制御
  locked_by_user_id     INT UNSIGNED DEFAULT NULL,
  locked_at             DATETIME     DEFAULT NULL,
  imported_by_user_id   INT UNSIGNED DEFAULT NULL,

  last_called_at        DATETIME     DEFAULT NULL,

  CONSTRAINT fk_ccc_ext FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE,
  INDEX idx_ccc_locked (locked_by_user_id, locked_at),
  INDEX idx_ccc_excl   (exclusion_flag, is_special)
);
```

### `fax_customer_ext` (fax-crm 固有)

```sql
CREATE TABLE fax_customer_ext (
  customer_id          BIGINT UNSIGNED PRIMARY KEY,

  send_count           INT     NOT NULL DEFAULT 0,
  last_sent_at         DATETIME DEFAULT NULL,
  last_pc_number       VARCHAR(20)  DEFAULT NULL,
  last_result          VARCHAR(40)  DEFAULT NULL,
  response_count       INT     NOT NULL DEFAULT 0,

  CONSTRAINT fk_fc_ext FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE,
  INDEX idx_fc_sent (last_sent_at)
);
```

### 既存テーブルの参照変更

| 既存 | 変更後 |
|---|---|
| `calls.company_id INT UNSIGNED` | `calls.customer_id BIGINT UNSIGNED` (= customers.id) |
| `contact_events.customer_id BIGINT` | そのまま (元から BIGINT) |
| `company_assignments.company_id` | `customer_id BIGINT` |
| `recall_tasks.company_id` | `customer_id BIGINT` |
| `projects.company_id` | `customer_id BIGINT` |
| `extraction_records.customer_id` | そのまま |
| `incoming_call_reports.customer_id` | そのまま |

---

## DB トポロジ案

3 案検討。

### A. 単一の物理 DB
- Railway 上に新 MySQL を作って、両アプリが繋ぐ
- メリット: SQL JOIN がそのまま使える
- デメリット: 障害時にどちらも停止

### B. callcenter の DB を共有 (推奨)
- 既に容量が大きい callcenter DB に fax-crm 側テーブルを追加
- fax-crm は新 DB を参照するように向け先変更
- メリット: 移行が一番素直、callcenter は無停止
- デメリット: fax-crm がリードヘビーだと callcenter に影響

### C. 別 DB クラスタ
- 「customer_db」を独立クラスタとして立てる
- 両アプリ stateless service、customer_db は SPOF
- メリット: 設計上きれい
- デメリット: 運用が複雑

**推奨は B**。

---

## 移行プラン

### Phase 0: 準備（リスクなし）
1. 本 doc の合意
2. dedup 規則の確定（下記参照）
3. 共有 DB の URL / 接続情報をシークレット化

### Phase 1: スキーマ追加（リスク低）
1. callcenter DB に `customers` / `callcenter_company_ext` / `fax_customer_ext` を作成
2. 既存 `companies` は残したまま、新テーブルは空
3. 両アプリにライブラリ追加 (`customerRepo`) — まだ読み書きしない

### Phase 2: シャドー二重書き (リスク中)
1. callcenter: `companies` INSERT/UPDATE 時に同じデータを `customers` + `callcenter_company_ext` にも書く (write-through)
2. fax-crm: 同様に `customers` + `fax_customer_ext` に二重書き
3. 既存 `companies` / `fax-crm.customers` の全行を一度 `customers` にバックフィル + dedup
4. しばらく稼働してドリフトしないことを観察

### Phase 3: 読み込み切替 (リスク高)
1. feature flag (`USE_UNIFIED_CUSTOMERS=true`) で両アプリの読み込みを `customers` に切替
2. 1 週間の様子見
3. 問題があれば flag OFF で旧テーブルに戻れる

### Phase 4: 旧テーブル退役 (不可逆)
1. 旧 `companies` / `fax-crm.customers` を `*_legacy` にリネーム
2. 二重書きコードを削除
3. 同期コードを完全削除
4. webhook (call event / fax event) は contact_events ベースのみ残す

---

## Dedup 規則

社名・電話・FAX の正規化:

```js
function normalizePhone(s) {
  if (!s) return null;
  // 全角→半角、ハイフン/空白/括弧除去
  return s
    .replace(/[\s\-\(\)（）]/g, '')
    .replace(/[０-９]/g, d => String.fromCharCode(d.charCodeAt(0) - 0xFEE0))
    .replace(/[^0-9+]/g, '')
    || null;
}
function normalizeName(s) {
  if (!s) return null;
  return s
    .replace(/[\s　]/g, '')
    .replace(/[株式会社|有限会社|合同会社|（株）|（有）|\(株\)|\(有\)]/g, '')
    || null;
}
```

マッチ優先度:

1. `fax_number` 完全一致（正規化後）
2. `phone_number` 完全一致（正規化後）  
3. `external_callcenter_id` (既に紐づき済みの場合)
4. 正規化済み `company_name` 完全一致 + `prefecture` 一致
5. 曖昧 (Levenshtein 等) — ここに来たら手動レビュー

---

## ロールバック戦略

各 Phase 完了直後に branch tag を打って、問題発生時は:
- Phase 2 → Phase 1 戻し: 二重書きコードを no-op に
- Phase 3 → Phase 2 戻し: feature flag OFF
- Phase 4 完了後: バックアップから旧テーブル復元（最終手段）

---

## 影響範囲

### callcenter で書き換えが必要な箇所
- `controllers/companyController.js` — `companies` → `customers` JOIN `callcenter_company_ext`
- `controllers/callController.js` — `company_id` カラム参照
- `controllers/adminController.js` — 顧客マスタ系
- `controllers/csvController.js` — CSV インポート時の重複判定
- `controllers/analyticsController.js` — JOIN
- フロントは API 形式が同じなら影響なし

### fax-crm で書き換えが必要な箇所
- `services/customerService.js` — `customers` → `customers` JOIN `fax_customer_ext`
- `services/customerSyncService.js` — **削除**
- `services/callcenterClient.js` — **削除**
- `services/callcenterWebhookClient.js` — **削除**
- `controllers/customers.js` のソース一覧 — **削除**

---

## 想定 KPI

| 項目 | 現在 | 統合後 |
|---|---|---|
| 顧客行数の物理保管 | 2x = 3M | 1x = 1.5M |
| 同期コード LoC | ~800 行 | 0 行 |
| 同期失敗による不整合発生率 | 月1-2件 | 0 |
| 「片方にしかない顧客」発生 | 数千〜数万件/月 | 構造的に発生不可 |
| 全件 re-sync 時間 | 数日 | 不要 |
| クロスシステム集計 (CPA × 架電) の難易度 | 中（API 連携） | 低（1 SQL） |

---

## オープン質問

1. Railway MySQL を 1 つに統合するか、新規プロビジョンするか？
2. Phase 2 〜 3 の運用ウィンドウをいつ取るか？
3. dedup で手動レビューが必要そうな件数を事前にどう見積もる？
   - 試案: 全件をローカルにダンプして dedup スクリプトを dry-run、衝突候補だけ CSV 出力
4. callcenter `companies.id INT` → `customers.id BIGINT` への参照変更のロールアウト順序
