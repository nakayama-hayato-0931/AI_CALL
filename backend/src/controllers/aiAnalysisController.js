/**
 * AI分析コントローラー
 * チーム全体分析・個人オペレーター詳細・コーチング
 */
const pool = require('../../config/database');
const ApiResponse = require('../utils/apiResponse');
const logger = require('../utils/logger');
const { getDateRange } = require('../utils/periodHelper');
const { evaluateTeamAnalysis, evaluateOperatorCoaching, evaluateStatusSheet } = require('../services/aiTeamAnalysisService');

// status_sheets テーブルを確実に作成
let statusSheetsTableReady = false;
const ensureStatusSheetsTable = async () => {
  if (statusSheetsTableReady) return;
  try {
    await pool.execute(`
      CREATE TABLE IF NOT EXISTS status_sheets (
        id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        user_id INT UNSIGNED NOT NULL,
        period_from DATE NOT NULL,
        period_to DATE NOT NULL,
        current_status JSON NOT NULL,
        training_plan JSON NOT NULL,
        next_steps JSON NOT NULL,
        created_by INT UNSIGNED NOT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_ss_user (user_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    statusSheetsTableReady = true;
    logger.info('[ensureStatusSheetsTable] テーブル準備完了');
  } catch (e) {
    logger.warn('[ensureStatusSheetsTable]', e.message);
    // テーブルが既に存在する場合も成功扱い
    if (e.message.includes('already exists')) statusSheetsTableReady = true;
  }
};

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
           - COALESCE(break_minutes, 0)
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
         - COALESCE(break_minutes, 0)
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

/**
 * 1オペレーターのステータスシート生成（共通処理）
 */
const generateSheetForOperator = async (op, dateFrom, dateTo, createdBy) => {
  // コール統計
  const [statsRows] = await pool.query(
    `SELECT
      COUNT(c.id) as total_calls,
      CAST(SUM(CASE WHEN c.is_effective_connection = 1 THEN 1 ELSE 0 END) AS SIGNED) as effective_connections,
      CAST(SUM(CASE WHEN c.is_person_in_charge = 1 THEN 1 ELSE 0 END) AS SIGNED) as person_connections,
      CAST(SUM(CASE WHEN c.result_code = 'PROJECT' THEN 1 ELSE 0 END) AS SIGNED) as projects
    FROM calls c
    WHERE c.user_id = ? AND DATE(c.call_started_at) BETWEEN ? AND ? AND c.result_code IS NOT NULL AND c.result_code != 'SKIP'`,
    [op.id, dateFrom, dateTo]
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
    [op.id, dateFrom, dateTo]
  );

  // 直近2週間の評価から厳選ピックアップ
  const twoWeeksAgo = new Date();
  twoWeeksAgo.setDate(twoWeeksAgo.getDate() - 14);
  const evalDateFrom = twoWeeksAgo.toISOString().slice(0, 10);
  const evalDateTo = new Date().toISOString().slice(0, 10);

  const [goodEvals] = await pool.query(
    `SELECT ae.overall_score, ae.summary, ae.good_points, ae.improvement_points, c.result_code, co.company_name
    FROM ai_evaluations ae JOIN calls c ON ae.call_id = c.id LEFT JOIN companies co ON c.company_id = co.id
    WHERE ae.user_id = ? AND DATE(c.call_started_at) BETWEEN ? AND ? AND c.result_code = 'PROJECT'
    ORDER BY ae.overall_score DESC, c.call_started_at DESC LIMIT 5`,
    [op.id, evalDateFrom, evalDateTo]
  );

  const [badEvals] = await pool.query(
    `SELECT ae.overall_score, ae.summary, ae.good_points, ae.improvement_points, c.result_code, co.company_name
    FROM ai_evaluations ae JOIN calls c ON ae.call_id = c.id LEFT JOIN companies co ON c.company_id = co.id
    WHERE ae.user_id = ? AND DATE(c.call_started_at) BETWEEN ? AND ? AND c.result_code = 'NG'
    ORDER BY ae.overall_score DESC, c.call_started_at DESC LIMIT 5`,
    [op.id, evalDateFrom, evalDateTo]
  );

  const evalRows = [...goodEvals, ...badEvals];

  // 稼働時間
  const [whRows] = await pool.query(
    `SELECT SUM(TIMESTAMPDIFF(MINUTE, STR_TO_DATE(start_time, '%H:%i'), STR_TO_DATE(end_time, '%H:%i')) - COALESCE(break_minutes, 0)) as total_minutes
     FROM work_hours WHERE user_id = ? AND date BETWEEN ? AND ?`,
    [op.id, dateFrom, dateTo]
  );
  const workHours = whRows[0]?.total_minutes ? whRows[0].total_minutes / 60 : 0;

  const stats = statsRows[0];
  const scoreAvgs = avgRows[0];

  // データがない場合
  if (!stats.total_calls && evalRows.length === 0) {
    return { userId: op.id, name: op.name, sheet: null, message: 'この期間のデータがありません' };
  }

  // AI生成
  let sheet;
  try {
    sheet = await evaluateStatusSheet({
      name: op.name,
      level: op.operator_level,
      dateFrom, dateTo, workHours,
      stats: {
        totalCalls: stats.total_calls || 0,
        effectiveConnections: stats.effective_connections || 0,
        personConnections: stats.person_connections || 0,
        projects: stats.projects || 0,
      },
      evaluations: evalRows,
      scoreAvgs: {
        overall: scoreAvgs.overall || 0, opening: scoreAvgs.opening || 0,
        clarity: scoreAvgs.clarity || 0, hearing: scoreAvgs.hearing || 0,
        rebuttal: scoreAvgs.rebuttal || 0, closing: scoreAvgs.closing || 0,
      },
    });
  } catch (aiErr) {
    logger.error(`AI生成失敗 (${op.name}):`, aiErr.message);
    return { userId: op.id, name: op.name, sheet: null, message: `AI生成失敗: ${aiErr.message}` };
  }

  // DBに保存
  try {
    const [existing] = await pool.query('SELECT id FROM status_sheets WHERE user_id = ? ORDER BY updated_at DESC LIMIT 1', [op.id]);
    if (existing.length > 0) {
      await pool.execute(
        `UPDATE status_sheets SET period_from = ?, period_to = ?, current_status = ?, training_plan = ?, next_steps = ?, targets = ?, scenario = ?, created_by = ? WHERE id = ?`,
        [dateFrom, dateTo, JSON.stringify(sheet.current_status || {}), JSON.stringify(sheet.training_plan || {}), JSON.stringify(sheet.next_steps || []), JSON.stringify(sheet.targets || null), JSON.stringify(sheet.scenario || null), createdBy, existing[0].id]
      );
    } else {
      await pool.execute(
        `INSERT INTO status_sheets (user_id, period_from, period_to, current_status, training_plan, next_steps, targets, scenario, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [op.id, dateFrom, dateTo, JSON.stringify(sheet.current_status || {}), JSON.stringify(sheet.training_plan || {}), JSON.stringify(sheet.next_steps || []), JSON.stringify(sheet.targets || null), JSON.stringify(sheet.scenario || null), createdBy]
      );
    }
  } catch (dbErr) {
    logger.error(`DB保存失敗 (${op.name}):`, dbErr.message);
  }

  return { userId: op.id, name: op.name, sheet };
};

