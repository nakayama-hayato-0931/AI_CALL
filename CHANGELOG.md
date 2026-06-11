# CHANGELOG

主要な変更履歴。詳細はそれぞれのコミットメッセージ参照（`git log`）。

---

## 2026年6月 〜 直近

### 架電リスト(緊急fix): 業種別モード時は Tier 0/1 にも業種フィルタを適用
- 「業種別が効かない (業種を変えても同じ企業が出る)」事象を修正。
- 原因: Tier 0 (assigned) と Tier 1 (recall) は modeFilterSQL を含まず、業種に関係なく LIST_SIZE(25) を埋めることがあり、Tier 2-5 の業種別企業が表示されていなかった。
- 修正: 両Tier の SQL に `${modeFilterSQL}` を追加。業種別モード時のみ業種絞込が効く。auto モードでは modeFilterSQL は空文字なので影響なし。
- Tier 0/1 は永久除外バイパスなど他の特権は維持。業種に該当する場合だけ表示される。

### 架電リスト(緊急fix): キャッシュキーに region パラメータを追加
- 「業種別が選択でピックアップ職種が変わらない」事象を修正。
- 原因: `buildCallListCacheKey` が `(userId, callType, mode, industry)` の4つだけで構成されており、地域 (region) パラメータが含まれていなかった。地域変更や業種変更時にキャッシュヒットして古い結果が返っていた。
- 修正: `region` も cacheKey の構成要素に追加。`${userId}|${callType}|${mode}|${industry}|${region}`。

### 架電リスト: 自動割り当て(NO_ANSWER経由)を Tier 0 から除外、繰り返し表示を解消
- 「一度割り当てられている企業がリストに残り続ける」事象を修正。
- 原因: `endCall` の NO_ANSWER 処理で `company_assignments` に自動 INSERT されるが、これを Tier 0 (assigned) が「自分割り当て」として永久除外バイパスで表示し続けていた。
- 修正: `company_assignments` に `is_auto TINYINT(1) DEFAULT 0` カラム追加。NO_ANSWER 由来は `is_auto=1`、手動割り当て (`assignCompany`) は `is_auto=0` (デフォルト)。
- Tier 0 (assigned) / assignBypassWrap / assignmentFilterSQL / 各Tier の is_assigned 判定 はすべて **`is_auto=0` (手動割り当て) のみ対象**。
- NO_ANSWER 由来の自動割り当ては Tier 0 の特権を持たず、通常通り Tier 4 (2日後 retry) のフローで再ピックアップされる。
- 影響: 手動で割り当てた企業は引き続き Tier 0 で永久除外バイパス。NO_ANSWER 連発で繰り返し出ていた企業は出なくなる。

### 架電リスト: 過去不通(Tier 4/5)は未架電(Tier 3)が完全に枯渇してから表示
- 「自動ピックアップに過去不通が混ざる」事象を修正。未架電が1件でも残る間は過去 NO_ANSWER/NG の再架電を表示しない。
- 修正前: Tier 3 が LIST_SIZE 未満なら Tier 4(retry_no_answer)/Tier 5(retry_ng) で補充。
- 修正後: `untouchedRows.length === 0` のときだけ Tier 4/5 を結合。
- Tier 1 (recall)、Tier 2 (golden_time) は従来通り併用 (リコールとゴールデンタイムは別軸の高優先候補)。

### axios timeout: 30秒 → 60秒に拡張 (Railway 混雑時の canceled 回避)
- 「operators が canceled (30秒で打ち切り)」事象対策。
- フロントの axios timeout が 30 秒だったため Railway backend の応答待ちでブラウザ側がキャンセルしていた。
- 60秒に拡張。それでも応答ない場合は Railway 自体の根本対策が必要。

### 全面見直し: authController / database.js をシンプルな最小実装に戻す
- 「ログインもオペレーター選択も自動ピックアップもできない」深刻状態の解消。
- 直近に積み上げた MAX_EXECUTION_TIME / Promise.race / cache + timeout / pool 拡大 等の複雑化が逆に副作用 (unhandled rejection / connection 取得タイミング不整合等) を引き起こしていたため、撤去。
- **authController**:
  - login: 通常の `pool.query` を直列実行するシンプル実装。タイムアウト/Promise.race 削除。
  - getOperators: 5分メモリキャッシュは維持 (DB 詰まり時の保険として有用)、 race と timeout は撤去。失敗時のみキャッシュ fallback。
  - getMe: pool.execute → pool.query に統一。
- **database.js**:
  - SET SESSION MAX_EXECUTION_TIME / innodb_lock_wait_timeout 等の接続時 SET を削除 (毎接続で複数 SET を投げる事自体が遅延要因の可能性)。
  - connectionLimit を 30 に (20→50→30 で間)。
  - on('connection') は JST タイムゾーン設定のみ。
- これでログイン・オペレーター取得が確実に応答するようになる (Railway 自体が詰まっていない限り)。

### 認証: pool.query に変更 (prepared statement オーバーヘッド回避) + タイムアウト 8s
- 「503 (3秒タイムアウト) が継続」事象対策。
- 原因: `pool.execute` は prepared statement を使うが、Railway MySQL proxy (hopper.proxy.rlwy.net) 経由だとプリペアフェーズで時間がかかることがある。軽量 SELECT には不要なオーバーヘッド。
- 修正: operators / login の DB クエリを `pool.execute` → `pool.query` に変更。query は SQL を直接送る (escape は mysql2 が処理)。
- タイムアウトを 3秒 → 8秒、login も 5秒 → 8秒に拡張。Railway 環境の応答遅延に余裕を持たせる。

### DB プール: connectionLimit を 20 → 50 に拡大
- 「operators API が 503 (3秒タイムアウト)」事象対策。
- 重いクエリ (getCallList の Tier 2-5 並列、診断系、ピックアップ複数同時等) が pool の 20 接続をすべて使い切ると、軽量な operators / login 等が接続を取得できず待たされて 3-5秒タイムアウトに。
- pool の connectionLimit を 50 に拡大。Railway MySQL の同時接続上限 (通常 100-150) には収まる。

### 認証: Promise.race の unhandled rejection を resolve 戦略で解消 (502 の原因)
- 「再起動後も operators API が 502」事象の修正。
- 原因: Promise.race の timeoutPromise が reject を残し、 queryPromise が先に解決しても 3-5秒後に unhandled rejection になっていた。Node.js が exception 扱いにして 502 を返していた。
- 修正: timeoutPromise を `resolve({ ok: false, timeout: true })` の resolve 戦略に変更。queryPromise も `.then().catch()` で result オブジェクトを返す形に。`clearTimeout` で確実にタイマーをキャンセル。
- これで unhandled rejection が発生しないので、 backend が安定して 200/503 を返せるようになる。

### ログイン: login API に DB タイムアウト 5秒 + 503 エラーで応答
- 「ログインボタンを押しても応答しない (30秒以上 pending)」事象対策。
- DB が詰まっていても 5秒で必ず応答を返す。
- 5秒以内に応答ない場合は 503 で「DB応答が遅延しています。管理者にお問い合わせください」を返す。
- ユーザーが何が起きているか分かるようになる (無言で待たされない)。

