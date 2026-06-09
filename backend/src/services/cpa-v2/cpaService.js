/**
 * cpa-v2: 月別 CPA 集計 (KPI のみ)
 *
 * fax-crm の cpaService.js を移植したもの。
 * 違い: コスト系 (fax_send_stats / outsourced_fax_records / zp_recordings /
 *       cpa_monthly_costs) は callcenter 側で「架電バイト人件費」モデルに
 *       置き換える想定で Phase 2 以降に分離。本ファイルでは集計コア
 *       (offers / first_payment / expected_revenue / payment_actual /
 *        interviews / rejects / projects / cancels) のみ。
 * source_kind は '架電バイト' (callcenter 側 keep)。
 */
const { SOURCE_KIND_KEEP, getPool } = require('./_common');

/**
 * basis から日付列を返す。
 *   acquired (既定): sales_projects.acquired_date / interview_records.acquired_date
 *   offer            : sales_projects.offer_date    / interview_records.interview_date
 */
function basisColumns(basis) {
  if (basis === 'offer') {
    return { col: 'offer_date', ivCol: 'interview_date' };
  }
  return { col: 'acquired_date', ivCol: 'acquired_date' };
}

/**
 * 月別 KPI を返す。
 * @param {object} opts
 *   - basis  : 'acquired' (default) / 'offer'
 *   - months : 返却件数の上限 (default 24)
 */
async function getMonthly({ basis = 'acquired', months = 24 } = {}) {
  const pool = getPool();
  const { col, ivCol } = basisColumns(basis);
  const limit = Math.min(Number(months) || 24, 60);

  // 派生指標は SQL 側ではなく JS 側で生成 (NULL 安全に)
  const sql = `
    SELECT
      m.month                                                       AS month,
      COALESCE(jp.projects,         0) AS projects,
      COALESCE(jp.cancels,          0) AS cancels,
      COALESCE(iv.interviews,       0) AS interviews,
      COALESCE(ir.rejects,          0) AS rejects,
      COALESCE(sp.offers,           0) AS offers,
      COALESCE(sp.first_payment,    0) AS first_payment,
      COALESCE(sp.expected_revenue, 0) AS expected_revenue,
      COALESCE(sp.payment_actual,   0) AS payment_actual
    FROM (
      SELECT DISTINCT month FROM (
        SELECT DATE_FORMAT(${col},  '%Y-%m-01') AS month
          FROM sales_projects_v2 WHERE ${col} IS NOT NULL
        UNION
        SELECT DATE_FORMAT(${ivCol}, '%Y-%m-01') AS month
          FROM interview_records_v2
         WHERE ${ivCol} IS NOT NULL AND source_kind = ? AND interview_date <= CURDATE()
        UNION
        SELECT DATE_FORMAT(acquired_date, '%Y-%m-01') AS month
          FROM job_postings_v2
         WHERE acquired_date IS NOT NULL AND source_kind = ?
      ) u WHERE month IS NOT NULL
    ) m
    LEFT JOIN (
      SELECT month, COUNT(DISTINCT job_key) AS interviews
      FROM (
        SELECT DATE_FORMAT(${ivCol}, '%Y-%m-01') AS month,
               COALESCE(NULLIF(job_number, ''), company_name) AS job_key
          FROM interview_records_v2
         WHERE ${ivCol} IS NOT NULL AND source_kind = ?
           AND interview_date <= CURDATE()
           AND NOT (interview_count = 0 AND (pass_count = 0 OR pass_count IS NULL))
        UNION
        SELECT DATE_FORMAT(${col}, '%Y-%m-01') AS month,
               COALESCE(NULLIF(job_number, ''), company_name) AS job_key
          FROM sales_projects_v2 WHERE ${col} IS NOT NULL
      ) u
      WHERE month IS NOT NULL AND job_key IS NOT NULL
      GROUP BY month
    ) iv ON iv.month = m.month
    LEFT JOIN (
      SELECT DATE_FORMAT(${ivCol}, '%Y-%m-01') AS month,
             COUNT(DISTINCT COALESCE(NULLIF(job_number, ''), company_name)) AS rejects
        FROM interview_records_v2
       WHERE ${ivCol} IS NOT NULL AND source_kind = ?
         AND interview_date <= CURDATE()
         AND NOT (interview_count = 0 AND (pass_count = 0 OR pass_count IS NULL))
         AND (pass_count = 0
              OR (pass_count IS NULL AND interview_date <= DATE_SUB(CURDATE(), INTERVAL 1 MONTH)))
       GROUP BY 1
    ) ir ON ir.month = m.month
    LEFT JOIN (
      SELECT DATE_FORMAT(${col}, '%Y-%m-01') AS month,
             COUNT(DISTINCT COALESCE(NULLIF(job_number, ''), company_name)) AS offers,
             SUM(first_payment)    AS first_payment,
             SUM(expected_revenue) AS expected_revenue,
             SUM(payment_actual)   AS payment_actual
        FROM sales_projects_v2 WHERE ${col} IS NOT NULL
       GROUP BY 1
    ) sp ON sp.month = m.month
    LEFT JOIN (
      SELECT DATE_FORMAT(acquired_date, '%Y-%m-01') AS month,
             COUNT(*) AS projects,
             SUM(CASE WHEN is_cancelled = 1 THEN 1 ELSE 0 END) AS cancels
        FROM job_postings_v2
       WHERE acquired_date IS NOT NULL AND source_kind = ?
       GROUP BY 1
    ) jp ON jp.month = m.month
    WHERE m.month <= DATE_FORMAT(CURDATE(), '%Y-%m-01')
    ORDER BY m.month DESC
    LIMIT ?`;

  const [rows] = await pool.query(sql, [
    SOURCE_KIND_KEEP, SOURCE_KIND_KEEP, SOURCE_KIND_KEEP, SOURCE_KIND_KEEP, SOURCE_KIND_KEEP, limit,
  ]);

  // 派生指標を JS で追加
  return rows.map(r => {
    const offers = Number(r.offers) || 0;
    const interviews = Number(r.interviews) || 0;
    const projects = Number(r.projects) || 0;
    return {
      ...r,
      offer_rate:     interviews > 0 ? Math.round(offers / interviews * 10000) / 100 : 0,
      interview_rate: projects   > 0 ? Math.round(interviews / projects * 10000) / 100 : 0,
    };
  });
}

module.exports = { getMonthly, basisColumns };
