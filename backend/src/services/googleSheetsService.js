/**
 * Google Sheets連携サービス
 * スプレッドシートから通話ログを検索する
 */
const { google } = require('googleapis');
const logger = require('../utils/logger');

/**
 * Google Sheets APIクライアントを初期化
 */
const getClient = async () => {
  try {
    const auth = new google.auth.GoogleAuth({
      credentials: {
        client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
        private_key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
      },
      scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
    });

    const sheets = google.sheets({ version: 'v4', auth });
    return sheets;
  } catch (err) {
    logger.error('Google Sheets認証エラー:', err);
    throw new Error('Google Sheets APIの認証に失敗しました');
  }
};

/**
 * 電話番号で通話ログを検索
 * @param {string} phoneNumber - 検索する電話番号
 * @returns {Array} 通話ログ一覧
 */
const searchCallLogs = async (phoneNumber) => {
  try {
    const sheets = await getClient();
    const spreadsheetId = process.env.GOOGLE_SPREADSHEET_ID;

    if (!spreadsheetId) {
      throw new Error('GOOGLE_SPREADSHEET_IDが設定されていません');
    }

    // シートのデータを取得 (A:Z全列)
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: 'シート1!A:Z',
    });

    const rows = response.data.values;
    if (!rows || rows.length === 0) {
      return [];
    }

    // ヘッダー行取得
    const headers = rows[0];
    const dataRows = rows.slice(1);

    // 電話番号カラムのインデックスを探索
    const phoneColIndex = headers.findIndex(
      (h) => h.includes('電話') || h.includes('番号') || h.includes('着信') || h.toLowerCase().includes('phone')
    );

    if (phoneColIndex === -1) {
      logger.warn('電話番号カラムが見つかりません');
      return [];
    }

    // 電話番号でフィルタリング (ハイフン・+81等を正規化して比較)
    const normalize = (num) => {
      let n = (num || '').replace(/[-\s()+]/g, '');
      // +81 → 0 に変換 (例: 819012345678 → 09012345678)
      if (n.startsWith('81') && n.length >= 11) n = '0' + n.slice(2);
      return n;
    };
    const normalizedSearch = normalize(phoneNumber);
    const matchedRows = dataRows.filter((row) => {
      const cellValue = normalize(row[phoneColIndex] || '');
      return cellValue.includes(normalizedSearch) || normalizedSearch.includes(cellValue);
    });

    // オブジェクト形式に変換
    const results = matchedRows.map((row) => {
      const obj = {};
      headers.forEach((header, i) => {
        obj[header] = row[i] || '';
      });
      return obj;
    });

    logger.info(`Google Sheets検索: phone=${phoneNumber}, 結果=${results.length}件`);
    return results;
  } catch (err) {
    logger.error('Google Sheets検索エラー:', err);
    throw err;
  }
};

// ===== Transcriptキャッシュ（5分間保持） =====
const TRANSCRIPT_CACHE_TTL = 5 * 60 * 1000; // 5分
let transcriptCache = null; // { index: Map<phone, [{transcript, time}]>, fetchedAt: number }

const normalize = (num) => {
  let n = (num || '').replace(/[-\s()+]/g, '');
  if (n.startsWith('81') && n.length >= 11) n = '0' + n.slice(2);
  return n;
};

/**
 * Transcriptインデックスを取得（キャッシュ付き）
 * 4万件超のシートデータをメモリにキャッシュし、電話番号でインデックス化
 */
const getTranscriptIndex = async () => {
  // キャッシュが有効ならそのまま返す
  if (transcriptCache && (Date.now() - transcriptCache.fetchedAt) < TRANSCRIPT_CACHE_TTL) {
    return transcriptCache.index;
  }

  const sheets = await getClient();
  const transcriptSheetId = process.env.GOOGLE_TRANSCRIPT_SPREADSHEET_ID;
  if (!transcriptSheetId) return new Map();

  logger.info('Transcriptシートデータ取得開始...');
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: transcriptSheetId,
    range: 'シート1!A:C',
  });

  const rows = response.data.values;
  if (!rows || rows.length <= 1) return new Map();

  // 電話番号でインデックス化
  const index = new Map();
  for (let i = 1; i < rows.length; i++) {
    const phone = normalize(rows[i][0] || '');
    const transcript = rows[i][1] || '';
    const time = rows[i][2] || '';
    if (!phone || !transcript) continue;
    if (!index.has(phone)) index.set(phone, []);
    // シートの時刻はJST（UTC+9）なので、タイムゾーンを明示してパース
    const parsedTime = time ? new Date(time.replace(/\s/, 'T') + '+09:00').getTime() : 0;
    index.get(phone).push({ transcript, time: parsedTime });
  }

  transcriptCache = { index, fetchedAt: Date.now() };
  logger.info(`Transcriptキャッシュ構築完了: ${rows.length - 1}行, ${index.size}電話番号`);
  return index;
};

/**
 * 文字起こしスプレッドシートから電話番号+開始時刻でtranscriptを検索
 */
const findTranscript = async (phoneNumber, callStartedAt) => {
  try {
    const index = await getTranscriptIndex();
    const normalizedPhone = normalize(phoneNumber);
    const callTime = new Date(callStartedAt).getTime();

    const entries = index.get(normalizedPhone);
    if (!entries) return null;

    for (const entry of entries) {
      if (entry.time && Math.abs(callTime - entry.time) <= 5 * 60 * 1000) {
        return entry.transcript;
      }
    }
    return null;
  } catch (err) {
    logger.error('Transcript検索エラー:', err);
    return null;
  }
};

/**
 * 複数通話のtranscriptを一括取得
 */
const findTranscriptsBatch = async (calls) => {
  try {
    const index = await getTranscriptIndex();

    const results = new Map();
    for (const call of calls) {
      const phone = normalize(call.phone_number);
      const entries = index.get(phone);
      if (!entries) continue;
      const callTime = new Date(call.call_started_at).getTime();
      for (const entry of entries) {
        if (entry.time && Math.abs(callTime - entry.time) <= 5 * 60 * 1000) {
          results.set(call.id, entry.transcript);
          break;
        }
      }
    }
    return results;
  } catch (err) {
    logger.error('Transcript一括検索エラー:', err);
    return new Map();
  }
};

module.exports = { searchCallLogs, findTranscript, findTranscriptsBatch };
