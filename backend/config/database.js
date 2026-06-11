/**
 * MySQL接続プール設定 (シンプル・確実重視)
 */
const mysql = require('mysql2/promise');
require('dotenv').config();

// Railway の public proxy (hopper.proxy.rlwy.net 等) 経由のときは SSL/TLS が必須なケースがある。
// DB_HOST に proxy.rlwy.net が含まれているときは SSL を有効化する。
const isRailwayPublicProxy = (process.env.DB_HOST || '').includes('rlwy.net');

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
  ...(isRailwayPublicProxy ? { ssl: { rejectUnauthorized: false } } : {}),
});

// 接続テスト + JST タイムゾーン設定
pool.getConnection()
  .then(async (conn) => {
    await conn.query("SET time_zone = '+09:00'");
    console.log('[DB] MySQL接続成功 (timezone: JST)');
    conn.release();
  })
  .catch((err) => {
    console.error('[DB] MySQL接続失敗:', err.message);
  });

// 新規接続時にも JST 設定 (シンプルに 1 クエリのみ、 余計な SET は付けない)
pool.on('connection', (conn) => {
  conn.query("SET time_zone = '+09:00'").catch(() => {});
});

module.exports = pool;