### ログイン: operators API を 5分メモリキャッシュ + 3秒タイムアウト
- 「ログイン画面で名前 select が空のまま (operators pending)」事象対策。
- DB が他クエリで詰まっていてもログイン画面のオペレーター一覧は即応答できるよう、メモリキャッシュ (5分) + DB タイムアウト 3秒。
- 3秒で DB応答がない場合、古いキャッシュがあればそれを返す (fallback)。
- これでバックエンドが多少詰まっていてもログインだけは確実にできる。

### 性能: MAX_EXECUTION_TIME=90s + getCallList キャッシュ TTL を 60秒に拡張
- 「自動ピックアップが表示されない、読み込みが長すぎる」事象対策。
- MAX_EXECUTION_TIME: 5分(=300s) → 90秒 に短縮。ユーザーが過剰に待たされ続ける状態を防ぐ。
- getCallList キャッシュ TTL: 20秒 → 60秒。架電画面の15秒ポーリングは 4回に1回しか実DBに行かない。
- 同条件のリクエスト連発は即キャッシュ返却するので Railway DB の負荷も下がる。

### 起動: criticalPreflight にハードタイムアウト 60s + lock_wait_timeout 30s
- 「Railway Healthcheck failure (~5分)」事象の対策。
- 原因: 起動時の criticalPreflight (ALTER TABLE 群) が、進行中の重い UPDATE のメタデータロックを待って詰まり、Healthcheck (5分) より前に listen() できなかった。
- 修正1: criticalPreflight 開始時に `SET SESSION lock_wait_timeout = 30` / `innodb_lock_wait_timeout = 30` を実行。ロック待ちで永遠に詰まらない。
- 修正2: criticalPreflight 全体を `Promise.race` で 60秒ハードタイムアウト。失敗してもログ出して listen() を続行 (Healthcheck より優先)。
- これでデプロイ失敗が連鎖しない。スキーマ追加に失敗した場合は次回デプロイで再試行可能。

### DB: SELECT に MAX_EXECUTION_TIME=60s を設定 (長時間クエリ自動キャンセル)
- 「operators API すら応答しない、ログインできない」事象の再発防止。
- 各接続で `SET SESSION MAX_EXECUTION_TIME = 60000` を実行。60秒を超える SELECT は MySQL が自動キャンセル → 後続クエリへのロック影響を防ぐ。
- UPDATE/INSERT/DELETE/DDL には効かない (MySQL の仕様) ので、書き込み系は引き続き設計で対応する。
- 影響: 通常の集計クエリは数秒で完了するため業務影響なし。長時間 ad-hoc クエリだけが切られる。

### 緊急fix: CSVインポート後の全件 UPDATE を停止 (DB詰まり原因)
- 「全員ピックアップされない」「ログインも出ない (operators API 502 9.6秒)」事象の対策。
- 原因: 直前に追加した `applyIndustryCategoryAfterImport(null)` が `WHERE industry_category IS NULL AND industry IS NOT NULL` の全件 UPDATE を実行していた。 60万行クラスで重く、10ファイル連続インポートで10回呼ばれて DB を完全に詰まらせていた。
- 修正: `applyIndustryCategoryAfterImport(null).catch(() => {})` の呼び出し3箇所をコメントアウト。
- 必要になったら顧客マスタの「業種診断」→「再計算」ボタンで明示的に実行可能。
- 別途、INSERT 時に industry_category を JS 側で直接計算して INSERT に含める方式は別タスクで対応予定。

### 架電リスト(緊急fix): 業種別モードで industry_category IS NULL も含める
- 「全員ピックアップされなくなった」事象の即時対応。
- 原因: 直前のコミット (c3b5f17) で modeFilterSQL を `industry_category = ?` だけにしたが、未再計算の企業 (industry_category IS NULL) が大量に残っていたためゼロ件になっていた。
- 修正: `(c.industry_category = ? OR c.industry_category IS NULL)` に変更。index 利用は維持。
- 正確な絞り込みには顧客マスタ「業種診断」→「再計算」で全行を分類済みにすることを推奨。

### 架電リスト性能改善: 業種別モードのキーワード OR LIKE を除去 (60万行で重い)
- 「ピックアップが遅い」事象の対策。
- 原因: 業種別モードで `industry_category = ?` に加えて `industry LIKE '%kw1%' OR LIKE '%kw2%' ...` (各カテゴリ15キーワード) を OR 評価していたため、index が使えずフルテーブルスキャンが発生。Tier 2-5 × 各種フィルタで重複実行されて全体応答が遅延。
- 修正: `modeFilterSQL` を `c.industry_category = ?` のみに変更。 industry_category カラムには `idx_companies_category` のインデックスがあるので高速。
- 複合業種企業 (うどん、建設業など) で漏れる場合は、顧客マスタの「業種診断」→「再計算」ボタンで industry テキストから再分類して industry_category を最新化する想定。インポート時の自動計算も既に追加済み。

### 架電リスト管理: 業種カテゴリフィルタを industry_category カラムに統一
- 「業種カテゴリバッジでは148,469件あるのに、その他フィルタを掛けると企業が表示されない」事象を修正。
- 原因: industry-stats API は `IFNULL(c.industry_category, 'その他')` で集計、getCompanies API は industry テキストの CASE 式で計算 → 判定不一致。
  - industry-stats では `industry_category IS NULL` の行も「その他」扱い
  - getCompanies の CASE 式では NULL/未該当の行を ELSE 'その他' に分類するが、 industry テキストから判定するため結果が異なる
- 修正: getCompanies の category フィルタを `co.industry_category = ?` に変更 (CASE 式を撤去)。
  - 「その他」指定時は `(industry_category = 'その他' OR industry_category IS NULL)` で NULL も含める。
- これでバッジの件数と一覧表示が一致するようになる。

### CSVインポート(バルク): 完了時に成功ファイルを解除、エラーのみ残す
- 「インポート完了したら選択中のファイルは解除、エラーのものだけ残してほしい」要望対応。
- 一括インポート完了時、`bulkFiles` から **成功したファイルを取り除き、エラーのものだけ** state に残す。
- 失敗ファイル名 Set でフィルタするので、再選択せずにそのまま再「一括インポート」ボタンで再試行できる。

### CSVインポート: 内訳に「FAX番号あり」件数を追加
- 「インポート時に FAX 番号ありが何件あるかも内訳に入れてほしい」要望対応。
- バックエンド: `csvController.js` の `importCompanies` / `importSpecialList` で `faxCount` を集計、レスポンスに含める (新規/更新/スキップ問わず FAX 番号が取れた行をカウント)。
- フロント: バルクインポート結果カードに「FAX番号あり: N件」(青緑) を追加。1行サマリーにも `FAX${N}` 表示。

