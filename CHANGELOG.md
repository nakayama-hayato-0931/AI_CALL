# CHANGELOG

主要な変更履歴。詳細はそれぞれのコミットメッセージ参照（`git log`）。

---

## 2026年5月 〜 直近

### 顧客マスタ（FAX CRM 統合）
- **顧客マスタ拡張**
  - フィルタ追加: 結果 / 期間 / オペレーター / 業種。
  - 統合タイムライン: 架電 + 手動アクション + FAX CRM 履歴を時系列で1リスト表示（kind badge付き）。
  - 担当者情報セクション: 架電履歴から名前+電話で重複排除して右パネル上部に表示（性別/印象/最終接触日）。
  - **fax-crm 双方向同期ボタン**:
    - `POST /api/admin/customer-master/:id/sync-to-faxcrm` … callcenter の架電履歴を fax-crm に push（肉付けマージ）。call_id を source_event_id にして冪等化。
    - `POST /api/admin/customer-master/:id/sync-from-faxcrm` … fax-crm の FAX 履歴を取得して `company_actions` に取込。`[fax-crm:<id>]` タグで重複スキップ。
    - 「双方向同期」ボタン: 上記2つを連続実行（confirm付き）。
  - 単方向の取込側にも confirm を付与。


### コスト・給与関連
- **給与Excel取込（推奨）** `f7785e2`
  - 給与支給控除一覧の `.xlsx` を 1ファイル丸ごと取込。
  - 各セクション「従業員氏名」行 → 「支給合計額 / 健康保険料 / 介護保険料 / 厚生年金保険料 / 雇用保険料」を抽出。
  - `total_cost = 支給合計額 + 4種保険料合計` を `monthly_payroll_records` に保存。
  - `operator` role のみ対象（退職者も含む）。
  - 月セレクターから手動で対象月指定（PDF/Excel 内の年月は使わない）。
- **給与PDF取込（補助）** `8e066d6` 以降
  - pdfjs-dist v5 + cmaps + standard_fonts + DOMMatrix polyfill。
  - 名前駆動パーサー（既知のオペレーター名でX座標を特定）。
  - 本番環境（Railway）でも text extraction が動かないケースあるため、Excel取込を主に。
- **追加コスト（コンサル料など）** `ca301fb`
  - `monthly_extra_costs` テーブル (period_ym, category, amount, memo)。
  - `GET/POST/DELETE /api/analytics/extra-costs`。
  - CPA/案件質分析のチーム合計コストに加算（個人行には影響なし）。
  - UI: CPA/案件質分析ページの「追加コスト」ボタン（ピンク）→ モーダル。
- **退職者の給与も取込可能に** `a19cf4a`
  - 給与インポート系SQLから `is_active = 1` フィルタ除去。
- **CPA はオペレーターのみ対象** `236e7e1`
  - `role IN ('operator','intern')` → `role = 'operator'`。
- **打刻CSV: 月日1桁対応** `f1de510`
  - 正規表現 `\d{2}` → `\d{1,2}` で `2026/5/8 18:20` 形式に対応。
- **DB予約語回避** `373bb71`
  - `year_month` カラム → `period_ym` に改名（MySQL 8 予約語）。

### 都道府県・業種フィルタ
- **架電リスト管理 → 都道府県チェックボックス** `91a25bb`
  - 9地方別の都道府県を有効/無効でピックアップ制限。
- **業種別モードも都道府県フィルタ適用** `2846036`
- **regionの自動正規化** `757245c`
  - 起動時に address 先頭から都道府県名を抽出して `companies.region` に保存。
  - 「東京」→「東京都」のような短縮形を完全名へ統一。
- **大量都道府県有効時の高速化** `c5c4cf9`
  - 全形式（完全名+短縮形）を1つの IN 句にまとめる。

### 業種別分析（新ページ）
- **新ページ追加** `275f96c`
  - `/admin/industry-analysis` 業種カテゴリ × 月別の転換率比較。
  - 6指標: 案件化率 / 内定率(案件比) / 面接実施率 / 内定率(面接比) / 失注率 / バラシ率。
  - 「獲得案件」タブから案件明細にドリルダウン。
- **5カテゴリ + その他に統合** `b97315e`
  - 飲食 / 製造 / 小売 / 建設 / 宿泊 / その他。
- **キーワード判定で正しく分類** `892bceb`
  - companies.industry_category が NULL でも industry テキストから推定。
  - 「飲食料品小売業」は順序処理で 小売 へ。

### 案件質分析の改善
- **連絡待ち列クリック → 面接日有無の内訳モーダル** `69e6af7` / `9bce82e`
  - 比較ビューでも動作。
- **失注 / バラシ / 内定 列クリック → 業種別内訳モーダル** `275f96c`
- **面接日確定の判定** `b98d673` → `faf43a1`（最終）
  - 元の `interview_date IS NOT NULL` のみで判定（連絡待ちと一部重複容認）。
