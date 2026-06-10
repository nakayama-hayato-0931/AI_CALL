# CHANGELOG

主要な変更履歴。詳細はそれぞれのコミットメッセージ参照（`git log`）。

---

## 2026年6月 〜 直近

### ダッシュボード: 営業ロールにメンバー一覧テーブルを追加 (sales のみ)
- 営業ロール (role='sales') のダッシュボードに「営業メンバー一覧」セクションを追加。
- 自分の KPI カードはそのまま、その下にチーム全員の数値テーブル。
- 並び順: 自分先頭 → 稼働中 (total_calls > 0 or work_minutes > 0) → 他は total_calls 降順。
- 列: 営業 / 稼働(時間) / コール / 有効接続 / 担当接続 / 案件 / リコール獲得 / リコール消化 / 平均通話。
- オペレーターロールは従来通り自分の数値のみ (sales 用テーブルは表示しない)。
- バックエンド: `GET /api/admin/performance` を sales が `call_type=sales` のとき呼び出せるよう権限緩和 (内部処理は既存 `getAllOperatorPerformance` を流用)。

### 架電リスト: ②自動ピックアップ対象都道府県 を最優先=絶対条件に格上げ
- 「② で除外した県の企業が業種別ルール (③) や自分割り当て経由で出てくる」事象 (例: 製造の東北がピックアップ) を修正。
- ② (`prefectureFilter`) は `assignBypassWrap` のバイパス対象から除外し、各Tier (Tier 0/2/3/4/5) で必ず AND 適用。
- ③ (業種地域ルール `irFilter`)・業種除外 (`goldenIndFilter`)・モードフィルタは引き続き「自分割り当て」でバイパス可能。
- 適用順イメージ: ② で許可された都道府県の中で、③のルールを満たす企業を表示。② 東京/大阪 & ③ 全国 → 東京/大阪のみ。
- 影響Tier: Tier 0 (assigned)・Tier 2 (golden)・Tier 3 (untouched)・Tier 4 (retry_no_answer)・Tier 5 (retry_ng)。Tier 1 (recall) は引き続き例外 (本人がセットしたタスクのため)。

### CPA: バラシ/失注 業種別内訳モーダルの右3列を差し替え
- バラシ/失注には内定人数/初回入金/見込売上が存在しないため、右3列を「書類選考の有無 / 面接方法 / 面接日」に変更。
- バックエンド: `getQualityIndustryDetail` の明細クエリに `p.document_screening, p.interview_type, p.interview_date` を追加。
- フロント: status が BARASHI/LOST/BARASHI_LOST のとき列構成を分岐。合計行は「合計N件」のみ表示。
- 内定 (NAITEI) / その他 (LOST単独/BARASHI単独でも数値表示が要らない=このパッチ対象) のヘッダー/フッターも同期。

### ダッシュボード: コール数を企業ユニーク数に変更 (同一企業の複数回コールは1回扱い)
- ダッシュボードKPIの「コール数」を `COUNT(*)` → `COUNT(DISTINCT c.company_id)` に変更。
- 同じ企業に何度かけても1社=1コール扱い。
- 有効通話数 / 担当者通話数 / 案件化数 / リコール獲得数 / 接続率分母 (時間帯別グラフ) は通算カウントのまま (個別イベントを示す指標のため)。
- 対象: `dashboardController.getDashboardStats` のメインKPI集計クエリ。

### 架電リスト: Tier 0 (自分割り当て専用) を追加、永久除外も含めて必ず架電可能に
- 管理画面で「○○割り当て中」とオレンジ表示される企業を、本人がオペレーター画面で必ず架電できるように。
- Tier 1(recall) と Tier 2-5 の間に Tier 0 を挿入。reason='assigned'。
- バイパス条件: `lastResultExclusionSQL` (SKIP/PROJECT/RECALL/INTERESTED 永久除外) / 業種地域 / モード / `last_called_at IS NULL`等の経過条件 すべて。
- 残す条件: ロック (`lockFilterSQL`) / 1時間以内除外 (`recentCallFilterSQL`) / recall_tasks pending除外 / exclusion_flag・is_special。
- これで「自分割り当て & 前回INTERESTED/SKIP」のような企業も本人架電画面に出る。

