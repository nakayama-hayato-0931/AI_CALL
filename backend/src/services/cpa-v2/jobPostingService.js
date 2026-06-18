/**
 * cpa-v2: 求人情報 (job_postings_v2)
 *   - シート『求人情報』
 *   - 抽出条件: H='架電バイト'
 *   - 列マッピング(fax-crm 実装と同一):
 *       B: 営業担当 (末尾アルファベット除去)
 *       C: 求人番号、D: 会社名、H: 案件区分、I: 業種
 *       AI: バラシ('バラシ' なら is_cancelled=1)、AJ: 案件取得日
 */
const {
  SOURCE_KIND_KEEP, getPool, colIndex,
  parseDateCell, clean, fetchSheetValues,
} = require('./_common');

const COL = {
  B:  colIndex('B'),  C:  colIndex('C'),  D:  colIndex('D'),
  H:  colIndex('H'),  I:  colIndex('I'),
  AI: colIndex('AI'), AJ: colIndex('AJ'),
};

function cleanSalesOwner(raw) {
  const t = clean(raw);
  if (!t) return null;
  return t.replace(/[\s　]+[A-Za-z]+\s*$/, '').trim() || null;
}

function parseJobPostingsSheet(values) {
  const records = [];
  const stats = { totalRows: 0, kept: 0, skippedNotKeep: 0, skippedNoKey: 0, cancelledCount: 0 };
  for (let r = 1; r < values.length; r++) {
    const row = values[r] || [];
    stats.totalRows++;
    const h = clean(row[COL.H]);
    if (h !== SOURCE_KIND_KEEP) { stats.skippedNotKeep++; continue; }
    const jobNumber = clean(row[COL.C]);
    const companyName = clean(row[COL.D]);
    let externalKey;
    if (jobNumber)            externalKey = `${jobNumber}__r${r + 1}`;
    else if (companyName)     externalKey = `${companyName}__r${r + 1}`;
    else { stats.skippedNoKey++; continue; }
    const aiVal = clean(row[COL.AI]);
    const isCancelled = aiVal === 'バラシ' ? 1 : 0;
    if (isCancelled) stats.cancelledCount++;
    records.push({
      external_key: externalKey,
      acquired_date: parseDateCell(row[COL.AJ]),
      job_number: jobNumber,
      company_name: companyName,
      sales_owner: cleanSalesOwner(row[COL.B]),
      industry: clean(row[COL.I]),
      source_kind: h,
      status_label: aiVal,
      is_cancelled: isCancelled,
      source_row: r + 1,
    });
    stats.kept++;
  }
  return { records, stats };
}

async function upsertRecords(records) {
  if (!records.length) return { inserted: 0, updated: 0 };
  const pool = getPool();
  const conn = await pool.getConnection();
  let inserted = 0, updated = 0;
  try {
    for (const r of records) {
      const [result] = await conn.query(
        `INSERT INTO job_postings_v2 (
          external_key, acquired_date, job_number, company_name,
          sales_owner, industry, source_kind, status_label, is_cancelled, source_row, synced_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, DATE_ADD(UTC_TIMESTAMP(), INTERVAL 9 HOUR))
        ON DUPLICATE KEY UPDATE
          acquired_date = VALUES(acquired_date),
          job_number = VALUES(job_number),
          company_name = VALUES(company_name),
          sales_owner = VALUES(sales_owner),
          industry = VALUES(industry),
          source_kind = VALUES(source_kind),
          status_label = VALUES(status_label),
          is_cancelled = VALUES(is_cancelled),
          source_row = VALUES(source_row),
          synced_at = DATE_ADD(UTC_TIMESTAMP(), INTERVAL 9 HOUR)`,
        [r.external_key, r.acquired_date, r.job_number, r.company_name,
         r.sales_owner, r.industry, r.source_kind, r.status_label, r.is_cancelled, r.source_row]
      );
      if (result.affectedRows === 1) inserted++;
      else if (result.affectedRows >= 2) updated++;
    }
  } finally { conn.release(); }
  return { inserted, updated };
}

