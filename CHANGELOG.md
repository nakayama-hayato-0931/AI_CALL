# CHANGELOG

主要な変更履歴。詳細はそれぞれのコミットメッセージ参照（`git log`）。

---

## 2026年6月 〜 直近

### CPA: 入金実績の抽出修正（シート名クォート + 登録番号の分割照合）
- ビザ進捗シートの範囲をシート名スペース対応でクォート: `'ビザ申請 進捗'!G:CC`（未クォートだと範囲解析エラーでマップが空＝入金実績0だった）。
- 登録番号が1セルに複数（例: `TT5247, GC6415`）入る場合に備え、区切り文字で分割して1件ずつ照合・合算するよう修正。

### CPA: 入金実績 + 実績ROAS 列を追加（ビザ申請進捗シート連携）
- ROAS の右に「入金実績」「実績ROAS」列を追加（`analytics.js`）。
- 入金実績 = 内定者の登録番号(`project_hires.registration_number`)を Google スプレッドシート「ビザ申請 進捗」シートの G列で照合し、一致行の CC列の数値×10,000円を合算（`googleSheetsService.getVisaPaymentMap`、5分キャッシュ）。
- 実績ROAS = 入金実績 / コスト（既存ROASと同じ計算式、入金実績ベース）。
- 集計対象は既存の初回入金(finMap)と同じ（finDateCol基準・is_legacy=0・未取消の内定者）。
- スプレッドシートIDは env `VISA_PROGRESS_SPREADSHEET_ID`（未設定時は既定ID）。サービスアカウントに該当シートの閲覧権限が必要。未共有/エラー時は入金実績0（既存指標に影響なし）。
- 注意: 過去シード(`past_cpa_data`)には登録番号が無いため入金実績は付かない（実案件分のみ）。

### 架電画面: NG理由に選択肢追加
- NG理由に「経験者のみ(専門分野を学習含む)」を追加（`call.js`、「アルバイトだけ(正社員NG)」の下）。

### CPA: 内定内訳に求職者の登録番号を表示
- 内定の業種別内訳モーダルの案件明細に「登録番号」列を追加（NAITEI時のみ）。
- `getQualityIndustryDetail` の明細で `project_hires.registration_number` を `GROUP_CONCAT` し、1案件に複数内定者がいる場合はカンマ区切りで表示。

### CPA: 集計の日付基準トグル（案件獲得日 / 内定日）+ 内訳の不一致修正
- CPA指標タブに「集計基準」トグルを追加（`analytics.js`）。既定は **案件獲得日(created_at)**、切替で **内定日** 基準。
  - 内定日モードの基準: コスト/コール/案件数=獲得日のまま、面接数=面接実施日(interview_date)、内定/不合格/バラシ失注/初回入金/見込売上/ROAS=内定日(naitei_date)。
  - `getCpaAll` に `date_base` パラメータを追加し、案件集計（projAll）と金額集計（finMap）の日付軸を基準ごとに切替（`analyticsController.js`）。
- 内訳（業種別内訳モーダル）と一覧の不一致を修正:
  - 一覧は案件獲得日基準＋レガシー除外なのに、内訳モーダルは内定日固定＋レガシー混在で数字がずれていた。
  - `getQualityIndustryDetail` に `date_base` を追加し、内定ドリルダウンを一覧と同じ基準（acquisition→created_at / naitei→naitei_date）に一致させ、`is_legacy = 0` を追加してレガシー案件を除外。
  - 注意: 過去シード(`past_cpa_data`)は明細を持たないため、シードを含む月は内訳合計が一覧よりシード分少なくなる（実案件分は一致）。

