/**
 * CSVインポートコントローラー
 * 企業データのCSV / XLS / XLSX 一括インポート
 * NG / 既存案件 除外リストインポート
 */
const fs = require('fs');
const path = require('path');
const csv = require('csv-parser');
const XLSX = require('xlsx');
const fflate = require('fflate');
const pool = require('../../config/database');
const ApiResponse = require('../utils/apiResponse');
const logger = require('../utils/logger');
const { upsertCompanyByPhone, addManualAssignment, MASTER_COLS } = require('../utils/companyUpsert');

/**
 * industry テキストから industry_category を計算するヘルパー。
 * 順序は companyController.recompute-industry-category の CASE 式と同一。
 * CSV インポート直後にこの SQL で UPDATE することで、新規行に正しいカテゴリが付く。
 */
const INDUSTRY_CATEGORY_SQL_CASE = `
  CASE
    WHEN industry LIKE '%建設%' OR industry LIKE '%建築%' OR industry LIKE '%工事%' OR industry LIKE '%土木%' OR industry LIKE '%リフォーム%' OR industry LIKE '%電気工事%' OR industry LIKE '%管工事%' OR industry LIKE '%建材%' OR industry LIKE '%住宅%' OR industry LIKE '%リノベ%' THEN '建設'
    WHEN industry LIKE '%宿泊%' OR industry LIKE '%ホテル%' OR industry LIKE '%旅館%' OR industry LIKE '%民宿%' THEN '宿泊'
    WHEN industry LIKE '%清掃%' OR industry LIKE '%クリーニング%' OR industry LIKE '%ビルメンテ%' OR industry LIKE '%ビル管理%' OR industry LIKE '%ハウスクリーニング%' THEN '清掃'
    WHEN industry LIKE '%介護%' OR industry LIKE '%デイサービス%' OR industry LIKE '%福祉%' OR industry LIKE '%老人ホーム%' OR industry LIKE '%グループホーム%' THEN '介護'
    WHEN industry LIKE '%飲食%' OR industry LIKE '%グルメ%' OR industry LIKE '%レストラン%' OR industry LIKE '%居酒屋%' OR industry LIKE '%ラーメン%' OR industry LIKE '%カフェ%' OR industry LIKE '%喫茶店%' OR industry LIKE '%寿司%' OR industry LIKE '%焼肉%' OR industry LIKE '%和食%' OR industry LIKE '%中華%' OR industry LIKE '%洋食%' OR industry LIKE '%食堂%' OR industry LIKE '%ダイニング%' OR industry LIKE '%そば%' OR industry LIKE '%うどん%' OR industry LIKE '%菓子%' THEN '飲食'
    WHEN industry LIKE '%農業%' OR industry LIKE '%農場%' OR industry LIKE '%農園%' OR industry LIKE '%畜産%' OR industry LIKE '%養鶏%' OR industry LIKE '%水産%' OR industry LIKE '%漁業%' OR industry LIKE '%林業%' OR industry LIKE '%農産%' THEN '農業'
    WHEN industry LIKE '%製造%' OR industry LIKE '%メーカー%' OR industry LIKE '%加工%' OR industry LIKE '%工場%' OR industry LIKE '%金属%' OR industry LIKE '%部品%' OR industry LIKE '%機械%' OR industry LIKE '%化学%' OR industry LIKE '%食品%' OR industry LIKE '%飲料%' OR industry LIKE '%繊維%' OR industry LIKE '%衣料%' OR industry LIKE '%印刷%' OR industry LIKE '%木材%' OR industry LIKE '%木製%' OR industry LIKE '%プラスチック%' OR industry LIKE '%ゴム%' OR industry LIKE '%紙%' OR industry LIKE '%パルプ%' OR industry LIKE '%セメント%' OR industry LIKE '%窯業%' OR industry LIKE '%電子%' OR industry LIKE '%輸送機%' OR industry LIKE '%自動車%' OR industry LIKE '%電気機械%' THEN '製造'
    WHEN industry LIKE '%小売%' OR industry LIKE '%卸売%' OR industry LIKE '%スーパー%' OR industry LIKE '%コンビニ%' OR industry LIKE '%ショッピング%' OR industry LIKE '%商社%' OR industry LIKE '%物販%' OR industry LIKE '%販売%' THEN '小売'
    ELSE 'その他'
  END
`;

/**
 * インポート直後の新規/更新行に industry_category を一括計算する。
 * - import_batch_id があれば該当バッチだけ高速 UPDATE
 * - 無ければ industry_category IS NULL の行を全件 UPDATE (バッチ ID 未対応の旧パス用)
 */
const applyIndustryCategoryAfterImport = async (importBatchId = null) => {
  try {
    if (importBatchId) {
      const [r] = await pool.query(
        `UPDATE companies SET industry_category = (${INDUSTRY_CATEGORY_SQL_CASE})
         WHERE import_batch_id = ? AND industry IS NOT NULL AND industry != ''`,
        [importBatchId]
      );
      logger.info(`[ImportCategory] batch=${importBatchId} updated=${r.affectedRows}`);
    } else {
      const [r] = await pool.query(
        `UPDATE companies SET industry_category = (${INDUSTRY_CATEGORY_SQL_CASE})
         WHERE industry_category IS NULL AND industry IS NOT NULL AND industry != ''`
      );
      logger.info(`[ImportCategory] NULL category updated=${r.affectedRows}`);
    }
  } catch (e) {
    logger.warn(`[ImportCategory] update failed: ${e.message}`);
  }
};

/**
 * 日本語→英語 カラム名マッピング
 * 「全業界まとめ.xlsx」等の新フォーマットにも対応
 */
const COLUMN_MAP = {
  // 既存
  '会社名': 'company_name',
  '電話番号': 'phone_number',
  '業種': 'industry',
  '職種': 'job_type',
  'コメント': 'comment',
  '住所': 'address',
  '地域': 'region',
  'データ元': 'data_source',
  // 新フォーマット（全業界まとめ等）
  '法人名称': 'company_name',
  '法人名': 'company_name',
  '事業者名': 'company_name',
  // FAX 番号の各種表記揺れに対応
  'FAX番号': 'fax_number',
  'FAX': 'fax_number',
  'Fax': 'fax_number',
  'fax': 'fax_number',
  'FAX No': 'fax_number',
  'FAX No.': 'fax_number',
  'FAX_番号': 'fax_number',
  'ファックス': 'fax_number',
  'ファックス番号': 'fax_number',
  'ＦＡＸ': 'fax_number',
  'ＦＡＸ番号': 'fax_number',
  '業種(中分類1)': 'industry',
  '業種（中分類1）': 'industry',
  '業種(中分類)': 'industry',
  '業種（中分類）': 'industry',
  '中分類': 'industry',
  '法人サマリー': 'comment',
  'サイトURL': 'url',
  'URL': 'url',
  'ホームページ': 'url',
};

const normalizeColumnName = (name) => {
  const trimmed = (name || '').trim();
  return COLUMN_MAP[trimmed] || trimmed;
};

/**
 * XLS/XLSX ファイルをパース。
 * - onRow が指定されていれば各行を await onRow(record) で渡す（ストリーミング、メモリ効率○）
 * - onRow なしなら従来通り records 配列を返す（小さいファイル向け互換）
 * 通常は xlsx パッケージで読むが、sheet1.xml が Node の String 上限(~536MB)を
 * 超える巨大ファイルは「Cannot create a string longer than ...」で失敗するため、
 * その場合は fflate ストリーミング解凍にフォールバック。
 */
const parseExcelFile = async (filePath, onRow) => {
  try {
    const wb = XLSX.readFile(filePath);
    const sheet = wb.Sheets[wb.SheetNames[0]];
    if (sheet && sheet['!ref']) {
      const rawData = XLSX.utils.sheet_to_json(sheet, { defval: '' });
      const normalize = (row) => {
        const normalized = {};
        for (const [key, value] of Object.entries(row)) {
          const normKey = normalizeColumnName(key);
          normalized[normKey] = typeof value === 'string' ? value.trim() : String(value);
        }
        return normalized;
      };
      if (onRow) {
        for (const row of rawData) await onRow(normalize(row));
        return null;
      }
      return rawData.map(normalize);
    }
    logger.warn(`[parseExcelFile] xlsx で本体読み取り失敗。ストリーム展開にフォールバック: ${filePath}`);
  } catch (err) {
    logger.warn(`[parseExcelFile] xlsx 失敗(${err.message})。ストリーム展開にフォールバック: ${filePath}`);
  }
  return parseExcelHugeStream(filePath, onRow);
};

