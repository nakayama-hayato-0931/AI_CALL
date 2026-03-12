# AI CallCenter CRM 実装手順書

このガイドでは、ゼロからシステムを動かすまでの全手順を解説します。

---

## 前提条件（事前にインストールが必要なもの）

| ツール | バージョン | 用途 | インストール方法 |
|--------|-----------|------|-----------------|
| Node.js | 18以上 | バックエンド・フロントエンド実行 | https://nodejs.org/ からLTS版をダウンロード |
| MySQL | 8.0以上 | データベース | https://dev.mysql.com/downloads/ |
| Git | 最新 | ソース管理 | https://git-scm.com/ |
| npm | Node.js同梱 | パッケージ管理 | Node.jsに含まれる |

### 確認コマンド
```bash
node -v    # v18.0.0 以上であればOK
npm -v     # 9.0.0 以上
mysql --version  # 8.0 以上
git --version
```

---

## STEP 1: リポジトリ取得

```bash
# プロジェクトフォルダに移動
cd ~/Desktop  # または任意のフォルダ

# (Gitリポジトリの場合)
git clone https://github.com/your-org/callcenter-ai-system.git
cd callcenter-ai-system

# (ローカルファイルの場合)
# そのままプロジェクトフォルダに cd してください
```

---

## STEP 2: データベース作成

### 2-1. MySQLにログイン
```bash
mysql -u root -p
# パスワードを入力
```

### 2-2. SQLファイルを実行
```sql
-- MySQLコンソール内で実行
source database/migrations/001_create_tables.sql;
```

もしくはコマンドラインから:
```bash
mysql -u root -p < database/migrations/001_create_tables.sql
```

### 2-3. 作成されるもの
- データベース: `callcenter_crm`
- テーブル: 7個 (users, companies, calls, projects, recall_tasks, ai_evaluations, industry_time_rules)
- 初期データ: 業種別ゴールデンタイム + 管理者ユーザー

### 2-4. 確認
```sql
USE callcenter_crm;
SHOW TABLES;
SELECT * FROM users;  -- admin@example.com が存在すればOK
SELECT * FROM industry_time_rules;  -- 6件のゴールデンタイムデータ
```

---

## STEP 3: バックエンド設定

### 3-1. ディレクトリ移動
```bash
cd backend
```

### 3-2. 環境変数ファイル作成
```bash
cp .env.example .env
```

### 3-3. .env を編集
テキストエディタで `backend/.env` を開き、以下を設定:

```env
# --- 必須設定 ---

# MySQLの接続情報（自分の環境に合わせる）
DB_HOST=localhost
DB_PORT=3306
DB_USER=root
DB_PASSWORD=あなたのMySQLパスワード
DB_NAME=callcenter_crm

# JWT認証のシークレットキー（ランダムな文字列に変更）
JWT_SECRET=my-super-secret-key-change-this-123

# --- 任意設定（あとから設定でもOK） ---

# OpenAI API（AI通話評価を使う場合）
OPENAI_API_KEY=sk-あなたのAPIキー

# Google Sheets（通話ログ連携を使う場合）
GOOGLE_SERVICE_ACCOUNT_EMAIL=
GOOGLE_PRIVATE_KEY=
GOOGLE_SPREADSHEET_ID=

# フロントエンドURL
FRONTEND_URL=http://localhost:3000
```

### 3-4. パッケージインストール
```bash
npm install
```
これで `node_modules/` フォルダに依存パッケージが入ります。

### 3-5. バックエンド起動
```bash
# 開発モード（ファイル変更で自動再起動）
npm run dev

# 本番モード
npm start
```

### 3-6. 動作確認
ブラウザまたはcurlで:
```bash
curl http://localhost:3001/api/health
```
レスポンス:
```json
{ "success": true, "message": "OK", "timestamp": "..." }
```
これが表示されればバックエンドは正常です。

---

## STEP 4: フロントエンド設定

### 4-1. 新しいターミナルを開き、ディレクトリ移動
```bash
cd frontend
```

### 4-2. 環境変数ファイル作成
```bash
cp .env.example .env.local
```

### 4-3. .env.local を確認
```env
NEXT_PUBLIC_API_URL=http://localhost:3001
```
バックエンドのポート番号と合っていればOK。

### 4-4. パッケージインストール
```bash
npm install
```

### 4-5. フロントエンド起動
```bash
# 開発モード
npm run dev
```

### 4-6. アクセス
ブラウザで http://localhost:3000 を開く

### 4-7. ログイン
```
メールアドレス: admin@example.com
パスワード: admin123
```

---

## STEP 5: 基本機能の動作確認