### 架電リスト: 自分に割り当てがある企業は業種地域/都道府県/モードフィルタをバイパス
- オペレーターが「自分に割り当てた企業が自分にも出てこない」事象を修正。
- 原因: 各Tier (golden_time/untouched/retry_no_answer/retry_ng) で適用される `irFilter` (業種地域ルール) / `goldenIndFilter` (ゴールデン業種除外) / `prefectureFilter` (自動ピックアップ都道府県) / `modeFilterSQL` (auto モード業種フィルタ) が、自分割り当て企業も除外していた。
- 修正: 4つのフィルタを `assignBypassWrap` で包み、`EXISTS (company_assignments where user_id = ?)` のときバイパス。各Tier params に `userId` を1つ追加。
- 影響: 旧来「自動ピックアップで拾われない条件」の企業も、自分に割り当てがあれば必ず架電リスト先頭(is_assigned DESC)に出る。

### CPA: バラシ/失注 セルクリックで業種別内訳モーダル
- CPA指標テーブルの「バラシ/失注」セルをクリックで業種別内訳モーダルを開けるように。
- バックエンド: `getQualityIndustryDetail` の `status` に `BARASHI_LOST` を追加 (`p.status IN ('BARASHI','LOST')` で集計)。
- フロント: cpaColumns に `clickable: 'industry:BARASHI_LOST'` 追加、labelMap に「バラシ/失注」追加。
- 取得元は v1 (callcenter.projects テーブル、status=BARASHI or LOST)、バラシ/失注 列の表示と一貫。

### 案件管理: 求人番号 自動取得ボタン
- 求人番号が未入力の案件について、自動でソースから取得して埋める。
- ソース優先順:
  1. 同じ `company_id` の他案件で求人番号があるもの (最新)
  2. **`job_postings_v2` (架電バイト求人情報シート) から会社名で完全一致 → 正規化マッチ**
- 会社名正規化: 全角/半角空白除去 + 「株式会社」「(株)」「(有)」「合同会社」等の前後表記を除去後、小文字化。
- バックエンド: `POST /api/admin/backfill-job-numbers` (requireEditor)。
- フロント: 案件管理ヘッダに青緑「求人番号 自動取得」ボタン (管理者・マネージャー)。
- 結果トーストにソース別件数を表示 (同社案件:N / 求人情報シート:M)。

### 案件質: 書類選考中 定義変更 + 詳細モーダル追加
- 「書類選考中」の集計を `status='SHORUI_CHU'` → `document_screening='required' AND status='BOSHUCHU'` (書類選考あり+募集中) に変更。
- 手動補正の actualSql も同じ条件に揃えた。
- 案件質テーブルの「書類選考中」セルクリックで詳細モーダルを開けるように。
- 詳細モーダル列: 案件獲得日 / 求人番号 / 企業名 / 担当営業 / 架電担当(owner) / 募集開始日 / 履歴書送付日 / 面接日。未入力は薄いグレーで「未入力」表示。
- 新エンドポイント `GET /api/analytics/screening-in-progress?date_from=&date_to=&user_id=` (requireManager)。

### インセンティブ管理: 新CPA(v2)データで内定日ベース集計
- 既存の callcenter.projects ベース集計から、sales_projects_v2 (架電バイト/fax-crm互換) ベース集計に変更。
- オペレーター紐付け: sales_projects_v2.job_number → callcenter.projects.owner_user_id → users.name で解決。
- 内定社数: 同一job_numberの複数行(=複数内定者)は1社にユニーク化(Setで dedupe)。
- 入金実績(payment_actual) と 実績ROAS をサマリ/オペレーター行/案件詳細/合計行に追加。
- 案件詳細に「状態」(取消/辞退)列を追加。
- インセンティブ画面に <Layout wide> を適用 (テーブル拡張対応)。
- v2テーブル不在時は v1ロジックにフォールバック (try/catch)。

### 案件管理: 募集開始日 一括補完ボタン (管理者・マネージャー)
- 4/1以降・書類選考あり・募集中・募集開始日未入力の案件すべてに、案件獲得日(DATE(created_at))と同日を一括入力する管理API/ボタンを追加。
- バックエンド: `POST /api/admin/backfill-recruitment-start-date` (requireEditor)
- フロント: 案件管理画面ヘッダ「手動追加」の左隣にオレンジ「募集開始日 一括補完」ボタン。
- 今後はステータスを募集中に変えた日に自動入力 (既に実装済み)。

