/**
 * fax-crm-system への共通イベント書き込みクライアント。
 *   - callcenter で発生したイベント(架電結果など)を fax-crm の contact_events に POST
 *   - 失敗は呼び出し側で握りつぶす設計(本処理を阻害しない)
 *
 * 必要な環境変数:
 *   FAX_CRM_API_URL=https://fax-crm-backend-production.up.railway.app
 *   (未設定なら no-op で OK を返す)
 *
 * fax-crm 側の受け口:
 *   POST /api/contact-events
 *   body: { lookup: { external_callcenter_id }, channel, event_type, occurred_at,
 *           source_system: 'callcenter-ai', source_event_id, operator_name, memo, ...}
 *
 * 詳細仕様: fax-crm-system/docs/SHARED_CUSTOMER_MASTER.md
 */
const logger = require('../utils/logger');

const DEFAULT_TIMEOUT_MS = 5000;

// callcenter の result_code → fax-crm の event_type マッピング
const RESULT_CODE_TO_EVENT_TYPE = {
  NO_ANSWER:  'no_answer',
  NG:         'ng',
  RECALL:     'recall',
  INTERESTED: 'interested',
  PROJECT:    'project',
  SKIP:       'skip',
};

function isEnabled() {
  return !!process.env.FAX_CRM_API_URL;
}

function endpoint(path) {
  const base = (process.env.FAX_CRM_API_URL || '').replace(/\/+$/, '');
  return `${base}${path}`;
}

/**
 * 汎用 contact_events POST
 * @returns {Promise<{ok: boolean, status?: number, body?: any, error?: string}>}
 */
async function postContactEvent(payload) {
  if (!isEnabled()) {
    return { ok: false, skipped: true, reason: 'FAX_CRM_API_URL not set' };
  }
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), DEFAULT_TIMEOUT_MS);
  try {
    const resp = await fetch(endpoint('/api/contact-events'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: ctrl.signal,
    });
    const text = await resp.text();
    let body;
    try { body = JSON.parse(text); } catch (_e) { body = text; }
    if (!resp.ok) {
      return { ok: false, status: resp.status, body };
    }
    return { ok: true, status: resp.status, body };
  } catch (e) {
    return { ok: false, error: e.message };
  } finally {
    clearTimeout(t);
  }
}

/**
 * 通話結果(endCall)を fax-crm に通知するヘルパ
 *   - call_id を source_event_id にして冪等性を担保
 *   - 失敗はログだけ出して握りつぶす
 */
async function notifyCallResult({ callId, companyId, resultCode, callStartedAt, operatorEmail, memo }) {
  if (!isEnabled()) {
    logger.debug('[faxCrmClient] FAX_CRM_API_URL 未設定。通知スキップ');
    return { ok: true, skipped: true };
  }
  const eventType = RESULT_CODE_TO_EVENT_TYPE[resultCode] || 'other';
  const payload = {
    lookup: { external_callcenter_id: companyId },
    channel: 'call',
    event_type: eventType,
    occurred_at: callStartedAt instanceof Date
      ? callStartedAt.toISOString()
      : (callStartedAt || new Date().toISOString()),
    source_system: 'callcenter-ai',
    source_event_id: callId,
    operator_name: operatorEmail || null,
    result_label: resultCode || null,
    memo: memo || null,
  };
  const result = await postContactEvent(payload);
  if (result.ok) {
    logger.info(`[faxCrmClient] 通話結果通知OK call=${callId} company=${companyId} type=${eventType}`);
  } else if (result.skipped) {
    // no-op
  } else {
    logger.warn(`[faxCrmClient] 通話結果通知失敗 call=${callId}: ${result.error || JSON.stringify(result.body)}`);
  }
  return result;
}

module.exports = {
  isEnabled,
  postContactEvent,
  notifyCallResult,
  RESULT_CODE_TO_EVENT_TYPE,
};
