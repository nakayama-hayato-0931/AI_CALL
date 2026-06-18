/**
 * cpa-v2: 売上案件マスタ (sales_projects_v2)
 *   - シート『ビザ申請 進捗』から内定案件を取り込む
 *   - 抽出条件: BE列='架電バイト' AND J列≠'ビザ'  (fax-crm 側の 'FAX受電' に相当する callcenter 側 keep 条件)
 *   - 列マッピング: fax-crm 実装と同一 (列番号は固定)
 *       A: 内定日、B: 求人番号、E: 営業担当、G: 登録番号、J: ステータス
 *       BD: 会社名、BE: 案件区分('架電バイト')
 *       BI: 初回入金 (×10000)、BJ: 見込売上 (×10000)、BK: 案件取得日
 *       CC: 入金実績 (×10000)、CF: 業種
 */
const {
  SOURCE_KIND_KEEP, getPool, colIndex,
  parseDateCell, parseMoneyTimes10000, clean, fetchSheetValues,
} = require('./_common');

const COL = {
  A:  colIndex('A'),   B:  colIndex('B'),   E:  colIndex('E'),
  G:  colIndex('G'),   J:  colIndex('J'),   BD: colIndex('BD'),
  BE: colIndex('BE'),  BI: colIndex('BI'),  BJ: colIndex('BJ'),
  BK: colIndex('BK'),  CC: colIndex('CC'),  CF: colIndex('CF'),
};

function parseProjectsSheet(values) {
  const projects = [];
  const stats = { totalRows: 0, kept: 0, skippedNotKeep: 0, skippedVisa: 0, skippedNoKey: 0 };

  for (let r = 1; r < values.length; r++) {
    const row = values[r] || [];
    stats.totalRows++;

    const beVal = clean(row[COL.BE]);
    const jVal  = clean(row[COL.J]);

    if (beVal !== SOURCE_KIND_KEEP) { stats.skippedNotKeep++; continue; }
    if (jVal === 'ビザ')             { stats.skippedVisa++;    continue; }

    const jobNumber = clean(row[COL.B]);
    const candidateNo = clean(row[COL.G]);
    let externalKey;
    if (jobNumber && candidateNo) externalKey = `${jobNumber}_${candidateNo}`;
    else if (jobNumber)            externalKey = jobNumber;
    else if (candidateNo)          externalKey = candidateNo;
    else { stats.skippedNoKey++; continue; }

    const isCancelled = jVal === '取消';
    const isDeclined  = jVal === '辞退';
    const zeroMoney   = isCancelled || isDeclined;

    projects.push({
      external_key: externalKey,
      offer_date:    parseDateCell(row[COL.A]),
      acquired_date: parseDateCell(row[COL.BK]),
      job_number:    jobNumber,
      company_name:  clean(row[COL.BD]),
      candidate_registration_no: candidateNo,
      sales_owner:   clean(row[COL.E]),
      industry:      clean(row[COL.CF]),
      first_payment:    zeroMoney ? 0 : parseMoneyTimes10000(row[COL.BI]),
      expected_revenue: zeroMoney ? 0 : parseMoneyTimes10000(row[COL.BJ]),
      payment_actual:   parseMoneyTimes10000(row[COL.CC]),
      status_label:  jVal,
      is_cancelled:  isCancelled ? 1 : 0,
      is_declined:   isDeclined ? 1 : 0,
      source_row:    r + 1,
    });
    stats.kept++;
  }
  return { projects, stats };
}