/**
 * 巨大xlsx をストリーミング展開してパース。
 * - fflate.unzipSync で xl/worksheets/sheet1.xml だけ取り出す（他エントリは無視）
 * - 展開した Uint8Array を Buffer 化してチャンクごとに XML パース
 * - 各 row の <c r="A2" t="inlineStr"><is><t>VALUE</t></is></c> 等から値を抽出
 *   （inlineStr / 数値 v / sharedStrings 未使用前提）
 * - 1行目はヘッダー、それ以降はデータ。列名は COLUMN_MAP で正規化。
 *
 * 注: sheet1.xml が Node の String 上限(~536MB)を超える場合、全文を一度に
 *     String 化できない。そのため fflate で UInt8Array にしたバッファを
 *     32MB ずつスライスして文字列化＋XMLパースで逐次処理する。
 */
const parseExcelHugeStream = (filePath, onRow) => new Promise((resolve, reject) => {
  const decoder = new (require('util').TextDecoder)('utf-8', { fatal: false });
  const decodeEntities = (s) => s
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, n) => String.fromCharCode(parseInt(n, 16)));

  const colLetter = (ref) => (ref.match(/^[A-Z]+/) || [''])[0];

  let buffer = '';
  let headerByCol = null;
  const records = onRow ? null : [];
  let recordCount = 0;
  let sheetFound = false;
  let done = false;
  // onRow への async 処理用キュー（DBへの flush を確実に直列化する）
  let pending = Promise.resolve();
  const enqueue = (record) => { pending = pending.then(() => onRow(record)); };

  const parseRow = (rowXml) => {
    const cells = {};
    const cellRe = /<c\s+([^/>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
    let m;
    while ((m = cellRe.exec(rowXml)) !== null) {
      const attrs = m[1];
      const content = m[2] || '';
      const refMatch = attrs.match(/r="([A-Z]+\d+)"/);
      if (!refMatch) continue;
      const col = colLetter(refMatch[1]);
      let valMatch = content.match(/<t[^>]*>([\s\S]*?)<\/t>/);
      if (!valMatch) valMatch = content.match(/<v>([\s\S]*?)<\/v>/);
      if (valMatch) cells[col] = decodeEntities(valMatch[1]).trim();
    }
    return cells;
  };

  const processBuffer = () => {
    while (true) {
      const start = buffer.indexOf('<row');
      if (start === -1) {
        if (buffer.length > 1024 * 1024) buffer = buffer.slice(-65536);
        break;
      }
      const end = buffer.indexOf('</row>', start);
      if (end === -1) {
        buffer = buffer.slice(start);
        break;
      }
      const rowXml = buffer.slice(start, end + '</row>'.length);
      buffer = buffer.slice(end + '</row>'.length);
      const cells = parseRow(rowXml);
      if (!headerByCol) {
        headerByCol = {};
        for (const [col, raw] of Object.entries(cells)) {
          headerByCol[col] = normalizeColumnName(raw);
        }
      } else {
        const obj = {};
        for (const [col, val] of Object.entries(cells)) {
          const key = headerByCol[col];
          if (key) obj[key] = val;
        }
        if (Object.values(obj).some(v => v && String(v).trim())) {
          recordCount++;
          if (onRow) enqueue(obj);
          else records.push(obj);
        }
      }
    }
  };

  // fflate ストリーミング Unzip: ファイルチャンクと解凍チャンク両方を逐次処理
  const unzip = new fflate.Unzip();
  unzip.register(fflate.UnzipInflate);
  unzip.onfile = (file) => {
    if (file.name !== 'xl/worksheets/sheet1.xml') return; // 他エントリは無視
    sheetFound = true;
    logger.info(`[parseExcelHugeStream] sheet1.xml 解凍開始 (圧縮=${file.size}, 非圧縮=${file.originalSize})`);
    file.ondata = (err, data, final) => {
      if (err) { done = true; return reject(new Error(`解凍エラー: ${err.message || err}`)); }
      // data: Uint8Array チャンク
      buffer += decoder.decode(data, { stream: !final });
      processBuffer();
      if (final) {
        buffer += decoder.decode(); // フラッシュ
        processBuffer();
      }
    };
    file.start();
  };

  // xlsxファイルをストリームで読みつつ unzip に push
  const stream = fs.createReadStream(filePath);
  stream.on('data', (chunk) => {
    if (done) return;
    unzip.push(new Uint8Array(chunk), false);
  });
  stream.on('end', () => {
    try {
      unzip.push(new Uint8Array(0), true);
    } catch (err) {
      done = true;
      return reject(new Error(`zip終端エラー: ${err.message}`));
    }
    if (!sheetFound) {
      return reject(new Error('xl/worksheets/sheet1.xml が xlsx 内に見つかりません'));
    }
    // onRow キューを全て待ってから解決
    pending
      .then(() => {
        logger.info(`[parseExcelHugeStream] パース完了: ${recordCount}行 (headers=${Object.keys(headerByCol || {}).join(',')})`);
        resolve(onRow ? null : records);
      })
      .catch(reject);
  });
  stream.on('error', (err) => {
    done = true;
    reject(new Error(`ファイル読込エラー: ${err.message}`));
  });
});

/**
 * CSVファイルをパース。
 * onRow 指定時はストリーミング、未指定時は records 配列を返す。
 */
const parseCsvFile = (filePath, onRow) => {
  return new Promise((resolve, reject) => {
    const records = onRow ? null : [];
    let count = 0;
    let pending = Promise.resolve();
    const rs = fs.createReadStream(filePath, { encoding: 'utf-8' });
    rs.pipe(csv({
      mapHeaders: ({ header }) => normalizeColumnName(header),
    }))
      .on('data', (row) => {
        count++;
        if (onRow) pending = pending.then(() => onRow(row));
        else records.push(row);
      })
      .on('end', () => {
        pending.then(() => resolve(onRow ? null : records)).catch(reject);
      })
      .on('error', reject);
  });
};

/**
 * ファイルをパース（拡張子で自動判別）。
 * onRow 指定でストリーミング処理（メモリ効率○）。
 */
const parseFile = async (filePath, originalName, onRow) => {
  const ext = path.extname(originalName).toLowerCase();
  if (ext === '.xls' || ext === '.xlsx') {
    return parseExcelFile(filePath, onRow);
  }
  return parseCsvFile(filePath, onRow);
};

/**
 * 電話番号を抽出（複数対応・乱雑セル対応）
 *
 * 想定する入力例 (実ファイル D 列より):
 *   '072-879-6300'                                      → ['0728796300']
 *   '090-3109-5824\nh.d.k.hatake@adagio.ocn.ne.jp'      → ['09031095824']
 *    9055337733                                          → ['9055337733']  (数値型セル)
 *   'k-matsuo@kurohiji-g.co.jp\n0436-60-7753\n080-1065-2552' → ['0436607753','08010652552']
 *   '090-3907-7264\n092-432-7775\nyamashita.toukyu@gmail.com' → ['09039077264','0924327775']
 *   'h-tanaka@f-million.com'                            → []  (メールのみ)
 *   '03-5615-2986 / 080-5387-8711 / 080-7833-1198'      → 3 件
 *   '090-1643-4313\n\n\n\n\n森田様\n011-563-3288\n'     → 2 件
 *   '03-6215-6211(銀座店)\n03-3595-6288(日比谷店)'      → 2 件
 *   '072-645-5670\n090-8657-1089 宮近様'                → 2 件
 *   '08050104683\n042-492-9870'                         → 2 件 (ハイフンなし11桁)
 *   '"""□会社名：株式会社...□電話番号：0967-32-1151...' → 1 件
 *   '+8180-4428-6082　氏家\n穂谷専務（090-8239-1984）' → 国際表記/全角カッコ内
 *
 * アルゴリズム:
 *   1. NFKC 正規化で全角→半角を統一 (全角数字・全角ハイフン・全角カッコ・全角空白)。
 *   2. 区切り文字 (改行/カンマ/セミコロン/スラッシュ/全角カッコ/半角カッコ/空白/タブ) で token 分割。
 *   3. token に '@' が含まれていればメールとみなしスキップ。
 *   4. token から数字以外を全て除去し、 残った数字列が以下を満たすときのみ電話番号として採用:
 *      - 10桁または11桁 (日本の固定/携帯/フリーダイヤル)
 *      - 先頭が '0' (国内番号)、 または '+81' → 先頭を '0' に置換
 *   5. 同一番号は重複排除。
 *
 * @param {string|number} phone - 電話番号フィールドの生値 (CSV/XLSX セル)
 * @returns {string[]} 数字のみの正規化済み電話番号配列 (例: ['09012345678', '0312345678'])
 */