### CPA-v2: 集計基準トグル(内定日/獲得日)が v2 に伝わっていなかった修正
- 旧CPAの「集計基準」(cpaBase) を v2 API (basis=acquired/offer) にもマッピングして渡すように修正。
- 内定日基準を選択しても v2 が常に案件獲得日基準のままだった問題を解消。
- 月別マージ・内訳モーダル両方で cpaBase を尊重。

### CPA画面のコンテンツ幅制限を撤廃 (画面いっぱい使う)
- Layout に `wide` prop を追加。`wide` 時は `max-w-[1600px]` を外し画面いっぱいに表示。
- CPA/案件質分析画面 (`/admin/analytics`) で `<Layout wide>` を指定。
- ROAS/実績ROAS 等の右端列が画面広げても見切れていた問題を解消。

### CPA-v2: バラシ/失注も v1 のまま + 比較モードの月表示を降順に
- バラシ/失注(barashiLostCount)もmergeV2Intoから外して v1(既存projects テーブル)由来のまま表示するように変更。
- 比較モードの月リスト生成を降順に変更 (例: 6月→5月→4月...)。

### CPA-v2: 案件数を v1 のまま / 内訳に架電担当者・面接結果を追加
- 案件数(projectCount)は既存(projects テーブル)から取得するよう mergeV2Into から外した。案件化率・案件CPAも v1 のまま。
- 既存CPAテーブルの「内定/面接数/不合格」セルクリック (全体行のみ・単一月) で v2 内訳モーダルが開けるように:
  - **内定社内訳モーダル**に「架電担当者」列を追加 (求人番号で callcenter.projects→users.name 解決)
  - **面接内訳モーダル**に「面接結果」(合格/不合格/結果待ち) と「架電担当者」列を追加
  - 面接結果: pass_count>0=合格, =0=不合格, IS NULL+1ヶ月以上経過=不合格, それ以外=結果待ち
- 既存の業種別内訳モーダル (旧CPA) はそのまま動く (cpaMode='v1' or 個人行 or 複数月またぎ時はフォールバック)。

### CPA-v2: 既存CPAテーブルに v2 数値を上書きマージ (UI完全互換)
- 既存UI(列構成/月のトグル/期間切替/対象/案件質向上切替/月降順)を全部維持しつつ、新CPAモード時に下記指標だけ v2(架電バイト/fax-crm互換) 由来で上書き:
  - **内定/不合格/バラシ・失注/初回入金/見込売上/案件数/面接数/入金実績**
- コスト/コール数 は変更なし (旧CPAのまま、cost_records/calls から)
- 派生指標 (案件CPA/面接CPA/面接実施率/ROAS/実績ROAS) は v2 数値で再計算
- 個人選択/週別表示は v2 オペレーター紐付けなし・月単位のみのため、旧CPA数値のまま (混乱回避)
- monthly/compare(月行のみ)/custom(単一月のみ) で v2 マージ適用、cumulative/週別/個人別は v1
- タイトル横に「新CPA/旧CPA」トグル、新CPA時は「Sheets同期」ボタンも表示
- `CpaV2View.jsx` と `pages/admin/cpa-v2.js` は削除

### CPA-v2: 既存CPA画面に統合 (旧/新トグル、デフォルト新CPA)
- Layout の「新CPA」リンクを削除。`/admin/cpa-v2` ページも削除。
- 既存 `/admin/analytics`(CPA/案件質分析) 画面のタイトル横に「新CPA / 旧CPA」トグルを追加。デフォルトは新CPA。
- 新CPAビューを `components/admin/CpaV2View.jsx` に切り出して既存画面から呼び出し。
- 既存「新CPA(β)」モーダルとボタンは重複のため非表示化。

### CPA-v2: Phase 2 — 新CPAページ + 詳細モーダル
- 新ページ `/admin/cpa-v2` を追加。Layout の「分析」セクションに「新CPA (fax-crm互換)」リンク(管理者のみ)。
- 基本機能:
  - basis 切替トグル (案件獲得日 / 内定日)、月数選択 (3/6/12/24/36)
  - 月別表 (案件数/バラシ/面接数/不合格/内定社数/内定率/面接実施率/初回入金/見込売上/入金実績)
  - 同期ボタン (Google Sheets 同期、最大90秒)
