/**
 * AI分析コントローラー
 * チーム全体分析・個人オペレーター詳細・コーチング
 */
const pool = require('../../config/database');
const ApiResponse = require('../utils/apiResponse');
const logger = require('../utils/logger');
const { getDateRange } = require('../utils/periodHelper');
const { evaluateTeamAnalysis, evaluateOperatorCoaching } = require('../services/aiTeamAnalysisService');

/**
 * POST /api/ai/analysis/team
 * チーム全体のAI分析レポート生成
 */
const getTeamAnalysis = async (req, res, next) => {
  try {
    const { period = 'daily', date, date_from, date_to } = req.body;
    let dateFrom, dateTo;
    if (date_from && date_to) {
      dateFrom = date_from;
      dateTo = date_to;
    } else {
      const range = getDateRange(period, date || new Date().toISOString().slice(0, 10));
      if (!range) {
        return ApiResponse.badRequest(res, 'periodはdaily, weekly, monthly, cumulativeのいずれかです');
      }
      dateFrom = range.dateFrom;
      dateTo = range.dateTo;
    }

    // 全オペレーターの集計データ取得 (LEFT JOINで一括取得)
    const [rows] = await pool.query(
      `SELECT
        u.id as user_id, u.name,
        COUNT(DISTINCT c.id) as total_calls,
        CAST(SUM(CASE WHEN c.is_effective_connection = 1 THEN 1 ELSE 0 END) AS SIGNED) as effective_connections,
        CAST(SUM(CASE WHEN c.is_person_in_charge = 1 THEN 1 ELSE 0 END) AS SIGNED) as person_connections,
        CAST(SUM(CASE WHEN c.result_code = 'PROJECT' THEN 1 ELSE 0 END) AS SIGNED) as projects,
        COALESCE(ROUND(AVG(ae.overall_score), 1), 0) as avg_ai_score,
        COALESCE(ROUND(AVG(ae.opening_score), 1), 0) as avg_opening,
        COALESCE(ROUND(AVG(ae.clarity_score), 1), 0) as avg_clarity,
        COALESCE(ROUND(AVG(ae.hearing_score), 1), 0) as avg_hearing,
        COALESCE(ROUND(AVG(ae.rebuttal_score), 1), 0) as avg_rebuttal,
        COALESCE(ROUND(AVG(ae.closing_score), 1), 0) as avg_closing
      FROM users u
      LEFT JOIN calls c ON c.user_id = u.id AND DATE(c.call_started_at) BETWEEN ? AND ? AND c.result_code IS NOT NULL AND c.result_code != 'SKIP'
      LEFT JOIN ai_evaluations ae ON ae.call_id = c.id
      WHERE u.role = 'operator' AND u.is_active = 1
      GROUP BY u.id, u.name
      ORDER BY total_calls DESC`,
      [dateFrom, dateTo]
    );

    // 架電数0のオペレーター（未出勤）を除外
    const activeOperators = rows.filter(op => op.total_calls > 0);

    // 各オペレーターの稼働時間を取得
    for (const op of activeOperators) {
      const [whRows] = await pool.query(
        `SELECT SUM(
           TIMESTAMPDIFF(MINUTE, STR_TO_DATE(start_time, '%H:%i'), STR_TO_DATE(end_time, '%H:%i'))
         ) as total_minutes
         FROM work_hours
         WHERE user_id = ? AND date BETWEEN ? AND ?`,
        [op.user_id, dateFrom, dateTo]
      );
      op.work_hours = whRows[0]?.total_minutes ? whRows[0].total_minutes / 60 : 0;
    }

    // 全体統計
    const totalStats = activeOperators.reduce((acc, op) => ({
      totalCalls: acc.totalCalls + (op.total_calls || 0),
      effectiveConnections: acc.effectiveConnections + (op.effective_connections || 0),
      personConnections: acc.personConnections + (op.person_connections || 0),
      projects: acc.projects + (op.projects || 0),
    }), { totalCalls: 0, effectiveConnections: 0, personConnections: 0, projects: 0 });

    if (totalStats.totalCalls === 0 && activeOperators.length === 0) {
      return ApiResponse.success(res, { analysis: null, message: 'この期間のデータがありません' });
    }

    // Claude API で分析（出勤者のみ）
    const analysis = await evaluateTeamAnalysis({
      period,
      dateFrom,
      dateTo,
      operators: activeOperators,
      totalStats,
    });

    return ApiResponse.success(res, {
      period,
      dateFrom,
      dateTo,
      totalStats,
      analysis,
    });
  } catch (err) {
    logger.error('チーム分析エラー:', err.message, err.stack);
    return res.status(500).json({
      success: false,
      message: `AI分析エラー: ${err.message}`,
    });
  }
};

/**
 * GET /api/ai/analysis/operator/:userId
 * 個人オペレーターの詳細データ取得（スコア推移 + 統計）
 */