const extractPhoneNumbers = (phone) => {
  if (phone === null || phone === undefined) return [];
  // 数値型セル (xlsx の int 値) は文字列化
  let raw = String(phone);
  if (!raw.trim()) return [];

  // NFKC 正規化 (全角英数・全角カッコ → 半角、 全角空白 → 半角空白)
  let text = raw.normalize('NFKC');
  // 各種ダッシュ → 半角ハイフンに統一 (NFKC 後でも残る Unicode ダッシュ)
  text = text.replace(/[ー－−–—‐‑⁃₋―]/g, '-');

  // 区切り文字で token 分割: 改行 / カンマ / 全角カンマ / 読点 / セミコロン / スラッシュ
  //                       / 半角カッコ / バックスラッシュ / 空白 / タブ
  // 注: ハイフン・ドットは番号内部に出るので区切りに含めない。
  const tokens = text.split(/[\r\n,、，;；/\\()\s\t]+/).filter(Boolean);

  const results = [];
  for (const token of tokens) {
    // メールアドレスを含む token はスキップ
    if (token.includes('@')) continue;
    // URL らしき token はスキップ
    if (/https?:\/\//i.test(token)) continue;

    // 数字以外を全て削除 (ハイフン/ドット/カッコ/プラス記号などは捨てる)
    let digits = token.replace(/[^\d]/g, '');
    if (!digits) continue;

    // 国際表記 (+81xxxx / 81xxxx で 12-13桁) → 先頭 0 に置換
    if (digits.length >= 12 && digits.length <= 13 && digits.startsWith('81')) {
      digits = '0' + digits.slice(2);
    }

    // 日本の電話番号は 10 桁 (固定) または 11 桁 (携帯/フリーダイヤル)
    if (digits.length < 10 || digits.length > 11) continue;
    // 国内番号は 0 始まり (例外的に頭の 0 が落ちた xlsx int セルもあるが、
    // それは「9055337733」のような 10 桁数値で先頭 0 を持たない＝携帯番号として
    // 救済できないので、 そのまま不採用とする。 ユーザーは元データの修正で対応)
    if (!digits.startsWith('0')) continue;

    // 重複排除して順序を保持
    if (!results.includes(digits)) results.push(digits);
  }

  return results;
};

/**
 * 1 トークンを電話番号として正規化できれば数字のみ文字列を返す。
 * 失敗時は null。
 * - メール (@含む) / URL を除外
 * - 数字以外を除去
 * - +81xxx / 81xxx (12-13 桁) は先頭を '0' に置換
 * - 10 桁または 11 桁 + 先頭 '0' のみ採用
 */
const tryNormalizePhoneToken = (token) => {
  if (!token) return null;
  if (token.includes('@')) return null;
  if (/https?:\/\//i.test(token)) return null;
  let digits = token.replace(/[^\d]/g, '');
  if (!digits) return null;
  if (digits.length >= 12 && digits.length <= 13 && digits.startsWith('81')) {
    digits = '0' + digits.slice(2);
  }
  if (digits.length < 10 || digits.length > 11) return null;
  if (!digits.startsWith('0')) return null;
  return digits;
};

/**
 * 電話番号セルから "primary (上から最初に見つかった 1 件) + remainder (それ以外全テキスト)" を返す。
 *
 * 新仕様 (2026-06-25):
 *   ユーザー要望: 「インポート時に電話番号欄のセルに複数行情報がある場合は、
 *   一番上の電話番号のみ保存して、 それ以外の情報は全てコメントに保存しておく運用」
 *   「一番上にメールアドレスがある場合 (一番上に電話番号が無い場合) は
 *    2 行目以降に電話番号があればそれで保存」。
 *
 * アルゴリズム:
 *   1. NFKC 正規化 + Unicode ダッシュ統一
 *   2. 行を [\r\n]+ で分割 (trim)
 *   3. 各行を区切り文字 ( 、 , ; ； 空白 タブ / \ ( ) で token 分割
 *   4. 行を上から走査:
 *      - 行内に電話番号 token があれば最初の 1 個を primary に採用、
 *        残りの tokens (および他行) を remainder に。 primary 確定後は
 *        以降の行で primary は再選定しない。
 *      - 行内に電話番号が無ければ primary 未確定のまま次行へ。 当該行の
 *        テキスト全体 (改行を ' / ' に置換した形) を remainder に積む。
 *
 * @param {string|number} raw - 電話番号フィールドの生値
 * @returns {{ primary: string|null, remainder: string|null }}
 */
const extractPhoneInfo = (raw) => {
  if (raw === null || raw === undefined) return { primary: null, remainder: null };
  const str = String(raw);
  if (!str.trim()) return { primary: null, remainder: null };

  // NFKC + ダッシュ統一
  let text = str.normalize('NFKC');
  text = text.replace(/[ー－−–—‐‑⁃₋―]/g, '-');

  const lines = text.split(/[\r\n]+/).map(l => l.trim()).filter(l => l.length > 0);

  let primary = null;
  const remainderParts = [];

  for (const line of lines) {
    // 行内 token 分割: カンマ / 全角カンマ / 読点 / セミコロン / スラッシュ / カッコ / 空白 / タブ / バックスラッシュ
    // 注: ハイフン・ドットは番号内部に出るので区切りに含めない。
    const tokens = line.split(/[,、，;；/\\()「」\s\t]+/).filter(Boolean);

    if (primary === null) {
      // この行で primary 候補を探す
      const remainderTokens = [];
      let primaryFoundInLine = false;
      for (const token of tokens) {
        if (!primaryFoundInLine) {
          const normalized = tryNormalizePhoneToken(token);
          if (normalized) {
            primary = normalized;
            primaryFoundInLine = true;
            continue;
          }
        }
        remainderTokens.push(token);
      }
      if (primaryFoundInLine) {
        // primary 行から primary token を除いた残り tokens を remainder へ
        if (remainderTokens.length > 0) {
          remainderParts.push(remainderTokens.join(' '));
        }
      } else {
        // primary が見つからなかった行 → 行全体を remainder へ (原文を保つ)
        remainderParts.push(line);
      }
    } else {
      // primary 確定済み → 行全体をそのまま remainder へ
      remainderParts.push(line);
    }
  }

  // remainder を ' / ' で連結。 空なら null。
  const remainder = remainderParts
    .map(s => s.trim())
    .filter(s => s.length > 0)
    .join(' / ');

  return {
    primary: primary,
    remainder: remainder.length > 0 ? remainder : null,
  };
};

/**
 * 後方互換: 単一電話番号を返す（架電リストインポート用）
 * extractPhoneInfo.primary を返すラッパ。 見つからなければ空文字。
 */
const normalizePhoneNumber = (phone) => {
  const { primary } = extractPhoneInfo(phone);
  return primary || '';
};

/**
 * 電話番号セルの remainder (primary 以外の全情報) を既存 comment 末尾に追記する整形ヘルパー。
 * remainder が空なら baseComment をそのまま返す (null 含む)。
 * 既に同じ追記行が baseComment に含まれていれば二重追記しない。
 *
 * 形式: `<label>追記: <remainder>` を ' / ' 区切りで baseComment 末尾に付ける。
 *
 * @param {string|null} baseComment - 既存コメント (null/空 可)
 * @param {string|null} remainder - extractPhoneInfo の remainder
 * @param {string} [label='電話番号セル'] - 追記ラベル (FAX セル等を区別するため)
 * @returns {string|null}
 */
const appendRemainderToComment = (baseComment, remainder, label = '電話番号セル') => {
  const r = (remainder || '').trim();
  if (!r) return baseComment || null;
  const line = `${label}追記: ${r}`;
  const base = (baseComment || '').trim();
  if (base.includes(line)) return base || null;
  return base ? `${base} / ${line}` : line;
};

/**
 * 会社名の正規化
 * - 【ヒトキワ】【グーナビ】等のタグを除去（【...】形式すべて）
 * - 全角スペース → 半角スペースに統一
 * - 連続スペース → 1つに圧縮
 * - 前後の空白除去
 * - 全角英数 → 半角英数
 */
const normalizeCompanyName = (name) => {
  if (!name) return name;
  let normalized = name
    // 【...】タグを除去（【ヒトキワ】【グーナビ】等）
    .replace(/【[^】]*】/g, '')
    // 全角英数 → 半角英数
    .replace(/[Ａ-Ｚａ-ｚ０-９]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0))
    // 全角スペース → 半角
    .replace(/　/g, ' ')
    // 連続スペース → 1つ
    .replace(/\s+/g, ' ')
    .trim();
  return normalized;
};

/**
 * 住所から都道府県を抽出
 * @param {string} address - 住所文字列（例: "北海道函館市川汲町１５４６"）
 * @returns {string|null} 都道府県名（例: "北海道"）、抽出できなければ null
 */
const PREFECTURES = [
  '北海道',
  '青森県','岩手県','宮城県','秋田県','山形県','福島県',
  '茨城県','栃木県','群馬県','埼玉県','千葉県','東京都','神奈川県',
  '新潟県','富山県','石川県','福井県','山梨県','長野県','岐阜県','静岡県','愛知県',
  '三重県','滋賀県','京都府','大阪府','兵庫県','奈良県','和歌山県',
  '鳥取県','島根県','岡山県','広島県','山口県',
  '徳島県','香川県','愛媛県','高知県',
  '福岡県','佐賀県','長崎県','熊本県','大分県','宮崎県','鹿児島県','沖縄県',
];

const PREF_TO_REGION = {
  '北海道': '北海道',
  '青森県': '東北', '岩手県': '東北', '宮城県': '東北', '秋田県': '東北', '山形県': '東北', '福島県': '東北',
  '茨城県': '関東', '栃木県': '関東', '群馬県': '関東', '埼玉県': '関東', '千葉県': '関東', '東京都': '関東', '神奈川県': '関東',
  '新潟県': '中部', '富山県': '中部', '石川県': '中部', '福井県': '中部', '山梨県': '中部', '長野県': '中部', '岐阜県': '中部', '静岡県': '中部', '愛知県': '中部',
  '三重県': '近畿', '滋賀県': '近畿', '京都府': '近畿', '大阪府': '近畿', '兵庫県': '近畿', '奈良県': '近畿', '和歌山県': '近畿',
  '鳥取県': '中国', '島根県': '中国', '岡山県': '中国', '広島県': '中国', '山口県': '中国',
  '徳島県': '四国', '香川県': '四国', '愛媛県': '四国', '高知県': '四国',
  '福岡県': '九州', '佐賀県': '九州', '長崎県': '九州', '熊本県': '九州', '大分県': '九州', '宮崎県': '九州', '鹿児島県': '九州', '沖縄県': '九州',
};

const extractPrefecture = (address) => {
  if (!address) return null;
  for (const pref of PREFECTURES) {
    if (address.startsWith(pref)) return pref;
  }
  return null;
};

const extractRegionFromAddress = (address) => {
  const pref = extractPrefecture(address);
  return pref ? (PREF_TO_REGION[pref] || null) : null;
};

/**
 * 一時ファイルを安全に削除
 */
const cleanupFile = (filePath) => {
  if (filePath && fs.existsSync(filePath)) fs.unlinkSync(filePath);
};

/**
 * POST /api/csv/import
 * 架電リストインポート
 * 重複判定: 電話番号 OR 会社名
 * 除外判定: exclusion_lists テーブルとの照合
 */
const importCompanies = async (req, res, next) => {
  try {
    if (!req.file) {
      return ApiResponse.badRequest(res, 'ファイルをアップロードしてください');
    }

    const filePath = req.file.path;
    logger.info(`インポート開始: ${req.file.originalname} (${req.file.size} bytes)`);
    // ストリーミングインポート: records配列を持たず、parseFile が 1行ずつ onRow を呼ぶ。
    // 60万行クラスのファイルでも records[] による OOM を回避する。

    // 優先オペレーター設定（管理者/マネージャーのみ）
    let priorityOperatorIds = [];
    let graceDays = 0;
    if (req.user.role !== 'operator' && req.body.priority_operator_ids) {
      try { priorityOperatorIds = JSON.parse(req.body.priority_operator_ids); } catch (e) { /* ignore */ }
      graceDays = parseInt(req.body.grace_days) || 0;
    }

    let totalRows = 0;
    let insertedCount = 0;
    let skippedCount = 0;
    let duplicateCount = 0;
    let excludedCount = 0;
    let faxCount = 0; // FAX番号が取れた件数 (新規・更新問わず)
    const errors = [];

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      const importedByUserId = (req.user.role === 'operator') ? req.user.id : null;
      // 営業リストフラグ（リクエストボディから取得）
      const isSalesList = req.body.is_sales_list === '1' || req.body.is_sales_list === true ? 1 : 0;

      // 事前にDB全phone_number + company_nameをロード（重複チェック高速化）
      // 会社名重複もチェックすることで「電話番号は違うが同じ会社」(本社/支店/番号変更等) も検出。
      logger.info('Pre-loading phone/name sets...');
      const [existingPhones] = await conn.query('SELECT id, phone_number, company_name, is_sales_list, imported_by_user_id FROM companies WHERE phone_number IS NOT NULL OR company_name IS NOT NULL');
      // phone_number → {id, is_sales_list, imported_by_user_id} のマップ
      const dbPhoneMap = new Map();
      const dbNameMap = new Map();
      existingPhones.forEach(r => {
        if (r.phone_number) dbPhoneMap.set(r.phone_number, r);
        if (r.company_name) dbNameMap.set(r.company_name, r);
      });
      // 双方向重複チェック用: 相手側リストの電話番号セット
      const crossListPhoneSet = new Set(existingPhones.filter(r => r.is_sales_list !== isSalesList && r.phone_number).map(r => r.phone_number));
      logger.info(`Companies loaded: phones=${dbPhoneMap.size}, names=${dbNameMap.size}`);
      const [excludedPhones] = await conn.query('SELECT phone_number FROM exclusion_lists WHERE phone_number IS NOT NULL');
      const excludePhoneSet = new Set(excludedPhones.map(r => r.phone_number));
      logger.info(`Exclusions loaded: ${excludePhoneSet.size}. Starting import loop...`);

      // NGワード（業種除外ワード）をロード
      const [ngWords] = await conn.query('SELECT keyword FROM industry_exclude_words');
      const ngKeywords = ngWords.map(r => r.keyword).filter(k => k && k.length > 0);
      logger.info(`NG keywords loaded: ${ngKeywords.length}`);

      // インポート内重複防止用Set
      const importedPhones = new Set();
      const importedNames = new Set();

      // ===== バッチINSERT用 =====
      // 60万行クラスの一括取り込みに耐えるため、新規INSERTはチャンクでmulti-row INSERTする。
      // 1件ずつ await すると Railway-MySQL の往復で 1行あたり数十msかかり数時間〜半日になるため。
      const INSERT_BATCH_SIZE = 500;       // 1回のINSERTで挿入する行数
      const COMMIT_BATCH_SIZE = 5000;      // 何件INSERTごとに commit/begin するか
      const pendingInserts = [];            // 各要素: 11カラム値の配列
      let lastCommittedAt = 0;              // 直近commit時点の累計insertedCount
      const flushInserts = async () => {
        if (pendingInserts.length === 0) return;
        // multi-row INSERT (+ ON DUPLICATE KEY UPDATE で肉付け)。
        // - 60 万行クラスの一括取り込み性能を保つため、 multi-row INSERT は維持。
        // - phone_number に UNIQUE INDEX が無い間は通常 INSERT と同じ挙動 (id 衝突しない)。
        // - UNIQUE INDEX 追加後は、 衝突行を MASTER_COLS で肉付け UPDATE。
        // - assignments は元々呼び出し側で別途 INSERT IGNORE されるので肉付け系で十分。
        const COLS = '(company_name, phone_number, fax_number, industry, job_type, comment, data_source, region, address, imported_by_user_id, is_sales_list)';
        const oneTuple = '(?,?,?,?,?,?,?,?,?,?,?)';
        const placeholders = pendingInserts.map(() => oneTuple).join(',');
        const flat = pendingInserts.flatMap(v => v);
        // 肉付け対象 (上記 COLS のうち imported_by_user_id / is_sales_list 以外)
        const HYDRATE = ['company_name', 'fax_number', 'industry', 'job_type', 'comment', 'data_source', 'region', 'address'];
        const setClause = HYDRATE.map(c => `${c} = COALESCE(NULLIF(VALUES(${c}), ''), ${c})`).join(', ');
        const [result] = await conn.query(
          `INSERT INTO companies ${COLS} VALUES ${placeholders}
           ON DUPLICATE KEY UPDATE ${setClause}, updated_at = CURRENT_TIMESTAMP, id = LAST_INSERT_ID(id)`,
          flat
        );
        // MySQL の multi-row INSERT は insertId に先頭idを返し、以降は連番。
        const firstId = result.insertId;
        // dbPhoneMap / dbNameMap も更新（後続行の重複検知用）
        for (let k = 0; k < pendingInserts.length; k++) {
          const tuple = pendingInserts[k];
          const cname = tuple[0];
          const phone = tuple[1];
          const rec = { id: firstId + k, is_sales_list: isSalesList, imported_by_user_id: importedByUserId };
          if (phone) dbPhoneMap.set(phone, rec);
          if (cname) dbNameMap.set(cname, rec);
        }
        // 自作リスト時 → company_assignments もバッチINSERT
        if (req.user.role === 'operator' && importedByUserId) {
          const aPh = pendingInserts.map(() => '(?,?,?)').join(',');
          const aFlat = [];
          for (let k = 0; k < pendingInserts.length; k++) {
            aFlat.push(firstId + k, req.user.id, req.user.id);
          }
          try {
            await conn.query(
              `INSERT IGNORE INTO company_assignments (company_id, user_id, assigned_by) VALUES ${aPh}`,
              aFlat
            );
          } catch (e) { logger.warn(`[import] assignments batch error: ${e.message}`); }
        }
        // 優先オペレーター割り当て + 猶予期間
        if (priorityOperatorIds.length > 0 && graceDays > 0) {
          const ids = pendingInserts.map((_, k) => firstId + k);
          // priority_expires_at をまとめて更新（IN句）
          try {
            await conn.query(
              `UPDATE companies SET priority_expires_at = DATE_ADD(DATE_ADD(UTC_TIMESTAMP(), INTERVAL 9 HOUR), INTERVAL ? DAY) WHERE id IN (${ids.map(() => '?').join(',')})`,
              [graceDays, ...ids]
            );
            const aPh = [];
            const aFlat = [];
            for (const cid of ids) {
              for (const opId of priorityOperatorIds) {
                aPh.push('(?,?,?)');
                aFlat.push(cid, opId, req.user.id);
              }
            }
            if (aPh.length > 0) {
              await conn.query(
                `INSERT IGNORE INTO company_assignments (company_id, user_id, assigned_by) VALUES ${aPh.join(',')}`,
                aFlat
              );
            }
          } catch (e) { logger.warn(`[import] priority batch error: ${e.message}`); }
        }
        insertedCount += pendingInserts.length;
        pendingInserts.length = 0;
        // チャンクごとに commit / begin（ROLLBACK領域とメモリを抑える）
        if (insertedCount - lastCommittedAt >= COMMIT_BATCH_SIZE) {
          await conn.commit();
          await conn.beginTransaction();
          lastCommittedAt = insertedCount;
          logger.info(`[import] progress: inserted=${insertedCount} / processed=${totalRows}`);
        }
      };

      // 1行分のレコードを処理して pendingInserts に積む（必要なら flush）
      const processRow = async (row) => {
        totalRows++;
        const lineNum = totalRows + 1; // ヘッダー分

        const companyName = normalizeCompanyName((row.company_name || '').trim());
        // 電話番号セルから primary (上から最初の電話番号) と remainder (それ以外全テキスト) を抽出。
        // メール混入・複数行・スラッシュ区切り・括弧注記・担当者名等をすべて remainder で保持する。
        const phoneInfo = extractPhoneInfo(row.phone_number);
        const phoneNumber = phoneInfo.primary;
        const industry = (row.industry || '').trim().replace(/,\s*$/, '') || null;
        const jobType = (row.job_type || '').trim() || null;
        // 新フォーマットの URL は comment に統合（既存スキーマを壊さない）
        const baseComment = (row.comment || '').trim();
        const urlField = (row.url || '').trim();
        let comment = [baseComment, urlField ? `URL: ${urlField}` : ''].filter(Boolean).join(' / ') || null;
        // 電話番号セルの remainder (primary 以外の全情報) を comment 末尾に追記
        comment = appendRemainderToComment(comment, phoneInfo.remainder, '電話番号セル');
        const dataSource = (row.data_source || '').trim() || null;
        const address = (row.address || '').trim() || null;
        const region = (row.region || '').trim() || extractRegionFromAddress(address) || null;
        // 新フォーマット用 FAX番号（取得できれば INSERT 時に保存）
        // FAX セルも電話番号と同様にメール混入・複数行を排除して抽出、 remainder は comment へ。
        const faxInfo = extractPhoneInfo(row.fax_number);
        const faxNumber = faxInfo.primary;
        comment = appendRemainderToComment(comment, faxInfo.remainder, 'FAXセル');
        if (faxNumber) faxCount++;

        if (!companyName || !phoneNumber) {
          errors.push({ line: lineNum, message: '企業名または電話番号が空です' });
          skippedCount++;
          return;
        }

        // ファイル内重複チェック
        if (importedPhones.has(phoneNumber) || importedNames.has(companyName)) {
          duplicateCount++;
          skippedCount++;
          return;
        }

        // 双方向重複チェック: 相手側リスト(オペ↔営業)に存在する場合はスキップ
        if (crossListPhoneSet.has(phoneNumber)) {
          const listName = isSalesList ? 'オペレーターリスト' : '営業リスト';
          errors.push({ line: lineNum, message: `${listName}に存在するためスキップ: ${phoneNumber}` });
          duplicateCount++;
          skippedCount++;
          return;
        }

        // DB重複チェック: phone_number 一致 OR company_name 一致
        // 電話番号が変動した同じ会社 (本社/支店/番号変更等) も拾うため会社名でも判定
        const existing = dbPhoneMap.get(phoneNumber) || dbNameMap.get(companyName);
        if (existing) {
          // オペレーターの自作リストインポート時
          if (req.user.role === 'operator' && importedByUserId) {
            if (existing.imported_by_user_id === null) {
              // 共有リストにある → 自作リストに移す（直前に pendingInserts を flush して整合性確保）
              await flushInserts();
              await conn.execute(
                'UPDATE companies SET imported_by_user_id = ?, industry = COALESCE(?, industry), job_type = COALESCE(?, job_type), comment = COALESCE(?, comment), data_source = COALESCE(?, data_source), region = COALESCE(?, region), address = COALESCE(?, address), exclusion_flag = 0 WHERE id = ?',
                [importedByUserId, industry, jobType, comment, dataSource, region, address, existing.id]
              );
              await addManualAssignment(conn, existing.id, req.user.id, req.user.id, req.user.role);
              existing.imported_by_user_id = importedByUserId;
              insertedCount++;
              importedPhones.add(phoneNumber);
              return;
            } else if (existing.imported_by_user_id === importedByUserId) {
              duplicateCount++;
              skippedCount++;
              return;
            } else {
              errors.push({ line: lineNum, message: `他のオペレーターの自作リストに登録済みのためスキップ: ${companyName} (${phoneNumber})` });
              duplicateCount++;
              skippedCount++;
              return;
            }
          }
          // 管理者/営業の共有リストインポート時:
          // 「重複登録時の肉付け + 追加ユーザー割り当て」 要望に対応し、
          // 既存行に対し COALESCE 肉付け UPDATE を実施 (空欄項目だけ補完)。
          // 担当者割り当ては (操作者が operator でない=管理者/マネージャー/営業のため) 行わない。
          await flushInserts();
          await conn.execute(
            `UPDATE companies SET
               company_name = COALESCE(NULLIF(?, ''), company_name),
               industry     = COALESCE(NULLIF(?, ''), industry),
               job_type     = COALESCE(NULLIF(?, ''), job_type),
               comment      = COALESCE(NULLIF(?, ''), comment),
               data_source  = COALESCE(NULLIF(?, ''), data_source),
               region       = COALESCE(NULLIF(?, ''), region),
               address      = COALESCE(NULLIF(?, ''), address),
               fax_number   = COALESCE(NULLIF(?, ''), fax_number),
               updated_at   = CURRENT_TIMESTAMP
             WHERE id = ?`,
            [companyName, industry, jobType, comment, dataSource, region, address, faxNumber, existing.id]
          );
          duplicateCount++;
          skippedCount++;
          return;
        }

        // 除外リストチェック（メモリ内Set使用）
        if (excludePhoneSet.has(phoneNumber)) { excludedCount++; skippedCount++; return; }

        // NGワードチェック: 会社名・業種・職種・コメントにNGワードが含まれる場合は除外
        // ただしオペレーター自身が自分リストとしてインポートする場合はNGワードチェックをスキップ
        if (req.user.role !== 'operator') {
          const haystack = `${companyName} ${industry || ''} ${jobType || ''} ${comment || ''}`;
          const matchedNg = ngKeywords.find(kw => haystack.includes(kw));
          if (matchedNg) {
            excludedCount++;
            skippedCount++;
            return;
          }
        }

        // ファイル内重複防止（バッチINSERT前にもガード）
        importedPhones.add(phoneNumber);
        importedNames.add(companyName);

        // バッチに積む（後で multi-row INSERT、assignments もまとめて挿入）
        pendingInserts.push([
          companyName, phoneNumber, faxNumber, industry, jobType, comment,
          dataSource, region, address, importedByUserId, isSalesList,
        ]);
        if (pendingInserts.length >= INSERT_BATCH_SIZE) {
          await flushInserts();
        }
      };

      // ストリーミングパース: 1行ずつ processRow を呼ぶ（records配列を持たない＝OOM回避）
      await parseFile(filePath, req.file.originalname, processRow);

      // 残りをフラッシュ
      await flushInserts();
      await conn.commit();
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }

    cleanupFile(filePath);

    const assignMsg = req.user.role === 'operator' ? `（${insertedCount}件があなたの架電予定に追加されました）` : '';
    logger.info(`ファイルインポート完了: inserted=${insertedCount}, skipped=${skippedCount}, duplicates=${duplicateCount}, excluded=${excludedCount}, user=${req.user.id}`);

    // 注意: 全件 UPDATE は60万行クラスで重く、連続インポート時に DB を詰まらせるため一旦無効化。
    // 代わりに、必要なら顧客マスタの「業種診断」→「再計算」ボタンで手動実行する想定。
    // applyIndustryCategoryAfterImport(null).catch(() => {});

    return ApiResponse.success(res, {
      totalRows,
      insertedCount,
      skippedCount,
      duplicateCount,
      excludedCount,
      faxCount,
      autoAssigned: req.user.role === 'operator' ? insertedCount : 0,
      errors: errors.slice(0, 50),
    }, `${insertedCount}件をインポートしました${assignMsg}`);
  } catch (err) {
    cleanupFile(req.file?.path);
    logger.error('インポートエラー詳細:', err.message, err.stack?.slice(0, 500));
    return res.status(500).json({ success: false, message: `インポートエラー: ${err.message}` });
  }
};