async function getConfig() {
  const pool = getPool();
  const [rows] = await pool.query(
    `SELECT jobs_sheet_id, jobs_sheet_name, jobs_sheet_range,
            jobs_last_synced_at, jobs_last_sync_status, jobs_last_sync_message
       FROM sheets_config_v2 WHERE id = 1 LIMIT 1`
  );
  return rows[0] || null;
}

async function updateConfig({ jobs_sheet_id, jobs_sheet_name, jobs_sheet_range }) {
  const pool = getPool();
  await pool.query(
    `INSERT INTO sheets_config_v2 (id, jobs_sheet_id, jobs_sheet_name, jobs_sheet_range)
     VALUES (1, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       jobs_sheet_id    = VALUES(jobs_sheet_id),
       jobs_sheet_name  = VALUES(jobs_sheet_name),
       jobs_sheet_range = VALUES(jobs_sheet_range)`,
    [jobs_sheet_id || null, jobs_sheet_name || '求人情報', jobs_sheet_range || 'A1:BZ20000']
  );
  return getConfig();
}

async function markSync(status, message) {
  const pool = getPool();
  await pool.query(
    `UPDATE sheets_config_v2 SET
       jobs_last_synced_at    = DATE_ADD(UTC_TIMESTAMP(), INTERVAL 9 HOUR),
       jobs_last_sync_status  = ?,
       jobs_last_sync_message = ?
     WHERE id = 1`,
    [status, message || null]
  );
}

async function syncFromSheets() {
  const cfg = await getConfig();
  if (!cfg?.jobs_sheet_id) {
    const err = new Error('求人情報シートIDが未設定です'); err.status = 400; err.code = 'NO_SHEET_ID';
    throw err;
  }
  let values;
  try {
    values = await fetchSheetValues({
      spreadsheetId: cfg.jobs_sheet_id,
      sheetName:     cfg.jobs_sheet_name  || '求人情報',
      rangePart:     cfg.jobs_sheet_range || 'A1:BZ20000',
    });
  } catch (e) {
    await markSync('error', e.message);
    const err = new Error(`Sheets取得失敗: ${e.message}`); err.status = 502; throw err;
  }
  if (values.length < 2) {
    await markSync('error', 'シートが空、またはヘッダーのみ');
    return { totalRows: 0, kept: 0, inserted: 0, updated: 0 };
  }
  const { records, stats } = parseJobPostingsSheet(values);
  const up = await upsertRecords(records);
  const msg = `keep=${stats.kept} (notKeep=${stats.skippedNotKeep}, noKey=${stats.skippedNoKey}, バラシ=${stats.cancelledCount}) / ins=${up.inserted}, upd=${up.updated}`;
  await markSync('ok', msg);
  return { ...stats, ...up };
}

async function list({ month, filter, limit = 2000 } = {}) {
  const pool = getPool();
  const where = [`source_kind = '${SOURCE_KIND_KEEP}'`]; const params = [];
  if (month) {
    where.push(`acquired_date >= ?`); params.push(month);
    where.push(`acquired_date < DATE_ADD(?, INTERVAL 1 MONTH)`); params.push(month);
  }
  if (filter === 'cancelled') where.push(`is_cancelled = 1`);
  const whereSql = 'WHERE ' + where.join(' AND ');
  const [rows] = await pool.query(
    `SELECT id, external_key, acquired_date, job_number, company_name, sales_owner,
            industry, source_kind, status_label, is_cancelled, source_row
       FROM job_postings_v2 ${whereSql}
      ORDER BY COALESCE(NULLIF(job_number, ''), company_name) ASC,
               acquired_date DESC, id DESC
      LIMIT ?`,
    [...params, Math.min(Number(limit) || 2000, 10000)]
  );
  return rows;
}

module.exports = {
  parseJobPostingsSheet, upsertRecords, syncFromSheets, list,
  getConfig, updateConfig, cleanSalesOwner, COL,
};
