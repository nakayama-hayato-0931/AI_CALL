# AI CallCenter CRM

法人営業向けAIコールセンターCRMシステム

## 機能一覧

- ログイン認証 (JWT)
- ダッシュボード (KPI表示・グラフ)
- 架電画面 (自動架電リスト・Zoom Phone連携)
- リコール管理 (今日・明日・期限超過)
- 案件管理 (ステータス管理)
- 通話ログ検索 (DB + Google Sheets)
- CSVインポート (企業データ一括登録)
- AI通話評価 (OpenAI API)

## 技術スタック

| レイヤー | 技術 |
|---------|------|
| Frontend | Next.js 14, React 18, Tailwind CSS, Recharts |
| Backend | Node.js, Express |
| Database | MySQL 8 |
| AI | OpenAI API (GPT-4) |
| 外部連携 | Zoom Phone, Google Sheets API |

## ディレクトリ構造

```
callcenter-ai-system/
├── frontend/          # Next.js フロントエンド
│   └── src/
│       ├── pages/     # ページコンポーネント
│       ├── components/# UIコンポーネント
│       ├── hooks/     # カスタムフック
│       └── utils/     # ユーティリティ
├── backend/           # Express バックエンド
│   └── src/
│       ├── routes/       # ルート定義
│       ├── controllers/  # コントローラー
│       ├── services/     # ビジネスロジック
│       ├── middlewares/  # ミドルウェア
│       └── utils/        # ヘルパー
├── database/          # SQLマイグレーション
├── scripts/           # デプロイスクリプト
└── docs/              # ドキュメント
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
```

### 3. バックエンド

```bash
cd backend
cp .env.example .env
# .env を編集してDB接続情報等を設定
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
- 初期ログイン: admin@example.com / admin123

## API エンドポイント

| メソッド | パス | 説明 |
|---------|------|------|
| POST | /api/auth/login | ログイン |
| GET | /api/auth/me | 現在のユーザー |
| GET | /api/dashboard/stats | 日次KPI |
| GET | /api/dashboard/hourly-calls | 時間帯別コール数 |
| GET | /api/dashboard/industry-conversion | 業種別案件化率 |
| GET | /api/companies | 企業一覧 |
| GET | /api/companies/:id | 企業詳細 |
| POST | /api/companies | 企業作成 |
| PUT | /api/companies/:id | 企業更新 |
| GET | /api/companies/call-list/next | 次の架電先 |
| POST | /api/calls/start | 架電開始 |
| PUT | /api/calls/:id/end | 通話結果登録 |
| GET | /api/calls | 通話履歴 |
| GET | /api/recalls | リコール一覧 |
| PUT | /api/recalls/:id/complete | リコール完了 |
| PUT | /api/recalls/:id/cancel | リコール取消 |
| GET | /api/projects | 案件一覧 |
| GET | /api/projects/:id | 案件詳細 |
| PUT | /api/projects/:id | 案件更新 |
| POST | /api/ai/evaluate | AI通話評価 |
| GET | /api/ai/evaluations/:callId | 評価結果取得 |
| POST | /api/csv/import | CSVインポート |
| GET | /api/logs/search | 通話ログ検索 |

## 外部連携設定

### Zoom Phone
架電画面の「架電開始」ボタンでZoom Phoneが自動起動します。
`zoomphone://call?number=電話番号` スキームを使用。

### Google Sheets
1. Google Cloud Consoleでサービスアカウントを作成
2. Google Sheets APIを有効化
3. スプレッドシートをサービスアカウントに共有
4. `.env` にサービスアカウント情報を設定

### OpenAI API
1. OpenAI APIキーを取得
2. `.env` の `OPENAI_API_KEY` に設定

## デプロイ (お名前.comレンタルサーバー)

```bash
# サーバーにSSH接続
ssh user@your-server

# デプロイスクリプト実行
bash scripts/deploy.sh
```

### PM2プロセス管理

```bash
pm2 status          # 状態確認
pm2 logs            # ログ確認
pm2 restart all     # 全再起動
```

## Git ブランチ戦略

- `main` - 本番ブランチ
- `develop` - 開発ブランチ
- `feature/*` - 機能開発ブランチ

## セキュリティ

- bcryptによるパスワードハッシュ化
- JWT認証 (有効期限付き)
- SQLインジェクション対策 (プリペアドステートメント)
- Helmetによるセキュリティヘッダー
- レートリミット (ログイン: 15分/10回, API: 15分/500回)
- CORS設定
- 入力バリデーション