/**
 * POST /api/csv/import-exclusion?list_type=ng|existing_project
 * NG / 既存案件 除外リストインポート
 * インポート後、既存companiesの一致企業を exclusion_flag=1 に設定
 */
const importExclusionList = async (req, res, next) => {
  try {
    const listType = req.query.list_type;
    if (!listType || !['ng', 'existing_project'].includes(listType)) {
      return ApiResponse.badRequest(res, 'list_type は ng または existing_project を指定してください');
    }

    if (!req.file) {
      return ApiResponse.badRequest(res, 'ファイルをアップロードしてください');
    }

    const filePath = req.file.path;
    const records = await parseFile(filePath, req.file.originalname);

    if (records.length === 0) {
      cleanupFile(filePath);
      return ApiResponse.badRequest(res, 'ファイルにデータがありません');
    }

    let insertedCount = 0;
    let duplicateCount = 0;
    let excludedCompaniesCount = 0;
    const errors = [];

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      // 1行に複数電話番号が含まれる場合、それぞれを個別レコードとして登録する
      // ヘルパー: 1件分の除外リスト登録＋架電リスト照合
      const insertOneExclusion = async (companyName, phoneNumber) => {
        // 同一リスト種別内の重複チェック（NGはNG内、既存は既存内）
        const dupConditions = [];
        const dupParams = [listType];
        if (phoneNumber) { dupConditions.push('phone_number = ?'); dupParams.push(phoneNumber); }
        if (companyName) { dupConditions.push('company_name = ?'); dupParams.push(companyName); }
        const dupQuery = `SELECT id FROM exclusion_lists WHERE list_type = ? AND (${dupConditions.join(' OR ')})`;
        const [existing] = await conn.execute(dupQuery, dupParams);

        if (existing.length > 0) {
          duplicateCount++;
          return;
        }

        // exclusion_lists にインサート
        await conn.execute(
          'INSERT INTO exclusion_lists (company_name, phone_number, list_type) VALUES (?, ?, ?)',
          [companyName, phoneNumber, listType]
        );

        // 架電リスト（companies）から一致企業を削除/除外
        const findConditions = [];
        const findParams = [];
        if (phoneNumber) { findConditions.push('phone_number = ?'); findParams.push(phoneNumber); }
        if (companyName) { findConditions.push('company_name = ?'); findParams.push(companyName); }
        const findQuery = `SELECT id FROM companies WHERE ${findConditions.join(' OR ')}`;
        const [matchedCompanies] = await conn.execute(findQuery, findParams);

        for (const mc of matchedCompanies) {
          try {
            await conn.execute('DELETE FROM company_assignments WHERE company_id = ?', [mc.id]);
            await conn.execute('DELETE FROM recall_tasks WHERE company_id = ?', [mc.id]);
            const [callCheck] = await conn.execute('SELECT id FROM calls WHERE company_id = ? LIMIT 1', [mc.id]);
            if (callCheck.length > 0) {
              await conn.execute('UPDATE companies SET exclusion_flag = 1 WHERE id = ?', [mc.id]);
            } else {
              await conn.execute('DELETE FROM companies WHERE id = ?', [mc.id]);
            }
            excludedCompaniesCount++;
          } catch (delErr) {
            await conn.execute('UPDATE companies SET exclusion_flag = 1 WHERE id = ?', [mc.id]);
            excludedCompaniesCount++;
          }
        }

        insertedCount++;
      };

      for (let i = 0; i < records.length; i++) {
        const row = records[i];
        const lineNum = i + 2;

        const companyName = normalizeCompanyName((row.company_name || '').trim()) || null;
        // 電話番号を複数抽出（改行・スペース区切りで2件以上入っている場合がある）
        const phoneNumbers = extractPhoneNumbers((row.phone_number || '').trim());

        if (!companyName && phoneNumbers.length === 0) {
          errors.push({ line: lineNum, message: '企業名または電話番号のどちらかが必要です' });
          continue;
        }

        if (phoneNumbers.length > 0) {
          // 電話番号ごとに個別レコードとして登録
          for (const pn of phoneNumbers) {
            await insertOneExclusion(companyName, pn);
          }
        } else {
          // 電話番号なし、企業名のみで登録
          await insertOneExclusion(companyName, null);
        }
      }

      await conn.commit();
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }

    cleanupFile(filePath);

    const listLabel = listType === 'ng' ? 'NGリスト' : '既存案件リスト';
    logger.info(`${listLabel}インポート完了: inserted=${insertedCount}, duplicates=${duplicateCount}, excludedCompanies=${excludedCompaniesCount}, user=${req.user.id}`);

    // industry_category を非同期で計算 (NGリスト/既存案件リストにも新規行が入る可能性あり)
    applyIndustryCategoryAfterImport(null).catch(() => {});

    return ApiResponse.success(res, {
      totalRows: records.length,
      insertedCount,
      duplicateCount,
      excludedCompaniesCount,
      errors: errors.slice(0, 50),
    }, `${listLabel}に${insertedCount}件を登録しました（架電リストから${excludedCompaniesCount}件を削除/除外）`);
  } catch (err) {
    cleanupFile(req.file?.path);
    next(err);
  }
};

