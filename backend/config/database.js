/**
 * MySQL接続プール設定 (シンプル・確実重視)
 */
const mysql = require('mysql2/promise');
require('dotenv').config();

// SSL は付けない。 Railway proxy 経由の TCP は plain で繋がる (確認済 /api/_tcptest)
// SSL を入れると mysql2 v3.6.5 が SSL handshake で無限 hang する症状あり。
// DB_SSL=1 のときだけ明示的に SSL を有効化。
// pool 初期化時の getConnection() / pool.on('connection') が
// mysql2 v3.19.0 で pool queue を塞いでいた疑い。
// timezone は createPool option (timezone: '+09:00') で十分。
const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT, 10) || 3306,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'callcenter_crm',
  waitForConnections: true,
  connectionLimit: 30,
  queueLimit: 0,
  connectTimeout: 20000,
  charset: 'utf8mb4',
  timezone: '+09:00',
  dateStrings: true,
  ...(process.env.DB_SSL === '1' ? { ssl: { rejectUnauthorized: false } } : {}),
});

// 各 connection の session time_zone を JST に設定。
// これが無いと NOW() が UTC で返り、 call_started_at 等が 9 時間ずれて保存される
// (結果ログの日時が深夜表示、 文字起こし照合が ±5分窓を外れて取得不能になる事象)。
//
// 注意: mysql2 v3.19 で pool.on('connection') のコールバック内で
//   await conn.query(...) を直接 await すると pool 内 queue が破壊される事象あり
//   (過去ログイン全機能停止の真因 commit a29d1c8 参照)。 setImmediate と
//   .catch(() => {}) の fire-and-forget で回避する。
pool.on('connection', (conn) => {
  setImmediate(() => {
    conn.query("SET time_zone = '+09:00'").catch(() => {});
  });
});

module.exports = pool;