- **全0オペレーターを非表示** `9d71c43`

### 案件管理・割り振り
- **案件割り振りページ** `7c4bdc0`
  - `/admin/project-assignment`
  - 営業別案件状況マトリクス + 未割当案件一覧
- **失注/バラシ除外、移行前案件除外** `4370d5c`
- **面接日ベース月切替 + 連絡待ち表示** `0645e59`
- **面接実施列を結果待ち/内定/不合格に展開** `b97315e`周辺
- **未割当行は実件数で表示** `74596fd`

### 営業売上一覧
- **面接日ベース + 業種別ビュー追加** `c6d66bb`
- **業種別を大枠カテゴリで集計** `c41520d`

### インセンティブ管理（新ページ）
- **`/admin/incentive`** `2d9ab7d`
  - オペレーター別月次内定数。
- **月別 + コスト・ROAS** `0ff4942`
  - 内定社数 / 初回入金 / 見込入金 / コスト / ROAS のサマリカード。

### ダッシュボード
- **「任意」期間モード追加** `a07d2aa`
  - CPA/案件質と同じ感覚でカスタム期間集計可能。

### オペレーター画面
- **架電結果ログの高速化** `d3a0650` → `48348f5` → `b3fa78c`
  - 一覧取得時のGoogle Sheets同期取得を背景化、未取得は数秒後にreloadで反映。
- **架電リスト表示件数 10→25件** `551d1ef`
- **リコール対象がピックアップされない問題** `96fbe04`
  - 1時間以内除外 / 業種地域 / モード絞込をリコール取得からバイパス。

### その他
- **管理者ダッシュボード等で operator role 限定** `236e7e1`
- **CSV import の自作リスト** `2b86263`
- **業種チェックボックスでピックアップ制御** `c388825`
- **industry_category 事前計算カラム** `38bbe9b`

---

## アーキテクチャ概要

### バックエンド (`/backend`)
- Node.js / Express / mysql2
- 主要コントローラー:
  - `companyController.js` — 架電リスト、ピックアップ、ロック
  - `analyticsController.js` — CPA/案件質、コストPDF・Excel、給与、業種別、追加コスト
  - `projectController.js` — 案件管理、割り振り
  - `adminController.js` — 管理者、KPI補正、自動ピックアップ業種/都道府県
  - `callController.js` — 架電結果ログ
- Railway デプロイ（GitHub `main` ブランチ自動デプロイ）

### フロントエンド (`/frontend`)
- Next.js
- 主要ページ:
  - `/admin/analytics` — CPA/案件質分析
  - `/admin/industry-analysis` — 業種別分析
  - `/admin/incentive` — インセンティブ管理
  - `/admin/projects` — 案件管理
  - `/admin/project-assignment` — 案件割り振り
  - `/admin/companies` — 架電リスト管理（時間帯ルール・都道府県設定）
  - `/admin/sales-performance` — 営業売上一覧
  - `/call` — オペレーター架電画面
  - `/call-results` — 架電結果ログ
- Railway デプロイ

### データベース
- MySQL 8（Railway Volume）
- 主要テーブル:
  - `users` — ユーザー（role: admin/manager/operator/intern/sales/consultant）
  - `companies` — 架電リスト（industry_category 事前計算、region 正規化）
  - `calls` — 架電記録
  - `projects` — 案件
  - `project_hires` — 内定者情報（initial_payment / expected_revenue）
  - `recall_tasks` — リコール
  - `company_assignments` — 企業の個別割当
  - `industry_time_rules` — 時間帯×業種優先度
  - `industry_region_rules` — 業種×地域ルール
  - `kpi_adjustments` — KPI手動補正
  - `cost_records` — 打刻データ
  - `monthly_payroll_records` — 給与PDF/Excel取込データ ← NEW
  - `monthly_extra_costs` — 追加コスト（コンサル料等） ← NEW
  - `past_cpa_data` / `past_quality_data` — 移行前手動入力データ
  - `status_sheets` — ステータスシート

### 主要 system_settings キー
- `auto_pickup_industries` — 業種別ピックアップ有効/無効マップ
- `auto_pickup_prefectures` — 都道府県別ピックアップ有効/無効マップ
- `team_targets` — チームKPI目標値
- `region_backfill_done` — 起動時 region 正規化フラグ

---

## トラブルシューティング

### Railway 障害時 (2026/5/19)
Google Cloud アカウントブロックによる全体障害。
コードや DB は無事。復旧後 GitHub `main` から自動デプロイされる想定。

### 給与PDFインポート
- PDF は production 環境で text 抽出が不安定 → Excel (`.xlsx`) を推奨
- Excel は `xlsx` パッケージで table 構造をそのまま解析

### `year_month` 予約語問題
MySQL 8 の予約語のためカラム名を `period_ym` に改名済。