/**
 * POST /api/ai/analysis/status-sheets
 * 全オペレーターの育成ステータスシート一括生成
 */
const generateStatusSheets = async (req, res, next) => {
  try {
    await ensureStatusSheetsTable();
    const { period = 'monthly', date_from, date_to } = req.body;
    let dateFrom, dateTo;
    if (date_from && date_to) {
      dateFrom = date_from;
      dateTo = date_to;
    } else {
      const range = getDateRange(period, new Date().toISOString().slice(0, 10));
      if (!range) {
        return ApiResponse.badRequest(res, 'periodはdaily, weekly, monthly, cumulativeのいずれかです');
      }
      dateFrom = range.dateFrom;
      dateTo = range.dateTo;
    }

    // 全アクティブオペレーター取得
    const [operators] = await pool.query(
      `SELECT u.id, u.name, u.operator_level FROM users u WHERE u.role = 'operator' AND u.is_active = 1 ORDER BY u.name`
    );

    if (operators.length === 0) {
      return ApiResponse.success(res, { sheets: [], message: 'オペレーターがいません' });
    }

    const sheets = [];

    for (const op of operators) {
      const result = await generateSheetForOperator(op, dateFrom, dateTo, req.user.id);
      sheets.push(result);
    }

    return ApiResponse.success(res, {
      period,
      dateFrom,
      dateTo,
      sheets,
    });
  } catch (err) {
    logger.error('ステータスシート生成エラー:', err.message, err.stack);
    return res.status(500).json({
      success: false,
      message: `ステータスシート生成エラー: ${err.message}`,
    });
  }
};

