/**
 * fax-crm-system の MySQL への接続プール (Phase 2: シャドー二重書き用)。
 *
 * ENV:
 *   FAXCRM_DB_URL                fax-crm MySQL の MYSQL_PUBLIC_URL (推奨)
 *   または FAXCRM_DB_HOST/PORT/USER/PASSWORD/NAME を個別指定
 *
 * 未設定なら getPool() は null を返す → 呼び出し側は no-op として扱う。
 *
 * fax-crm 本来の DB に直接書き込んで customers テーブルを同期する目的のみ。
 */
const mysql = require('mysql2/promise');

let pool = null;
let triedBuild = false;

function isConfigured() {
  return !!process.env.FAXCRM_DB_URL
      || (!!process.env.FAXCRM_DB_HOST && !!process.env.FAXCRM_DB_USER);
}

function parseUrl(u) {
  try {
    const url = new URL(u);
    return {
      host: url.hostname,
      port: Number(url.port || 3306),
      user: decodeURIComponent(url.username),
      password: decodeURIComponent(url.password),
      database: url.pathname.replace(/^\//, ''),
    };
  } catch (_e) {
    return null;
  }
}

function buildPool() {
  if (!isConfigured()) return null;
  const opts = {
    waitForConnections: true,
    connectionLimit: Number(process.env.FAXCRM_DB_CONNECTION_LIMIT || 5),
    queueLimit: 0,
    charset: 'utf8mb4_general_ci',
    dateStrings: ['DATE'],
    connectTimeout: 10000,
  };
  if (process.env.FAXCRM_DB_URL) {
    const parsed = parseUrl(process.env.FAXCRM_DB_URL);
    if (!parsed) {
      console.error('[faxCrmDb] FAXCRM_DB_URL の解析に失敗');
      return null;
    }
    return mysql.createPool({ ...opts, ...parsed });
  }
  return mysql.createPool({
    ...opts,
    host: process.env.FAXCRM_DB_HOST,
    port: Number(process.env.FAXCRM_DB_PORT || 3306),
    user: process.env.FAXCRM_DB_USER,
    password: process.env.FAXCRM_DB_PASSWORD || '',
    database: process.env.FAXCRM_DB_NAME || 'railway',
  });
}

function getPool() {
  if (pool) return pool;
  if (triedBuild) return null;
  triedBuild = true;
  pool = buildPool();
  if (pool) console.log('[faxCrmDb] connection pool 構築');
  else console.log('[faxCrmDb] 未設定 (FAXCRM_DB_URL 等が空) — shadow write skip');
  return pool;
}

async function ping() {
  const p = getPool();
  if (!p) return { ok: false, configured: false };
  try {
    const conn = await p.getConnection();
    await conn.ping();
    conn.release();
    return { ok: true, configured: true };
  } catch (e) {
    return { ok: false, configured: true, error: e.message };
  }
}

module.exports = { getPool, ping, isConfigured };