### CSVインポート: DB重複チェックを「電話番号 OR 会社名」に拡張
- 「同じファイルを再インポートしているのに新規として追加される。件数は毎回減ってる」事象を修正。
- 原因: DB重複チェックが `phone_number` 完全一致のみだった。同じ会社でも以下のケースで重複検出できなかった:
  - 電話番号が変動 (本社→支店表記、番号変更、複数電話入りセル等)
  - normalizePhoneNumber の抽出結果が違うパターン (複数番号入り→最初に抽出される番号が変わる)
  - ファイルの電話番号フォーマット (区切り文字や半角全角)
- 修正:
  - 事前ロードSQLに `company_name` カラム追加、`dbNameMap` を構築。
  - DB重複判定を `dbPhoneMap.get(phoneNumber) || dbNameMap.get(companyName)` に変更。
  - バッチINSERT後の dbPhoneMap 更新時に dbNameMap も同期更新。
- これで「同じ会社・違う電話番号」のレコードも重複扱いされ、再インポートで新規追加されなくなる。

### CSVインポート: FAX 番号の列名揺れに対応 (FAX/Fax/ファックス等)
- インポート時に FAX 番号は元々保存していたが、列名 `FAX番号` または `fax_number` のときだけ認識していた。
- 多くのファイル (Urizoデータリスト等) で `FAX` / `Fax` / `fax` / `ファックス` / `ファックス番号` / `ＦＡＸ` (全角) などの表記が使われるため、COLUMN_MAP に以下を追加:
  - FAX / Fax / fax / FAX No / FAX No. / FAX_番号 / ファックス / ファックス番号 / ＦＡＸ / ＦＡＸ番号
- これで列名にこれらが含まれる CSV/Excel は自動的に `fax_number` カラムに保存される。
- companies.fax_number は元々スキーマあり、顧客マスタ画面で確認・編集可能。

### インポート: industry_category 自動計算 + 製造系キーワード拡充
- 「インポート時の業種別振り分けが弱い、その他に振り分けられる」事象を修正。
- 原因1: CSV インポート時に `industry_category` カラムを設定しておらず、NULL のまま → 業種別絞り込みで「その他」扱い。
- 原因2: CASE 式に金属/部品/化学/食品/衣料などのキーワードがなく、「金属製品製造・加工」のような企業も製造に分類されなかった。
- 修正1: `csvController.js` に `applyIndustryCategoryAfterImport()` ヘルパーを追加。`importCompanies` / `importExclusion` / `importSpecial` の各完了時にレスポンス返却前で非同期実行 (await 無し)、新規インポート行の industry_category を自動計算。
- 修正2: CASE 式の製造系キーワードを拡充 (companyController.recompute-industry-category と csvController の両方):
  - 製造: 製造/メーカー/加工/工場 → + **金属/部品/機械/化学/食品/飲料/繊維/衣料/印刷/木材/木製/プラスチック/ゴム/紙/パルプ/セメント/窯業/電子/輸送機/自動車/電気機械**
  - 農業: + 水産/漁業/林業/農産
  - 小売: + 販売
- インポート済みの 124,096 件「その他」は、顧客マスタの「業種診断」→「再計算」ボタンで全件再分類してください (推奨)。

### 全体性能改善: region フィルタの中間一致 LIKE を削除
- 「オペレーター選択不可・全体的に重い」事象に対応。
- 原因: companies テーブル (60万行クラス) の region フィルタで `LIKE '%xxx%'` の中間一致を使っていたため毎クエリでフルテーブルスキャン発生 → バックエンド全体が詰まりオペレーター一覧 API なども応答遅延。
- 修正: 5 パターン OR を 3 パターンに削減:
  - 完全一致 `c.region IN ('東京都', '東京')`
  - 前方一致 `c.region LIKE '東京%'` (index 活用可能)
  - 住所前方一致 `c.address LIKE '東京都%'`
- 削除した中間一致パターン: `c.region LIKE '%東京%'`, `c.address LIKE '%東京%'`
- 影響箇所: companyController.js (modeFilterSQL) / adminController.getCompanies / getCustomerMasterList / bulkAssignSpecial の 4 箇所すべて。
- 「東京都港区...」のような複合形式は前方一致でも拾えるため実用上の影響なし。中間一致が必要なケース (region 中に都道府県名が埋もれている) はまれ。

### 架電リスト管理: fetchCompanies に AbortController を入れて連続フェッチを安定化
- 「架電リストが表示されなくなった」事象の対策。
- 症状: Network タブで同じ URL の `companies?page=1&limit=20` が複数 canceled / pending 状態 → state が空配列で「企業がありません」と表示される。
- 原因: フィルタ変更や useEffect 連鎖で fetchCompanies が高速に重ねて呼ばれ、後発が前のレスポンスを上書き or canceled で何も入らないケース。
- 修正: `fetchAbortRef.current` で進行中のリクエストを保持し、次回呼び出し時に明示的に `abort()` する。CanceledError/AbortError はトーストを出さず無視。
- これで複数フィルタを高速変更しても最後の応答だけが state に反映される。

### CSVインポート(バルク): ファイルごとの詳細内訳を表示
- 「複数インポート時は各ファイルごとに内訳を表示してほしい」要望に対応。
- 結果欄を 1 行テキストから **ファイルごとのカード形式** に変更。
- 各カードに以下を表示 (該当 0 件はスキップ):
  - 総行数 / 新規追加 / 更新 / 重複スキップ / 除外スキップ / その他スキップ / 自動割り当て / 処理時間
- 色分け: 新規=エメラルド、更新=青、重複=アンバー、除外=オレンジ、自動割当=紫。
- レスポンス内のフィールドを柔軟に拾うよう変更 (insertedCount/inserted/added 等を統一処理)。
- 結果欄の max-h を 128px → 384px に拡張、カード間隔も確保。

### CORS(緊急fix): allowedHeaders に X-Work-Category 追加
- 「CSVバルクインポートが全件 CORS error で失敗」事象を修正。
- 原因: 業務カテゴリ (技人国/特定技能) 機能で追加した `X-Work-Category` カスタムヘッダが、サーバー側 CORS 設定の `allowedHeaders` に含まれておらず、preflight で承認されないため本リクエストが CORS error 扱いになっていた。
- 影響: CSVバルクインポートだけでなく、全 API リクエスト (ダッシュボード/CPA/その他)も localStorage に work_category が保存されている状態だと同様にエラー。スクショの preflight 204 OK / 本リクエスト CORS error がこのパターン。
- 修正: `allowedHeaders: ['Content-Type', 'Authorization', 'X-Work-Category']` に X-Work-Category を追加。PATCH メソッドも追加。

### CSVインポート(バルク): エラー詳細を console + 結果欄に表示
- 「.xls 6ファイル全部失敗 (4秒で)」事象の原因切り分け用。
- 失敗時に console.error で `{status, code, message, response, raw}` を全部出力。
- 結果欄表記を `[ステータス] エラーメッセージ [秒]` 形式に。例: `[400] CSV・XLS・XLSXファイルのみ許可 [0.5秒]`
- DevTools の Console タブで原因を即特定できる。

