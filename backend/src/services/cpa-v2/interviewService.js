/**
 * cpa-v2: 面接記録 (interview_records_v2)
 *   - シート『2024_面接内訳』
 *   - 抽出条件: NR='架電バイト' AND NM(面接日)<=今日
 *   - 列マッピング (fax-crm 実装と同一):
 *       NL: 営業担当、NM: 面接日、NN: 求人番号、NO: 会社名
 *       NP: 面接人数、NQ: 合格者数 (NULL/0 区別)、NR: 案件区分('架電バイト')
 *       NS: 案件獲得日、NU: 業種
 */
const {
  SOURCE_KIND_KEEP, getPool, colIndex,
  parseDateCell, parseInt0, parseIntNullable, clean, fetchSheetValues,
} = require('./_common');

const COL = {
  NL: colIndex('NL'), NM: colIndex('NM'), NN: colIndex('NN'),
  NO: colIndex('NO'), NP: colIndex('NP'), NQ: colIndex('NQ'),
  NR: colIndex('NR'), NS: colIndex('NS'), NU: colIndex('NU'),
};

function parseInterviewsSheet(values, opts = {}) {
  const today = opts.today || new Date();
  const todayYMD = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  const records = [];
  const stats = { totalRows: 0, kept: 0, skippedNotKeep: 0, skippedFutureOrNoDate: 0, skippedNoKey: 0 };
  for (let r = 1; r < values.length; r++) {
    const row = values[r] || [];
    stats.totalRows++;
    const nr = clean(row[COL.NR]);
    if (nr !== SOURCE_KIND_KEEP) { stats.skippedNotKeep++; continue; }
    const interviewDate = parseDateCell(row[COL.NM]);
    if (!interviewDate || interviewDate > todayYMD) { stats.skippedFutureOrNoDate++; continue; }
    const jobNumber = clean(row[COL.NN]);
    const companyName = clean(row[COL.NO]);
    let externalKey;
    if (jobNumber) externalKey = `${jobNumber}__${interviewDate}__r${r + 1}`;
    else if (companyName) externalKey = `${companyName}__${interviewDate}__r${r + 1}`;
    else { stats.skippedNoKey++; continue; }
    records.push({
      external_key: externalKey,
      interview_date: interviewDate,
      acquired_date: parseDateCell(row[COL.NS]),
      job_number: jobNumber,
      company_name: companyName,
      sales_owner: clean(row[COL.NL]),
      industry: clean(row[COL.NU]),
      interview_count: parseInt0(row[COL.NP]),
      pass_count: parseIntNullable(row[COL.NQ]),
      source_kind: nr,
      source_row: r + 1,
    });
    stats.kept++;
  }
  return { records, stats };
}

async function upsertRecords(records) {
  const pool = getPool();
  const conn = await pool.getConnection();
  let inserted = 0, deleted = 0;
  try {
    await conn.beginTransaction();
    // フルリフレッシュ (架電バイト のみ全削除→再投入)
    const [del] = await conn.query(
      `DELETE FROM interview_records_v2 WHERE source_kind = ?`, [SOURCE_KIND_KEEP]
    );
    deleted = del.affectedRows || 0;

    if (records.length) {
      const CHUNK = 500;
      const cols = ['external_key','interview_date','acquired_date','job_number','company_name',
                    'sales_owner','industry','interview_count','pass_count','source_kind','source_row','synced_at'];
      const now = new Date();
      for (let i = 0; i < records.length; i += CHUNK) {
        const slice = records.slice(i, i + CHUNK);
        const placeholders = slice.map(() => `(${cols.map(() => '?').join(',')})`).join(',');
        const values = [];
        for (const r of slice) {
          values.push(r.external_key, r.interview_date, r.acquired_date, r.job_number, r.company_name,
                      r.sales_owner, r.industry, r.interview_count, r.pass_count, r.source_kind, r.source_row, now);
        }
        await conn.query(`INSERT INTO interview_records_v2 (${cols.join(',')}) VALUES ${placeholders}`, values);
        inserted += slice.length;
      }
    }
    await conn.commit();
  } catch (e) { await conn.rollback(); throw e; }
  finally { conn.release(); }
  return { inserted, deleted, updated: 0 };
}

