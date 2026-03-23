/**
 * リコールコントローラー
 * リコールタスクの取得・完了・期限超過管理
 */
const pool = require('../../config/database');
const ApiResponse = require('../utils/apiResponse');

/**
 * GET /api/recalls
 * リコールタスク一覧 (今日・明日・期限超過)
 */
const getRecalls = async (req, res, next) => {
  try {
    const userId = req.query.user_id || req.user.id;
    const today = new Date().toISOString().slice(0, 10);
    const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);

    // 今日のリコール
    const [todayRows] = await pool.execute(
      `SELECT rt.*, c.company_name, c.phone_number, c.industry,
              (SELECT cl.memo FROM calls cl WHERE cl.id = rt.call_id) as call_memo,
              (SELECT cl.transcript FROM calls cl WHERE cl.id = rt.call_id) as call_transcript
       FROM recall_tasks rt
       JOIN companies c ON rt.company_id = c.id
       WHERE rt.user_id = ? AND DATE(rt.recall_at) = ? AND rt.status = 'pending'
       ORDER BY rt.recall_at ASC`,
      [userId, today]
    );

    // 明日のリコール
    const [tomorrowRows] = await pool.execute(
      `SELECT rt.*, c.company_name, c.phone_number, c.industry,
              (SELECT cl.memo FROM calls cl WHERE cl.id = rt.call_id) as call_memo,
              (SELECT cl.transcript FROM calls cl WHERE cl.id = rt.call_id) as call_transcript
       FROM recall_tasks rt
       JOIN companies c ON rt.company_id = c.id
       WHERE rt.user_id = ? AND DATE(rt.recall_at) = ? AND rt.status = 'pending'
       ORDER BY rt.recall_at ASC`,
      [userId, tomorrow]
    );

    // 期限超過
    const [overdueRows] = await pool.execute(
      `SELECT rt.*, c.company_name, c.phone_number, c.industry,
              (SELECT cl.memo FROM calls cl WHERE cl.id = rt.call_id) as call_memo,
              (SELECT cl.transcript FROM calls cl WHERE cl.id = rt.call_id) as call_transcript
       FROM recall_tasks rt
       JOIN companies c ON rt.company_id = c.id
       WHERE rt.user_id = ? AND DATE(rt.recall_at) < ? AND rt.status = 'pending'
       ORDER BY rt.recall_at ASC`,
      [userId, today]
    );

    // 将来のリコール (明後日以降)
    const [futureRows] = await pool.execute(
      `SELECT rt.*, c.company_name, c.phone_number, c.industry,
              (SELECT cl.memo FROM calls cl WHERE cl.id = rt.call_id) as call_memo,
              (SELECT cl.transcript FROM calls cl WHERE cl.id = rt.call_id) as call_transcript,
              'future_recall' as source_type
       FROM recall_tasks rt
       JOIN companies c ON rt.company_id = c.id
       WHERE rt.user_id = ? AND DATE(rt.recall_at) > ? AND rt.status = 'pending'
       ORDER BY rt.recall_at ASC`,
      [userId, tomorrow]
    );

    // 興味あり通話
    const [interestedRows] = await pool.execute(
      `SELECT cl.id, cl.company_id, cl.call_started_at as recall_at,
              cl.memo as call_memo, cl.transcript as call_transcript,
              c.company_name, c.phone_number, c.industry,
              'interested' as source_type
       FROM calls cl
       JOIN companies c ON cl.company_id = c.id
       WHERE cl.user_id = ? AND cl.result_code = 'INTERESTED'
       ORDER BY cl.call_started_at DESC`,
      [userId]
    );

    return ApiResponse.success(res, {
      today: todayRows,
      tomorrow: tomorrowRows,
      overdue: overdueRows,
      other: [...futureRows, ...interestedRows],
      counts: {
        today: todayRows.length,
        tomorrow: tomorrowRows.length,
        overdue: overdueRows.length,
        other: futureRows.length + interestedRows.length,
      },
    });
  } catch (err) {
    next(err);
  }
};

/**
 * PUT /api/recalls/:id/complete
 * リコールタスク完了
 */
const completeRecall = async (req, res, next) => {
  try {
    const { id } = req.params;

    const [result] = await pool.execute(
      `UPDATE recall_tasks SET status = 'completed' WHERE id = ? AND user_id = ?`,
      [id, req.user.id]
    );

    if (result.affectedRows === 0) {
      return ApiResponse.notFound(res, 'リコールタスクが見つかりません');
    }

    return ApiResponse.success(res, null, 'リコールを完了しました');
  } catch (err) {
    next(err);
  }
};

/**
 * PUT /api/recalls/:id/cancel
 * リコールタスクキャンセル
 */
const cancelRecall = async (req, res, next) => {
  try {
    const { id } = req.params;

    const [result] = await pool.execute(
      `UPDATE recall_tasks SET status = 'cancelled' WHERE id = ? AND user_id = ?`,
      [id, req.user.id]
    );

    if (result.affectedRows === 0) {
      return ApiResponse.notFound(res, 'リコールタスクが見つかりません');
    }

    return ApiResponse.success(res, null, 'リコールをキャンセルしました');
  } catch (err) {
    next(err);
  }
};

/**
 * PUT /api/recalls/:id/reschedule
 * リコール日時変更
 */
const rescheduleRecall = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { recall_at } = req.body;

    if (!recall_at) {
      return ApiResponse.badRequest(res, 'リコール日時を指定してください');
    }

    const [result] = await pool.execute(
      `UPDATE recall_tasks SET recall_at = ? WHERE id = ? AND user_id = ? AND status = 'pending'`,
      [recall_at, id, req.user.id]
    );

    if (result.affectedRows === 0) {
      return ApiResponse.notFound(res, 'リコールタスクが見つかりません');
    }

    return ApiResponse.success(res, null, 'リコール日時を変更しました');
  } catch (err) {
    next(err);
  }
};

module.exports = { getRecalls, completeRecall, cancelRecall, rescheduleRecall };