### CSVインポート: 大規模バルクアップロード対応 (タイムアウト延長 + 経過時間表示)
- 5万行×41ファイル ≈ 205万行クラスの大規模インポート対応。
- 各ファイル毎に **15分タイムアウト** (`timeout: 900000ms`) を directApi で設定。
- ファイル間に 500ms のスリープを挟んで DB 負荷を分散。
- 進捗 UI 改善:
  - 開始前 confirm「全体で数十分〜数時間かかる可能性があり、タブを閉じないで」と警告。
  - 経過時間を分単位でリアルタイム表示。
  - 各ファイルの結果に処理時間 (秒) を併記: `aaa.csv: 追加 50,000/更新 100/スキップ 200 [124.3秒]`
  - 完了トーストに全体所要時間 (分秒) を表示。
  - 失敗したファイルがあれば再選択を促す案内を表示。

### CSVインポート: 複数ファイル一括アップロード対応
- 「41件のファイルを一度にインポートしたい」要望に対応。
- CSV インポート画面 (`/csv-import`) に「複数ファイル一括」エリア (紫帯) を追加。
- `<input type="file" multiple>` で複数 .csv/.xls/.xlsx を選択 → 「一括インポート (N件)」ボタンで順次アップロード。
- 進捗表示: 「処理中 5/41」+ 現在のファイル名 + 各ファイルの結果 (✓追加X/更新Y/スキップZ / ✗エラー)。
- 完了時に合計を トースト表示 (追加/更新/スキップ/エラー件数)。
- リスト管理タブ (calllist/special/ng/existing) のいずれでも動作。優先オペレーター・期限の設定もそのまま適用。

### 架電リスト: 業種別ピックアップを複合業種にも対応 (industry テキスト OR キーワード)
- 「うどん、ラーメン、グルメ・飲食、工務店、リフォーム、塗装」のように複数業種を持つ企業が、業種別「建設」「飲食」両方に出るように。
- 修正前: `modeFilterSQL` は `c.industry_category = ?` (単一カテゴリ厳密マッチ) のみ → 複合業種企業は1カテゴリにしか出ない。
- 修正後: 業種別モードのキーワード辞書を導入し、`AND (c.industry_category = ? OR c.industry LIKE '%kw1%' OR c.industry LIKE '%kw2%' ...)` で OR 拡張。
- カテゴリ別キーワード一覧 (companyController.INDUSTRY_KEYWORDS):
  - 建設: 建設/建築/工事/土木/リフォーム/電気工事/管工事/建材/住宅/リノベ/工務店/解体/内装/塗装/職別工事
  - 飲食: 飲食/グルメ/レストラン/居酒屋/ラーメン/カフェ/喫茶店/寿司/焼肉/和食/中華/洋食/食堂/ダイニング/そば/うどん/菓子
  - 小売/製造/宿泊/清掃/農業/介護 も同様
- 「うどん、ラーメン、建設業」のような企業 → 建設も飲食も両方に出る。

### 架電リスト管理・顧客マスタ: 都道府県フィルタ + 特別リスト一括割り当て機能
- 「顧客マスタ・架電リスト管理で地域別でフィルタをかけられるように、絞り込み結果からオペレーターに特別リストとして割り当てができるように」要望に対応。
- バックエンド:
  - `getCompanies` (架電リスト管理) / `getCustomerMasterList` (顧客マスタ) で `region` クエリパラメータを受け付け、region/address 5パターン OR で絞り込み。
  - `POST /api/admin/companies/bulk-assign-special` 新規。`{user_id, filter: {region, industry_category, search, limit}}` でフィルタ条件にマッチする全企業に `is_special=1` を立て、`company_assignments` に手動割り当て (is_auto=0) を一括挿入。
- フロント:
  - 架電リスト管理画面: 検索フォームに「都道府県」select を追加。フィルタが効いているとき紫帯で「絞り込み結果を特別リスト化して割り当て」UIを表示 (オペレーター select + 実行ボタン)。
  - 顧客マスタ画面: フィルタバーに「都道府県」select を追加。一覧見出し直下に紫帯で同等の割り当て UI を表示。
  - 一括割り当て前に confirm で件数表示。
- これで「東京の建設業1000社をオペレーターA に振り分け」のような運用が一発でできる。
- 注意: 既定上限は 10000 件。それ以上は filter.limit で指定 or 複数回実行。

### 架電リスト: 都道府県フィルタのマッチパターンを拡張 (region/address 各種形式に対応)
- 「以前うまくフィルタできていなかった」事象の見直し。
- 元の条件: `c.region IN (短形, 長形) OR c.address LIKE '長形%'` だけだった。
- 「東京都港区」のような複合region、住所中間に都道府県名がある等のケースに対応するため、以下5パターンを OR で評価:
  1. `c.region IN (?, ?)` (「東京都」「東京」両形式完全一致)
  2. `c.region LIKE CONCAT(?, '%')` (前方一致: 「東京都港区」のような長い形式)
  3. `c.region LIKE CONCAT('%', ?, '%')` (中間一致フォールバック)
  4. `c.address LIKE CONCAT(?, '%')` (住所前方一致: region 空欄企業)
  5. `c.address LIKE CONCAT('%', ?, '%')` (住所中間一致: 住所中に都道府県含む)
- これで region/address のどの形式でも、選んだ都道府県の企業が拾える。

### 架電画面: 業種別ピックアップに都道府県絞込 UI を復活
- 「業種別に都道府県別フィルタ機能を復活させてほしい」要望に対応。
- 以前 (d28658a) UI を一旦非表示にしていたが、バックエンドの region パラメータ受付ロジックと state は残置していた。今回 UI のみ復活。
- 業種別モードで業種選択後に都道府県 select を表示。
  - 業種地域ルール (industry_region_rules) に該当業種の地域設定がある場合は **その地域だけを優先表示**。
  - 未設定の業種なら **全47都道府県** から選択可能 (フォールバック)。
- 「全都道府県 (絞り込みなし)」をデフォルト選択肢として用意。
- バックエンドは `getCallList` で `region` パラメータを受け取って `modeFilterSQL += AND (c.region IN (?, short) OR c.address LIKE 'region%')` を AND 適用 (既存ロジック)。

### 都道府県診断: 全件対象に変更 (除外/特別/旧営業も含む)
- 「都道府県診断は自動ピックアップだけではなく全件で実施してほしい」要望に対応。
- `diagnosePrefecture` の region 分布クエリと関東7県カウントクエリから `exclusion_flag=0 AND is_special=0 AND is_sales_list=0` の WHERE 句を削除。
- companies テーブル全件 (除外/特別/旧営業を含む) で region の分布を見られるように。

### 架電画面: 現在のフィルタ状態を見出しに可視化 (業種別が効かない事象の診断用)
- 「業種別建設で他業種が出る」事象を切り分けるため、架電リスト見出し下に現在のフィルタ状態を表示。
- 「モード: industry / 業種: 建設」のように緑色で表示。
- 業種別モードで業種未選択時は赤色で「(未選択!業種を選んでください)」と表示。
- これでフロント state が意図と違うのか、バックエンドの SQL に問題があるのか切り分けられる。