async function getConfig() {
  const pool = getPool();
  const [rows] = await pool.query(
    `SELECT interviews_sheet_id, interviews_sheet_name, interviews_sheet_range,
            interviews_last_synced_at, interviews_last_sync_status, interviews_last_sync_message
       FROM sheets_config_v2 WHERE id = 1 LIMIT 1`
  );
  return rows[0] || null;
}

async function updateConfig({ interviews_sheet_id, interviews_sheet_name, interviews_sheet_range }) {
  const pool = getPool();
  await pool.query(
    `INSERT INTO sheets_config_v2 (id, interviews_sheet_id, interviews_sheet_name, interviews_sheet_range)
     VALUES (1, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       interviews_sheet_id    = VALUES(interviews_sheet_id),
       interviews_sheet_name  = VALUES(interviews_sheet_name),
       interviews_sheet_range = VALUES(interviews_sheet_range)`,
    [interviews_sheet_id || null, interviews_sheet_name || '2024_面接内訳', interviews_sheet_range || 'A1:OZ20000']
  );
  return getConfig();
}

async function markSync(status, message) {
  const pool = getPool();
  await pool.query(
    `UPDATE sheets_config_v2 SET
       interviews_last_synced_at    = DATE_ADD(UTC_TIMESTAMP(), INTERVAL 9 HOUR),
       interviews_last_sync_status  = ?,
       interviews_last_sync_message = ?
     WHERE id = 1`,
    [status, message || null]
  );
}

async function syncFromSheets() {
  const cfg = await getConfig();
  if (!cfg?.interviews_sheet_id) {
    const err = new Error('面接シートIDが未設定です'); err.status = 400; err.code = 'NO_SHEET_ID'; throw err;
  }
  let values;
  try {
    values = await fetchSheetValues({
      spreadsheetId: cfg.interviews_sheet_id,
      sheetName:     cfg.interviews_sheet_name  || '2024_面接内訳',
      rangePart:     cfg.interviews_sheet_range || 'A1:OZ20000',
    });
  } catch (e) {
    await markSync('error', e.message);
    const err = new Error(`Sheets取得失敗: ${e.message}`); err.status = 502; throw err;
  }
  if (values.length < 2) {
    await markSync('error', 'シートが空、またはヘッダーのみ');
    return { totalRows: 0, kept: 0, inserted: 0, updated: 0 };
  }
  const { records, stats } = parseInterviewsSheet(values);
  const up = await upsertRecords(records);
  const msg = `keep=${stats.kept} (notKeep=${stats.skippedNotKeep}, fut/noDate=${stats.skippedFutureOrNoDate}, noKey=${stats.skippedNoKey}) / del=${up.deleted}, ins=${up.inserted}`;
  await markSync('ok', msg);
  return { ...stats, ...up };
}

