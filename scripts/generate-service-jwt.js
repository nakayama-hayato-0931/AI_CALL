/**
 * サービス用 JWT (長期) を発行するワンショットスクリプト
 *
 * 用途:
 *   fax-crm-system → callcenter-ai-system の API 呼び出しに使う
 *   長期有効 JWT を1回だけ生成し、 Railway の fax-crm-backend env に保存する
 *
 * 実行方法 (どれか1つ):
 *
 *   [A] ローカル実行 (backend/.env の JWT_SECRET と production が同じ場合)
 *       PS> cd C:\Users\aaaas\OneDrive\デスクトップ\Claude\callcenter-ai-system\backend
 *       PS> node ../scripts/generate-service-jwt.js
 *
 *   [B] Railway CLI 実行 (production の JWT_SECRET を確実に使う)
 *       PS> railway run --service backend node scripts/generate-service-jwt.js
 *
 *   [C] Railway dashboard の Shell タブ (もしあれば)
 *       /app$ node scripts/generate-service-jwt.js
 *
 * 環境変数(任意):
 *   SERVICE_USER_ID  ... デフォルト 1 (callcenter の users.id に実在する admin)
 *   SERVICE_EMAIL    ... デフォルト fax-crm-sync@example.com
 *   JWT_EXPIRES_IN   ... デフォルト '365d' (1年)
 */
require('dotenv').config();
const jwt = require('jsonwebtoken');

const SECRET = process.env.JWT_SECRET;
if (!SECRET) {
  console.error('ERROR: JWT_SECRET が見つかりません。 .env を確認してください。');
  process.exit(1);
}

const payload = {
  id: Number(process.env.SERVICE_USER_ID || 1),
  email: process.env.SERVICE_EMAIL || 'fax-crm-sync@example.com',
  role: 'admin',
  isServiceAccount: true,
};

const expiresIn = process.env.JWT_EXPIRES_IN || '365d';

const token = jwt.sign(payload, SECRET, { expiresIn });

console.log('');
console.log('===== SERVICE JWT (有効期間: ' + expiresIn + ') =====');
console.log(token);
console.log('===== END =====');
console.log('');
console.log('payload:', JSON.stringify(payload, null, 2));
console.log('');
console.log('Railway の fax-crm-backend サービス → Variables に以下を追加:');
console.log('  CALLCENTER_API_BASE_URL = https://<callcenter-backend>.up.railway.app');
console.log('  CALLCENTER_API_TOKEN    = (上記の JWT)');
console.log('');
