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

module.exports = { searchCallLogs };