/**
 * GET /api/csv/exclusion-stats
 * NG / 既存案件リストの件数と最終更新日を返す
 */
const getExclusionStats = async (req, res, next) => {
  try {
    const [rows] = await pool.execute(`
      SELECT
        list_type,
        COUNT(*) AS total_count,
        MAX(created_at) AS last_updated_at
      FROM exclusion_lists
      GROUP BY list_type
    `);
    const stats = { ng: null, existing_project: null };
    for (const row of rows) {
      stats[row.list_type] = {
        totalCount: row.total_count,
        lastUpdatedAt: row.last_updated_at,
      };
    }
    return ApiResponse.success(res, stats);
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/csv/manual-company
 * 架電リストに1件手動登録
 */
const manualAddCompany = async (req, res, next) => {
  try {
    const { company_name, phone_number, industry, job_type, comment, data_source, address, region, is_sales_list } = req.body;
    const isSalesList = is_sales_list ? 1 : 0;

    if (!company_name || !phone_number) {
      return ApiResponse.badRequest(res, '企業名と電話番号は必須です');
    }
    if (!industry || !String(industry).trim()) {
      return ApiResponse.badRequest(res, '業種は必須です');
    }
    const addrStrCl = String(address || '').trim();
    if (!addrStrCl) {
      return ApiResponse.badRequest(res, '住所は必須です (最低でも都道府県から入力してください)');
    }
    if (!PREFECTURES.some(pref => addrStrCl.includes(pref))) {
      return ApiResponse.badRequest(res, '住所は都道府県から入力してください (例: 東京都...)');
    }

    const companyName = normalizeCompanyName(company_name);
    // ユーザーがメール混じり・改行込みで貼り付けたケースも primary を抜き出して採用
    const phoneInfo = extractPhoneInfo(phone_number);
    const phoneNumber = phoneInfo.primary;

    if (!phoneNumber) {
      return ApiResponse.badRequest(res, '有効な電話番号を入力してください');
    }

    // 既存 comment に電話番号セルの remainder (primary 以外の全情報) を追記して保存する
    let normalizedComment = comment || null;
    normalizedComment = appendRemainderToComment(normalizedComment, phoneInfo.remainder, '電話番号セル');

    // 除外リストチェック
    const [excluded] = await pool.execute(
      'SELECT id, list_type FROM exclusion_lists WHERE phone_number = ? OR company_name = ?',
      [phoneNumber, companyName]
    );
    if (excluded.length > 0) {
      const listLabel = excluded[0].list_type === 'ng' ? 'NGリスト' : '既存案件リスト';
      return ApiResponse.badRequest(res, `${listLabel}に登録済みのため追加できません`);
    }

    // NGワードチェック（会社名・業種・職種・コメント）
    // オペレーター自身の自作リスト追加時はNGワードチェックをスキップ
    if (req.user.role !== 'operator') {
      const [ngWords] = await pool.query('SELECT keyword FROM industry_exclude_words');
      const haystack = `${companyName} ${industry || ''} ${job_type || ''} ${comment || ''}`;
      const matchedNg = ngWords.map(r => r.keyword).filter(k => k).find(kw => haystack.includes(kw));
      if (matchedNg) {
        return ApiResponse.badRequest(res, `NGワード「${matchedNg}」が含まれているため追加できません`);
      }
    }

    // 双方向重複チェック: 相手側リストに存在する場合はスキップ
    const [crossExisting] = await pool.execute(
      'SELECT id FROM companies WHERE phone_number = ? AND is_sales_list = ?',
      [phoneNumber, isSalesList ? 0 : 1]
    );
    if (crossExisting.length > 0) {
      const listName = isSalesList ? 'オペレーターリスト' : '営業リスト';
      return ApiResponse.badRequest(res, `${listName}に既に登録済みのため追加できません`);
    }

    const derivedRegion = region || extractRegionFromAddress(address);
    const importedByUserId = (req.user.role === 'operator' || req.user.role === 'sales') ? req.user.id : null;

    // 「重複登録時の肉付け + 追加ユーザー割り当て」 要望:
    //   電話番号が既に存在する場合は元データを肉付け (空欄項目だけ補完) + 追加ユーザーに割り当て。
    //   従来の「既に登録済みのため追加できません」 はオペレーターの自作リスト排他のみ残す。
    const [existing] = await pool.execute(
      'SELECT id, imported_by_user_id FROM companies WHERE phone_number = ? AND is_sales_list = ?',
      [phoneNumber, isSalesList]
    );
    if (existing.length > 0 && req.user.role === 'operator' && importedByUserId) {
      const ex = existing[0];
      if (ex.imported_by_user_id !== null && ex.imported_by_user_id !== req.user.id) {
        return ApiResponse.badRequest(res, '他のオペレーターの自作リストに登録済みのため追加できません');
      }
      // 共有リスト or 自分の自作リスト → 自分の自作リストへ肉付け統合
      if (ex.imported_by_user_id === null) {
        await pool.execute(
          `UPDATE companies SET imported_by_user_id = ?, exclusion_flag = 0 WHERE id = ?`,
          [importedByUserId, ex.id]
        );
      }
    }

    // upsert (重複時は MASTER_COLS 肉付け、 担当者割り当て追加)
    const { companyId: insertedId, isNew } = await upsertCompanyByPhone(pool, {
      phone_number: phoneNumber,
      company_name: companyName,
      industry: industry || null,
      job_type: job_type || null,
      comment: normalizedComment,
      data_source: data_source || null,
      region: derivedRegion,
      address: address || null,
    }, {
      userId: importedByUserId,
      role: req.user.role,
      assignToUserId: req.user.role === 'operator' ? req.user.id : null,
      isSalesList: !!isSalesList,
      isSpecial: false,
    });

    // 管理者/マネージャー: 優先オペレーター割当
    const { priority_operator_ids, grace_days } = req.body;
    if (priority_operator_ids && Array.isArray(priority_operator_ids) && priority_operator_ids.length > 0) {
      const gd = grace_days || 5;
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + gd);
      const expiresStr = expiresAt.toISOString().slice(0, 19).replace('T', ' ');

      await pool.execute(
        'UPDATE companies SET priority_expires_at = ? WHERE id = ?',
        [expiresStr, insertedId]
      );

      for (const opId of priority_operator_ids) {
        await addManualAssignment(pool, insertedId, opId, req.user.id, req.user.role);
      }
    }

    logger.info(`手動企業登録: id=${insertedId}, user=${req.user.id}, isNew=${isNew}`);
    const msg = isNew ? '架電リストに登録しました' : '既存企業に肉付けして登録しました';
    return ApiResponse.created(res, { companyId: insertedId, isNew }, msg);
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/csv/manual-exclusion
 * NG/既存案件リストに1件手動登録
 */
const manualAddExclusion = async (req, res, next) => {
  const conn = await pool.getConnection();
  try {
    const { company_name, phone_number, list_type } = req.body;

    if (!list_type || !['ng', 'existing_project'].includes(list_type)) {
      return ApiResponse.badRequest(res, 'list_typeはng または existing_project を指定してください');
    }
    if (!company_name && !phone_number) {
      return ApiResponse.badRequest(res, '企業名または電話番号のいずれかは必須です');
    }

    const companyName = company_name ? normalizeCompanyName(company_name) : null;
    const phoneNumber = phone_number ? normalizePhoneNumber(phone_number) : null;

    await conn.beginTransaction();

    // 重複チェック
    let dupWhere = [];
    let dupParams = [];
    if (phoneNumber) { dupWhere.push('phone_number = ?'); dupParams.push(phoneNumber); }
    if (companyName) { dupWhere.push('company_name = ?'); dupParams.push(companyName); }
    const [dupRows] = await conn.execute(
      `SELECT id FROM exclusion_lists WHERE list_type = ? AND (${dupWhere.join(' OR ')})`,
      [list_type, ...dupParams]
    );
    if (dupRows.length > 0) {
      await conn.rollback();
      const listLabel = list_type === 'ng' ? 'NGリスト' : '既存案件リスト';
      return ApiResponse.badRequest(res, `${listLabel}に既に登録済みです`);
    }

    // 除外リストに登録
    await conn.execute(
      'INSERT INTO exclusion_lists (company_name, phone_number, list_type) VALUES (?, ?, ?)',
      [companyName, phoneNumber, list_type]
    );

    // 架電リストから一致する企業を検索・処理
    let matchWhere = [];
    let matchParams = [];
    if (phoneNumber) { matchWhere.push('phone_number = ?'); matchParams.push(phoneNumber); }
    if (companyName) { matchWhere.push('company_name = ?'); matchParams.push(companyName); }
    const [matchedCompanies] = await conn.execute(
      `SELECT c.id, (SELECT COUNT(*) FROM calls cl WHERE cl.company_id = c.id AND cl.result_code IS NOT NULL) as call_count
       FROM companies c WHERE ${matchWhere.join(' OR ')}`,
      matchParams
    );

    let excludedCount = 0;
    for (const company of matchedCompanies) {
      // 関連データ削除
      await conn.execute('DELETE FROM company_assignments WHERE company_id = ?', [company.id]);
      await conn.execute('DELETE FROM recall_tasks WHERE company_id = ?', [company.id]);

      if (company.call_count > 0) {
        // 通話履歴あり → 除外フラグ
        await conn.execute('UPDATE companies SET exclusion_flag = 1 WHERE id = ?', [company.id]);
      } else {
        // 通話履歴なし → 削除
        await conn.execute('DELETE FROM companies WHERE id = ?', [company.id]);
      }
      excludedCount++;
    }

    await conn.commit();

    const listLabel = list_type === 'ng' ? 'NGリスト' : '既存案件リスト';
    logger.info(`手動除外登録: list_type=${list_type}, excluded=${excludedCount}, user=${req.user.id}`);
    return ApiResponse.created(res, { excludedCompaniesCount: excludedCount },
      `${listLabel}に登録しました${excludedCount > 0 ? `（架電リストから${excludedCount}件を除外）` : ''}`);
  } catch (err) {
    await conn.rollback();
    next(err);
  } finally {
    conn.release();
  }
};

/**
 * POST /api/csv/import-special
 * 特別リストインポート（NG/既存案件リストを無視して追加、is_special=1）
 */
const importSpecialList = async (req, res, next) => {
  try {
    if (!req.file) {
      return ApiResponse.badRequest(res, 'ファイルをアップロードしてください');
    }

    const filePath = req.file.path;
    const records = await parseFile(filePath, req.file.originalname);

    if (records.length === 0) {
      cleanupFile(filePath);
      return ApiResponse.badRequest(res, 'ファイルにデータがありません');
    }

    // 優先オペレーター設定（管理者/マネージャーのみ）
    let priorityOperatorIds = [];
    let graceDays = 0;
    if (req.user.role !== 'operator' && req.body.priority_operator_ids) {
      try { priorityOperatorIds = JSON.parse(req.body.priority_operator_ids); } catch (e) { /* ignore */ }
      graceDays = parseInt(req.body.grace_days) || 0;
    }

    // 特別リスト優先度 (A/B/C/D)。 CSV 全体に 1 つ、 デフォルト 'C'。
    const rawPriority = (req.body.priority || 'C').toString().toUpperCase();
    const importPriority = ['A', 'B', 'C', 'D'].includes(rawPriority) ? rawPriority : 'C';

    let insertedCount = 0;
    let skippedCount = 0;
    let duplicateCount = 0;
    let faxCount = 0; // FAX番号が取れた件数
    const errors = [];

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      // 管理者インポート時のみバッチ作成（進捗管理用）
      let batchId = null;
      const isManagerImport = req.user.role === 'admin' || req.user.role === 'manager';
      if (isManagerImport) {
        const batchName = req.file.originalname || `特別リスト_${new Date().toISOString().slice(0, 10)}`;
        const [batchResult] = await conn.execute(
          'INSERT INTO import_batches (name, list_type, total_count, created_by) VALUES (?, ?, ?, ?)',
          [batchName, 'special', records.length, req.user.id]
        );
        batchId = batchResult.insertId;
      }

      for (let i = 0; i < records.length; i++) {
        const row = records[i];
        const lineNum = i + 2;

        const companyName = normalizeCompanyName((row.company_name || '').trim());
        // 電話番号セルから primary + remainder を抽出 (メール混入・複数行・担当者名等を保存)
        const phoneInfo = extractPhoneInfo(row.phone_number);
        const phoneNumber = phoneInfo.primary;
        const industry = (row.industry || '').trim().replace(/,\s*$/, '') || null;
        const jobType = (row.job_type || '').trim() || null;
        // 新フォーマットの URL は comment に統合（既存スキーマを壊さない）
        const baseComment = (row.comment || '').trim();
        const urlField = (row.url || '').trim();
        let comment = [baseComment, urlField ? `URL: ${urlField}` : ''].filter(Boolean).join(' / ') || null;
        comment = appendRemainderToComment(comment, phoneInfo.remainder, '電話番号セル');
        const dataSource = (row.data_source || '').trim() || null;
        const address = (row.address || '').trim() || null;
        const region = (row.region || '').trim() || extractRegionFromAddress(address) || null;
        // 新フォーマット用 FAX番号（取得できれば INSERT 時に保存）
        const faxInfo = extractPhoneInfo(row.fax_number);
        const faxNumber = faxInfo.primary;
        comment = appendRemainderToComment(comment, faxInfo.remainder, 'FAXセル');
        if (faxNumber) faxCount++;

        if (!companyName || !phoneNumber) {
          errors.push({ line: lineNum, message: '企業名または電話番号が空です' });
          skippedCount++;
          continue;
        }

        // 「重複登録時の肉付け + 追加ユーザー割り当て」 要望対応:
        //   重複チェックは行わず、 upsertCompanyByPhone で既存行があれば肉付け。
        //   特別リスト内重複は import_batch_id を更新せず、 duplicateCount にカウント。
        const [dupCheck] = await conn.execute(
          'SELECT id FROM companies WHERE (phone_number = ? OR company_name = ?) AND is_special = 1 LIMIT 1',
          [phoneNumber, companyName]
        );
        const isDup = dupCheck.length > 0;

        const { companyId: newCompanyId } = await upsertCompanyByPhone(conn, {
          phone_number: phoneNumber,
          company_name: companyName,
          industry, job_type: jobType, comment,
          data_source: dataSource, region, address,
        }, {
          userId: req.user.id,
          role: req.user.role,
          isSpecial: true,
          isSalesList: false,
          priority: importPriority,
        });

        // 新規 INSERT 時のみ import_batch_id を紐づけ (既存行は触らない)
        if (!isDup && batchId) {
          try {
            await conn.execute(
              'UPDATE companies SET import_batch_id = ? WHERE id = ? AND import_batch_id IS NULL',
              [batchId, newCompanyId]
            );
          } catch (_e) {}
        }

        // 管理者/マネージャー: 優先オペレーター割り当て + 猶予期間設定
        if (priorityOperatorIds.length > 0 && graceDays > 0) {
          await conn.execute(
            'UPDATE companies SET priority_expires_at = DATE_ADD(DATE_ADD(UTC_TIMESTAMP(), INTERVAL 9 HOUR), INTERVAL ? DAY) WHERE id = ?',
            [graceDays, newCompanyId]
          );
          for (const opId of priorityOperatorIds) {
            await addManualAssignment(conn, newCompanyId, opId, req.user.id, req.user.role, importPriority);
          }
        }

        if (isDup) {
          duplicateCount++;
        } else {
          insertedCount++;
        }
      }

      // バッチの実際のインサート数を更新
      if (batchId && insertedCount > 0) {
        await conn.execute('UPDATE import_batches SET total_count = ? WHERE id = ?', [insertedCount, batchId]);
      }

      await conn.commit();
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }

    cleanupFile(filePath);

    logger.info(`特別リストインポート完了: inserted=${insertedCount}, skipped=${skippedCount}, duplicates=${duplicateCount}, user=${req.user.id}`);

    // industry_category を非同期で計算
    applyIndustryCategoryAfterImport(null).catch(() => {});

    return ApiResponse.success(res, {
      totalRows: records.length,
      insertedCount,
      skippedCount,
      duplicateCount,
      faxCount,
      autoAssigned: 0,
      errors: errors.slice(0, 50),
    }, `特別リストに${insertedCount}件をインポートしました`);
  } catch (err) {
    cleanupFile(req.file?.path);
    next(err);
  }
};

/**
 * POST /api/csv/manual-special
 * 特別リストに1件手動登録（NG/既存案件を無視）
 */
const manualAddSpecial = async (req, res, next) => {
  try {
    const { company_name, phone_number, industry, job_type, comment, address, region, priority_operator_id } = req.body;
    // 特別リスト優先度 (A/B/C/D)、 デフォルト 'C'
    const rawPriority = (req.body.priority || 'C').toString().toUpperCase();
    const manualPriority = ['A', 'B', 'C', 'D'].includes(rawPriority) ? rawPriority : 'C';

    if (!company_name || !phone_number) {
      return ApiResponse.badRequest(res, '企業名と電話番号は必須です');
    }
    if (!industry || !String(industry).trim()) {
      return ApiResponse.badRequest(res, '業種は必須です');
    }
    const addrStrSp = String(address || '').trim();
    if (!addrStrSp) {
      return ApiResponse.badRequest(res, '住所は必須です (最低でも都道府県から入力してください)');
    }
    if (!PREFECTURES.some(pref => addrStrSp.includes(pref))) {
      return ApiResponse.badRequest(res, '住所は都道府県から入力してください (例: 東京都...)');
    }

    const companyName = normalizeCompanyName(company_name);
    // ユーザーがメール混じり・改行込みで貼り付けたケースも primary を抜き出して採用
    const phoneInfo = extractPhoneInfo(phone_number);
    const phoneNumber = phoneInfo.primary;

    if (!phoneNumber) {
      return ApiResponse.badRequest(res, '有効な電話番号を入力してください');
    }

    let normalizedComment = comment || null;
    normalizedComment = appendRemainderToComment(normalizedComment, phoneInfo.remainder, '電話番号セル');

    const derivedRegion = region || extractRegionFromAddress(address);

    // 「重複登録時の肉付け + 追加ユーザー割り当て」 要望:
    //   重複でも上書き肉付け + 追加ユーザーを company_assignments に追加。
    //   オペレーターの場合は自分、 管理者の場合は priority_operator_id (指定時) を割当先に。
    const assignUserId = (req.user.role === 'operator')
      ? req.user.id
      : (priority_operator_id || null);

    const { companyId, isNew } = await upsertCompanyByPhone(pool, {
      phone_number: phoneNumber,
      company_name: companyName,
      industry: industry || null,
      job_type: job_type || null,
      comment: normalizedComment,
      region: derivedRegion,
      address: address || null,
    }, {
      userId: req.user.id,
      role: req.user.role,
      assignToUserId: assignUserId,
      isSpecial: true,
      isSalesList: false,
      priority: manualPriority,
    });

    logger.info(`特別リスト手動登録: id=${companyId}, user=${req.user.id}, isNew=${isNew}, priority=${manualPriority}`);
    const msg = isNew ? '特別リストに登録しました' : '既存の特別リストに肉付けして登録しました';
    return ApiResponse.created(res, { companyId, isNew }, msg);
  } catch (err) {
    next(err);
  }
};

module.exports = { importCompanies, importExclusionList, getExclusionStats, manualAddCompany, manualAddExclusion, importSpecialList, manualAddSpecial, _parseExcelFile: parseExcelFile };
