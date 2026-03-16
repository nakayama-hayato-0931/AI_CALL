/**
 * AI評価コントローラー
 * 通話評価の実行・取得
 */
const pool = require('../../config/database');
const ApiResponse = require('../utils/apiResponse');
const { evaluateCall, evaluateCallFromData, evaluateDailySummary } = require('../services/aiEvaluationService');
const { searchCallLogs } = require('../services/googleSheetsService');
const logger = require('../utils/logger');

// 1日あたりのAI評価回数上限
const DAILY_EVAL_LIMIT = 3;

/**
 * POST /api/ai/evaluate
 * 通話をAI評価する
 */
const evaluate = async (req, res, next) => {
  try {
    const { call_id, transcript } = req.body;
    const userId = req.user.id;

    if (!call_id || !transcript) {
      return ApiResponse.badRequest(res, '通話IDと文字起こしテキストは必須です');
    }

    // 通話存在チェック
    const [callRows] = await pool.execute(
      'SELECT c.*, u.name as operator_name FROM calls c LEFT JOIN users u ON c.user_id = u.id WHERE c.id = ?',
      [call_id]
    );
    if (callRows.length === 0) {
      return ApiResponse.notFound(res, '通話が見つかりません');
    }

    const call = callRows[0];

    // AI評価実行
    const evaluation = await evaluateCall(transcript, call.operator_name);

    // トランスクリプトをcallsテーブルに保存
    await pool.execute(
      'UPDATE calls SET transcript = ? WHERE id = ?',
      [transcript, call_id]
    );

    // 評価結果をDBに保存
    const [result] = await pool.execute(
      `INSERT INTO ai_evaluations
        (user_id, call_id, overall_score, opening_score, clarity_score,
         hearing_score, rebuttal_score, closing_score,
         summary, good_points, improvement_points, next_improvement)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        call.user_id,
        call_id,
        evaluation.overall_score,
        evaluation.opening_score,
        evaluation.clarity_score,
        evaluation.hearing_score,
        evaluation.rebuttal_score,
        evaluation.closing_score,
        evaluation.summary || null,
        evaluation.good_points || null,
        evaluation.improvement_points || null,
        evaluation.next_improvement || null,
      ]
    );

    logger.info(`AI評価保存: evaluation=${result.insertId}, call=${call_id}`);

    return ApiResponse.created(res, {
      evaluationId: result.insertId,
      ...evaluation,
    }, 'AI評価を完了しました');
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/ai/evaluations/:callId
 * 通話のAI評価結果取得
 */
const getEvaluationByCallId = async (req, res, next) => {
  try {
    const { callId } = req.params;

    const [rows] = await pool.execute(
      `SELECT ae.*, u.name as operator_name
       FROM ai_evaluations ae
       LEFT JOIN users u ON ae.user_id = u.id
       WHERE ae.call_id = ?
       ORDER BY ae.created_at DESC
       LIMIT 1`,
      [callId]
    );

    if (rows.length === 0) {
      return ApiResponse.notFound(res, 'AI評価が見つかりません');
    }

    return ApiResponse.success(res, rows[0]);
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/ai/evaluations/user/:userId
 * ユーザーのAI評価履歴取得
 */
const getEvaluationsByUserId = async (req, res, next) => {
  try {
    const { userId } = req.params;
    const limit = Math.min(50, parseInt(req.query.limit, 10) || 20);

    const [rows] = await pool.execute(
      `SELECT ae.*, co.company_name
       FROM ai_evaluations ae
       LEFT JOIN calls c ON ae.call_id = c.id
       LEFT JOIN companies co ON c.company_id = co.id
       WHERE ae.user_id = ?
       ORDER BY ae.created_at DESC
       LIMIT ?`,
      [userId, limit]
    );

    return ApiResponse.success(res, rows);
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/ai/evaluate-from-data
 * CRMデータ + Google Sheetsからの通話をAI評価する
 */
const evaluateFromData = async (req, res, next) => {
  try {
    const { call_id } = req.body;

    if (!call_id) {
      return ApiResponse.badRequest(res, '通話IDは必須です');
    }

    // 通話データ取得
    const [callRows] = await pool.query(
      `SELECT c.*, co.company_name, co.industry, co.region, co.phone_number,
              u.name as operator_name
       FROM calls c
       LEFT JOIN companies co ON c.company_id = co.id
       LEFT JOIN users u ON c.user_id = u.id
       WHERE c.id = ?`,
      [call_id]
    );
    if (callRows.length === 0) {
      return ApiResponse.notFound(res, '通話が見つかりません');
    }

    const callData = callRows[0];

    // SKIP通話は評価対象外
    if (callData.result_code === 'SKIP') {
      return ApiResponse.badRequest(res, 'SKIP通話は評価対象外です');
    }

    // 既存評価チェック
    const [existingEval] = await pool.query(
      'SELECT id FROM ai_evaluations WHERE call_id = ?',
      [call_id]
    );
    if (existingEval.length > 0) {
      return ApiResponse.badRequest(res, 'この通話は既に評価済みです');
    }

    // Google Sheetsから関連ログを検索
    let sheetLogs = [];
    if (callData.phone_number) {
      try {
        sheetLogs = await searchCallLogs(callData.phone_number);
      } catch (err) {
        logger.warn('Google Sheets検索スキップ:', err.message);
      }
    }

    // AI評価実行
    const evaluation = await evaluateCallFromData(callData, sheetLogs);

    // 評価結果をDBに保存
    const [result] = await pool.query(
      `INSERT INTO ai_evaluations
        (user_id, call_id, overall_score, opening_score, clarity_score,
         hearing_score, rebuttal_score, closing_score,
         summary, good_points, improvement_points, next_improvement)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        callData.user_id,
        call_id,
        evaluation.overall_score,
        evaluation.opening_score,
        evaluation.clarity_score,
        evaluation.hearing_score,
        evaluation.rebuttal_score,
        evaluation.closing_score,
        evaluation.summary || null,
        evaluation.good_points || null,
        evaluation.improvement_points || null,
        evaluation.next_improvement || null,
      ]
    );

    logger.info(`AI評価(データ)保存: evaluation=${result.insertId}, call=${call_id}`);

    return ApiResponse.created(res, {
      evaluationId: result.insertId,
      ...evaluation,
    }, 'AI評価を完了しました');
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/ai/evaluate-daily
 * 日次一括AI評価 + サマリー生成
 */
const evaluateDailyBatch = async (req, res, next) => {
  try {
    const { date, target_user_id } = req.body;
    const isAdminOrManager = req.user.role === 'admin' || req.user.role === 'manager';
    const userId = (target_user_id && isAdminOrManager) ? target_user_id : req.user.id;

    if (!date) {
      return ApiResponse.badRequest(res, '日付は必須です');
    }

    // 1日の評価回数チェック (admin/managerはスキップ)
    if (!isAdminOrManager) {
      const [batchLogs] = await pool.query(
        'SELECT COUNT(*) as cnt FROM evaluation_batch_logs WHERE user_id = ? AND evaluated_date = CURDATE()',
        [userId]
      );
      const todayCount = batchLogs[0].cnt;
      if (todayCount >= DAILY_EVAL_LIMIT) {
        return ApiResponse.badRequest(res,
          `本日のAI評価回数が上限(${DAILY_EVAL_LIMIT}回)に達しました。明日再度お試しください。`
        );
      }
    }

    // 未評価の通話を取得
    const [unevaluatedCalls] = await pool.query(
      `SELECT c.*, co.company_name, co.industry, co.region, co.phone_number,
              u.name as operator_name
       FROM calls c
       LEFT JOIN companies co ON c.company_id = co.id
       LEFT JOIN users u ON c.user_id = u.id
       LEFT JOIN ai_evaluations ae ON ae.call_id = c.id
       WHERE c.user_id = ? AND DATE(c.call_started_at) = ?
         AND ae.id IS NULL AND c.result_code != 'SKIP' AND c.result_code IS NOT NULL
       ORDER BY c.call_started_at ASC`,
      [userId, date]
    );

    let evaluatedCount = 0;
    const evaluatedResults = [];

    // 各通話を順にAI評価
    for (const callData of unevaluatedCalls) {
      try {
        // Google Sheetsから関連ログを検索
        let sheetLogs = [];
        if (callData.phone_number) {
          try {
            sheetLogs = await searchCallLogs(callData.phone_number);
          } catch (err) {
            logger.warn('Google Sheets検索スキップ:', err.message);
          }
        }

        const evaluation = await evaluateCallFromData(callData, sheetLogs);

        // 保存
        await pool.query(
          `INSERT INTO ai_evaluations
            (user_id, call_id, overall_score, opening_score, clarity_score,
             hearing_score, rebuttal_score, closing_score,
             summary, good_points, improvement_points, next_improvement)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            callData.user_id,
            callData.id,
            evaluation.overall_score,
            evaluation.opening_score,
            evaluation.clarity_score,
            evaluation.hearing_score,
            evaluation.rebuttal_score,
            evaluation.closing_score,
            evaluation.summary || null,
            evaluation.good_points || null,
            evaluation.improvement_points || null,
            evaluation.next_improvement || null,
          ]
        );

        evaluatedResults.push({
          call_id: callData.id,
          company_name: callData.company_name,
          result_code: callData.result_code,
          overall_score: evaluation.overall_score,
          summary: evaluation.summary,
        });
        evaluatedCount++;
      } catch (err) {
        logger.error(`通話 ${callData.id} の評価失敗:`, err.message);
      }
    }

    // 日次サマリー生成（評価済みデータを全て取得）
    let dailySummary = null;
    const [allEvaluatedCalls] = await pool.query(
      `SELECT c.*, co.company_name, ae.overall_score, ae.summary,
              ae.good_points, ae.improvement_points
       FROM calls c
       LEFT JOIN companies co ON c.company_id = co.id
       LEFT JOIN ai_evaluations ae ON ae.call_id = c.id
       WHERE c.user_id = ? AND DATE(c.call_started_at) = ? AND ae.id IS NOT NULL
       ORDER BY c.call_started_at ASC`,
      [userId, date]
    );

    if (allEvaluatedCalls.length > 0) {
      const scores = allEvaluatedCalls.map(c => c.overall_score).filter(s => s != null);
      const avgScore = scores.length > 0 ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : 0;

      const [allDayCalls] = await pool.query(
        `SELECT c.is_effective_connection, c.result_code
         FROM calls c WHERE c.user_id = ? AND DATE(c.call_started_at) = ?`,
        [userId, date]
      );

      const stats = {
        totalCalls: allDayCalls.length,
        effectiveConnections: allDayCalls.filter(c => c.is_effective_connection).length,
        projects: allDayCalls.filter(c => c.result_code === 'PROJECT').length,
        avgScore,
      };

      try {
        dailySummary = await evaluateDailySummary(allEvaluatedCalls, stats);
      } catch (err) {
        logger.error('日次サマリー生成失敗:', err.message);
      }
    }

    // バッチ実行ログを記録
    if (evaluatedCount > 0) {
      await pool.query(
        'INSERT INTO evaluation_batch_logs (user_id, evaluated_date) VALUES (?, CURDATE())',
        [userId]
      );
    }

    const remainingEvals = DAILY_EVAL_LIMIT - todayCount - (evaluatedCount > 0 ? 1 : 0);

    return ApiResponse.success(res, {
      evaluatedCount,
      evaluatedResults,
      dailySummary,
      dailyLimit: DAILY_EVAL_LIMIT,
      remainingEvals: Math.max(0, remainingEvals),
    }, `${evaluatedCount}件の通話を評価しました`);
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/ai/daily-summary?date=YYYY-MM-DD
 * 既存評価からの日次サマリー取得
 */
const getDailySummary = async (req, res, next) => {
  try {
    const { date, dateFrom, dateTo, user_id } = req.query;
    const isAdminOrManager = req.user.role === 'admin' || req.user.role === 'manager';
    const userId = (user_id && isAdminOrManager) ? user_id : req.user.id;

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

    // 評価済み通話を集計
    const [evaluated] = await pool.query(
      `SELECT ae.overall_score, ae.opening_score, ae.clarity_score,
              ae.hearing_score, ae.rebuttal_score, ae.closing_score
       FROM ai_evaluations ae
       JOIN calls c ON ae.call_id = c.id
       WHERE ae.user_id = ? AND ${dateCondition}`,
      queryParams
    );

    // 全架電の集計
    const [allCalls] = await pool.query(
      `SELECT c.result_code, c.is_effective_connection, c.is_person_in_charge
       FROM calls c WHERE c.user_id = ? AND ${dateCondition}`,
      queryParams
    );

    const scoreFields = ['overall_score', 'opening_score', 'clarity_score', 'hearing_score', 'rebuttal_score', 'closing_score'];
    const avgScores = {};
    scoreFields.forEach(field => {
      const vals = evaluated.map(e => e[field]).filter(v => v != null);
      avgScores[field] = vals.length > 0 ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : null;
    });

    return ApiResponse.success(res, {
      date: date || `${dateFrom}〜${dateTo}`,
      totalCalls: allCalls.length,
      evaluatedCalls: evaluated.length,
      effectiveConnections: allCalls.filter(c => c.is_effective_connection).length,
      personInCharge: allCalls.filter(c => c.is_person_in_charge).length,
      projects: allCalls.filter(c => c.result_code === 'PROJECT').length,
      avgScores,
    });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/ai/latest-improvement
 * ログインユーザーの直近のAI改善点を取得
 */
const getLatestImprovement = async (req, res, next) => {
  try {
    const userId = req.user.id;

    const [rows] = await pool.query(
      `SELECT ae.improvement_points, ae.next_improvement, ae.overall_score,
              c.call_started_at, co.company_name
       FROM ai_evaluations ae
       JOIN calls c ON ae.call_id = c.id
       JOIN companies co ON c.company_id = co.id
       WHERE ae.user_id = ?
       ORDER BY ae.created_at DESC
       LIMIT 1`,
      [userId]
    );

    if (rows.length === 0) {
      return ApiResponse.success(res, null);
    }

    return ApiResponse.success(res, rows[0]);
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/ai/eval-limit
 * 本日の残りAI評価回数を取得
 */
const getEvalLimit = async (req, res, next) => {
  try {
    const userId = req.user.id;

    const [batchLogs] = await pool.query(
      'SELECT COUNT(*) as cnt FROM evaluation_batch_logs WHERE user_id = ? AND evaluated_date = CURDATE()',
      [userId]
    );
    const todayCount = batchLogs[0].cnt;

    return ApiResponse.success(res, {
      dailyLimit: DAILY_EVAL_LIMIT,
      usedToday: todayCount,
      remainingEvals: Math.max(0, DAILY_EVAL_LIMIT - todayCount),
    });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/ai/admin/evaluations
 * 管理者: 全オペレーター評価一覧
 */
const getAllEvaluations = async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, parseInt(req.query.limit) || 20);
    const offset = (page - 1) * limit;
    const { user_id, date_from, date_to } = req.query;

    let whereClauses = [];
    let params = [];

    if (user_id) {
      whereClauses.push('ae.user_id = ?');
      params.push(user_id);
    }
    if (date_from) {
      whereClauses.push('DATE(c.call_started_at) >= ?');
      params.push(date_from);
    }
    if (date_to) {
      whereClauses.push('DATE(c.call_started_at) <= ?');
      params.push(date_to);
    }

    const whereStr = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

    const [countRows] = await pool.query(
      `SELECT COUNT(*) as total FROM ai_evaluations ae JOIN calls c ON ae.call_id = c.id ${whereStr}`,
      params
    );

    const [rows] = await pool.query(
      `SELECT ae.*, u.name as operator_name, co.company_name, c.call_started_at, c.result_code, c.transcript
       FROM ai_evaluations ae
       JOIN users u ON ae.user_id = u.id
       JOIN calls c ON ae.call_id = c.id
       LEFT JOIN companies co ON c.company_id = co.id
       ${whereStr}
       ORDER BY ae.created_at DESC
       LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    return ApiResponse.success(res, {
      evaluations: rows,
      pagination: {
        page,
        limit,
        total: countRows[0].total,
        totalPages: Math.ceil(countRows[0].total / limit),
      },
    });
  } catch (err) {
    next(err);
  }
};

module.exports = {
  evaluate,
  getEvaluationByCallId,
  getEvaluationsByUserId,
  evaluateFromData,
  evaluateDailyBatch,
  getDailySummary,
  getLatestImprovement,
  getEvalLimit,
  getAllEvaluations,
};
