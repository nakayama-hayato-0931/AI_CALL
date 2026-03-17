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

/**
 * 文字起こしスプレッドシートから電話番号+開始時刻でtranscriptを検索
 * @param {string} phoneNumber - 電話番号 (0XXX形式)
 * @param {string} callStartedAt - 通話開始日時 (YYYY-MM-DD HH:mm:ss)
 * @returns {string|null} transcript text or null
 */
const findTranscript = async (phoneNumber, callStartedAt) => {
  try {
    const sheets = await getClient();
    const transcriptSheetId = process.env.GOOGLE_TRANSCRIPT_SPREADSHEET_ID;
    if (!transcriptSheetId) return null;

    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: transcriptSheetId,
      range: 'シート1!A:C',
    });

    const rows = response.data.values;
    if (!rows || rows.length <= 1) return null;

    const normalize = (num) => {
      let n = (num || '').replace(/[-\s()+]/g, '');
      if (n.startsWith('81') && n.length >= 11) n = '0' + n.slice(2);
      return n;
    };
    const normalizedPhone = normalize(phoneNumber);
    const callTime = new Date(callStartedAt).getTime();

    // ヘッダーをスキップしてマッチ検索
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      const sheetPhone = normalize(row[0] || '');
      const sheetTranscript = row[1] || '';
      const sheetTime = row[2] || '';

      if (sheetPhone !== normalizedPhone || !sheetTranscript) continue;

      // 開始時刻が5分以内なら同一通話とみなす
      if (sheetTime) {
        const sheetTimeMs = new Date(sheetTime).getTime();
        if (Math.abs(callTime - sheetTimeMs) <= 5 * 60 * 1000) {
          return sheetTranscript;
        }
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
 * @param {Array} calls - [{phone_number, call_started_at}]
 * @returns {Map} phone+time -> transcript
 */
const findTranscriptsBatch = async (calls) => {
  try {
    const sheets = await getClient();
    const transcriptSheetId = process.env.GOOGLE_TRANSCRIPT_SPREADSHEET_ID;
    if (!transcriptSheetId) return new Map();

    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: transcriptSheetId,
      range: 'シート1!A:C',
    });

    const rows = response.data.values;
    if (!rows || rows.length <= 1) return new Map();

    const normalize = (num) => {
      let n = (num || '').replace(/[-\s()+]/g, '');
      if (n.startsWith('81') && n.length >= 11) n = '0' + n.slice(2);
      return n;
    };

    // シートデータをインデックス化 (電話番号 -> [{transcript, time}])
    const sheetIndex = new Map();
    for (let i = 1; i < rows.length; i++) {
      const phone = normalize(rows[i][0] || '');
      const transcript = rows[i][1] || '';
      const time = rows[i][2] || '';
      if (!phone || !transcript) continue;
      if (!sheetIndex.has(phone)) sheetIndex.set(phone, []);
      sheetIndex.get(phone).push({ transcript, time: time ? new Date(time).getTime() : 0 });
    }

    // 各通話にマッチするtranscriptを検索
    const results = new Map();
    for (const call of calls) {
      const phone = normalize(call.phone_number);
      const entries = sheetIndex.get(phone);
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