- 詳細モーダル (画像どおりの設計):
  - **内定社内訳** (内定社数クリック): 状態/内定日(A)/案件取得日(BK)/求人番号(B)/会社名(BD)/合格人数/登録番号(G)/営業担当(E)/業種(CF)/初回入金(BI)/見込売上(BJ)/入金実績(CC)。同一求人の重複行は「〃」表示、内定社数+合格者数+取消辞退の集計をフッタに。
  - **面接内訳** (面接数クリック): 面接シート全行 + 内定のみ加算分(UNION)を別セクションで表示
  - **不合格内訳** (不合格クリック): 不合格条件(NQ=0 or NQ空欄+1ヶ月経過)に該当する行
- 既存 `/admin/analytics` と既存「新CPA(β)」ボタンは並行で残す。

### CPA-v2: シート診断にサービスアカウントメール+シートリンクを表示
- 「シート診断」セクションに**共有先サービスアカウントメール**（コピペ可）と各シートを開くリンクを追加。
- 「失敗」と表示されたシートに何のアカウントを共有すれば良いかが一目で分かる。
- 売上/求人情報シート (1wPH1sud...) と面接シート (1gHldK7...) どちらも、表示されたサービスアカウントに「閲覧者」で共有する運用に対応。

### CPA-v2: ポップアップ→モーダル表示に変更
- ブラウザのポップアップブロックで結果が見られない問題への対策。
- 新CPA(β) ボタン押下で別ウィンドウ (window.open) ではなく、CPA画面内モーダルで表示。
- 操作バーに basis 切替トグル (案件獲得日/内定日)、「集計を取得」「シート同期+集計」ボタン。
- 同期結果・シート診断・月別集計をすべてモーダル内で表示。

### CPA-v2: Sheets API レート制限対策 + 権限案内
- 同期と診断を同時に投げて `Quota exceeded` (per-user 60req/min) でほぼ全失敗していた問題への対策。
- `fetchSheetValues` に exponential backoff リトライ (429/quota 検知時、最大3回、30秒/60秒/90秒待機)。
- `/api/cpa-v2/sync` で各シート間に 2秒待機を入れて緩和。
- フロント: sync を実行した場合は probe をスキップ (同期結果に kept/skipped が出るため十分)。
- 面接シート (1gHldK7...) の権限 (`The caller does not have permission`) はサービスアカウントへの共有が必要 — 運用で対応。

### CPA-v2: 新CPA(β) のプレビューに同期結果＋シート診断を追加
- 「新CPA(β)」ボタン押下時、月別集計が0行のとき原因が分からない問題への対策。
- 新ルート `GET /api/cpa-v2/probe` で各シートの source_kind 相当列(BE/H/NR)のユニーク値別件数を返す。
- 新ウィンドウ上部に「シート同期結果(JSON)」「シート診断(架電バイト/FAX受電 等の件数)」「集計0行時の説明」を表示。
- 「架電バイト」件数が0ならシートに該当データなし、件数があれば同期エラーと一目で切り分け可能に。

### CPA: fax-crm 互換ロジックを並行実装 (cpa-v2, Phase 1)
- 並行して動いている fax-crm-system と同じロジック・同じ Google Sheets を共有する CPA を新設。違いは source_kind が 'FAX受電' → '架電バイト' のみ。
- **既存 /api/analytics には一切影響しない**並行配置。ロールバックはフロントの「新CPA(β)」ボタンを外す + server.js のルート登録1行を削除するだけ。
- Phase 1 (今回 — backend インフラ + 動作確認UI):
  - 新サービス: `services/cpa-v2/_common.js` / `salesProjectService.js` / `jobPostingService.js` / `interviewService.js` / `cpaService.js`
  - 新ルート: `POST /api/cpa-v2/sync` / `GET /monthly` / `GET /offers` / `GET /interviews` / `GET /jobs` / `GET/PUT /config`
  - 新テーブル: `sheets_config_v2` / `sales_projects_v2` / `job_postings_v2` / `interview_records_v2` (起動時 criticalPreflight で作成)
  - Google Sheets 認証は callcenter スタイル(`GOOGLE_SERVICE_ACCOUNT_EMAIL` + `GOOGLE_PRIVATE_KEY`)に統一
  - CPA画面に紫の隣に「新CPA(β)」ボタン(青緑)を追加。同期 → 月別集計を新ウィンドウで表示。