### 不通の再ピックアップ: リコール由来のみ1時間後、通常は従来通り2日後
- 通常の不通(NO_ANSWER)は従来通り2日後に再ピックアップ（`companyController.js` の不通バケットは `INTERVAL 2 DAY` のまま）。
- リコール企業への架電が不通だった場合のみ、`endCall`（`callController.js`）で同企業の `pending` リコールの `recall_at` を `NOW() + 1 HOUR` に再設定し、1時間後に recall_due として再ピックアップされるようにした（直後に再度対象化されて邪魔になる問題を解消）。

### リコールの重複作成防止 + 自動完了
- **重複作成防止**: リコール企業に再架電して結果を再びリコールにした際、新規 recall_tasks を作らず、同企業の `pending` リコールを更新（recall_at / user_id / call_id）するように変更（`callController.js` endCall）。pending が無い場合のみ新規作成。
  - これに伴い RECALL の 409 重複確認（DUPLICATE_RECALL）と overwrite キャンセル処理を撤去（PROJECT の重複確認は維持）。フロントの確認ダイアログは PROJECT のみに縮退（フロント変更なし）。
- **自動完了**: リコール企業への架電で、不通(NO_ANSWER)・リコール(RECALL)以外の確定結果（NG / INTERESTED / PROJECT）を入力したら、同企業の `pending` リコールを `completed` に自動更新。

### ルール設定 ①②保存の体感速度改善（楽観的更新）
- 保存の遅さは Railway へのネットワーク往復（コールドスタート含む）が要因。保存処理自体は `system_settings` への単一UPSERTでミリ秒。
- ①② の保存を楽観的更新に変更: クリック即「未保存」解除＋成功表示、PUTは裏で実行し失敗時のみ「未保存」に戻してエラー表示。「保存中...」スピナー状態は廃止。

### ルール設定 ①②自動ピックアップの保存修正
- **不具合**: 「①自動ピックアップ対象 業種」「②自動ピックアップ対象 都道府県」の保存済み状態が、`ルール設定(area)` タブで一切ロードされていなかった（取得が `架電時間(time)` タブ限定だったため）。結果、②は常に全未チェック表示、トグルは空マップbaseで部分PUTされ保存が壊れていた。
- **修正**:
  - 自動ピックアップ取得を `loadAutoPickup()` に切り出し、area / time 両タブの表示時にロード。
  - ①② を **明示保存方式** に変更（トグルはローカル編集のみ → 各セクションの「保存」ボタンでまとめてPUT）。未保存時は「未保存」表示＋保存ボタン活性、保存後に非活性。
  - 従来のトグル即時PUT（部分マップ上書き）を廃止し、データ消失を防止。
  - バックエンドAPI（`GET/PUT /api/admin/auto-pickup-industries`・`auto-pickup-prefectures`）は変更なし。

### ルール設定（業種×地域）に編集機能
- 架電リスト管理 → ルール設定タブの「設定済みルール」に **「編集」ボタン** を追加（`admin/companies.js`）。
  - 従来は削除して新規作成しかできなかった業種×地域ルールを、既存の都道府県セットを読み込んで直接編集できるように。
  - 編集ボタンで業種キーワード＋現在の都道府県を追加/編集フォームに展開（フォームへ自動スクロール・編集中ハイライト）。
  - 保存時は差分適用（業種キーワード不変なら追加分のみINSERT・除外分のみDELETE、リネーム時は旧業種を全削除して再作成）。「キャンセル」で編集モード解除。
  - バックエンドAPIは既存の `POST/DELETE /api/admin/industry-region-rules` をそのまま利用（サーバー変更なし）。

### 引き継ぎ整備
- リポジトリ直下に `CLAUDE.md`（引き継ぎ書）を新設。新セッションが最初に読む全体像・アーキテクチャ・開発規約・現状・更新運用ルールを集約。
- 消化済みの `.claude/plan.md`（架電エリア設定リファクタリング、実装済み確認）を削除。

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
- **顧客マスタ: 一括同期 + 同期状態表示**
  - 個別の同期ボタンを撤去し、ページ上部に「一括 送信 / 一括 取込 / 一括 双方向同期」を追加（対象は現在の一覧フィルタ結果）。
  - `POST /api/admin/customer-master/bulk-sync` { ids[], direction: push|pull|both }。最大500社。
  - companies に `last_synced_to_faxcrm_at` / `last_synced_from_faxcrm_at` カラム追加（idempotent ALTER）。
  - 一覧テーブルに「同期」列を追加（↑送信日 / ↓取込日 / 未同期）、詳細パネルにも同期日を表示。