### 架電リスト: 業種別モードは「自分手動割り当て」でも業種絞り込みを通す
- 「業種別建設選択しているのにローソンなど小売業が表示される」事象の根本修正。
- 原因: `assignBypassWrap` の OR 句に `modeFilterSQL` が含まれており、「自分に手動割り当てがある企業」は業種フィルタをバイパスして表示されていた。
- 修正:
  - `assignBypassWrap` から `modeFilterSQL` を除外: `EXISTS(自分割り当て) OR (1=1 ${irFilter} ${goldenIndFilter})`
  - Tier 2-5 の SQL 本体 `${prefectureFilter}` の直後に `${modeFilterSQL}` を直接 AND で追加
  - params の順番を `prefectureParams → modeFilterParams` に調整
- これで Tier 0/Tier 1 と同様、Tier 2-5 でも「自分割り当て手動」でも業種絞り込みが絶対条件に。
- バックエンドで `mode='industry'` かつ `industry` パラメータが空のときは 400 を返すバリデーションも追加 (無音で全件返す事故を防ぐ)。

### 架電画面: industry_category タグを並列表示 (分類確認用)
- 「業種別で建設を選んだのに小売の企業が出る」事象を可視化するため、架電リストの各企業に industry テキストの隣に industry_category タグを並列表示。
- バックエンド: getCallList の各Tier (assigned/recall/golden/untouched/retry_na/retry_ng) の SELECT に `c.industry_category` を追加。
- フロント: 業種テキスト末尾に色付き小タグ (建設=オレンジ、小売=紫、製造=青、飲食=赤、その他は非表示)。
- これで「業種別建設で出た企業の industry テキストが小売っぽい」のが「実は industry_category=建設 として分類されている」のか「industry_category=小売 のままで分類漏れ」なのかが目視で判別できる。

### 業種カテゴリ: 建設を小売より先に判定 + 都道府県診断追加
- 「業種別 建設を選んだら小売がピックアップされる」事象を修正。
  - 原因: recompute-industry-category の CASE 順序が「小売 → 製造 → 建設」だったため、「建材小売」「建築資材」のような複合キーワードが小売に分類されていた。
  - 修正: CASE 順序を「建設 → 宿泊 → 清掃 → 介護 → 飲食 → 農業 → 製造 → 小売」に変更。建設キーワードに「建材」「住宅」「リノベ」も追加。
- 「関東で6件しか出ない」事象の診断ツール追加。
  - バックエンド: `GET /api/companies/diagnose/prefecture` 新規。② 設定 (enabled/disabled都道府県)、companies.region 値の上位30件、関東7県の region一致/address一致件数を返す。
  - フロント: 顧客マスタヘッダに「都道府県診断」ボタン追加。clickで alert で結果表示。
- これで「① 自動ピックアップ対象都道府県の設定漏れ」と「② region が短縮形で入っている (例: '東京' vs '東京都')」のどちらが原因か即特定できる。

### 顧客マスタ: 業種別件数診断 + industry_category 一括再計算
- 「業種別で建設300件は少なすぎる」事象の原因を可視化。
- バックエンド:
  - `GET /api/companies/diagnose/industry?category=建設` 新規。industry_category=該当 件数、industry テキストにキーワード含む全件、分類漏れ件数、分類漏れ実例10件、内訳 (未架電/永久除外/前回NO_ANSWER/前回NG) を返す。
  - `POST /api/companies/diagnose/recompute-industry-category` 新規。companies.industry_category を industry テキストから一括再計算。dry_run=1 で件数だけ試算。建設には電気工事/管工事/土木/建築/リフォームも含めるロジック。
- フロント: 顧客マスタ画面ヘッダに「業種診断」ボタン (アンバー) 追加。
  - prompt で業種カテゴリ入力 → 件数と分類漏れを alert 表示
  - 分類漏れが 100件超なら「再計算しますか?」confirm 提案
  - 再計算は dry_run → 確認 → 実行 の二段階確認

### 顧客マスタ: 件数内訳ボタンを追加 (顧客マスタ vs 架電リスト差分原因)
- 「顧客マスタ49万件 vs 架電リスト29万件 = 同じDB?」の確認用ツール。
- バックエンド: `GET /api/companies/diagnose/counts` 新規。
  - 全件 / 完全除外 (exclusion_flag=1) / 特別リスト (is_special=1) / 旧営業リスト (is_sales_list=1) の件数を返す
  - 顧客マスタ画面の表示対象数 (exclusion_flag=0) と架電リスト管理の表示対象数 (exclusion_flag=0 AND is_special=0 AND is_sales_list=0) を比較しやすく
  - さらに架電リスト管理対象の中で「未架電 / 永久除外状態 / 前回NO_ANSWER / 前回NG」内訳も返す
- フロント: 顧客マスタ画面ヘッダに「件数内訳」ボタン (アンバー)。クリックで alert で内訳表示。

### 顧客マスタ: ピックアップ診断ボタンを追加
- 「顧客マスタにあるのに架電リストに無い」事象を、企業ごとに原因可視化できるツール。
- バックエンド: `GET /api/companies/:id/pickup-diagnose` 新規。
  - exclusion_flag / is_special / is_sales_list / 永久除外結果 / recall_tasks pending / company_assignments 他人手動割当 / 他人ロック / 本日自分の架電履歴 / ②都道府県範囲 / ③業種地域ルール / ゴールデン業種 / Tier 4/5 経過日数 を順次評価。
  - 引っかかっている理由 (`reasons`) と通過した条件 (`ok`) を返す。
- フロント (`/admin/customer-master`): 顧客詳細パネル下に「架電リスト ピックアップ診断」ボタン (アンバー)。クリックで window.alert で診断結果を表示。
- 全ての除外条件が OK なら「シャッフルボタンで再評価してみてください」と案内。

### 架電リスト: 業種別モード時は ③業種地域ルールをバイパス
- 「業種別で建設を選んでも建設が出ない、未架電がまだあるはずなのに無いと表示される」事象を修正。
- ユーザーが明示的に業種を選んでいるのに ③ `industry_region_rules` の地域制限・業種除外が効いてしまい、結果セットが空になる事象。
- 修正: `getNextCallTarget` / `getCallList` の `irFilter` を `(isMyList || isSpecialList || mode === 'industry') ? '' : industryRegionFilterSQL` に変更。
- 業種別モード時はルール設定で建設/介護等が非表示扱いでも、明示選択時は表示される。
- ②自動ピックアップ対象都道府県 (prefectureFilter) は引き続き絶対条件として適用。
- ゴールデン業種除外 (goldenIndFilter) は元々 auto モード限定なので影響なし。

### 業務カテゴリ(漏れfix2): KPI補正を業務カテゴリ絞込時はスキップ
- 特定技能管理画面で「中田倫哉: 案件1」が残っていた事象を修正。
- 原因: `kpi_adjustments` テーブルには `work_category` 区分がなく、`getAllOperatorPerformance` で無条件に補正値を加算していた → 特定技能管理画面 (フィルタあり) でも技人国の補正値 (project_count=1 等) が漏れていた。
- 修正: `wcFilter.sql` が non-empty (絞込中) のときは KPI 補正処理全体をスキップ。これで特定技能管理画面は純粋な calls/projects.work_category データのみが反映される。
- 通常の管理者画面 (絞込なし) では引き続き KPI 補正が適用される。