### 5-1. ダッシュボード
ログイン後、ダッシュボードが表示されます。
初期状態ではデータがないため数値は0です。

### 5-2. CSVインポートで企業データ投入
1. 左メニュー「CSVインポート」をクリック
2. `scripts/sample_companies.csv` を選択
3. 「インポート実行」をクリック
4. 10件の企業データが登録されます

### 5-3. 架電画面で架電テスト
1. 左メニュー「架電画面」をクリック
2. 自動的に次の架電先が表示されます
3. 「架電開始」を押す（Zoom Phoneが起動を試みます）
4. 結果コードを選択 → メモ入力 → 「保存して次へ」
5. 自動的に次の企業が表示されます

### 5-4. リコール確認
結果コードで「リコール」を選んだ場合:
- 左メニュー「リコール管理」に表示されます
- 「今日」「明日」「期限超過」で分類されています

### 5-5. 案件確認
結果コードで「案件化」を選んだ場合:
- 左メニュー「案件管理」に案件が作成されます
- 詳細画面で面接日やステータスを管理できます

---

## STEP 6: 外部連携設定（任意）

### 6-1. OpenAI API（AI通話評価）

1. https://platform.openai.com/ にアクセス
2. API Keysでキーを作成
3. `backend/.env` の `OPENAI_API_KEY` に設定
4. バックエンドを再起動

**テスト:**
```bash
# CLIから直接テスト
cd ai
node evaluate.js "お世話になります。株式会社ABCの田中と申します。本日は御社の人材採用についてお電話いたしました。"
```

### 6-2. Google Sheets連携

