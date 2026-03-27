# AI CallCenter CRM

法人営業向けAIコールセンターCRMシステム

AI（Anthropic Claude）による通話品質の自動評価・コーチング機能を搭載した、法人営業チーム向けのコールセンター管理システムです。架電リストの管理からオペレーター育成まで、営業活動の全プロセスをカバーします。

## 機能一覧

### オペレーター向け
- **ダッシュボード** — 日次KPI（架電数・接続率・案件化率）、時間帯別コール数、業種別案件化率のグラフ表示
- **架電画面** — 優先度スコア順の自動架電リスト、業種×時間帯のゴールデンタイム最適化、Zoom Phone連携による自動発信
- **通話結果登録** — 不在/NG/リコール/興味あり/案件化のステータス管理、メモ・有効接続・担当者接続の記録
- **リコール管理** — 今日・明日・期限超過のリコールタスク表示、リスケジュール・完了・取消操作
- **案件管理** — 新規→メール送付→面接設定→面接済→結果待ち→採用/失注のパイプライン管理
- **通話ログ検索** — DB + Google Sheets連携によるログ検索・フィルタリング
- **CSVインポート** — 企業データ一括登録（CSV/XLS/XLSX対応）、除外リストインポート
- **リクエスト機能** — オペレーターから管理者への申請・承認フロー

### 管理者向け（Admin）
- **ユーザー管理** — オペレーター/マネージャー/管理者の作成・編集・有効/無効切替
- **パフォーマンス分析** — オペレーター別の架電実績・KPI一覧、個人詳細ページ
- **AI通話評価** — Claude AIによる通話品質の自動採点（6項目×100点）、改善ポイント生成
- **コーチング機能** — AI分析に基づく個人別コーチングフィードバック自動生成
- **ステータスシート** — オペレーター育成状況の管理、AIによるトレーニングプラン策定
- **スクリプト管理** — 架電スクリプトの作成・承認・配布
- **企業管理** — 企業リストの一括管理・担当割当
- **CPA分析** — 採用単価（CPA）・品質メトリクスの分析、コストCSV/PDFインポート
- **リクエスト承認** — オペレーターからの申請の承認・却下

### AI機能
- **通話品質評価** — 6項目（総合・オープニング・明瞭さ・ヒアリング・切り返し・クロージング）を100点満点で自動採点
- **デイリーバッチ評価** — 日次の一括AI評価、チーム全体の傾向分析
- **個人コーチング** — オペレーター別の強み・弱み分析、次回改善アクション提案
- **ステータスシート自動生成** — 7段階トレーニングプログラムに基づく育成計画の自動作成

## 技術スタック

| レイヤー | 技術 |
|---------|------|
| Frontend | Next.js 14, React 18, Tailwind CSS, Recharts, date-fns |
| Backend | Node.js, Express 4, Winston (ログ), express-validator |
| Database | MySQL 8 (mysql2, コネクションプール) |
| AI | Anthropic Claude (claude-sonnet-4-6) |
| 外部連携 | Zoom Phone, Google Sheets API |
| セキュリティ | JWT, bcrypt, Helmet, CORS, Rate Limit |
| ファイル処理 | multer, csv-parser, pdf-parse, xlsx |
| デプロイ | PM2, お名前.comレンタルサーバー |

## ディレクトリ構造

```
callcenter-ai-system/
├── frontend/               # Next.js フロントエンド
│   └── src/
│       ├── pages/          # ページコンポーネント
│       │   ├── admin/      # 管理者ページ (11画面)
│       │   ├── projects/   # 案件管理ページ
│       │   └── sales/      # 営業ページ
│       ├── components/     # UIコンポーネント
│       ├── hooks/          # カスタムフック (useAuth等)
│       └── utils/          # API通信ユーティリティ
├── backend/                # Express バックエンド
│   ├── config/             # DB接続設定
│   └── src/
│       ├── routes/         # ルート定義 (14モジュール)
│       ├── controllers/    # コントローラー (13モジュール)
│       ├── services/       # AI評価・Google Sheets連携
│       ├── middlewares/     # 認証・エラーハンドリング
│       └── utils/          # ロガー・レスポンスヘルパー
├── database/               # SQLマイグレーション
│   └── migrations/         # 001〜004 スキーマ定義
├── scripts/                # デプロイスクリプト・サンプルデータ
└── docs/                   # ドキュメント・モックアップ
    └── mockups/            # HTMLモックアップ (5画面)
```

## セットアップ

### 1. リポジトリクローン

```bash
git clone https://github.com/your-org/callcenter-ai-system.git
cd callcenter-ai-system
```

### 2. データベース作成

```bash
mysql -u root -p < database/migrations/001_create_tables.sql
mysql -u root -p callcenter_crm < database/migrations/002_add_lock_and_skip.sql
# 003, 004 のマイグレーションも順次実行
```

