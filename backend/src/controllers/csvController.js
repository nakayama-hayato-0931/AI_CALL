/**
 * CSVインポートコントローラー
 * 企業データのCSV / XLS / XLSX 一括インポート
 * NG / 既存案件 除外リストインポート
 */
const fs = require('fs');
const path = require('path');
const csv = require('csv-parser');
const XLSX = require('xlsx');
const pool = require('../../config/database');
const ApiResponse = require('../utils/apiResponse');
const logger = require('../utils/logger');

/**
 * 日本語→英語 カラム名マッピング
 */
const COLUMN_MAP = {
  '会社名': 'company_name',
  '電話番号': 'phone_number',
  '業種': 'industry',
  '職種': 'job_type',
  'コメント': 'comment',
  '住所': 'address',
  '地域': 'region',
};

const normalizeColumnName = (name) => {
  const trimmed = (name || '').trim();
  return COLUMN_MAP[trimmed] || trimmed;
};

/**
 * XLS/XLSX ファイルをパースしてレコード配列を返す
 */
const parseExcelFile = (filePath) => {
  const wb = XLSX.readFile(filePath);
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rawData = XLSX.utils.sheet_to_json(sheet, { defval: '' });
  return rawData.map(row => {
    const normalized = {};
    for (const [key, value] of Object.entries(row)) {
      const normKey = normalizeColumnName(key);
      normalized[normKey] = typeof value === 'string' ? value.trim() : String(value);
    }
    return normalized;
  });
};

/**
 * CSVファイルをパースしてレコード配列を返す
 */
const parseCsvFile = (filePath) => {
  return new Promise((resolve, reject) => {
    const records = [];
    fs.createReadStream(filePath, { encoding: 'utf-8' })
      .pipe(csv({
        mapHeaders: ({ header }) => normalizeColumnName(header),
      }))
      .on('data', (row) => records.push(row))
      .on('end', () => resolve(records))
      .on('error', reject);
  });
};

/**
 * ファイルをパース（拡張子で自動判別）
 */
const parseFile = async (filePath, originalName) => {
  const ext = path.extname(originalName).toLowerCase();
  if (ext === '.xls' || ext === '.xlsx') {
    return parseExcelFile(filePath);
  }
  return parseCsvFile(filePath);
};

/**
 * 電話番号を抽出（複数対応）
 * - 入力文字列から電話番号パターン（10〜11桁）をすべて抽出して配列で返す
 * - メールアドレス、URL、文字列など電話番号以外はすべて無視
 * - 全角数字→半角、ハイフン・括弧等の区切り文字を考慮
 * - 2行に分かれて複数番号が入っている場合も両方抽出
 * @param {string} phone - 電話番号フィールドの生値
 * @returns {string[]} 正規化済み電話番号の配列（例: ['09012345678', '0312345678']）
 */
const extractPhoneNumbers = (phone) => {
  if (!phone) return [];

  // 全角数字 → 半角数字に統一
  let text = phone.replace(/[０-９]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0));

  // 電話番号パターンを抽出（ハイフン・ダッシュ・ドット・スペース・括弧区切りに対応）
  // 例: 090-1234-5678, 03(1234)5678, 0120.123.456, ０３ー１２３４ー５６７８
  const phonePattern = /(?:\+?[\d]{1,4}[\s.\-ー－—―‐‑⁃₋−]?)?[\(（]?[0-9]{1,5}[\)）]?[\s.\-ー－—―‐‑⁃₋−]?[0-9]{1,4}[\s.\-ー－—―‐‑⁃₋−]?[0-9]{1,5}/g;

  const matches = text.match(phonePattern) || [];
  const results = [];

  for (const m of matches) {
    // 数字だけ抽出
    const digits = m.replace(/[^0-9]/g, '');
    // 日本の電話番号は10桁（固定）or 11桁（携帯/フリーダイヤル）
    if (digits.length >= 10 && digits.length <= 11) {
      // 重複排除
      if (!results.includes(digits)) {
        results.push(digits);
      }
    }
  }

  return results;
};

/**
 * 後方互換: 単一電話番号を返す（架電リストインポート用）
 * 最初に見つかった電話番号を返す。見つからなければ空文字。
 */