1. Google Cloud Console (https://console.cloud.google.com/) でプロジェクト作成
2. 「Google Sheets API」を有効化
3. 「サービスアカウント」を作成し、JSONキーをダウンロード
4. 連携したいスプレッドシートの共有設定で、サービスアカウントのメールアドレスを「閲覧者」として追加
5. `.env` に以下を設定:
   ```env
   GOOGLE_SERVICE_ACCOUNT_EMAIL=xxx@xxx.iam.gserviceaccount.com
   GOOGLE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----"
   GOOGLE_SPREADSHEET_ID=スプレッドシートのID（URLの/d/のあとの部分）
   ```

### 6-3. Zoom Phone連携

追加設定は不要です。架電画面の「架電開始」ボタンを押すと、ブラウザが `zoomphone://call?number=電話番号` を開き、Zoom Phoneアプリが自動起動します。

**前提条件:** PCにZoom Phoneアプリがインストールされていること。

---

## STEP 7: 本番デプロイ（お名前.comレンタルサーバー）

### 7-1. サーバーにSSH接続
```bash
ssh user@your-server-ip
```

### 7-2. 必要ツールのインストール
```bash
# Node.js (nvm経由推奨)
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
source ~/.bashrc
nvm install 18
nvm use 18

# PM2（プロセスマネージャー）
npm install -g pm2

# MySQL（サーバーにない場合）
sudo apt install mysql-server  # Ubuntu
```

### 7-3. リポジトリ取得
```bash
cd ~
git clone https://github.com/your-org/callcenter-ai-system.git
cd callcenter-ai-system
```

### 7-4. データベース設定
```bash
mysql -u root -p < database/migrations/001_create_tables.sql
```

### 7-5. バックエンド設定
```bash
cd backend
cp .env.example .env
nano .env  # 本番用の設定を入力
npm install --production
```

### 7-6. フロントエンドビルド
```bash
cd ../frontend
cp .env.example .env.local
nano .env.local  # 本番APIのURLを設定
npm install
npm run build  # 本番用にビルド
```

### 7-7. PM2で起動
```bash
# バックエンド
cd ../backend
pm2 start src/server.js --name callcenter-api

# フロントエンド
cd ../frontend
pm2 start npm --name callcenter-front -- start

# 自動起動設定
pm2 save
pm2 startup
```

### 7-8. PM2管理コマンド
```bash
pm2 status        # プロセス状態確認
pm2 logs           # ログ表示
pm2 restart all    # 全再起動
pm2 stop all       # 全停止
```

---

## STEP 8: ユーザー追加

### 管理者がユーザーを追加する場合

MySQLに直接INSERT:
```sql
USE callcenter_crm;

-- パスワードを bcrypt でハッシュ化する必要がある
-- Node.jsで以下を実行してハッシュを取得:
-- node -e "const bcrypt=require('bcrypt'); bcrypt.hash('password123',10).then(h=>console.log(h))"

INSERT INTO users (name, email, password_hash, role)
VALUES ('山田 花子', 'yamada@example.com', '$2b$10$ハッシュ値', 'operator');
```

ロールの種類:
- `admin` - 全機能利用可能
- `manager` - CSVインポート可能 + オペレーター機能
- `operator` - 架電・リコール・案件管理

---

## トラブルシューティング

### バックエンドが起動しない
```
[DB] MySQL接続失敗: Access denied
```
→ `.env` の `DB_USER` と `DB_PASSWORD` を確認

### フロントエンドでAPIエラー
```
Network Error / CORS error
```
→ バックエンドが起動しているか確認
→ `.env` の `FRONTEND_URL` がフロントエンドのURLと一致しているか確認

### ログインできない
→ MySQLで `SELECT * FROM users;` を実行し、ユーザーが存在するか確認
→ パスワードは `admin123`（初期管理者）

### CSVインポートが失敗する
→ CSVファイルがUTF-8エンコーディングか確認
→ ヘッダー行が `company_name,phone_number,industry,region` か確認

### AI評価が動かない
→ `.env` の `OPENAI_API_KEY` が正しく設定されているか確認
→ OpenAI APIの残高があるか確認

---

## ファイル構成まとめ

```
callcenter-ai-system/
├── .gitignore
├── README.md
│
├── database/
│   └── migrations/
│       └── 001_create_tables.sql    ← DBスキーマ
│
├── backend/
│   ├── .env.example                 ← 環境変数テンプレート
│   ├── package.json
│   ├── config/
│   │   └── database.js              ← MySQL接続設定
│   └── src/
│       ├── server.js                ← メインサーバー
│       ├── routes/                  ← 9つのAPIルート
│       ├── controllers/             ← 9つのコントローラー
│       ├── services/                ← AI評価・Google Sheets
│       ├── middlewares/             ← 認証・エラーハンドリング
│       └── utils/                   ← レスポンス・ロガー
│
├── frontend/
│   ├── .env.example
│   ├── package.json
│   ├── next.config.js
│   ├── tailwind.config.js
│   └── src/
│       ├── pages/                   ← 7つのページ
│       ├── components/common/       ← 共通レイアウト
│       ├── hooks/                   ← 認証フック
│       └── utils/                   ← API通信
│
├── ai/
│   └── evaluate.js                  ← AI評価CLIツール
│
├── scripts/
│   ├── deploy.sh                    ← デプロイスクリプト
│   └── sample_companies.csv         ← サンプルCSV
│
└── docs/
    ├── AI_CallCenter_CRM_説明資料.pptx ← プレゼン資料
    └── mockups/                     ← 画面モックアップHTML
```

---

## 全APIエンドポイント一覧

| # | メソッド | パス | 認証 | 説明 |
|---|---------|------|------|------|
| 1 | POST | /api/auth/login | 不要 | ログイン |
| 2 | GET | /api/auth/me | 必要 | 現在のユーザー情報 |
| 3 | GET | /api/dashboard/stats | 必要 | 日次KPI統計 |
| 4 | GET | /api/dashboard/hourly-calls | 必要 | 時間帯別コール数 |
| 5 | GET | /api/dashboard/industry-conversion | 必要 | 業種別案件化率 |
| 6 | GET | /api/companies | 必要 | 企業一覧 |
| 7 | GET | /api/companies/:id | 必要 | 企業詳細 |
| 8 | POST | /api/companies | 必要 | 企業作成 |
| 9 | PUT | /api/companies/:id | 必要 | 企業更新 |
| 10 | GET | /api/companies/call-list/next | 必要 | 次の架電先 |
| 11 | POST | /api/calls/start | 必要 | 架電開始 |
| 12 | PUT | /api/calls/:id/end | 必要 | 通話結果登録 |
| 13 | GET | /api/calls | 必要 | 通話履歴一覧 |
| 14 | GET | /api/recalls | 必要 | リコール一覧 |
| 15 | PUT | /api/recalls/:id/complete | 必要 | リコール完了 |
| 16 | PUT | /api/recalls/:id/cancel | 必要 | リコール取消 |
| 17 | GET | /api/projects | 必要 | 案件一覧 |
| 18 | GET | /api/projects/:id | 必要 | 案件詳細 |
| 19 | PUT | /api/projects/:id | 必要 | 案件更新 |
| 20 | POST | /api/ai/evaluate | 必要 | AI通話評価実行 |
| 21 | GET | /api/ai/evaluations/:callId | 必要 | 評価結果取得 |
| 22 | GET | /api/ai/evaluations/user/:userId | 必要 | ユーザー評価履歴 |
| 23 | POST | /api/csv/import | Manager+ | CSVインポート |
| 24 | GET | /api/logs/search | 必要 | 通話ログ検索 |
| 25 | GET | /api/health | 不要 | ヘルスチェック |
