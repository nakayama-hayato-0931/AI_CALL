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

    // 稼働時間 (最初の架電から最後の架電までの差分)
    const [workTimeRows] = await pool.execute(
      `SELECT
         MIN(call_started_at) as first_call,
         MAX(COALESCE(call_ended_at, call_started_at)) as last_call
       FROM calls
       WHERE user_id = ? AND DATE(call_started_at) = ?`,
      [userId, date]
    );

    // コール数
    const [callCountRows] = await pool.execute(
      `SELECT COUNT(*) as call_count FROM calls
       WHERE user_id = ? AND DATE(call_started_at) = ?`,
      [userId, date]
    );

    // リコール獲得数
    const [recallGainRows] = await pool.execute(
      `SELECT COUNT(*) as recall_gained FROM calls
       WHERE user_id = ? AND DATE(call_started_at) = ? AND result_code = 'RECALL'`,
      [userId, date]
    );

    // リコール消化数
    const [recallDoneRows] = await pool.execute(
      `SELECT COUNT(*) as recall_done FROM recall_tasks
       WHERE user_id = ? AND DATE(updated_at) = ? AND status = 'completed'`,
      [userId, date]
    );

    // 有効接続数
    const [effectiveRows] = await pool.execute(
      `SELECT COUNT(*) as effective_count FROM calls
       WHERE user_id = ? AND DATE(call_started_at) = ? AND is_effective_connection = 1`,
      [userId, date]
    );

    // 担当者接続数
    const [personRows] = await pool.execute(
      `SELECT COUNT(*) as person_count FROM calls
       WHERE user_id = ? AND DATE(call_started_at) = ? AND is_person_in_charge = 1`,
      [userId, date]
    );

    // 案件獲得数
    const [projectRows] = await pool.execute(
      `SELECT COUNT(*) as project_count FROM calls
       WHERE user_id = ? AND DATE(call_started_at) = ? AND is_project_created = 1`,
      [userId, date]
    );

    // 稼働時間計算 (分)
    const workTime = workTimeRows[0];
    let workMinutes = 0;
    if (workTime.first_call && workTime.last_call) {
      workMinutes = Math.round(
        (new Date(workTime.last_call) - new Date(workTime.first_call)) / 60000
      );
    }

    return ApiResponse.success(res, {
      date,
      workMinutes,
      callCount: callCountRows[0].call_count,
      recallGained: recallGainRows[0].recall_gained,
      recallDone: recallDoneRows[0].recall_done,
      effectiveCount: effectiveRows[0].effective_count,
      personCount: personRows[0].person_count,
      projectCount: projectRows[0].project_count,
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
       WHERE user_id = ? AND DATE(call_started_at) = ?
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
       WHERE DATE(c.call_started_at) = ? AND co.industry IS NOT NULL
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
         AND c.result_code != 'NO_ANSWER' AND c.result_code IS NOT NULL
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

module.exports = { getDailyStats, getHourlyCalls, getIndustryConversion, getHourlyIndustryConnections };
