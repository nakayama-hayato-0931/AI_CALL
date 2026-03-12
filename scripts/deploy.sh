#!/bin/bash
# ============================================
# デプロイスクリプト
# お名前.comレンタルサーバー向け
# ============================================

set -e

echo "=== AIコールセンターCRM デプロイ ==="

# 1. リポジトリ取得 (初回のみ)
if [ ! -d "/home/your-user/callcenter-ai-system" ]; then
  echo "[1/6] リポジトリをクローン..."
  cd /home/your-user
  git clone https://github.com/your-org/callcenter-ai-system.git
  cd callcenter-ai-system
else
  echo "[1/6] 最新コードを取得..."
  cd /home/your-user/callcenter-ai-system
  git pull origin main
fi

# 2. 環境変数設定 (初回のみ手動で .env を作成)
if [ ! -f "backend/.env" ]; then
  echo "[ERROR] backend/.env が見つかりません"
  echo "backend/.env.example をコピーして設定してください:"
  echo "  cp backend/.env.example backend/.env"
  echo "  nano backend/.env"
  exit 1
fi

# 3. バックエンド依存関係インストール
echo "[2/6] バックエンド依存関係をインストール..."
cd backend
npm install --production

# 4. フロントエンドビルド
echo "[3/6] フロントエンドをビルド..."
cd ../frontend
npm install
npm run build

# 5. データベースマイグレーション
echo "[4/6] データベースマイグレーション..."
cd ../backend
mysql -u $DB_USER -p$DB_PASSWORD < ../database/migrations/001_create_tables.sql 2>/dev/null || echo "テーブルは既に存在します"

# 6. PM2でサーバー起動 (または再起動)
echo "[5/6] バックエンドサーバーを起動..."
if pm2 describe callcenter-api > /dev/null 2>&1; then
  pm2 restart callcenter-api
else
  pm2 start src/server.js --name callcenter-api
fi

echo "[6/6] フロントエンドサーバーを起動..."
cd ../frontend
if pm2 describe callcenter-frontend > /dev/null 2>&1; then
  pm2 restart callcenter-frontend
else
  pm2 start npm --name callcenter-frontend -- start
fi

pm2 save

echo ""
echo "=== デプロイ完了 ==="
echo "バックエンド: http://localhost:3001"
echo "フロントエンド: http://localhost:3000"
