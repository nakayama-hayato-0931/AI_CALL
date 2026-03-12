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

        const companyName = (row.company_name || '').trim();
        const phoneNumber = (row.phone_number || '').trim();
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

      for (let i = 0; i < records.length; i++) {
        const row = records[i];
        const lineNum = i + 2;

        const companyName = (row.company_name || '').trim();
        const phoneNumber = (row.phone_number || '').trim() || null;

        if (!companyName) {
          errors.push({ line: lineNum, message: '企業名が空です' });
          continue;
        }

        // 同一リスト内の重複チェック
        const dupQuery = phoneNumber
          ? 'SELECT id FROM exclusion_lists WHERE list_type = ? AND (phone_number = ? OR company_name = ?)'
          : 'SELECT id FROM exclusion_lists WHERE list_type = ? AND company_name = ?';
        const dupParams = phoneNumber
          ? [listType, phoneNumber, companyName]
          : [listType, companyName];
        const [existing] = await conn.execute(dupQuery, dupParams);

        if (existing.length > 0) {
          duplicateCount++;
          continue;
        }

        // exclusion_lists にインサート
        await conn.execute(
          'INSERT INTO exclusion_lists (company_name, phone_number, list_type) VALUES (?, ?, ?)',
          [companyName, phoneNumber, listType]
        );

        // 既存 companies の一致企業を除外フラグ設定
        const excludeQuery = phoneNumber
          ? 'UPDATE companies SET exclusion_flag = 1 WHERE exclusion_flag = 0 AND (phone_number = ? OR company_name = ?)'
          : 'UPDATE companies SET exclusion_flag = 1 WHERE exclusion_flag = 0 AND company_name = ?';
        const excludeParams = phoneNumber
          ? [phoneNumber, companyName]
          : [companyName];
        const [excludeResult] = await conn.execute(excludeQuery, excludeParams);
        excludedCompaniesCount += excludeResult.affectedRows;

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

    const listLabel = listType === 'ng' ? 'NGリスト' : '既存案件リスト';
    logger.info(`${listLabel}インポート完了: inserted=${insertedCount}, duplicates=${duplicateCount}, excludedCompanies=${excludedCompaniesCount}, user=${req.user.id}`);

    return ApiResponse.success(res, {
      totalRows: records.length,
      insertedCount,
      duplicateCount,
      excludedCompaniesCount,
      errors: errors.slice(0, 50),
    }, `${listLabel}に${insertedCount}件を登録しました（架電リストから${excludedCompaniesCount}件を除外）`);
  } catch (err) {
    cleanupFile(req.file?.path);
    next(err);
  }
};

module.exports = { importCompanies, importExclusionList };