const normalizePhoneNumber = (phone) => {
  const phones = extractPhoneNumbers(phone);
  return phones.length > 0 ? phones[0] : '';
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
    const records = await parseFile(filePath, req.file.originalname);

    if (records.length === 0) {
      cleanupFile(filePath);
      return ApiResponse.badRequest(res, 'ファイルにデータがありません');
    }

    let insertedCount = 0;
    let skippedCount = 0;
    let duplicateCount = 0;
    let excludedCount = 0;
    const errors = [];

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      for (let i = 0; i < records.length; i++) {
        const row = records[i];
        const lineNum = i + 2;

        const companyName = normalizeCompanyName((row.company_name || '').trim());
        const phoneNumber = normalizePhoneNumber((row.phone_number || '').trim());
        const industry = (row.industry || '').trim().replace(/,\s*$/, '') || null;
        const jobType = (row.job_type || '').trim() || null;
        const comment = (row.comment || '').trim() || null;
        const address = (row.address || '').trim() || null;
        // 地域: 明示カラムがあればそれを使う、なければ住所から自動抽出
        const region = (row.region || '').trim() || extractRegionFromAddress(address) || null;

        if (!companyName || !phoneNumber) {
          errors.push({ line: lineNum, message: '企業名または電話番号が空です' });
          skippedCount++;
          continue;
        }

        // 重複チェック: 電話番号 OR 会社名
        const [existing] = await conn.execute(
          'SELECT id FROM companies WHERE phone_number = ? OR company_name = ?',
          [phoneNumber, companyName]
        );
        if (existing.length > 0) {
          duplicateCount++;
          skippedCount++;
          continue;
        }

        // 除外リストチェック: 電話番号 OR 会社名
        const [excluded] = await conn.execute(
          'SELECT id FROM exclusion_lists WHERE phone_number = ? OR company_name = ?',
          [phoneNumber, companyName]
        );
        if (excluded.length > 0) {
          excludedCount++;
          skippedCount++;
          continue;
        }

        // インサート（オペレーターの場合はimported_by_user_idを設定）
        const importedByUserId = (req.user.role === 'operator') ? req.user.id : null;
        const [insertResult] = await conn.execute(
          `INSERT INTO companies (company_name, phone_number, industry, job_type, comment, region, address, imported_by_user_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [companyName, phoneNumber, industry, jobType, comment, region, address, importedByUserId]
        );

        // オペレーター: 自動割り当て
        if (req.user.role === 'operator') {
          try {
            await conn.execute(
              'INSERT INTO company_assignments (company_id, user_id, assigned_by) VALUES (?, ?, ?)',
              [insertResult.insertId, req.user.id, req.user.id]
            );
          } catch (assignErr) {
            if (assignErr.code !== 'ER_DUP_ENTRY') throw assignErr;
          }
        }

        insertedCount++;
      }

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

    return ApiResponse.success(res, {
      totalRows: records.length,
      insertedCount,
      skippedCount,
      duplicateCount,
      excludedCount,
      autoAssigned: req.user.role === 'operator' ? insertedCount : 0,
      errors: errors.slice(0, 50),
    }, `${insertedCount}件をインポートしました${assignMsg}`);
  } catch (err) {
    cleanupFile(req.file?.path);
    next(err);
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
    const { company_name, phone_number, industry, job_type, comment, address, region } = req.body;

    if (!company_name || !phone_number) {
      return ApiResponse.badRequest(res, '企業名と電話番号は必須です');
    }

    const companyName = normalizeCompanyName(company_name);
    const phoneNumber = normalizePhoneNumber(phone_number);

    if (!phoneNumber) {
      return ApiResponse.badRequest(res, '有効な電話番号を入力してください');
    }

    // 除外リストチェック
    const [excluded] = await pool.execute(
      'SELECT id, list_type FROM exclusion_lists WHERE phone_number = ? OR company_name = ?',
      [phoneNumber, companyName]
    );
    if (excluded.length > 0) {
      const listLabel = excluded[0].list_type === 'ng' ? 'NGリスト' : '既存案件リスト';
      return ApiResponse.badRequest(res, `${listLabel}に登録済みのため追加できません`);
    }

    // 重複チェック
    const [existing] = await pool.execute(
      'SELECT id FROM companies WHERE phone_number = ? OR company_name = ?',
      [phoneNumber, companyName]
    );
    if (existing.length > 0) {
      return ApiResponse.badRequest(res, '既に架電リストに登録済みです');
    }

    const derivedRegion = region || extractRegionFromAddress(address);
    const importedByUserId = (req.user.role === 'operator') ? req.user.id : null;

    const [insertResult] = await pool.execute(
      `INSERT INTO companies (company_name, phone_number, industry, job_type, comment, region, address, imported_by_user_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [companyName, phoneNumber, industry || null, job_type || null, comment || null, derivedRegion, address || null, importedByUserId]
    );

    // オペレーター: 自動割り当て
    if (req.user.role === 'operator') {
      try {
        await pool.execute(
          'INSERT INTO company_assignments (company_id, user_id, assigned_by) VALUES (?, ?, ?)',
          [insertResult.insertId, req.user.id, req.user.id]
        );
      } catch (assignErr) {
        if (assignErr.code !== 'ER_DUP_ENTRY') throw assignErr;
      }
    }

    logger.info(`手動企業登録: id=${insertResult.insertId}, user=${req.user.id}`);
    return ApiResponse.created(res, { companyId: insertResult.insertId }, '架電リストに登録しました');
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
      `SELECT c.id, (SELECT COUNT(*) FROM calls cl WHERE cl.company_id = c.id) as call_count
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

module.exports = { importCompanies, importExclusionList, getExclusionStats, manualAddCompany, manualAddExclusion };
