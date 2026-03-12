/**
 * 通話ログコントローラー
 * Google Sheetsから通話ログを検索・表示
 */
const pool = require('../../config/database');
const ApiResponse = require('../utils/apiResponse');
const { searchCallLogs } = require('../services/googleSheetsService');
const logger = require('../utils/logger');

/**
 * GET /api/logs/search?phone=電話番号
 * 電話番号で通話ログを検索
 * Google Sheets + DB両方から取得
 */
const searchLogs = async (req, res, next) => {
  try {
    const { phone } = req.query;

    if (!phone) {
      return ApiResponse.badRequest(res, '電話番号を入力してください');
    }

    // DB内の通話履歴
    const [dbCalls] = await pool.execute(
      `SELECT c.*, u.name as operator_name, co.company_name,
              ae.overall_score, ae.summary as ai_summary,
              ae.good_points, ae.improvement_points
       FROM calls c
       LEFT JOIN users u ON c.user_id = u.id
       LEFT JOIN companies co ON c.company_id = co.id
       LEFT JOIN ai_evaluations ae ON ae.call_id = c.id
       WHERE co.phone_number LIKE ?
       ORDER BY c.call_started_at DESC
       LIMIT 50`,
      [`%${phone}%`]
    );

    // Google Sheetsからも検索
    let sheetLogs = [];
    try {
      sheetLogs = await searchCallLogs(phone);
    } catch (err) {
      // Google Sheets連携エラーは警告のみ (DBデータは返す)
      logger.warn('Google Sheets検索スキップ:', err.message);
    }

    return ApiResponse.success(res, {
      dbCalls,
      sheetLogs,
      totalDbCalls: dbCalls.length,
      totalSheetLogs: sheetLogs.length,
    });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/logs/daily?date=YYYY-MM-DD
 * GET /api/logs/daily?dateFrom=YYYY-MM-DD&dateTo=YYYY-MM-DD
 * 日付別 or 期間別の架電一覧を取得（ログインユーザーの架電データ + AI評価）
 */
const getDailyCalls = async (req, res, next) => {
  try {
    const { date, dateFrom, dateTo } = req.query;
    const userId = req.user.id;

    if (!date && (!dateFrom || !dateTo)) {
      return ApiResponse.badRequest(res, '日付または期間を指定してください');
    }

    let dateCondition, queryParams;
    if (dateFrom && dateTo) {
      dateCondition = 'DATE(c.call_started_at) BETWEEN ? AND ?';
      queryParams = [userId, dateFrom, dateTo];
    } else {
      dateCondition = 'DATE(c.call_started_at) = ?';
      queryParams = [userId, date];
    }

    const [calls] = await pool.query(
      `SELECT c.*, co.company_name, co.industry, co.region, co.phone_number,
              u.name as operator_name,
              ae.id as evaluation_id, ae.overall_score, ae.opening_score,
              ae.clarity_score, ae.hearing_score, ae.rebuttal_score, ae.closing_score,
              ae.summary, ae.good_points, ae.improvement_points, ae.next_improvement
       FROM calls c
       LEFT JOIN companies co ON c.company_id = co.id
       LEFT JOIN users u ON c.user_id = u.id
       LEFT JOIN ai_evaluations ae ON ae.call_id = c.id
       WHERE c.user_id = ? AND ${dateCondition}
       ORDER BY c.call_started_at ASC`,
      queryParams
    );

    return ApiResponse.success(res, {
      calls,
      date: date || `${dateFrom}〜${dateTo}`,
      totalCalls: calls.length,
    });
  } catch (err) {
    next(err);
  }
};

module.exports = { searchLogs, getDailyCalls };