- 揃え方:
  - 同一企業 dedupe キー: `COALESCE(NULLIF(job_number, ''), company_name)`
  - 月キー: `DATE_FORMAT(col, '%Y-%m-01')`
  - basis 切替: `acquired_date` / `offer_date` (interview_records 側は `acquired_date` / `interview_date`)
  - 「面接人数=0 かつ 合格=0/空欄」のノイズ行は除外
  - 取消・辞退は内定社1としてカウント、売上は0 (fax-crm と同一)
- Phase 2 で予定: 詳細モーダル (画像通り)、basis トグルUI、コスト系 (架電バイト人件費)、Phase 3 で朝7時バッチ。

### 管理者向け: CPA入金実績の診断ツール
- CPAの「入金実績」が出ない原因（シート読み取り失敗 or 登録番号未マッチ）を切り分け。
- バックエンド `GET /api/admin/diagnose-visa-payment?date_from=&date_to=` を新設。
  - ① シート読み取り可否＋サービスアカウントemail＋シート先頭サンプル
  - ② マップサイズ
  - ③ 対象期間の内定者ごとの登録番号→マッチ結果（分割トークン別の金額）
  - ④ 自動診断 hint（シート未共有/全件未マッチ等を判別）
- CPA画面（手動補正の隣）に「入金実績診断」紫ボタンを追加。新ウィンドウで赤色強調付きの表として表示。

### 管理者向け: 案件数差分診断ツール
- ダッシュボードと案件管理の案件数が合わない時の原因切り分け用。ダッシュボード上部に「案件数差分診断」ボタンを追加（管理者のみ）。
- バックエンド `GET /api/admin/diagnose-projects?date_from=&date_to=` を新設。owner_user_id × call_type の集計を返す。
- 集計差の最有力原因（案件管理は call_type フィルタなし、ダッシュボードは `call_type='operator'` で絞る）が user 別に可視化される。
- 結果はクリック時に新ウィンドウで表として表示（オペレーター別の差分、call_type=null/sales/other の内訳）。

### ダッシュボードAI分析: 条件別に永続化（次回も自動表示）
- 従来は sessionStorage に1件のみ保存（タブ閉じると消える＋条件を切り替えると消える）。
- localStorage に **条件キー（scope/userId/period/date_from/date_to）別** に保存し、同条件で開き直すと過去実行結果を自動表示。
- 「分析実行: 2026/06/08 14:25」のような実行日時バッジを結果上部に表示。
- 同条件で再実行すると新しい結果で上書き。最大50件まで保持（古い順に自動削除）。
- 例: 6/8に月別6月を実行 → 6/10にダッシュボード開くと6/8実行分が即表示 → 6/10に再実行すれば最新で上書き。

### 架電リスト: fast path 未有効時はティア4/5を完全スキップ
- `last_call_result_code` カラムが未追加でフォールバックモードのとき、ティア4/5の相関サブクエリ（60万行に対し毎行 calls ORDER BY LIMIT 1）が壊滅的に遅い問題への暫定対策。
- カラム未追加時はティア4/5を生成せず Promise.resolve で空応答 → 未接触/ゴールデンの結果のみで返却。応答時間が大幅短縮。
- preflight のログを詳細化（SHOW COLUMNSによる事前チェック+カラム追加結果ログ）。

### 架電リスト: last_call_result_code のフォールバック実装
- `c.last_call_result_code` カラムが何らかの理由で存在しない場合でも動作するよう、起動時に `SHOW COLUMNS` でカラム有無を確認し、無ければ従来の相関サブクエリにフォールバック。
- 5秒ごとに再チェック（preflightが遅れて完了する場合に自動切替）。
- 「Unknown column」エラーで架電リストが取得できなくなる事故を防止。

### 起動シーケンス修正: criticalPreflight でカラム追加を先に await
- これまで `runMigrations()` が await されずに `app.listen()` が始まっていたため、ALTER TABLE 完了前にAPIリクエストが処理され「Unknown column 'c.last_call_result_code'」エラーが発生していた。
- 新カラム ALTER（`last_call_result_code` / `last_call_user_id`）と関連INDEXを `criticalPreflight()` に分離し、必ず完了してから listen 開始するよう変更。
- その他の重いマイグレーション・region正規化・seedは listen 後に非同期実行（起動時間は伸ばさない）。

