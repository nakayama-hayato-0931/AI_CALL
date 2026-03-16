/**
 * ダッシュボードコントローラー
 * KPI集計・グラフデータ取得
 */
const pool = require('../../config/database');
const ApiResponse = require('../utils/apiResponse');

/**
 * GET /api/dashboard/stats
 * 当日のKPI統計取得
 */
const getDailyStats = async (req, res, next) => {
  try {
    const userId = req.query.user_id || req.user.id;
    const date = req.query.date || new Date().toISOString().slice(0, 10);

    // 1クエリで全KPIを集計 (SKIPを除外)
    const [statsRows] = await pool.execute(
      `SELECT
         MIN(call_started_at) as first_call,
         MAX(COALESCE(call_ended_at, call_started_at)) as last_call,
         COUNT(*) as call_count,
         SUM(CASE WHEN result_code = 'RECALL' THEN 1 ELSE 0 END) as recall_gained,
         SUM(CASE WHEN is_effective_connection = 1 THEN 1 ELSE 0 END) as effective_count,
         SUM(CASE WHEN is_person_in_charge = 1 THEN 1 ELSE 0 END) as person_count,
         SUM(CASE WHEN is_project_created = 1 THEN 1 ELSE 0 END) as project_count
       FROM calls
       WHERE user_id = ? AND DATE(call_started_at) = ? AND result_code != 'SKIP'`,
      [userId, date]
    );

    // リコール消化数 (別テーブル)
    const [recallDoneRows] = await pool.execute(
      `SELECT COUNT(*) as recall_done FROM recall_tasks
       WHERE user_id = ? AND DATE(updated_at) = ? AND status = 'completed'`,
      [userId, date]
    );

    const s = statsRows[0];
    let workMinutes = 0;
    if (s.first_call && s.last_call) {
      workMinutes = Math.round(
        (new Date(s.last_call) - new Date(s.first_call)) / 60000
      );
    }

    // 手動入力の稼働時間を取得
    const [whRows] = await pool.execute(
      'SELECT start_time, end_time FROM work_hours WHERE user_id = ? AND date = ?',
      [userId, date]
    );

    return ApiResponse.success(res, {
      date,
      workMinutes,
      callCount: s.call_count,
      recallGained: s.recall_gained,
      recallDone: recallDoneRows[0].recall_done,
      effectiveCount: s.effective_count,
      personCount: s.person_count,
      projectCount: s.project_count,
      manualWorkHours: whRows[0] || null,
    });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/dashboard/hourly-calls
 * 時間帯別コール数 (グラフ用)
 */
const getHourlyCalls = async (req, res, next) => {
  try {
    const userId = req.query.user_id || req.user.id;
    const date = req.query.date || new Date().toISOString().slice(0, 10);

    const [rows] = await pool.execute(
      `SELECT HOUR(call_started_at) as hour, COUNT(*) as count
       FROM calls
       WHERE user_id = ? AND DATE(call_started_at) = ? AND result_code != 'SKIP'
       GROUP BY HOUR(call_started_at)
       ORDER BY hour`,
      [userId, date]
    );

    // 9時~19時の配列に整形
    const hourlyData = [];
    for (let h = 9; h <= 19; h++) {
      const found = rows.find((r) => r.hour === h);
      hourlyData.push({ hour: h, count: found ? found.count : 0 });
    }

    return ApiResponse.success(res, hourlyData);
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/dashboard/industry-conversion
 * 業種別案件化率 (グラフ用)
 */
const getIndustryConversion = async (req, res, next) => {
  try {
    const date = req.query.date || new Date().toISOString().slice(0, 10);

    const [rows] = await pool.execute(
      `SELECT
         co.industry,
         COUNT(c.id) as total_calls,
         SUM(CASE WHEN c.is_project_created = 1 THEN 1 ELSE 0 END) as projects,
         ROUND(
           SUM(CASE WHEN c.is_project_created = 1 THEN 1 ELSE 0 END) / COUNT(c.id) * 100, 1
         ) as conversion_rate
       FROM calls c
       JOIN companies co ON c.company_id = co.id
       WHERE DATE(c.call_started_at) = ? AND co.industry IS NOT NULL AND c.result_code != 'SKIP'
       GROUP BY co.industry
       ORDER BY conversion_rate DESC`,
      [date]
    );

    return ApiResponse.success(res, rows);
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/dashboard/hourly-industry-connections
 * 時間帯×業種別 接続数クロス集計 (result_code != 'NO_ANSWER')
 */
const getHourlyIndustryConnections = async (req, res, next) => {
  try {
    const userId = req.query.user_id || req.user.id;
    const date = req.query.date || new Date().toISOString().slice(0, 10);

    const [rows] = await pool.execute(
      `SELECT HOUR(c.call_started_at) as hour, co.industry, COUNT(*) as connections
       FROM calls c
       JOIN companies co ON c.company_id = co.id
       WHERE c.user_id = ? AND DATE(c.call_started_at) = ?
         AND c.result_code NOT IN ('NO_ANSWER', 'SKIP') AND c.result_code IS NOT NULL
         AND co.industry IS NOT NULL
       GROUP BY HOUR(c.call_started_at), co.industry
       ORDER BY hour, co.industry`,
      [userId, date]
    );

    // ユニーク業種リスト
    const industries = [...new Set(rows.map(r => r.industry))].sort();

    // 9〜19時のクロス集計テーブル整形
    const tableRows = [];
    const totals = {};
    industries.forEach(ind => { totals[ind] = 0; });
    let grandTotal = 0;

    for (let h = 9; h <= 19; h++) {
      const row = { hour: h };
      let rowTotal = 0;
      for (const ind of industries) {
        const found = rows.find(r => r.hour === h && r.industry === ind);
        const val = found ? found.connections : 0;
        row[ind] = val;
        totals[ind] += val;
        rowTotal += val;
      }
      row.total = rowTotal;
      grandTotal += rowTotal;
      tableRows.push(row);
    }

    return ApiResponse.success(res, {
      industries,
      rows: tableRows,
      totals: { ...totals, total: grandTotal },
    });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/dashboard/work-hours?date=YYYY-MM-DD
 * 手動入力の稼働時間を取得
 */
const getWorkHours = async (req, res, next) => {
  try {
    const date = req.query.date || new Date().toISOString().slice(0, 10);
    const [rows] = await pool.execute(
      'SELECT start_time, end_time FROM work_hours WHERE user_id = ? AND date = ?',
      [req.user.id, date]
    );
    return ApiResponse.success(res, rows[0] || null);
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/dashboard/work-hours
 * 稼働時間の開始/終了を保存
 */
const saveWorkHours = async (req, res, next) => {
  try {
    const { date, start_time, end_time } = req.body;
    if (!date || !start_time || !end_time) {
      return ApiResponse.badRequest(res, '日付・開始時間・終了時間は必須です');
    }
    await pool.execute(
      `INSERT INTO work_hours (user_id, date, start_time, end_time)
       VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE start_time = VALUES(start_time), end_time = VALUES(end_time)`,
      [req.user.id, date, start_time, end_time]
    );
    return ApiResponse.success(res, { date, start_time, end_time }, '稼働時間を保存しました');
  } catch (err) {
    next(err);
  }
};

module.exports = { getDailyStats, getHourlyCalls, getIndustryConversion, getHourlyIndustryConnections, getWorkHours, saveWorkHours };
