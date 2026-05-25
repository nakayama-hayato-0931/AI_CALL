/**
 * fax-crm からのリアルタイム webhook 受け口。
 * fax-crm 側で FAX 送信などのイベントが発生したときに、ここに POST してもらう想定。
 *
 * 認証: HTTP ヘッダ `X-Webhook-Secret` と環境変数 `FAX_CRM_WEBHOOK_SECRET` の一致をチェック。
 *
 * Payload (fax-crm 側の contact_event とほぼ同じ):
 * {
 *   lookup: { external_callcenter_id: "<companies.id>" },
 *   channel: 'fax' | 'call' | 'other',
 *   event_type: 'fax_sent' | 'fax_received' | ...,
 *   occurred_at: ISO8601,
 *   source_event_id: "<fax-crm 側のイベントID>",
 *   operator_name: string,
 *   result_label: string,
 *   memo: string
 * }
 *
 * 冪等性: 既存の取込と同じく `[fax-crm:<source_event_id>]` タグで重複スキップ。
 */
const pool = require('../../config/database');
const ApiResponse = require('../utils/apiResponse');
const logger = require('../utils/logger');

function verifySecret(req) {
  const expected = process.env.FAX_CRM_WEBHOOK_SECRET;
  if (!expected) return { ok: false, reason: 'FAX_CRM_WEBHOOK_SECRET 未設定' };
  const got = req.headers['x-webhook-secret'];
  if (!got || got !== expected) return { ok: false, reason: 'invalid secret' };
  return { ok: true };
}

/**
 * POST /api/integrations/faxcrm/event
 * 単発イベント受信
 */
async function receiveEvent(req, res) {
  try {
    const v = verifySecret(req);
    if (!v.ok) {
      logger.warn(`[faxCrmWebhook] auth失敗: ${v.reason}`);
      return ApiResponse.unauthorized(res, '認証に失敗しました');
    }

    const ev = req.body || {};
    const companyId = ev?.lookup?.external_callcenter_id;
    if (!companyId) return ApiResponse.error(res, 'lookup.external_callcenter_id が必須です', 400);

    // 企業が存在するか
    const [rows] = await pool.execute(`SELECT id FROM companies WHERE id = ?`, [companyId]);
    if (rows.length === 0) {
      // 存在しない企業のイベントは無視（ログに記録のみ）
      logger.warn(`[faxCrmWebhook] 未知の company_id=${companyId} のイベントをスキップ`);
      return ApiResponse.success(res, { skipped: true, reason: 'unknown_company' });
    }

    const tag = `[fax-crm:${ev.id || ev.source_event_id || ''}]`;
    const [exist] = await pool.query(
      `SELECT id FROM company_actions WHERE company_id = ? AND memo LIKE ? LIMIT 1`,
      [companyId, `%${tag}%`]
    );
    if (exist.length > 0) {
      return ApiResponse.success(res, { skipped: true, reason: 'duplicate' });
    }

    const actionDate = ev.occurred_at ? new Date(ev.occurred_at) : new Date();
    const actionType = ev.channel === 'fax' ? 'FAX' : (ev.channel || 'OTHER').toUpperCase();
    const result = ev.event_type || ev.result_label || null;
    const memo = `${tag} ${ev.memo || ''}`.trim();
    await pool.query(
      `INSERT INTO company_actions (company_id, user_id, action_date, action_type, result, memo, created_at)
       VALUES (?, NULL, ?, ?, ?, ?, NOW())`,
      [companyId, actionDate, actionType, result, memo]
    );

    await pool.execute(
      `UPDATE companies SET last_synced_from_faxcrm_at = NOW() WHERE id = ?`,
      [companyId]
    );

    logger.info(`[faxCrmWebhook] イベント取込 company=${companyId} type=${actionType}/${result}`);
    return ApiResponse.success(res, { inserted: true, company_id: Number(companyId) });
  } catch (err) {
    logger.error(`[faxCrmWebhook] ${err.message}`);
    return ApiResponse.error(res, err.message, 500);
  }
}

/**
 * POST /api/integrations/faxcrm/events
 * 複数イベント一括受信（fax-crm 側で配信に失敗した時のリトライまとめ送信を想定）
 */
async function receiveEventsBulk(req, res) {
  try {
    const v = verifySecret(req);
    if (!v.ok) return ApiResponse.unauthorized(res, '認証に失敗しました');

    const events = Array.isArray(req.body?.events) ? req.body.events : [];
    if (events.length === 0) return ApiResponse.error(res, 'events が空です', 400);

    let inserted = 0;
    let skipped = 0;
    let invalid = 0;
    const touched = new Set();
    for (const ev of events) {
      const companyId = ev?.lookup?.external_callcenter_id;
      if (!companyId) { invalid++; continue; }
      const [rows] = await pool.execute(`SELECT id FROM companies WHERE id = ?`, [companyId]);
      if (rows.length === 0) { invalid++; continue; }

      const tag = `[fax-crm:${ev.id || ev.source_event_id || ''}]`;
      const [exist] = await pool.query(
        `SELECT id FROM company_actions WHERE company_id = ? AND memo LIKE ? LIMIT 1`,
        [companyId, `%${tag}%`]
      );
      if (exist.length > 0) { skipped++; continue; }

      const actionDate = ev.occurred_at ? new Date(ev.occurred_at) : new Date();
      const actionType = ev.channel === 'fax' ? 'FAX' : (ev.channel || 'OTHER').toUpperCase();
      const result = ev.event_type || ev.result_label || null;
      const memo = `${tag} ${ev.memo || ''}`.trim();
      await pool.query(
        `INSERT INTO company_actions (company_id, user_id, action_date, action_type, result, memo, created_at)
         VALUES (?, NULL, ?, ?, ?, ?, NOW())`,
        [companyId, actionDate, actionType, result, memo]
      );
      inserted++;
      touched.add(companyId);
    }
    if (touched.size > 0) {
      const ids = Array.from(touched);
      const placeholders = ids.map(() => '?').join(',');
      await pool.query(
        `UPDATE companies SET last_synced_from_faxcrm_at = NOW() WHERE id IN (${placeholders})`,
        ids
      );
    }
    return ApiResponse.success(res, { inserted, skipped, invalid, companies_touched: touched.size });
  } catch (err) {
    logger.error(`[faxCrmWebhook bulk] ${err.message}`);
    return ApiResponse.error(res, err.message, 500);
  }
}

/**
 * GET /api/integrations/faxcrm/health
 * fax-crm 側からのヘルスチェック用（secret 必須）
 */
async function health(req, res) {
  const v = verifySecret(req);
  if (!v.ok) return ApiResponse.unauthorized(res, '認証に失敗しました');
  return ApiResponse.success(res, { ok: true, ts: new Date().toISOString() });
}

module.exports = { receiveEvent, receiveEventsBulk, health };