### 起動時バックフィル(last_call_result_code)を非同期＋チャンク化
- 60万行UPDATEを `setImmediate` 内で実行し、サーバー起動・他リクエストを妨げないように。
- 500件×直列＋5000件ごとに50msの sleep でDBコネクションプールが詰まらないよう調整。
- これにより営業/オペレーター両方で出ていた「架電リストの取得に失敗 (500/502)」を解消。

### 営業アカウントでもリコール管理を表示
- 営業の左メニュー「業務」セクションに「リコール管理」（`/recalls`）を追加（`Layout.jsx`）。
- バックエンドAPIは元から認証のみで誰でも利用可（`req.user.id` でログインユーザーのリコールを返す）。

### 架電リスト高速化 第3弾（相関サブクエリ排除）
- 一番重かった `(SELECT cl3.result_code FROM calls...ORDER BY started_at DESC LIMIT 1) = 'NO_ANSWER'/'NG'` の相関サブクエリ（60万行に対し毎行評価）を排除。
- `companies` に **`last_call_result_code` / `last_call_user_id` カラムを追加**し、`endCall` 時に同期。ティア4/5は `c.last_call_result_code = 'NO_ANSWER'` のような単純条件で判定可能に（インデックス: `(last_call_result_code, last_called_at)`）。
- 起動時に既存全社（最大60万行）へ1回バックフィル（`system_settings.last_call_result_backfilled` フラグで二度実行しない）。`getNextCallTarget` / `getCallList` 両方に適用。
- `recentCallFilterSQL` も NOT IN → NOT EXISTS に変換。
- 結果: ティア4・5の応答時間が**桁違いに高速化**する見込み（行ごとサブクエリ → 単純カラム比較）。

### 架電リスト高速化 第2弾（オペレーター効果大）
- `assignmentFilterSQL` / `recall_tasks` 重複除外を `NOT IN (SELECT ...)` → `NOT EXISTS` に変換。NOT IN は大きなテーブルスキャンになりやすいが NOT EXISTS はインデックスが効きやすい（オペレーター環境で `company_assignments` が大きい場合に特に効く）。
- キャッシュTTLを 10秒 → 20秒に延長（15秒ポーリングで毎回ヒット）。
- インデックス追加: `company_assignments(company_id, user_id)`（NOT EXISTS の `company_id = c.id` を高速化）。

### 架電リスト(getCallList)の高速化（営業/オペレーター両方）
- Tier 2-5（ゴールデン/未接触/不通リトライ/NGリトライ）を `Promise.all` で並列実行に変更。直列だと各ティアで重いサブクエリを順番に評価していたため遅かった（60万行クラスのDBで顕著）。
- 10秒インメモリキャッシュ追加（user+mode+industry+callType単位）。15秒ポーリングで2回に1回はDBアクセスなしで即返却。
- ロック取得/解除・通話結果保存時にキャッシュを無効化（架電済企業が他ユーザーのリストに残らないように）。
- インデックス追加: `companies(is_sales_list, exclusion_flag, is_special, last_called_at)` / `recall_tasks(status, company_id)`。

### CSVインポート: ストリーミング処理化（records配列廃止、メモリ91MBに削減）
- importCompanies が `parseFile()` で全行を records配列にロードしていたため、60万行で 1.1GB のメモリを消費しOOMでプロセスクラッシュ→CORSエラー表示になっていた問題を解消。
- `parseFile/parseExcelFile/parseExcelHugeStream/parseCsvFile` に `onRow` コールバック引数を追加し、ストリーミング処理に対応。
- importCompanies のループを `processRow(record)` 関数化し、`parseFile(..., processRow)` で 1行ずつ受け取る方式に変更（records配列を持たない）。
- 動作確認: 60万行xlsx → **ピークメモリ 91MB**（従来の1/12）、37秒でパース完了。Railway標準インスタンスでも余裕で動作する見込み。

### CSVインポート: 巨大xlsx展開を unzip コマンドから fflate(純粋JS)に変更
- Railway環境に `unzip` コマンドが無く `spawn unzip ENOENT` で失敗していた問題を解消。
- `fflate.Unzip` + `UnzipInflate` でストリーミング解凍に切替。`fs.createReadStream` で xlsx を読みつつ、解凍チャンクを `TextDecoder(stream)` でデコード → `<row>` 単位で逐次パース。
- 依存追加: `fflate@^0.8`（純粋JS、30KB、依存ゼロ）。
- 動作確認: 60万行/800MB の xlsx → ピークメモリ 1.1GB、37秒でパース完了。