/**
 * GET /api/ai/analysis/status-sheets
 * 保存済みステータスシート一覧取得
 */
const getStatusSheets = async (req, res, next) => {
  try {
    await ensureStatusSheetsTable();
    const [rows] = await pool.query(
      `SELECT ss.id, ss.user_id, u.name as user_name, u.operator_level, ss.period_from, ss.period_to,
              ss.current_status, ss.training_plan, ss.next_steps, ss.targets, ss.scenario,
              ss.created_at, ss.updated_at, cb.name as created_by_name
       FROM status_sheets ss
       JOIN users u ON ss.user_id = u.id
       JOIN users cb ON ss.created_by = cb.id
       ORDER BY ss.updated_at DESC`
    );
    return ApiResponse.success(res, rows);
  } catch (err) {
    // テーブルがまだ存在しない場合は空配列を返す
    if (err.code === 'ER_NO_SUCH_TABLE') {
      return ApiResponse.success(res, []);
    }
    logger.error('ステータスシート一覧取得エラー:', err.message);
    return ApiResponse.success(res, []);
  }
};

/**
 * GET /api/ai/analysis/status-sheets/:userId
 * 特定オペレーターの最新ステータスシート取得
 */
const getStatusSheet = async (req, res, next) => {
  try {
    const { userId } = req.params;
    const [rows] = await pool.query(
      `SELECT ss.id, ss.user_id, u.name as user_name, u.operator_level, ss.period_from, ss.period_to,
              ss.current_status, ss.training_plan, ss.next_steps, ss.targets, ss.scenario,
              ss.created_at, ss.updated_at
       FROM status_sheets ss
       JOIN users u ON ss.user_id = u.id
       WHERE ss.user_id = ?
       ORDER BY ss.updated_at DESC
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
 * PUT /api/ai/analysis/status-sheets/:id
 * ステータスシートを手動編集
 */
const updateStatusSheet = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { current_status, training_plan, next_steps } = req.body;
    await pool.execute(
      `UPDATE status_sheets SET current_status = ?, training_plan = ?, next_steps = ? WHERE id = ?`,
      [JSON.stringify(current_status), JSON.stringify(training_plan), JSON.stringify(next_steps), id]
    );
    return ApiResponse.success(res, { message: '更新しました' });
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/ai/analysis/status-sheets/:userId/generate
 * 個別オペレーターのステータスシート生成
 */
const generateSingleStatusSheet = async (req, res, next) => {
  try {
    await ensureStatusSheetsTable();
    const { userId } = req.params;

    // オペレーター取得
    const [opRows] = await pool.query(
      `SELECT id, name, operator_level FROM users WHERE id = ? AND role = 'operator' AND is_active = 1`,
      [userId]
    );
    if (opRows.length === 0) {
      return ApiResponse.notFound(res, 'オペレーターが見つかりません');
    }
    const op = opRows[0];

    // 直近2週間固定
    const now = new Date();
    const twoWeeksAgo = new Date(now);
    twoWeeksAgo.setDate(now.getDate() - 14);
    const dateFrom = twoWeeksAgo.toISOString().slice(0, 10);
    const dateTo = now.toISOString().slice(0, 10);

    const result = await generateSheetForOperator(op, dateFrom, dateTo, req.user.id);

    if (!result.sheet) {
      return ApiResponse.success(res, { success: false, message: result.message || 'データがありません' });
    }

    return ApiResponse.success(res, { sheet: result, dateFrom, dateTo });
  } catch (err) {
    logger.error('個別ステータスシート生成エラー:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
};

// 研修進捗のデフォルトステップ
const TRAINING_STEPS = [
  { step_number: 1, step_name: '座学研修/サービス理解' },
  { step_number: 2, step_name: 'トークスクリプト読み込み' },
  { step_number: 3, step_name: 'ロープレ' },
  { step_number: 4, step_name: 'コールシステム説明' },
  { step_number: 5, step_name: '架電開始' },
  { step_number: 6, step_name: '改善点フィードバック' },
  { step_number: 7, step_name: '面談実施' },
];

/**
 * GET /api/ai/analysis/training/:userId
 * 研修進捗取得（初級オペレーター向け）
 */
const getTrainingProgress = async (req, res, next) => {
  try {
    const { userId } = req.params;
    const [rows] = await pool.query(
      'SELECT step_number, step_name, trainer_name, training_date, is_completed, completed_at FROM operator_training WHERE user_id = ? ORDER BY step_number',
      [userId]
    );

    // デフォルトステップがなければ初期化
    if (rows.length === 0) {
      for (const step of TRAINING_STEPS) {
        await pool.execute(
          'INSERT IGNORE INTO operator_training (user_id, step_number, step_name) VALUES (?, ?, ?)',
          [userId, step.step_number, step.step_name]
        );
      }
      const [newRows] = await pool.query(
        'SELECT step_number, step_name, trainer_name, training_date, is_completed, completed_at FROM operator_training WHERE user_id = ? ORDER BY step_number',
        [userId]
      );
      return ApiResponse.success(res, newRows);
    }

    return ApiResponse.success(res, rows);
  } catch (err) {
    logger.error('研修進捗取得エラー:', err.message);
    next(err);
  }
};

/**
 * PUT /api/ai/analysis/training/:userId/:stepNumber
 * 研修ステップ更新（担当者名、完了チェック）
 */
const updateTrainingStep = async (req, res, next) => {
  try {
    const { userId, stepNumber } = req.params;
    const { trainer_name, training_date, is_completed } = req.body;

    const updates = [];
    const params = [];

    if (trainer_name !== undefined) { updates.push('trainer_name = ?'); params.push(trainer_name || null); }
    if (training_date !== undefined) { updates.push('training_date = ?'); params.push(training_date || null); }
    if (is_completed !== undefined) {
      updates.push('is_completed = ?');
      params.push(is_completed ? 1 : 0);
      updates.push('completed_at = ?');
      params.push(is_completed ? new Date() : null);
    }

    if (updates.length === 0) {
      return ApiResponse.badRequest(res, '更新する項目がありません');
    }

    params.push(userId, stepNumber);
    await pool.execute(
      `UPDATE operator_training SET ${updates.join(', ')} WHERE user_id = ? AND step_number = ?`,
      params
    );

    return ApiResponse.success(res, null, '研修ステップを更新しました');
  } catch (err) {
    logger.error('研修ステップ更新エラー:', err.message);
    next(err);
  }
};

module.exports = { getTeamAnalysis, getOperatorDetail, getOperatorCoaching, generateStatusSheets, generateSingleStatusSheet, getStatusSheets, getStatusSheet, updateStatusSheet, getTrainingProgress, updateTrainingStep };