### 業務カテゴリ Phase 8: work_hours に work_category 追加 + 残り漏れ修正
- 「稼働時間も特定技能でログインしたときだけ集計、既存は技人国扱い」要望に対応。
- スキーマ: `work_hours` テーブルに `work_category VARCHAR(20) NOT NULL DEFAULT 'general'` カラム追加 (criticalPreflight)。インデックスも作成。
- 既存データは全て `'general'` (=技人国) 扱い。
- 保存 (`saveWorkHours`): `req.user.workCategory` をログイン時の選択から取得して保存。ON DUPLICATE KEY UPDATE で work_category も更新。カラム未追加環境のフォールバック付き。
- 集計 (`getAllOperatorPerformance` の `work_hours` クエリ): `wcFilter` を適用。これで特定技能で未稼働の人は稼働時間 0 になる。
- 平均通話時間集計クエリ (`avgDurMap`) にも漏れていたため適用。
- 残作業: recall_tasks (リコール) は work_category カラム持たないため、リコール消化数の絞り込みは別途検討 (calls から継承する仕組みが必要)。

### 業務カテゴリ(漏れfix): getAllOperatorPerformance の projects/calls 個別クエリにも work_category 適用
- 特定技能管理画面で「まだ特定技能ログインしていないのに案件数や有効接続が出る」事象を修正。
- 修正前: メインクエリは Phase 2 で wcFilter 適用済みだったが、各オペレーター毎に行う案件数の補完クエリと KPI 補正用の actualForDay 計算クエリ (projects 用 / calls 用) には work_category フィルタが当たっていなかった。
- 修正:
  - 案件数補完クエリ (projects p, line 348) に `${wcFilter.sql.replace(c\.→p\.)}` を追加。
  - KPI 補正の `project_count` actualForDay クエリにも同様に追加。
  - KPI 補正の `call_count/effective_count/person_count/recall_gained` actualForDay クエリにも `wcFilter.sql.replace(c\.→work_category)` を追加。
- これで特定技能でログイン済みの実績がない人は、特定技能管理画面で全数値 0 になる (有効接続の `-227` のような負値も解消)。

### 業務カテゴリ Phase 7: 詳細モーダル・業種別分析エンドポイントすべてに work_category
- `analyticsController` の以下に wcFilter 適用:
  - `getWaitingContactDetail` (連絡待ち詳細)
  - `getQualityIndustryDetail` (業種別内訳モーダル + 案件明細)
  - `getScreeningInProgressDetail` (書類選考中詳細)
  - `getIndustryMonthlyAnalysis` (業種別月別分析 - projects/calls/group_by=both/industry/region 各クエリ)
  - `getIndustryPeriodDetail` (業種×期間 明細 - calls 明細 + projects 明細)
- これで CPA/案件質分析画面のセルクリック → モーダル詳細、業種別分析画面、すべてのドリルダウンが特定技能のみに正しく絞り込まれる。
- 残作業: なし (基本機能はすべて分離完了)。今後発見された個別エンドポイントがあれば随時追加。

### 業務カテゴリ Phase 6: KPI補正テンプレート + sales_projects_v2 連動
- `analyticsController.getQualityAll` の KPI 補正 (`actualSql`) テンプレート 10 種すべてに `${wcSql}` を埋め込み、`pool.query` の params に `wcFilter.params` を追加。
- `adminController.getIncentiveData` (v2 パス) で `sales_projects_v2` に対し `EXISTS (SELECT 1 FROM projects p2 WHERE p2.job_number = sp.job_number AND p2.work_category = ?)` を付与。`sales_projects_v2` 自体は work_category カラムを持たないため、job_number 経由で `projects` と紐付けて絞る方式。
- これでインセンティブ管理画面（内定者リスト）も特定技能のみに正しく絞り込み可能。
- 残作業 (Phase 7): 業種別分析 (`getIndustryMonthlyAnalysis` / `getIndustryPeriodDetail` / `getQualityIndustryDetail`)、業種別詳細・期間別詳細などの analytics 詳細エンドポイント。

### 業務カテゴリ Phase 5: analytics cpa-all/quality-all バックエンドに work_category フィルタ
- `analyticsController.getCpaAll`:
  - callMap (コール数集計) クエリに wcCallFilter 適用
  - projAll (案件数/内定/不合格/バラシ失注) クエリに wcProjFilter 適用
  - kpi_adjustments の実績照合クエリ (projects/calls 両方) に wcFilter 適用
  - finAll (初回入金/見込売上) クエリに wcProjFilter 適用
  - visa map 照合 (registration_number 抽出) クエリに wcProjFilter 適用
- `analyticsController.getQualityAll`: メイン集計クエリに wcFilter 適用
- これで CPA/案件質分析ページが `?work_category=specific_skill` 付きで開かれたとき、各オペレーターのテーブル数値も特定技能のみに正しく絞り込まれる。
- 残作業 (Phase 6): KPI 補正 (actualSql 内のテンプレート文字列), 業種別/期間別の analytics 詳細エンドポイント, sales_projects_v2 (インセンティブ v2) への work_category 連動。

### 業務カテゴリ Phase 4: 案件管理 + 架電履歴 + CPA分析 への絞込伝播
- バックエンド:
  - `projectController.getProjects` (案件一覧) に `work_category` フィルタ適用。
  - `callController.getCalls` (架電履歴) に `work_category` フィルタ適用。
- フロント:
  - `/admin/analytics` (CPA/案件質分析): `useRouter` で `?work_category` を取得、`withWc()` ヘルパーで全 `api.get` の params に伝播。タイトルに緑バッジ。
  - `/admin/projects` (案件管理): `fetchProjects` で `work_category` を params に追加。依存配列にも追加。
  - `/admin/call-logs` (架電履歴): `fetchCalls` で `work_category` を params に追加。依存配列にも追加。
- 「特定技能管理」画面のリンクをクリックすると、ダッシュボード/CPA/案件管理/架電履歴すべて自動で特定技能のみに絞込表示される。
- 残作業 (Phase 5): analyticsController の `getCpaAll` / `getQualityAll` バックエンド (各 calls/projects クエリに wcFilter)、sales_projects_v2 (インセンティブ v2 パス) への work_category 連動。

### 業務カテゴリ Phase 3: インセンティブ + ダッシュボード URL クエリ受信 + バッジ
- `getIncentiveData` (v1 フォールバック) に `work_category` フィルタを追加。
- フロント `index.js` (ダッシュボード): `useRouter` で `?work_category=specific_skill` を取得し、`fetchStats` / `fetchPerfData` の params に追加。
- 依存配列に `workCategoryQuery` を追加して URL 変更時に再フェッチ。
- ダッシュボードタイトル横に「特定技能で絞込中」バッジを表示 (絞込時のみ)。
- 「特定技能管理」画面のリンクからダッシュボードを開くと、自動で特定技能のみの数値に切り替わる。
- 残作業 (Phase 4): CPA/案件質画面 (analytics.js)、案件管理、架電履歴、analytics の cpa-all/quality-all バックエンド、sales_projects_v2 への work_category 連動。

