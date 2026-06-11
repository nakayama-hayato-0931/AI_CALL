/**
 * MySQL接続プール設定
 * mysql2/promiseを使用し、プリペアドステートメントでSQLインジェクション対策
 */
const mysql = require('mysql2/promise');
require('dotenv').config();

const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT, 10) || 3306,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'callcenter_crm',
  // 接続プール設定
  waitForConnections: true,
  connectionLimit: 20,
  queueLimit: 0,
  // タイムアウト設定
  connectTimeout: 10000,
  // 文字コード
  charset: 'utf8mb4',
  // タイムゾーン
  timezone: '+09:00',
  // DATE/DATETIME型を文字列として返す（タイムゾーン変換による日付ズレ防止）
  dateStrings: true,
});

// 接続テスト + セッションタイムゾーンをJSTに設定
pool.getConnection()
  .then(async (conn) => {
    await conn.query("SET time_zone = '+09:00'");
    console.log('[DB] MySQL接続成功 (timezone: JST)');
    conn.release();
  })
  .catch((err) => {
    console.error('[DB] MySQL接続失敗:', err.message);
  });

// 全接続でセッションタイムゾーンをJSTに設定 + 実行時間の上限を設定
//   MAX_EXECUTION_TIME はミリ秒単位 (60秒)。これを超える SELECT は ER_QUERY_TIMEOUT で
//   自動キャンセルされ、後続クエリへのロック影響を防ぐ。重い ad-hoc クエリでバックエンド
//   全体が詰まる事故 (operators API すら応答しないなど) を回避するため。
//   ※ UPDATE/INSERT/DELETE/DDL には効かない (MySQL の仕様)。
pool.on('connection', (conn) => {
  conn.query("SET time_zone = '+09:00'");
  conn.query("SET SESSION MAX_EXECUTION_TIME = 60000").catch(() => {});
});

module.exports = pool;