const getOperatorDetail = async (req, res, next) => {
  try {
    const { userId } = req.params;
    const { period = 'daily', date, date_from, date_to } = req.query;
    let dateFrom, dateTo;
    if (date_from && date_to) {
      dateFrom = date_from;
      dateTo = date_to;
    } else {
      const range = getDateRange(period, date || new Date().toISOString().slice(0, 10));
      if (!range) {
        return ApiResponse.badRequest(res, 'periodはdaily, weekly, monthly, cumulativeのいずれかです');
      }
      dateFrom = range.dateFrom;
      dateTo = range.dateTo;
    }

    // ユーザー情報
    const [userRows] = await pool.execute('SELECT id, name, email, role FROM users WHERE id = ?', [userId]);
    if (userRows.length === 0) {
      return ApiResponse.notFound(res, 'ユーザーが見つかりません');
    }
    const operator = userRows[0];

    // コール統計
    const [statsRows] = await pool.query(
      `SELECT
        COUNT(c.id) as total_calls,
        CAST(SUM(CASE WHEN c.is_effective_connection = 1 THEN 1 ELSE 0 END) AS SIGNED) as effective_connections,
        CAST(SUM(CASE WHEN c.is_person_in_charge = 1 THEN 1 ELSE 0 END) AS SIGNED) as person_connections,
        CAST(SUM(CASE WHEN c.result_code = 'PROJECT' THEN 1 ELSE 0 END) AS SIGNED) as projects,
        CAST(SUM(CASE WHEN c.result_code = 'INTERESTED' THEN 1 ELSE 0 END) AS SIGNED) as interested,
        CAST(SUM(CASE WHEN c.result_code = 'RECALL' THEN 1 ELSE 0 END) AS SIGNED) as recalls,
        CAST(SUM(CASE WHEN c.result_code = 'NG' THEN 1 ELSE 0 END) AS SIGNED) as ng_count,
        CAST(SUM(CASE WHEN c.result_code = 'NO_ANSWER' THEN 1 ELSE 0 END) AS SIGNED) as no_answer
      FROM calls c
      WHERE c.user_id = ? AND DATE(c.call_started_at) BETWEEN ? AND ? AND c.result_code IS NOT NULL AND c.result_code != 'SKIP'`,
      [userId, dateFrom, dateTo]
    );

    // スコア平均
    const [avgRows] = await pool.query(
      `SELECT
        ROUND(AVG(ae.overall_score), 1) as overall,
        ROUND(AVG(ae.opening_score), 1) as opening,
        ROUND(AVG(ae.clarity_score), 1) as clarity,
        ROUND(AVG(ae.hearing_score), 1) as hearing,
        ROUND(AVG(ae.rebuttal_score), 1) as rebuttal,
        ROUND(AVG(ae.closing_score), 1) as closing,
        COUNT(ae.id) as eval_count
      FROM ai_evaluations ae
      JOIN calls c ON ae.call_id = c.id
      WHERE ae.user_id = ? AND DATE(c.call_started_at) BETWEEN ? AND ? AND c.result_code IS NOT NULL`,
      [userId, dateFrom, dateTo]
    );

    // スコア推移データ（日別にグループ化）
    const [trendRows] = await pool.query(
      `SELECT
        DATE(c.call_started_at) as date,
        ROUND(AVG(ae.overall_score), 1) as avg_score,
        ROUND(AVG(ae.opening_score), 1) as avg_opening,
        ROUND(AVG(ae.clarity_score), 1) as avg_clarity,
        ROUND(AVG(ae.hearing_score), 1) as avg_hearing,
        ROUND(AVG(ae.rebuttal_score), 1) as avg_rebuttal,
        ROUND(AVG(ae.closing_score), 1) as avg_closing,
        COUNT(ae.id) as eval_count
      FROM ai_evaluations ae
      JOIN calls c ON ae.call_id = c.id
      WHERE ae.user_id = ? AND DATE(c.call_started_at) BETWEEN ? AND ? AND c.result_code IS NOT NULL
      GROUP BY DATE(c.call_started_at)
      ORDER BY date ASC`,
      [userId, dateFrom, dateTo]
    );

    // 直近の評価一覧（最大20件）
    const [evalRows] = await pool.query(
      `SELECT
        ae.id, ae.overall_score, ae.opening_score, ae.clarity_score,
        ae.hearing_score, ae.rebuttal_score, ae.closing_score,
        ae.summary, ae.good_points, ae.improvement_points, ae.next_improvement,
        c.call_started_at, c.result_code, c.memo,
        co.company_name, co.industry
      FROM ai_evaluations ae
      JOIN calls c ON ae.call_id = c.id
      LEFT JOIN companies co ON c.company_id = co.id
      WHERE ae.user_id = ? AND DATE(c.call_started_at) BETWEEN ? AND ?
      ORDER BY c.call_started_at DESC
      LIMIT 20`,
      [userId, dateFrom, dateTo]
    );

    return ApiResponse.success(res, {
      operator,
      period,
      dateFrom,
      dateTo,
      stats: statsRows[0],
      scoreAvgs: avgRows[0],
      trend: trendRows,
      evaluations: evalRows,
    });
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/ai/analysis/operator/:userId/coaching
 * 個人オペレーターのAIコーチング生成
 */
const getOperatorCoaching = async (req, res, next) => {
  try {
    const { userId } = req.params;
    const { period = 'daily', date, date_from, date_to } = req.body;
    let dateFrom, dateTo;
    if (date_from && date_to) {
      dateFrom = date_from;
      dateTo = date_to;
    } else {
      const range = getDateRange(period, date || new Date().toISOString().slice(0, 10));
      if (!range) {
        return ApiResponse.badRequest(res, 'periodはdaily, weekly, monthly, cumulativeのいずれかです');
      }
      dateFrom = range.dateFrom;
      dateTo = range.dateTo;
    }

    // ユーザー情報
    const [userRows] = await pool.execute('SELECT id, name FROM users WHERE id = ?', [userId]);
    if (userRows.length === 0) {
      return ApiResponse.notFound(res, 'ユーザーが見つかりません');
    }

    // コール統計
    const [statsRows] = await pool.query(
      `SELECT
        COUNT(c.id) as total_calls,
        CAST(SUM(CASE WHEN c.is_effective_connection = 1 THEN 1 ELSE 0 END) AS SIGNED) as effective_connections,
        CAST(SUM(CASE WHEN c.is_person_in_charge = 1 THEN 1 ELSE 0 END) AS SIGNED) as person_connections,
        CAST(SUM(CASE WHEN c.result_code = 'PROJECT' THEN 1 ELSE 0 END) AS SIGNED) as projects
      FROM calls c
      WHERE c.user_id = ? AND DATE(c.call_started_at) BETWEEN ? AND ? AND c.result_code IS NOT NULL AND c.result_code != 'SKIP'`,
      [userId, dateFrom, dateTo]
    );

    // スコア平均
    const [avgRows] = await pool.query(
      `SELECT
        ROUND(AVG(ae.overall_score), 1) as overall,
        ROUND(AVG(ae.opening_score), 1) as opening,
        ROUND(AVG(ae.clarity_score), 1) as clarity,
        ROUND(AVG(ae.hearing_score), 1) as hearing,
        ROUND(AVG(ae.rebuttal_score), 1) as rebuttal,
        ROUND(AVG(ae.closing_score), 1) as closing
      FROM ai_evaluations ae
      JOIN calls c ON ae.call_id = c.id
      WHERE ae.user_id = ? AND DATE(c.call_started_at) BETWEEN ? AND ?`,
      [userId, dateFrom, dateTo]
    );

    // 直近の評価（サマリー付き）
    const [evalRows] = await pool.query(
      `SELECT
        ae.overall_score, ae.summary, ae.good_points, ae.improvement_points,
        c.result_code, co.company_name
      FROM ai_evaluations ae
      JOIN calls c ON ae.call_id = c.id
      LEFT JOIN companies co ON c.company_id = co.id
      WHERE ae.user_id = ? AND DATE(c.call_started_at) BETWEEN ? AND ?
      ORDER BY c.call_started_at DESC
      LIMIT 10`,
      [userId, dateFrom, dateTo]
    );

    const stats = statsRows[0];
    const scoreAvgs = avgRows[0];

    if (!stats.total_calls && evalRows.length === 0) {
      return ApiResponse.success(res, { coaching: null, message: 'この期間のデータがありません' });
    }

    // 稼働時間取得
    const [whRows] = await pool.query(
      `SELECT SUM(
         TIMESTAMPDIFF(MINUTE, STR_TO_DATE(start_time, '%H:%i'), STR_TO_DATE(end_time, '%H:%i'))
       ) as total_minutes
       FROM work_hours
       WHERE user_id = ? AND date BETWEEN ? AND ?`,
      [userId, dateFrom, dateTo]
    );
    const workHours = whRows[0]?.total_minutes ? whRows[0].total_minutes / 60 : 0;

    // Claude API でコーチング生成
    const coaching = await evaluateOperatorCoaching({
      name: userRows[0].name,
      dateFrom,
      dateTo,
      workHours,
      stats: {
        totalCalls: stats.total_calls || 0,
        effectiveConnections: stats.effective_connections || 0,
        personConnections: stats.person_connections || 0,
        projects: stats.projects || 0,
      },
      evaluations: evalRows,
      scoreAvgs: {
        overall: scoreAvgs.overall || 0,
        opening: scoreAvgs.opening || 0,
        clarity: scoreAvgs.clarity || 0,
        hearing: scoreAvgs.hearing || 0,
        rebuttal: scoreAvgs.rebuttal || 0,
        closing: scoreAvgs.closing || 0,
      },
    });

    return ApiResponse.success(res, { coaching });
  } catch (err) {
    logger.error('個人コーチング生成エラー:', err);
    next(err);
  }
};

module.exports = { getTeamAnalysis, getOperatorDetail, getOperatorCoaching };
