/**
 * cpa-v2: fax-crm から移植した CPA 系サービス群の共通ヘルパー
 *
 * source_kind は callcenter 側では '架電バイト' で keep する (fax-crm は 'FAX受電')。
 * Google 認証は callcenter スタイル (env の client_email + private_key) に統一。
 */
const pool = require('../../../config/database');

const SOURCE_KIND_KEEP = '架電バイト';

// fax-crm の getPool() / isConfigured() 互換シム
const getPool = () => pool;
const isConfigured = () => !!pool;

// Excel/Sheets シリアル日付 → YYYY-MM-DD
function excelSerialToYMD(serial) {
  const n = Math.floor(Number(serial));
  if (!Number.isFinite(n) || n <= 0) return null;
  const baseUtcMs = Date.UTC(1899, 11, 30);
  const ms = baseUtcMs + n * 86400000;
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

function parseDateCell(v) {
  if (v === undefined || v === null || v === '') return null;
  if (typeof v === 'number' && v > 25569 && v < 80000) return excelSerialToYMD(v);
  const s = String(v).trim();
  if (!s) return null;
  if (/^\d+(\.\d+)?$/.test(s)) {
    const n = Number(s);
    if (n > 25569 && n < 80000) return excelSerialToYMD(n);
  }
  let m = s.match(/^(\d{4})[\/\-年](\d{1,2})[\/\-月](\d{1,2})/);
  if (m) return `${m[1]}-${String(m[2]).padStart(2, '0')}-${String(m[3]).padStart(2, '0')}`;
  m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
  if (m) return `${m[3]}-${String(m[1]).padStart(2, '0')}-${String(m[2]).padStart(2, '0')}`;
  m = s.match(/^(\d{1,2})\/(\d{1,2})$/);
  if (m) return `${new Date().getFullYear()}-${String(m[1]).padStart(2, '0')}-${String(m[2]).padStart(2, '0')}`;
  return null;
}

function parseMoneyTimes10000(v) {
  if (v === undefined || v === null || v === '') return 0;
  const cleaned = String(v).replace(/[¥,\s円]/g, '');
  const n = Number(cleaned);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 10000);
}

function parseInt0(v) {
  if (v === undefined || v === null || v === '') return 0;
  const n = Number(String(v).replace(/[^0-9.-]/g, ''));
  return Number.isFinite(n) ? Math.round(n) : 0;
}

function parseIntNullable(v) {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  if (s === '') return null;
  const n = Number(s.replace(/[^0-9.-]/g, ''));
  return Number.isFinite(n) ? Math.round(n) : null;
}

function clean(s) {
  if (s === undefined || s === null) return null;
  const t = String(s).trim();
  return t || null;
}

// Excel 列名(A,B,...,AA,...) → 0始まりインデックス
function colIndex(letter) {
  let n = 0;
  for (const ch of letter.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

/**
 * Google Sheets クライアントを取得 (callcenter スタイル)。
 * 環境変数:
 *   GOOGLE_SERVICE_ACCOUNT_EMAIL
 *   GOOGLE_PRIVATE_KEY (改行は \n エンコード)
 */
async function getSheetsClient() {
  const { google } = require('googleapis');
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const rawKey = process.env.GOOGLE_PRIVATE_KEY;
  if (!email || !rawKey) {
    const err = new Error('GOOGLE_SERVICE_ACCOUNT_EMAIL / GOOGLE_PRIVATE_KEY が未設定');
    err.status = 400; err.code = 'NO_SA';
    throw err;
  }
  const auth = new google.auth.GoogleAuth({
    credentials: {
      client_email: email,
      private_key: rawKey.replace(/\\n/g, '\n'),
    },
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  });
  return google.sheets({ version: 'v4', auth });
}

/**
 * 指定シートの values を取得 (UNFORMATTED_VALUE)。
 * Sheets API は per-user 60req/min (read) なので 429/quota 超過時は exponential backoff で最大3回リトライ。
 */
async function fetchSheetValues({ spreadsheetId, sheetName, rangePart }) {
  const sheets = await getSheetsClient();
  const range = `'${sheetName}'!${rangePart}`;
  let lastErr;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const resp = await sheets.spreadsheets.values.get({
        spreadsheetId, range,
        valueRenderOption: 'UNFORMATTED_VALUE',
        dateTimeRenderOption: 'SERIAL_NUMBER',
      });
      return resp.data.values || [];
    } catch (err) {
      lastErr = err;
      const msg = String(err?.message || '');
      const status = err?.code || err?.response?.status;
      const isRateLimit = status === 429 || /quota|rate/i.test(msg);
      if (!isRateLimit || attempt === 3) break;
      // 60req/min なので 30秒〜90秒待つと自然に解消する
      const waitMs = 30000 * (attempt + 1);
      await new Promise(r => setTimeout(r, waitMs));
    }
  }
  throw lastErr;
}

/**
 * 各シートの「source_kind 相当列」のユニーク値別件数を集計する診断ヘルパー。
 * 期待値:
 *   sales_projects/job_postings: 'FAX受電' / '架電バイト' などが見えるはず
 *   interview_records: NR列に同様
 */
async function probeKindColumn({ spreadsheetId, sheetName, rangePart, colLetter }) {
  const colIdx = colIndex(colLetter);
  try {
    const values = await fetchSheetValues({ spreadsheetId, sheetName, rangePart });
    const counts = {};
    let total = 0;
    const sampleRows = [];
    for (let r = 1; r < values.length; r++) {
      const row = values[r] || [];
      total++;
      const v = clean(row[colIdx]) || '(空)';
      counts[v] = (counts[v] || 0) + 1;
      if (sampleRows.length < 5) {
        sampleRows.push({ row: r + 1, kindValue: v, snippet: (row || []).slice(0, 8).map(c => String(c == null ? '' : c).slice(0, 30)) });
      }
    }
    return { ok: true, totalDataRows: total, byKindValue: counts, sampleRows };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

module.exports = {
  SOURCE_KIND_KEEP,
  getPool, isConfigured,
  parseDateCell, parseMoneyTimes10000, parseInt0, parseIntNullable, clean,
  colIndex, excelSerialToYMD,
  getSheetsClient, fetchSheetValues, probeKindColumn,
};