### 業務カテゴリ (技人国 / 特定技能) Phase 2: 集計分離 + 管理者「特定技能管理」追加
- 共通ヘルパー `buildWorkCategoryFilter(req, columnExpr)` を auth.js に追加。
  - オペレーター/営業: `req.user.workCategory` (localStorage 経由) を自動適用
  - 管理者: `req.query.work_category` で明示指定したときのみフィルタ (未指定は全体)
- 集計エンドポイントに適用:
  - `dashboardController.getDashboardStats` (calls)
  - `adminController.getAllOperatorPerformance` (calls)
  - `analyticsController.getCpaMetrics` (calls + projects)
  - `analyticsController.getQualityMetrics` (projects)
- 管理者メニューに「特定技能管理」を追加 (`/admin/specific-skill`)。
- `/admin/specific-skill` ページ: 特定技能で稼働したオペレーター一覧 + 既存ページ (ダッシュボード/CPA/案件管理/架電履歴) への `?work_category=specific_skill` 絞込リンク。
- 残作業 (Phase 3): 既存ページ側で URL クエリ `work_category` を読んで API 呼び出しに渡す、その他の analytics クエリにも漏れなく適用。

### 業務カテゴリ (技人国 / 特定技能) 機能 Phase 1: スキーマ + ログイン選択 + 保存
- オペレーターのログイン時に「技人国 / 特定技能」を選択できるよう変更。デフォルト=技人国 (general)。
- スキーマ追加 (criticalPreflight): `calls.work_category VARCHAR(20) DEFAULT 'general'`、`projects.work_category` も同様。インデックスも作成。
- フロント: ログイン画面のオペレーターステップに技人国/特定技能トグルを追加。選択値を localStorage `work_category` に保存。
- axios インターセプター: 全 API リクエストに `X-Work-Category` ヘッダーを付与 (api + directApi 両方)。
- 認証 middleware: ヘッダーを読んで `req.user.workCategory` を設定 ('general'/'specific_skill')。
- `startCall`: `calls.work_category` に保存 (フォールバック付き)。
- `endCall` (PROJECT): 案件作成時に `projects.work_category` に継承 (フォールバック付き)。
- Phase 2 で集計分離 (ダッシュボード/CPA/案件質) と管理者「特定技能管理」メニューを追加予定。

### 架電リスト: 営業もオペレーターと同じリスト (is_sales_list=0) に統一
- これまで `call_type='sales'` のとき `c.is_sales_list = 1`、`operator` のとき `c.is_sales_list = 0` で別リストを参照していたのを、両方とも `is_sales_list = 0` に統一。
- 修正箇所: `getCallList` / `getNextCallTarget` の `salesListFilter` (2箇所)、`diagnoseCallList` の `salesCond` (1箇所)。
- **案件化 (projects テーブル) は引き続き `call_type='sales'` / `'operator'` で分離**。架電結果集計・CPA・案件管理画面の挙動は変わらない。
- `is_sales_list = 1` のデータは参照されなくなるが、削除はしない (将来のデータ整理は別タスク)。

### 架電リスト: 「架電済みより未架電優先」に Tier 結合順を変更
- 「シャッフルしても時間がたつと割り当て中(=過去架電あり)が上に上がってくる」事象を修正。
- 修正前の Tier 順: recall > assigned > golden > untouched > retry_na > retry_ng
- 修正後の Tier 順: recall > golden > untouched > **assigned** > retry_na > retry_ng
- Tier 0 (assigned) を Tier 3 (untouched) の後に移動。未架電プールが残っている限り、自分割り当て中の接触済み企業はリスト下段に表示される。
- ポーリングが走っても未架電が上に出てくるため、シャッフル後に「上書きされる」感覚が薄まる。
- 自分割り当ては引き続き「永久除外バイパス + 業種地域フィルタバイパス」だが、表示位置は未架電の後。

### 架電画面: シャッフル時の sticky を recall_due のみに縮小 (割り当ても並び替え対象に)
- 「接触済み企業 (自分割り当て中=Tier 0) がシャッフルされない、優先的に上に来るのが邪魔」事象を修正。
- フロントのシャッフル時、sticky (先頭固定) を `recall_due` のみに変更。`assigned` (自分割り当て) はシャッフル対象に含める。
- これで過去架電あり+割り当て中の企業がリスト中段以降にも混ざるようになる。
- トーストの sticky 表示文言も「リコール/割り当てのため」→「リコールのため」に変更。

### 架電画面: 自動ポーリングのエラートーストを抑止 (連発スパム回避)
- 「時間がたつと『架電リストの取得に失敗しました』が何度も出てくる」事象を修正。
- 15秒ごとの自動ポーリングが 502 等で失敗するたびにトーストが表示されスパムになっていた。
- 修正: `fetchCallList(false)` (自動ポーリング) はコンソールログのみ。`fetchCallList(true)` (手動操作=シャッフルボタン等) のみエラートースト表示。
- ユーザーの手動操作には引き続きエラー詳細を表示するので、原因切り分けには影響なし。

### 架電リスト(緊急fix): ORDER BY RAND() を撤回 (502 タイムアウトの原因)
- スクショで 30秒以上 pending → cancel → 502 連発を確認。
- 原因: refresh=1 のとき各Tier に追加した `ORDER BY ..., RAND()` が 60万行スキャンで重く Railway のリバースプロキシ閾値を超えてタイムアウト。
- 修正: ORDER BY を元の決定論的ソートに完全に戻す。refresh 時のランダム化はフロントの即時 Fisher-Yates シャッフルに完全に任せる (既に実装済み)。
- 502 エラーが解消され、シャッフルボタンの体験は維持される。

### 架電画面: リコール期限でリストが埋まる状態を可視化
- 「シャッフルしても変わらない」原因はリコール期限の企業が25枠を埋めていたため (recall_due は先頭固定なのでシャッフル対象0)。
- バックエンド: Tier 1 で LIST_SIZE 埋まり return するパスでも debug 情報を返し、`recall_only:true` フラグを付与。
- フロント: トーストを 「全Nがリコール/割り当てのため並び替え対象なし」 に分岐。 件数表示で `リコール:N` を赤強調 + 「リコール期限の企業がリストを埋め尽くしています。リコール管理画面で古いタスクを整理してください」を表示。

### 架電画面: Tier別ピックアップ件数を表示 (未架電が枯渇しているか可視化)
- 「未架電がもう無いのか?」を判別できるよう、リスト見出し下に Tier 別件数を表示。
- 表示: `リコール:N / ゴールデン:N / 未架電:N / 過去不通:N / 過去NG:N`。
- 未架電が 0 件のときはオレンジ色で警告強調。
- 未架電=0 かつ 過去不通/NG が >0 のとき `※ 未架電が枯渇したため過去架電企業を表示中` を表示。
- バックエンドは既に `debug` フィールドを返していたためフロント側のみの追加。

