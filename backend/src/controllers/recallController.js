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
              (SELECT cl.memo FROM calls cl WHERE cl.id = rt.call_id) as call_memo
       FROM recall_tasks rt
       JOIN companies c ON rt.company_id = c.id
       WHERE rt.user_id = ? AND DATE(rt.recall_at) = ? AND rt.status = 'pending'
       ORDER BY rt.recall_at ASC`,
      [userId, today]
    );

    // 明日のリコール
    const [tomorrowRows] = await pool.execute(
      `SELECT rt.*, c.company_name, c.phone_number, c.industry,
              (SELECT cl.memo FROM calls cl WHERE cl.id = rt.call_id) as call_memo
       FROM recall_tasks rt
       JOIN companies c ON rt.company_id = c.id
       WHERE rt.user_id = ? AND DATE(rt.recall_at) = ? AND rt.status = 'pending'
       ORDER BY rt.recall_at ASC`,
      [userId, tomorrow]
    );

    // 期限超過
    const [overdueRows] = await pool.execute(
      `SELECT rt.*, c.company_name, c.phone_number, c.industry,
              (SELECT cl.memo FROM calls cl WHERE cl.id = rt.call_id) as call_memo
       FROM recall_tasks rt
       JOIN companies c ON rt.company_id = c.id
       WHERE rt.user_id = ? AND DATE(rt.recall_at) < ? AND rt.status = 'pending'
       ORDER BY rt.recall_at ASC`,
      [userId, today]
    );

    return ApiResponse.success(res, {
      today: todayRows,
      tomorrow: tomorrowRows,
      overdue: overdueRows,
      counts: {
        today: todayRows.length,
        tomorrow: tomorrowRows.length,
        overdue: overdueRows.length,
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

module.exports = { getRecalls, completeRecall, cancelRecall };