### CSVインポート: Node heap 4GB に拡張
- 巨大xlsx（60万行/800MB）のパース+取り込み中にOOMで500になる症状を回避するため、`start` スクリプトに `--max-old-space-size=4096` を追加。
- 既存の `importCompanies` の catch は `message` を含む500レスポンスを返すため、Networkタブで Response 本文を確認すれば原因が特定可能。

### CSVインポート: 巨大ファイル受信のサーバー側設定
- multer のファイルサイズ上限を 50MB → **1GB** に拡張（全業界まとめ.xlsx 800MB級対応）。
- multer の `fileSize` / `fileFilter` エラーを JSON 400 で返すエラーハンドラを追加（従来は HTML エラーが返り、CORS ヘッダ欠落でブラウザ側ではCORSエラー扱いに見えていた）。
- Node HTTP サーバーの `requestTimeout=0`（無制限）/ `headersTimeout=60min` / `setTimeout(0)` で、巨大アップロード〜長時間インポートの応答を切断しないよう設定。

### CSVインポート: 大規模ファイル対応 - バッチINSERT + チャンクcommit
- 60万行クラス（全業界まとめ等）の一括取り込みを現実的な時間で完了させるため、INSERT処理を全面バッチ化。
  - **新規INSERTは500件ずつ multi-row INSERT**（1件ずつ await の直列処理 → まとめて1往復）。
  - **`company_assignments`（自作リスト割り当て・優先オペレーター割り当て）も同じ500件単位でバッチINSERT IGNORE**。
  - **5000件INSERTごとに commit → beginTransaction**（巨大ROLLBACK領域・undoログ肥大化を回避）。
  - 5000件ごとに進捗ログ（`[import] progress: inserted=N / records=M`）。
- 既存企業のUPDATE（自作リストへの移行）は従来通り1件ずつ。
- 想定: ローカルテストで60万行のパース27秒。バッチINSERT化により、推定 数十分〜1時間 程度で取り込み完了見込み（DBレイテンシ次第）。

### CSVインポート: 「全業界まとめ」フォーマット & 巨大xlsx対応
- 列名マッピングを拡張: `法人名称`/`法人名`/`事業者名`→`company_name`、`FAX番号`→`fax_number`、`業種(中分類1)`→`industry`、`法人サマリー`→`comment`、`サイトURL`/`URL`→`url`(commentに「URL: ...」で統合)。
- 巨大xlsx（sheet1.xml が Node の String 上限 ~536MB を超える 800MB級）のパースに対応。通常の `xlsx` パッケージで失敗した場合、OSの `unzip -p` で `xl/worksheets/sheet1.xml` をストリーミング展開し、自前のXMLパーサーで `<row>` 単位に逐次処理（inlineStr/v 両対応）。
- INSERT時に `fax_number` も保存。
- 動作確認: 「全業界まとめ.xlsx」(800MB級) → 609,606行を27秒でパース、phone_number付き481,030行抽出。

### 案件管理: 書類選考あり の詳細記録 + 経過日アラート
- 案件一覧の「書類選考」が「あり」の行をクリックで詳細モーダルを開けるように（`projects.js`）。
- モーダルで ①募集開始日 ②企業に履歴書送付日 ③面接日 を入力（③は `interview_date` を流用＝案件の面接日と双方向で同期）。
- モーダル上部に ①または②の直近日付からの経過日を表示。
- ①②の直近日付から4日以上経過した場合、一覧の「あり」を赤太字で強調（経過日数も併記）。面接日(interview_date)が入っていればアラートは抑制（一覧・モーダル両方）。
- ステータスを「募集中(BOSHUCHU)」にしたら ①募集開始日 を当日で自動入力（未入力時のみ）。
- フィルタ「書類選考=あり」を選択した時のみ、書類選考列の右に「募集開始日」「履歴書送付日」列を表示。
- projects に `recruitment_start_date` / `resume_sent_date` カラム追加（起動時マイグレーション）、`updateProject` で更新対応。

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