### 3. バックエンド

```bash
cd backend
cp .env.example .env
# .env を編集してDB接続情報・APIキー等を設定
npm install
npm run dev
```

### 4. フロントエンド

```bash
cd frontend
cp .env.example .env.local
npm install
npm run dev
```

### 5. アクセス

- フロントエンド: http://localhost:3000
- バックエンドAPI: http://localhost:3001
- ヘルスチェック: http://localhost:3001/api/health
- 初期ログイン: `admin@example.com` / `admin123`

## 環境変数

### Backend (.env)

| 変数名 | 説明 | 例 |
|--------|------|-----|
| `PORT` | サーバーポート | `3001` |
| `NODE_ENV` | 環境 | `development` |
| `DB_HOST` | MySQL ホスト | `localhost` |
| `DB_PORT` | MySQL ポート | `3306` |
| `DB_USER` | MySQL ユーザー | `root` |
| `DB_PASSWORD` | MySQL パスワード | - |
| `DB_NAME` | データベース名 | `callcenter_crm` |
| `JWT_SECRET` | JWT署名キー | - |
| `JWT_EXPIRES_IN` | JWT有効期限 | `24h` |
| `ANTHROPIC_API_KEY` | Anthropic APIキー | `sk-ant-...` |
| `GOOGLE_SERVICE_ACCOUNT_EMAIL` | GCP サービスアカウント | - |
| `GOOGLE_PRIVATE_KEY` | GCP 秘密鍵 | - |
| `GOOGLE_SPREADSHEET_ID` | Google スプレッドシートID | - |
| `FRONTEND_URL` | CORS許可オリジン | `http://localhost:3000` |

### Frontend (.env.local)

| 変数名 | 説明 | 例 |
|--------|------|-----|
| `NEXT_PUBLIC_API_URL` | バックエンドAPIのURL | `http://localhost:3001` |

## API エンドポイント

### 認証
| メソッド | パス | 説明 |
|---------|------|------|
| POST | `/api/auth/login` | ログイン |
| GET | `/api/auth/me` | 現在のユーザー |
| GET | `/api/auth/operators` | オペレーター一覧 |

### ダッシュボード
| メソッド | パス | 説明 |
|---------|------|------|
| GET | `/api/dashboard/stats` | 日次KPI |
| GET | `/api/dashboard/hourly-calls` | 時間帯別コール数 |
| GET | `/api/dashboard/industry-conversion` | 業種別案件化率 |
| GET | `/api/dashboard/hourly-industry-connections` | 時間帯×業種別接続数 |
| GET | `/api/dashboard/work-hours` | 稼働時間取得 |
| POST | `/api/dashboard/work-hours` | 稼働時間登録 |

### 企業管理
| メソッド | パス | 説明 |
|---------|------|------|
| GET | `/api/companies` | 企業一覧 |
| POST | `/api/companies` | 企業作成 |
| PUT | `/api/companies/:id` | 企業更新 |
| GET | `/api/companies/call-list` | 架電リスト |
| GET | `/api/companies/call-list/next` | 次の架電先 |
| POST | `/api/companies/:id/lock` | 企業ロック |
| POST | `/api/companies/:id/unlock` | 企業アンロック |

### 架電
| メソッド | パス | 説明 |
|---------|------|------|
| POST | `/api/calls/start` | 架電開始 |
| PUT | `/api/calls/:id/end` | 通話結果登録 |
| GET | `/api/calls` | 通話履歴 |
| DELETE | `/api/calls/:id/cancel` | 架電取消 |
| POST | `/api/calls/skip` | スキップ |
| POST | `/api/calls/:id/refresh-transcript` | 文字起こし再取得 |

### リコール
| メソッド | パス | 説明 |
|---------|------|------|
| GET | `/api/recalls` | リコール一覧 |
| PUT | `/api/recalls/:id/complete` | リコール完了 |
| PUT | `/api/recalls/:id/cancel` | リコール取消 |
| PUT | `/api/recalls/:id/reschedule` | リスケジュール |

### 案件管理
| メソッド | パス | 説明 |
|---------|------|------|
| GET | `/api/projects` | 案件一覧 |
| GET | `/api/projects/:id` | 案件詳細 |
| PUT | `/api/projects/:id` | 案件更新 |
| DELETE | `/api/projects/:id` | 案件削除 |
| POST | `/api/projects/import-legacy` | レガシーデータインポート |
| GET | `/api/projects/:id/call-logs` | 案件の通話履歴 |
| GET | `/api/projects/:id/hires` | 採用情報取得 |
| PUT | `/api/projects/:id/hires` | 採用情報更新 |