- **顧客マスタ: ページネーション + 並び順改善 + UI 整理**
  - 一覧をページングに変更（page / limit パラメータ、total / totalPages 返却）。デフォルト 50件、25/50/100/200 切替。
  - 並び順を「最終更新が近い順」に: 架電 / 手動アクション / 同期日時 / 作成日時 の GREATEST。
  - 詳細パネルの「NG理由（過去）」セクションを削除（アクション履歴に NG 理由が表示済みのため重複）。
- **サービスアカウント対応**
  - `authenticate` ミドルウェアで JWT の `isServiceAccount` を `req.user.isServiceAccount` に伝搬。
  - rate-limit (`/api/` の 3000req/15min) のスキップ条件にサービスアカウントを追加（fax-crm 同期バッチが上限に当たらないように）。`skip` 内で JWT を再検証してから判定するため不正トークンによる免除は不可。
- **顧客マスタ: FAX番号フィールド追加**
  - companies に `fax_number VARCHAR(50)` 追加（idempotent ALTER）。
  - `PATCH /api/admin/customer-master/:id`（fax_number / phone_number / company_name / address を任意で更新）。
  - 顧客マスタ詳細パネルで FAX番号をインライン編集可能（管理者・マネージャー）。
  - fax-crm への push payload に `fax_number` を含めるよう拡張。
- **fax-crm からのリアルタイム webhook 受け口**
  - 新ルート `/api/integrations/faxcrm/*`（JWT 認証ではなく `X-Webhook-Secret` ヘッダで認証）。
  - エンドポイント:
    - `POST /api/integrations/faxcrm/event` — 単発イベント
    - `POST /api/integrations/faxcrm/events` — `{ events: [...] }` でバルク
    - `GET  /api/integrations/faxcrm/health` — ヘルスチェック
  - 受信時に `company_actions` に upsert（`[fax-crm:<id>]` タグで冪等化）+ `companies.last_synced_from_faxcrm_at` を更新。
  - 環境変数 `FAX_CRM_WEBHOOK_SECRET` を新設（fax-crm 側でこの値を `X-Webhook-Secret` に載せて POST）。
  - rate-limit の skip 対象に `/api/integrations/faxcrm/*` を追加。
  - これで fax-crm 側で FAX 送信した瞬間に callcenter のタイムラインに反映される双方向リアルタイム同期が完成。
- **CPA分析: 追加コストの加算ルール修正**
  - `getCpaAll` に `include_extra` クエリパラメータを追加（既定: `period === 'custom'` のときのみ加算しない）。
  - フロント側 (analytics.js) の週フェッチ・任意期間フェッチに `include_extra=0` を付与。
  - これで 5月の各週行に 5月分の追加コスト (例: ¥150,000) が二重計上される問題を修正。
  - CPA 分析画面下に「追加コスト」枠を新設（対象月・区分・金額・メモを一覧表示、合計付き）。
- **業種別分析: 業種×地域 マトリクス表示**
  - `GET /api/analytics/industry-monthly-analysis?group_by=both` を新設（指定期間の業種×地域の合算セル + 行/列/総合計）。
  - `GET /api/analytics/industry-period-detail` に `region` および `date_from / date_to` クエリを追加（マトリクスの任意セルから明細表示）。
  - フロントの groupBy トグルに「両方」ボタンを追加。業種×地域のマトリクス表をレンダリング（行/列合計付き、セルクリックで明細）。


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
