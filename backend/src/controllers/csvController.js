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
        const region = (row.region || '').trim() || null;

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

        // インサート
        const [insertResult] = await conn.execute(
          `INSERT INTO companies (company_name, phone_number, industry, job_type, comment, region, address)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [companyName, phoneNumber, industry, jobType, comment, region, address]
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

module.exports = { importCompanies, importExclusionList, getExclusionStats };