### AI評価
| メソッド | パス | 説明 |
|---------|------|------|
| POST | `/api/ai/evaluate` | 通話AI評価 |
| POST | `/api/ai/evaluate-from-data` | データからAI評価 |
| POST | `/api/ai/evaluate-daily` | デイリーバッチ評価 |
| GET | `/api/ai/daily-summary` | 日次サマリー |
| GET | `/api/ai/eval-limit` | 評価上限確認 |
| GET | `/api/ai/latest-improvement` | 最新改善ポイント |
| GET | `/api/ai/evaluations/:callId` | 評価結果取得 |

### AI分析
| メソッド | パス | 説明 |
|---------|------|------|
| POST | `/api/ai/analysis/team` | チーム分析 |
| GET | `/api/ai/analysis/operator/:userId` | オペレーター分析 |
| POST | `/api/ai/analysis/operator/:userId/coaching` | コーチング生成 |
| POST | `/api/ai/analysis/status-sheets` | ステータスシート生成 |
| GET | `/api/ai/analysis/status-sheets` | ステータスシート一覧 |
| PUT | `/api/ai/analysis/status-sheets/:id` | ステータスシート更新 |

### CSVインポート
| メソッド | パス | 説明 |
|---------|------|------|
| POST | `/api/csv/import` | 企業CSVインポート |
| POST | `/api/csv/import-exclusion` | 除外リストインポート |
| GET | `/api/csv/exclusion-stats` | 除外統計 |
| POST | `/api/csv/manual-company` | 手動企業登録 |
| POST | `/api/csv/import-special` | 特殊インポート |

### 管理者
| メソッド | パス | 説明 |
|---------|------|------|
| - | `/api/admin/*` | ユーザー管理・パフォーマンス・企業管理・ルール・スクリプト・リクエスト |

### その他
| メソッド | パス | 説明 |
|---------|------|------|
| GET | `/api/analytics/cpa` | CPA分析 |
| GET | `/api/analytics/quality` | 品質分析 |
| GET | `/api/logs/daily` | 日次ログ |
| GET | `/api/logs/search` | ログ検索 |
| GET | `/api/scripts` | スクリプト取得 |
| GET | `/api/requests` | リクエスト一覧 |
| POST | `/api/requests` | リクエスト作成 |
| GET | `/api/health` | ヘルスチェック |

## データベース

### 主要テーブル

| テーブル | 説明 |
|---------|------|
| `users` | オペレーター・管理者（role: admin/operator/manager） |
| `companies` | 架電先企業（優先度スコア・除外フラグ付き） |
| `calls` | 通話履歴（結果コード: NO_ANSWER/NG/RECALL/INTERESTED/PROJECT） |
| `projects` | 案件（ステータス: NEW→MAIL_SENT→INTERVIEW_SET→INTERVIEW_DONE→WAITING_RESULT→HIRED/LOST） |
| `recall_tasks` | リコールタスク（pending/completed/overdue/cancelled） |
| `ai_evaluations` | AI通話評価スコア（6項目×100点） |
| `industry_time_rules` | 業種別ゴールデンタイム設定 |
| `status_sheets` | オペレーター育成ステータスシート |
| `operator_training` | トレーニング進捗（7段階） |
| `past_cpa_data` | 過去CPA実績データ |
| `system_settings` | システム設定（チーム目標等） |

## 外部連携設定

### Zoom Phone
架電画面の「架電開始」ボタンでZoom Phoneが自動起動します。
`zoomphone://call?number=電話番号` スキームを使用。

### Google Sheets
1. Google Cloud Consoleでサービスアカウントを作成
2. Google Sheets APIを有効化
3. スプレッドシートをサービスアカウントに共有
4. `.env` にサービスアカウント情報を設定

### Anthropic Claude API
1. Anthropic APIキーを取得
2. `.env` の `ANTHROPIC_API_KEY` に設定
3. AI通話評価・コーチング・ステータスシート生成に使用

## デプロイ

### 本番デプロイ（お名前.comレンタルサーバー）

```bash
# サーバーにSSH接続
ssh user@your-server

# デプロイスクリプト実行
bash scripts/deploy.sh
```

デプロイスクリプトは以下を自動実行します：
1. リポジトリのクローン/プル
2. 環境変数の検証
3. バックエンド依存関係のインストール
4. フロントエンドのビルド
5. データベースマイグレーション
6. PM2によるプロセス起動/再起動

### PM2プロセス管理

```bash
pm2 status          # 状態確認
pm2 logs            # ログ確認
pm2 restart all     # 全再起動
```

## Git ブランチ戦略

- `main` — 本番ブランチ
- `develop` — 開発ブランチ
- `feature/*` — 機能開発ブランチ

## セキュリティ

- bcryptによるパスワードハッシュ化
- JWT認証（有効期限付き）
- SQLインジェクション対策（プリペアドステートメント）
- Helmetによるセキュリティヘッダー
- レートリミット（ログイン: 15分/10回, API: 15分/500回）
- CORS設定
- express-validatorによる入力バリデーション
- 企業ロック機能（同時架電防止）

## ライセンス

Private