async function upsertProjects(projects) {
  if (!projects.length) return { inserted: 0, updated: 0 };
  const pool = getPool();
  const conn = await pool.getConnection();
  let inserted = 0, updated = 0;
  try {
    for (const p of projects) {
      const [result] = await conn.query(
        `INSERT INTO sales_projects_v2 (
          external_key, offer_date, acquired_date, job_number, company_name,
          candidate_registration_no, sales_owner, industry,
          first_payment, expected_revenue, payment_actual,
          status_label, is_cancelled, is_declined,
          source_row, synced_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, DATE_ADD(UTC_TIMESTAMP(), INTERVAL 9 HOUR))
        ON DUPLICATE KEY UPDATE
          offer_date = VALUES(offer_date),
          acquired_date = VALUES(acquired_date),
          job_number = VALUES(job_number),
          company_name = VALUES(company_name),
          candidate_registration_no = VALUES(candidate_registration_no),
          sales_owner = VALUES(sales_owner),
          industry = VALUES(industry),
          first_payment = VALUES(first_payment),
          expected_revenue = VALUES(expected_revenue),
          payment_actual = VALUES(payment_actual),
          status_label = VALUES(status_label),
          is_cancelled = VALUES(is_cancelled),
          is_declined = VALUES(is_declined),
          source_row = VALUES(source_row),
          synced_at = DATE_ADD(UTC_TIMESTAMP(), INTERVAL 9 HOUR)`,
        [
          p.external_key, p.offer_date, p.acquired_date, p.job_number, p.company_name,
          p.candidate_registration_no, p.sales_owner, p.industry,
          p.first_payment, p.expected_revenue, p.payment_actual,
          p.status_label, p.is_cancelled, p.is_declined, p.source_row,
        ]
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
    `SELECT projects_sheet_id, projects_sheet_name, projects_sheet_range,
            projects_last_synced_at, projects_last_sync_status, projects_last_sync_message
       FROM sheets_config_v2 WHERE id = 1 LIMIT 1`
  );
  return rows[0] || null;
}

async function updateConfig({ projects_sheet_id, projects_sheet_name, projects_sheet_range }) {
  const pool = getPool();
  await pool.query(
    `INSERT INTO sheets_config_v2 (id, projects_sheet_id, projects_sheet_name, projects_sheet_range)
     VALUES (1, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       projects_sheet_id    = VALUES(projects_sheet_id),
       projects_sheet_name  = VALUES(projects_sheet_name),
       projects_sheet_range = VALUES(projects_sheet_range)`,
    [
      projects_sheet_id    || null,
      projects_sheet_name  || 'ビザ申請 進捗',
      projects_sheet_range || 'A1:CZ20000',
    ]
  );
  return getConfig();
}

async function markSync(status, message) {
  const pool = getPool();
  await pool.query(
    `UPDATE sheets_config_v2 SET
       projects_last_synced_at    = DATE_ADD(UTC_TIMESTAMP(), INTERVAL 9 HOUR),
       projects_last_sync_status  = ?,
       projects_last_sync_message = ?
     WHERE id = 1`,
    [status, message || null]
  );
}

async function syncFromSheets() {
  const cfg = await getConfig();
  if (!cfg?.projects_sheet_id) {
    const err = new Error('案件シートIDが未設定です'); err.status = 400; err.code = 'NO_SHEET_ID';
    throw err;
  }
  let values;
  try {
    values = await fetchSheetValues({
      spreadsheetId: cfg.projects_sheet_id,
      sheetName:     cfg.projects_sheet_name  || 'ビザ申請 進捗',
      rangePart:     cfg.projects_sheet_range || 'A1:CZ20000',
    });
  } catch (e) {
    await markSync('error', e.message);
    const err = new Error(`Sheets取得失敗: ${e.message}`); err.status = 502;
    throw err;
  }
  if (values.length < 2) {
    await markSync('error', 'シートが空、またはヘッダーのみ');
    return { totalRows: 0, kept: 0, inserted: 0, updated: 0 };
  }
  const { projects, stats } = parseProjectsSheet(values);
  const up = await upsertProjects(projects);
  const msg = `keep=${stats.kept} (notKeep=${stats.skippedNotKeep}, visa=${stats.skippedVisa}, noKey=${stats.skippedNoKey}) / ins=${up.inserted}, upd=${up.updated}`;
  await markSync('ok', msg);
  return { ...stats, ...up };
}

async function list({ from, to, month, basis = 'acquired', status, limit = 200 } = {}) {
  const pool = getPool();
  const dateCol = basis === 'offer' ? 'sp.offer_date' : 'sp.acquired_date';
  const where = []; const params = [];
  if (month) {
    where.push(`${dateCol} >= ?`); params.push(month);
    where.push(`${dateCol} < DATE_ADD(?, INTERVAL 1 MONTH)`); params.push(month);
  } else {
    if (from) { where.push(`${dateCol} >= ?`); params.push(from); }
    if (to)   { where.push(`${dateCol} <= ?`); params.push(to); }
  }
  if (status === 'active')    where.push('sp.is_cancelled = 0 AND sp.is_declined = 0');
  else if (status === 'cancelled') where.push('sp.is_cancelled = 1');
  else if (status === 'declined')  where.push('sp.is_declined = 1');
  const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';
  // caller_name: 求人番号で callcenter.projects→users.name から架電担当者を解決
  const [rows] = await pool.query(
    `SELECT sp.id, sp.external_key, sp.offer_date, sp.acquired_date, sp.job_number, sp.company_name,
            sp.candidate_registration_no, sp.sales_owner, sp.industry,
            sp.first_payment, sp.expected_revenue, sp.payment_actual,
            sp.status_label, sp.is_cancelled, sp.is_declined, sp.source_row,
            (SELECT u.name FROM projects p JOIN users u ON u.id = p.owner_user_id
              WHERE p.job_number = sp.job_number AND p.is_legacy = 0 AND p.owner_user_id IS NOT NULL
              ORDER BY p.created_at DESC LIMIT 1) AS caller_name
       FROM sales_projects_v2 sp ${whereSql}
      ORDER BY COALESCE(NULLIF(sp.job_number, ''), sp.company_name) ASC,
               ${dateCol} DESC, sp.id DESC
      LIMIT ?`,
    [...params, Math.min(Number(limit) || 200, 1000)]
  );
  return rows;
}

module.exports = {
  parseProjectsSheet, upsertProjects, syncFromSheets, list,
  getConfig, updateConfig, COL,
};