async function list({ month, basis = 'acquired', kind = 'all', limit = 1000 } = {}) {
  const pool = getPool();
  const dateCol = basis === 'offer' ? 'interview_date' : 'acquired_date';
  const where = [`ir.source_kind = '${SOURCE_KIND_KEEP}'`, `ir.interview_date <= CURDATE()`];
  const params = [];
  if (month) {
    where.push(`ir.${dateCol} >= ?`); params.push(month);
    where.push(`ir.${dateCol} < DATE_ADD(?, INTERVAL 1 MONTH)`); params.push(month);
  }
  where.push(`NOT (ir.interview_count = 0 AND (ir.pass_count = 0 OR ir.pass_count IS NULL))`);
  if (kind === 'rejects') {
    where.push(`(ir.pass_count = 0 OR (ir.pass_count IS NULL AND ir.interview_date <= DATE_SUB(CURDATE(), INTERVAL 1 MONTH)))`);
  }
  const whereSql = 'WHERE ' + where.join(' AND ');
  // - 面接結果(result_label): pass_count>0=合格, =0=不合格, IS NULL+1ヶ月以上経過=不合格, それ以外=結果待ち
  // - caller_name: 求人番号で callcenter.projects→users から架電担当者を解決(LIMIT 1)
  const [rows] = await pool.query(
    `SELECT ir.id, ir.external_key, ir.interview_date, ir.acquired_date, ir.job_number, ir.company_name,
            ir.sales_owner, ir.industry, ir.interview_count, ir.pass_count, ir.source_kind, ir.source_row,
            CASE
              WHEN ir.pass_count > 0 THEN '合格'
              WHEN ir.pass_count = 0 THEN '不合格'
              WHEN ir.pass_count IS NULL AND ir.interview_date <= DATE_SUB(CURDATE(), INTERVAL 1 MONTH) THEN '不合格'
              ELSE '結果待ち'
            END AS result_label,
            (SELECT u.name FROM projects p JOIN users u ON u.id = p.owner_user_id
              WHERE p.job_number = ir.job_number AND p.is_legacy = 0 AND p.owner_user_id IS NOT NULL
              ORDER BY p.created_at DESC LIMIT 1) AS caller_name
       FROM interview_records_v2 ir ${whereSql}
      ORDER BY COALESCE(NULLIF(ir.job_number, ''), ir.company_name) ASC,
               ir.interview_date DESC, ir.id DESC
      LIMIT ?`,
    [...params, Math.min(Number(limit) || 1000, 5000)]
  );
  return rows;
}

async function listOfferOnly({ month, basis = 'acquired', limit = 1000 } = {}) {
  const pool = getPool();
  if (!month) return [];
  const col   = basis === 'offer' ? 'offer_date'     : 'acquired_date';
  const ivCol = basis === 'offer' ? 'interview_date' : 'acquired_date';
  const [rows] = await pool.query(
    `SELECT id, acquired_date, offer_date, job_number, company_name,
            sales_owner, industry, first_payment, expected_revenue,
            status_label, is_cancelled, is_declined, caller_name
       FROM (
         SELECT sp.*,
                (SELECT u.name FROM projects p JOIN users u ON u.id = p.owner_user_id
                  WHERE p.job_number = sp.job_number AND p.is_legacy = 0 AND p.owner_user_id IS NOT NULL
                  ORDER BY p.created_at DESC LIMIT 1) AS caller_name,
                ROW_NUMBER() OVER (
                  PARTITION BY COALESCE(NULLIF(sp.job_number, ''), sp.company_name)
                  ORDER BY sp.offer_date DESC, sp.id DESC
                ) AS rn
           FROM sales_projects_v2 sp
          WHERE sp.${col} IS NOT NULL
            AND sp.${col} >= ?
            AND sp.${col} < DATE_ADD(?, INTERVAL 1 MONTH)
            AND NOT EXISTS (
              SELECT 1 FROM interview_records_v2 ir
              WHERE ir.${ivCol} IS NOT NULL
                AND ir.${ivCol} >= ? AND ir.${ivCol} < DATE_ADD(?, INTERVAL 1 MONTH)
                AND ir.source_kind = ?
                AND ir.interview_date <= CURDATE()
                AND NOT (ir.interview_count = 0 AND (ir.pass_count = 0 OR ir.pass_count IS NULL))
                AND COALESCE(NULLIF(ir.job_number, ''), ir.company_name)
                  = COALESCE(NULLIF(sp.job_number, ''), sp.company_name)
            )
       ) ranked
      WHERE rn = 1
      ORDER BY COALESCE(NULLIF(job_number, ''), company_name) ASC,
               ${col} DESC, id DESC
      LIMIT ?`,
    [month, month, month, month, SOURCE_KIND_KEEP, Math.min(Number(limit) || 1000, 5000)]
  );
  return rows;
}

module.exports = {
  parseInterviewsSheet, upsertRecords, syncFromSheets, list, listOfferOnly,
  getConfig, updateConfig, COL,
};
