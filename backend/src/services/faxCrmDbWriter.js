/**
 * Phase 2: callcenter の company 変更を fax-crm DB にシャドー二重書き込み。
 *
 *   - fax-crm.customers に upsert
 *   - 紐付けキー優先: external_callcenter_id (fax-crm 側) = callcenter.companies.id
 *                  → company.external_faxcrm_id (callcenter 側) = fax-crm.customers.id
 *                  → 無ければ INSERT (callcenter 側 external_faxcrm_id に書き戻し)
 *   - fire-and-forget: fax-crm が落ちていても callcenter 本処理は止めない
 *
 * 仕様詳細: docs/UNIFIED_CUSTOMER_SCHEMA.md
 */
const faxDb = require('../../config/faxCrmDb');
const pool = require('../../config/database');
const logger = require('../utils/logger');

function isEnabled() { return faxDb.isConfigured(); }

/**
 * callcenter.companies の 1 行を受け取り、fax-crm.customers に upsert する。
 *
 * @param {object} company callcenter.companies の行 (全カラム想定)
 * @returns {Promise<{ok, action?, faxId?, error?, skipped?}>}
 */
async function upsertToFaxCrm(company) {
  if (!isEnabled()) return { ok: false, skipped: true, reason: 'FAXCRM_DB 未設定' };
  if (!company || !company.id) return { ok: false, skipped: true, reason: 'company.id 無し' };

  const fp = faxDb.getPool();
  const conn = await fp.getConnection();
  try {
    // 既存検索: external_faxcrm_id (callcenter が知ってる fax-crm id) → external_callcenter_id (逆参照)
    let faxId = null;
    if (company.external_faxcrm_id) {
      const [r] = await conn.query(
        'SELECT id FROM customers WHERE id = ? LIMIT 1',
        [company.external_faxcrm_id]
      );
      if (r[0]) faxId = r[0].id;
    }
    if (!faxId) {
      const [r] = await conn.query(
        'SELECT id FROM customers WHERE external_callcenter_id = ? LIMIT 1',
        [company.id]
      );
      if (r[0]) faxId = r[0].id;
    }

    const cols = {
      company_name:       company.company_name || '(未設定)',
      phone_number:       company.phone_number || null,
      fax_number:         company.fax_number || null,
      industry:           company.industry || null,
      industry_category:  company.industry_category || null,
      prefecture:         company.prefecture || null,
      city:               company.city || null,
      address:            company.address || null,
      postal_code:        company.postal_code || null,
      url:                company.url || null,
      employee_count:     company.employee_count || null,
      representative:     company.representative || null,
      note:               company.note || null,
      is_blacklisted:     company.is_blacklisted ? 1 : 0,
      blacklisted_reason: company.blacklisted_reason || null,
      external_callcenter_id: company.id,
    };

    if (faxId) {
      const setCols = Object.keys(cols).map(k => `${k} = ?`).join(', ');
      await conn.query(
        `UPDATE customers SET ${setCols} WHERE id = ?`,
        [...Object.values(cols), faxId]
      );
    } else {
      const colNames = Object.keys(cols).join(', ');
      const ph = Object.keys(cols).map(() => '?').join(', ');
      const [ins] = await conn.query(
        `INSERT INTO customers (${colNames}, imported_at, source_file)
         VALUES (${ph}, NOW(), 'callcenter-shadow')`,
        Object.values(cols)
      );
      faxId = ins.insertId;
    }

    // callcenter 側にも external_faxcrm_id を書き戻す (未設定の場合のみ)
    if (!company.external_faxcrm_id && faxId) {
      try {
        await pool.execute(
          'UPDATE companies SET external_faxcrm_id = ? WHERE id = ? AND external_faxcrm_id IS NULL',
          [faxId, company.id]
        );
      } catch (e) {
        logger.warn(`[faxCrmDbWriter] external_faxcrm_id 書き戻し失敗 cc.id=${company.id}: ${e.message}`);
      }
    }

    return { ok: true, action: company.external_faxcrm_id || faxId ? 'updated' : 'created', faxId };
  } catch (e) {
    logger.warn(`[faxCrmDbWriter] upsert失敗 cc.id=${company.id}: ${e.message}`);
    return { ok: false, error: e.message };
  } finally {
    conn.release();
  }
}

/**
 * fire-and-forget 版 (callcenter 本処理は止めない)
 * @param {number} companyId callcenter.companies.id
 */
function shadowUpsertById(companyId) {
  if (!isEnabled() || !companyId) return;
  pool.query('SELECT * FROM companies WHERE id = ? LIMIT 1', [companyId])
    .then(([rows]) => {
      if (!rows[0]) return;
      return upsertToFaxCrm(rows[0]);
    })
    .then((r) => {
      if (!r) return;
      if (r.ok) logger.info(`[faxCrmDbWriter] shadow OK cc.id=${companyId} fax.id=${r.faxId}`);
      else if (!r.skipped) logger.warn(`[faxCrmDbWriter] shadow NG cc.id=${companyId}: ${r.error}`);
    })
    .catch((e) => logger.warn(`[faxCrmDbWriter] exception cc.id=${companyId}: ${e.message}`));
}

module.exports = {
  isEnabled,
  upsertToFaxCrm,
  shadowUpsertById,
};
