# CLAUDE.md — 引き継ぎ書（最初に読む）

このファイルは Claude Code がセッション開始時に自動で読み込みます。**新しい人・新しいセッションがこのプロジェクトを引き継ぐとき、最初にここを読めば全体を把握できる**ことを目的にしています。

> 運用ルール（重要）: 作業して構造・仕様・運用が変わったら、**このファイルと `CHANGELOG.md` を都度更新する**こと。詳細は末尾「更新運用」を参照。

---

## 1. このプロジェクトは何か

法人営業向け **AIコールセンターCRM**（`callcenter-ai-system`）。
架電リスト管理 → 架電 → 結果登録 → 案件化パイプライン → AI通話品質評価/コーチング、までをカバー。別システム **fax-crm-system** とは双方向同期で統合済み。

## 2. 引き継ぎ時に読む順番

1. **このファイル（CLAUDE.md）** — 全体像・規約・現状
2. **`CHANGELOG.md`** — 直近の変更履歴（機能追加はここに時系列で集約）
3. **`README.md`** — 機能一覧・API一覧・環境変数・セットアップ詳細
4. `git log --oneline -50` — コミット単位の詳細
5. 必要に応じて `docs/`（specification.md, UNIFIED_CUSTOMER_SCHEMA.md ほか）

## 3. 技術スタック / デプロイ

- Frontend: Next.js 14 / React 18 / Tailwind / Recharts（`frontend/`）
- Backend: Node.js / Express 4 / mysql2（`backend/`）
- DB: MySQL 8、AI: Anthropic Claude `claude-sonnet-4-6`
- 外部連携: Zoom Phone（`zoomphone://` 発信）、Google Sheets（文字起こし・通話時間）、fax-crm（webhook 双方向同期）
- **デプロイ: Railway**（GitHub `main` ブランチ自動デプロイ）。
  ※ README にある「お名前.com / PM2」は旧情報。現状は Railway。

## 4. アーキテクチャの最重要ポイント

引き継ぐ人が最初にハマりやすい/知っておくべき設計:

- **DBマイグレーションは起動時にコードで実行する方式**。
  `backend/src/server.js` の `runMigrations()` 内で、冪等な `ALTER TABLE`（try/catchで握りつぶし）を大量に実行する。
  `database/migrations/*.sql` は初期スキーマ中心で、**以降のスキーマ差分はこの server.js 側に追記する**のが慣習。スキーマを足すときは同じパターンで追記すること。
- **架電優先度ロジック＝システムの心臓部**。
  `backend/src/controllers/companyController.js` の `getNextCallTarget`（次の1件）/ `getCallList`（候補リスト）。
  優先順: (1)リコール期限 → (2)ゴールデンタイム（`industry_time_rules` 業種×時間帯）→ (3)未接触 → (4)前回不通NO_ANSWERは2日後 → (5)前回NGは3ヶ月後＆別オペレーターのみ。
  モード: `auto` / `industry`（業種別）/ `mylist`（自作リスト）/ `special`（特別リスト）。mylist・special は業種地域/結果除外/割当フィルタをバイパス。
  業種絞り込みは `industry_category`（飲食/製造/小売…14カテゴリの事前計算カラム）＋ `industry LIKE` の併用。地域絞り込みは `c.address LIKE CONCAT(irr.region, '%')`（住所先頭の都道府県でマッチ）。
- **通話フロー**: `callController.js` の `start`（企業ロック検証）→ `end`（結果コード `NO_ANSWER/NG/RECALL/INTERESTED/PROJECT/SKIP`、PROJECT→案件自動生成、RECALL→リコールタスク生成、終了時にロック解除）。文字起こし・実通話時間は Google Sheets から背景取得。
- **テストアカウント**は DB 書き込みをスキップしてダミー応答を返す（`req.user.isTestAccount`）。
- **認証**: JWT + bcrypt。`isServiceAccount`（fax-crm 同期バッチ用）はレート制限から除外。
- **AI機能**: `backend/src/services/aiEvaluationService.js`。通話品質6項目×100点採点、デイリーバッチ、個人コーチング、ステータスシート（7段階研修）自動生成。

## 5. 開発規約（このプロジェクト固有・厳守）

- **用語**: 「送信結果入力」ではなく **「受電報告」** と呼ぶ。
- **絵文字を使わない**: UI・トースト・confirm・コメント・コミットメッセージ含め全面禁止。
- **既存モックHTMLを流用しない**: `docs/mockups/` 等の古いモックを参照・転用しない。
- **スキーマ変更**は上記「起動時の冪等 ALTER」パターンで `server.js` に追記する。
- **DB予約語に注意**: `year_month` は MySQL 8 予約語のためカラム名は `period_ym`。
- **作業完了ごとに確認なしで `main` へ commit & push する**（main push が Railway 自動デプロイのトリガー。毎回プッシュまで完了させる）。自分の変更ファイルだけをステージし、無関係な未追跡ファイル（`scripts/generate-service-jwt.js` 等）は含めない。コミットメッセージは絵文字なし・`feat()/fix()/perf()` 形式。

## 6. ローカル起動（概要）

詳細は `README.md`。要点のみ:

```bash
# backend
cd backend && cp .env.example .env   # DB接続・APIキー等を設定
npm install && npm run dev           # :3001

# frontend
cd frontend && cp .env.example .env.local   # NEXT_PUBLIC_API_URL=http://localhost:3001
npm install && npm run dev                  # :3000
```

初期ログイン: `admin@example.com` / `admin123`。ヘルスチェック: `GET /api/health`。

## 7. 現状とTODO

- 直近のフォーカス: fax-crm 統合（顧客マスタ・双方向同期・webhook受口 `/api/integrations/faxcrm/*`）、CPA/案件質分析、業種別分析、給与Excel取込。詳細は `CHANGELOG.md`。
- 既知の未完タスク: **現時点でなし**。
  （`.claude/plan.md` にあった「架電エリア設定リファクタリング」は実装済み・消化済み。2026-06-03 確認。）

## 8. 更新運用（このファイルを陳腐化させない）

作業のたびに、変更の種類に応じて更新する:

| 変更した内容 | 更新先 |
|---|---|
| 機能追加・修正（日々の差分） | `CHANGELOG.md` に時系列で追記 |
| アーキテクチャ/設計方針/重要な慣習が変わった | この CLAUDE.md の該当セクション |
| 開発規約・用語ルールが増えた | この CLAUDE.md「5. 開発規約」 |
| 残タスク・現状が変わった | この CLAUDE.md「7. 現状とTODO」 |
| デプロイ/起動手順が変わった | この CLAUDE.md「3」「6」と `README.md` |

セッション終了前に「この変更で引き継ぎ書の記述が古くなっていないか」を一度確認すること。

---

最終更新: 2026-06-03
