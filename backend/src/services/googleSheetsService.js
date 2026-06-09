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
  // A:H まで取得（G列=架電開始時間, H列=架電終了時間 から通話時間を算出）
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: transcriptSheetId,
    range: 'シート1!A:H',
  });

  const rows = response.data.values;
  if (!rows || rows.length <= 1) return new Map();

  // JST文字列を ms にパース
  const parseJst = (s) => {
    if (!s) return 0;
    const str = String(s);
    return (str.includes('T') || str.includes('Z'))
      ? new Date(str).getTime()
      : new Date(str.replace(/\s/, 'T') + '+09:00').getTime();
  };

  // 電話番号でインデックス化
  const index = new Map();
  for (let i = 1; i < rows.length; i++) {
    const phone = normalize(rows[i][0] || '');
    const transcript = rows[i][1] || '';
    const time = rows[i][2] || '';
    const startRaw = rows[i][6] || ''; // G列: 架電開始時間
    const endRaw = rows[i][7] || '';   // H列: 架電終了時間
    if (!phone) continue;
    if (!index.has(phone)) index.set(phone, []);
    // マッチング用時刻: C列優先、無ければG列（架電開始）
    const parsedTime = parseJst(time) || parseJst(startRaw);
    // 通話時間 = H - G（秒）
    const startMs = parseJst(startRaw);
    const endMs = parseJst(endRaw);
    let durationSec = null;
    if (startMs && endMs && endMs >= startMs) {
      durationSec = Math.round((endMs - startMs) / 1000);
    }
    index.get(phone).push({ transcript, time: parsedTime, durationSec });
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
    // dateStrings:true対応 — 文字列をJSTとしてパース
    const callTimeStr = String(callStartedAt);
    const callTime = callTimeStr.includes('T') || callTimeStr.includes('Z')
      ? new Date(callStartedAt).getTime()
      : new Date(callTimeStr.replace(' ', 'T') + '+09:00').getTime();

    const entries = index.get(normalizedPhone);
    if (!entries) return null;

    for (const entry of entries) {
      if (entry.time && Math.abs(callTime - entry.time) <= 5 * 60 * 1000 && entry.transcript) {
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
 * 複数通話の通話時間（秒）をスプレッドシートのG/H列から一括取得
 * 電話番号 + 開始時刻(±5分) でマッチした行の durationSec を返す
 * @returns {Promise<Map<callId, number>>} 通話時間（秒）
 */
const findDurationsBatch = async (calls) => {
  try {
    const index = await getTranscriptIndex();
    const results = new Map();
    for (const call of calls) {
      const phone = normalize(call.phone_number);
      const entries = index.get(phone);
      if (!entries) continue;
      const ts = String(call.call_started_at);
      const callTime = ts.includes('T') || ts.includes('Z')
        ? new Date(call.call_started_at).getTime()
        : new Date(ts.replace(' ', 'T') + '+09:00').getTime();
      for (const entry of entries) {
        if (entry.durationSec != null && entry.time && Math.abs(callTime - entry.time) <= 5 * 60 * 1000) {
          results.set(call.id, entry.durationSec);
          break;
        }
      }
    }
    return results;
  } catch (err) {
    logger.error('通話時間一括検索エラー:', err);
    return new Map();
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
      const ts = String(call.call_started_at);
      const callTime = ts.includes('T') || ts.includes('Z')
        ? new Date(call.call_started_at).getTime()
        : new Date(ts.replace(' ', 'T') + '+09:00').getTime();
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

// ===== ビザ申請進捗シート（入金実績）キャッシュ（5分間保持） =====
const VISA_CACHE_TTL = 5 * 60 * 1000; // 5分
let visaCache = null; // { map: Map<登録番号, 入金実績(円)>, fetchedAt }

/**
 * 「ビザ申請 進捗」シートから 登録番号(G列) → 入金実績(CC列の数値×10000円) のマップを取得。
 * - スプレッドシートID: env VISA_PROGRESS_SPREADSHEET_ID（未設定時は既定IDを使用）
 * - サービスアカウントに該当スプレッドシートの閲覧権限が必要
 * - 5分キャッシュ。シート未共有・エラー時は空Mapを返す（入金実績は0になる）
 */
const getVisaPaymentMap = async () => {
  if (visaCache && (Date.now() - visaCache.fetchedAt) < VISA_CACHE_TTL) {
    return visaCache.map;
  }
  const map = new Map();
  try {
    const sheets = await getClient();
    const sheetId = process.env.VISA_PROGRESS_SPREADSHEET_ID || '1wPH1sud7dAwJQihiR6qDrH-otJ3ygAgcCAg-e4ituvw';
    // G:CC を取得（G列=登録番号=index0, CC列=index74）
    // シート名にスペースを含むため A1記法ではシングルクォートで囲む必要がある
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: sheetId,
      range: "'ビザ申請 進捗'!G:CC",
    });
    const rows = response.data.values || [];
    let count = 0;
    for (const row of rows) {
      const reg = String(row[0] || '').trim(); // G列
      if (!reg) continue;
      const ccRaw = row[74]; // CC列
      const num = parseFloat(String(ccRaw == null ? '' : ccRaw).replace(/[^0-9.\-]/g, ''));
      const yen = isNaN(num) ? 0 : Math.round(num * 10000);
      // 同一登録番号が複数行ある場合は後勝ち
      map.set(reg, yen);
      map.set(reg.toUpperCase(), yen);
      count++;
    }
    visaCache = { map, fetchedAt: Date.now() };
    logger.info(`ビザ進捗シート取得: ${count}登録番号`);
  } catch (err) {
    logger.error(`ビザ進捗シート取得エラー: ${err.message}`);
    // 失敗時は古いキャッシュがあればそれを、無ければ空Mapを返す
    return visaCache ? visaCache.map : map;
  }
  return map;
};

/**
 * 登録番号から入金実績(円)を引く。完全一致→大文字一致の順で照合。
 */
const lookupVisaPayment = (map, registrationNumber) => {
  if (!map || !registrationNumber) return 0;
  const reg = String(registrationNumber).trim();
  if (!reg) return 0;
  return map.get(reg) ?? map.get(reg.toUpperCase()) ?? 0;
};

/**
 * ビザシートの状態を診断（管理者向け）。
 * シート読み取り可否、行数、サンプル行、サービスアカウント email を返す。
 */
const probeVisaSheet = async () => {
  const sheetId = process.env.VISA_PROGRESS_SPREADSHEET_ID || '1wPH1sud7dAwJQihiR6qDrH-otJ3ygAgcCAg-e4ituvw';
  const serviceAccountEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || null;
  try {
    const sheets = await getClient();
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: sheetId,
      range: "'ビザ申請 進捗'!G:CC",
    });
    const rows = response.data.values || [];
    // 登録番号があり CC列に数値が入っている先頭5件をサンプルに
    const sample = [];
    for (const row of rows) {
      const reg = String(row[0] || '').trim();
      if (!reg) continue;
      sample.push({ reg, ccRaw: row[74] == null ? null : String(row[74]) });
      if (sample.length >= 5) break;
    }
    const withReg = rows.filter(r => String(r[0] || '').trim()).length;
    const withCcNumber = rows.filter(r => {
      const v = parseFloat(String(r[74] == null ? '' : r[74]).replace(/[^0-9.\-]/g, ''));
      return !isNaN(v) && v !== 0;
    }).length;
    return { ok: true, sheetId, serviceAccountEmail, totalRows: rows.length, withReg, withCcNumber, sample };
  } catch (err) {
    return { ok: false, sheetId, serviceAccountEmail, error: err.message, errorCode: err.code };
  }
};

module.exports = { searchCallLogs, findTranscript, findTranscriptsBatch, findDurationsBatch, getVisaPaymentMap, lookupVisaPayment, probeVisaSheet };