### 架電画面: 「更新」ボタンを「シャッフル」ボタンに変更 + トースト確認
- 「何度押しても変わらない」の原因切り分けのため、ボタンを完全リニューアル。
- テキスト「更新」→「シャッフル」、アイコンも別物、配色も紫系に変更。
- 押下時に `setTargetList` で即時シャッフルし、`${N}件をシャッフルしました` を1.5秒トースト表示。
- 古いキャッシュが残っているとボタンが「更新」のまま見えるので、ハードリロードが必要かどうかが一目で判別できる。
- 同時にバックグラウンドで `fetchCallList(true)` も実行。

### 架電画面: 更新ボタン押下と同時に setTargetList で即シャッフル
- スクショで `?refresh=1&_t=...` は飛んでいるのに同サイズのレスポンスが返って表示が変わらない事象に対応。
- 修正: 更新ボタン onClick で `setTargetList(prev => shuffled)` を即実行し、レスポンス到着前にUIを並び替え。
- recall_due/assigned は先頭固定、それ以外を Fisher-Yates シャッフル。
- バックグラウンドで `fetchCallList(true)` も実行して新候補も取得。

### 架電画面: 更新時のフロントシャッフル + URL cache-buster (二重保険)
- 「更新を押してもずっと変わらない」事象が続くため、フロント側でも保険を入れる。
- 更新ボタン押下時の URL に `_t=Date.now()` を付与 → ブラウザ/プロキシ/中間キャッシュを完全回避。
- レスポンス受信後、`assigned`/`recall_due` を先頭固定にして残りを Fisher-Yates でクライアントサイドでもシャッフル。
- バックエンドの ORDER BY RAND() がデプロイ未反映でも、フロントで確実に並び替わる。

### 架電画面: 手動更新後30秒間は自動ポーリングを抑止
- 「更新を押しても変わらない」事象を追加修正。
- 原因: 15秒ごとの自動ポーリングが決定論的 ORDER BY で取得した結果でランダム結果を上書きしていた。
- 修正: 更新ボタン押下時に `manualRefreshAtRef` を記録。ポーリング側でこれを参照し、押下から30秒間はポーリングをスキップ。
- これでユーザーは更新ボタンを連打して違う候補を見ることができる。30秒経過後は通常のポーリングに復帰し、他OPの取得分を反映する。

### 架電リスト: refresh=1 のとき SQL レベルで RAND() 化、押すたびに違う25件
- 「更新を押してもリコール以外も変わらない」事象を強化修正。
- 原因: 各Tier の LIMIT 25 が SQL の決定論的 ORDER BY で固定 → 結合後のシャッフルでは「同じ25件の並び替え」しか起こらず、母集団から別の25件を引き出せていなかった。
- 修正: `req.query.refresh` のとき各Tier の ORDER BY を `is_assigned DESC, RAND()` に切り替え。母集団からランダムに25件抽出 → 押すたびに違う候補が出る。
- 通常 (auto) は決定論的 ORDER BY のまま (高速インデックス活用)。
- 自分割り当て (is_assigned=1) は引き続き先頭固定。

### 架電リスト(障害fix): is_auto カラムを criticalPreflight に移し起動順序競合を解消
- 「架電リスト取得に失敗しました」が一部ユーザーで出ていた事象を修正。
- 原因: 直前のコミットで `company_assignments.is_auto` カラムを参照する SQL を Tier 0 / assignBypassWrap / is_assigned に入れたが、ALTER TABLE は `app.listen()` 後の migrations() 内で実行していた。起動直後のリクエストで「Unknown column 'is_auto'」エラーで 500。
- 修正: `criticalPreflight()` 内に移動し `app.listen()` 前に確実に追加。
- 追加: フロントのエラートーストにステータスコード+detail を出すよう改修 (原因切り分け補助)。

### 架電リスト: 更新ボタンで結果をシャッフル + キャッシュ保存もスキップ
- 「更新を押しても表示企業が変わらない」事象を強化修正。
- `?refresh=1` のとき: Tier 0 (assigned) と Tier 1 (recall) は先頭固定、Tier 2-5 を Fisher-Yates でシャッフルして毎回違う候補を表示。
- `?refresh=1` のときはキャッシュ保存もしない (次回の自動ポーリングはまた決定論的結果に戻る)。
- これで更新ボタンを連打するたびに違う未架電企業が見える。

### 架電リスト: 今日架電した企業を除外 + 更新ボタンでキャッシュバイパス
- 「今日架電したリストがピックアップされる」「更新ボタンを押しても結果が変わらない」事象を修正。
- 修正1: `recentCallFilterSQL` の除外条件を `INTERVAL 1 HOUR` → `DATE(cl.call_started_at) = CURDATE()` に変更。同日中に自分が結果コードを入力した企業は出さない (1時間経過後も翌日0時まで除外)。
- 修正2: `GET /api/companies/call-list?refresh=1` を受け取ったらサーバー側 20秒キャッシュをバイパス + 自分宛のキャッシュをクリア。
- フロント: 更新ボタンクリック時に `fetchCallList(true)` を渡し refresh=1 を付与。15秒ポーリングは従来通りキャッシュ利用。

### 架電画面: 自分のピックアップロックを一括解除するボタンを追加
- 各オペレーター/営業の架電画面の「架電リスト」見出し右に「ロック解除」ボタンを追加。
- 自分が `locked_by_user_id` として持っている全企業のロックを一括解除し、解除件数をトーストで表示。
- 解除後 `fetchCallList()` を呼び自動的にリスト更新。
- バックエンド: `POST /api/companies/unlock-all` を新規追加 (`UPDATE companies SET locked_by_user_id=NULL, locked_at=NULL WHERE locked_by_user_id=?`)。

### 架電画面: 業種別ピックアップの地域 select UI を一旦非表示
- UIイメージが要件と合わなかったため、業種別モードの地域 select を一時的に非表示。
- バックエンドの `GET /api/companies/industry-regions` エンドポイント、`getCallList` / `getNextCallTarget` の region パラメータ受付ロジックはそのまま残置 (再表示時に復活可能)。
- フロントの state (`selectedRegion`, `availableRegions`) と useEffect の地域 fetch ロジックも残置。

### 架電画面: 業種別ピックアップに地域絞込を追加 (架電ルール許可地域のみ)
- 架電画面の業種別モードで、業種に加えて地域 (都道府県) でも絞り込めるように。
- 選択可能な地域は **架電ルール (industry_region_rules) で設定された地域 ∩ ②自動ピックアップ対象都道府県** のみ。
- ルール未設定の業種は地域 select が disabled。
- バックエンド:
  - `GET /api/companies/industry-regions?industry=X` を新規追加 (`industry_region_rules` × `auto_pickup_prefectures` で絞った都道府県を返す)。
  - `getCallList` / `getNextCallTarget` で `region` パラメータを受け付け、`modeFilterSQL` に `(c.region IN (full, short) OR c.address LIKE 'region%')` を AND。
- フロント (call.js): selectedIndustry 変更時に availableRegions を fetch、業種 select の直下に地域 select を表示。

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
