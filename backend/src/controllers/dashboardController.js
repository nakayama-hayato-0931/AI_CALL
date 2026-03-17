/**
 * ダッシュボードコントローラー
 * KPI集計・グラフデータ取得
 */
const pool = require('../../config/database');
const ApiResponse = require('../utils/apiResponse');
const { getDateRange } = require('../utils/periodHelper');

/**
 * GET /api/dashboard/stats
 * KPI統計取得（期間・スコープ対応）
 * ?date=YYYY-MM-DD&period=daily|weekly|monthly|cumulative&scope=self|team|operator&target_user_id=N
 */
const getDailyStats = async (req, res, next) => {
  try {
    const date = req.query.date || new Date().toISOString().slice(0, 10);
    const period = req.query.period || 'daily';
    const scope = req.query.scope || 'self';
    const targetUserId = req.query.target_user_id;
    const userRole = req.user.role;

    // scope=team/operator は manager以上のみ
    if ((scope === 'team' || scope === 'operator') && userRole !== 'admin' && userRole !== 'manager') {
      return ApiResponse.forbidden(res, '権限がありません');
    }

    // 日付範囲計算
    const range = getDateRange(period, date);
    const dateFrom = range.dateFrom;
    const dateTo = range.dateTo;

    // ユーザー条件
    let userCondition = '';
    let userParams = [];
    if (scope === 'team') {
      // 全ユーザー → user_id条件なし
    } else if (scope === 'operator' && targetUserId) {
      userCondition = 'AND c.user_id = ?';
      userParams = [targetUserId];
    } else {
      userCondition = 'AND c.user_id = ?';
      userParams = [req.user.id];
    }

    // 1クエリで全KPIを集計 (SKIPを除外)
    const [statsRows] = await pool.query(
      `SELECT
         MIN(call_started_at) as first_call,
         MAX(COALESCE(call_ended_at, call_started_at)) as last_call,
         COUNT(*) as call_count,
         CAST(SUM(CASE WHEN result_code = 'RECALL' THEN 1 ELSE 0 END) AS SIGNED) as recall_gained,
         CAST(SUM(CASE WHEN is_effective_connection = 1 THEN 1 ELSE 0 END) AS SIGNED) as effective_count,
         CAST(SUM(CASE WHEN is_person_in_charge = 1 THEN 1 ELSE 0 END) AS SIGNED) as person_count,
         CAST(SUM(CASE WHEN is_project_created = 1 THEN 1 ELSE 0 END) AS SIGNED) as project_count
       FROM calls c
       WHERE DATE(c.call_started_at) BETWEEN ? AND ? AND c.result_code != 'SKIP'
         ${userCondition}`,
      [dateFrom, dateTo, ...userParams]
    );

    // リコール消化数
    let recallUserCondition = '';
    let recallUserParams = [];
    if (scope === 'team') {
      // 全ユーザー
    } else if (scope === 'operator' && targetUserId) {
      recallUserCondition = 'AND user_id = ?';
      recallUserParams = [targetUserId];
    } else {
      recallUserCondition = 'AND user_id = ?';
      recallUserParams = [req.user.id];
    }

    const [recallDoneRows] = await pool.query(
      `SELECT COUNT(*) as recall_done FROM recall_tasks
       WHERE DATE(updated_at) BETWEEN ? AND ? AND status = 'completed'
         ${recallUserCondition}`,
      [dateFrom, dateTo, ...recallUserParams]
    );

    const s = statsRows[0];
    let workMinutes = 0;
    if (s.first_call && s.last_call) {
      workMinutes = Math.round(
        (new Date(s.last_call) - new Date(s.first_call)) / 60000
      );
    }

    // 手動入力の稼働時間
    let manualWorkHours = null;
    if (scope === 'team') {
      // チーム全体: 全員のwork_hoursを集計（期間範囲内）
      const [whTeamRows] = await pool.query(
        `SELECT
           SUM(
             TIMESTAMPDIFF(MINUTE,
               STR_TO_DATE(start_time, '%H:%i'),
               STR_TO_DATE(end_time, '%H:%i')
             )
           ) as total_minutes,
           COUNT(*) as entry_count
         FROM work_hours
         WHERE date BETWEEN ? AND ?`,
        [dateFrom, dateTo]
      );
      if (whTeamRows[0] && whTeamRows[0].total_minutes) {
        manualWorkHours = { totalMinutes: whTeamRows[0].total_minutes, entryCount: whTeamRows[0].entry_count };
      }
    } else {
      const whUserId = (scope === 'operator' && targetUserId) ? targetUserId : req.user.id;
      if (period === 'daily') {
        const [whRows] = await pool.execute(
          'SELECT start_time, end_time FROM work_hours WHERE user_id = ? AND date = ?',
          [whUserId, date]
        );
        manualWorkHours = whRows[0] || null;
      } else {
        // 期間範囲の合計
        const [whRows] = await pool.query(
          `SELECT
             SUM(
               TIMESTAMPDIFF(MINUTE,
                 STR_TO_DATE(start_time, '%H:%i'),
                 STR_TO_DATE(end_time, '%H:%i')
               )
             ) as total_minutes,
             COUNT(*) as entry_count
           FROM work_hours
           WHERE user_id = ? AND date BETWEEN ? AND ?`,
          [whUserId, dateFrom, dateTo]
        );
        if (whRows[0] && whRows[0].total_minutes) {
          manualWorkHours = { totalMinutes: whRows[0].total_minutes, entryCount: whRows[0].entry_count };
        }
      }
    }

    return ApiResponse.success(res, {
      date,
      period,
      scope,
      dateFrom,
      dateTo,
      workMinutes,
      callCount: s.call_count,
      recallGained: s.recall_gained,
      recallDone: recallDoneRows[0].recall_done,
      effectiveCount: s.effective_count,
      personCount: s.person_count,
      projectCount: s.project_count,
      manualWorkHours,
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
    const userRole = req.user.role;
    const userId = req.query.user_id || req.user.id;
    const date = req.query.date || new Date().toISOString().slice(0, 10);
    const isManagerView = (userRole === 'admin' || userRole === 'manager') && !req.query.user_id;

    let rows;
    if (isManagerView) {
      [rows] = await pool.query(
        `SELECT HOUR(call_started_at) as hour, COUNT(*) as count
         FROM calls
         WHERE DATE(call_started_at) = ? AND result_code != 'SKIP'
         GROUP BY HOUR(call_started_at)
         ORDER BY hour`,
        [date]
      );
    } else {
      [rows] = await pool.execute(
        `SELECT HOUR(call_started_at) as hour, COUNT(*) as count
         FROM calls
         WHERE user_id = ? AND DATE(call_started_at) = ? AND result_code != 'SKIP'
         GROUP BY HOUR(call_started_at)
         ORDER BY hour`,
        [userId, date]
      );
    }

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
 * 業種別案件化率 (累計・全期間)
 */
const getIndustryConversion = async (req, res, next) => {
  try {
    const userRole = req.user.role;
    const userId = req.query.user_id || req.user.id;
    const isManagerView = (userRole === 'admin' || userRole === 'manager') && !req.query.user_id;

    let rows;
    if (isManagerView) {
      [rows] = await pool.query(
        `SELECT
           co.industry,
           COUNT(c.id) as total_calls,
           CAST(SUM(CASE WHEN c.is_project_created = 1 THEN 1 ELSE 0 END) AS SIGNED) as projects,
           ROUND(
             CAST(SUM(CASE WHEN c.is_project_created = 1 THEN 1 ELSE 0 END) AS SIGNED) / COUNT(c.id) * 100, 1
           ) as conversion_rate
         FROM calls c
         JOIN companies co ON c.company_id = co.id
         WHERE co.industry IS NOT NULL AND c.result_code != 'SKIP'
         GROUP BY co.industry
         ORDER BY conversion_rate DESC`
      );
    } else {
      [rows] = await pool.execute(
        `SELECT
           co.industry,
           COUNT(c.id) as total_calls,
           CAST(SUM(CASE WHEN c.is_project_created = 1 THEN 1 ELSE 0 END) AS SIGNED) as projects,
           ROUND(
             CAST(SUM(CASE WHEN c.is_project_created = 1 THEN 1 ELSE 0 END) AS SIGNED) / COUNT(c.id) * 100, 1
           ) as conversion_rate
         FROM calls c
         JOIN companies co ON c.company_id = co.id
         WHERE c.user_id = ? AND co.industry IS NOT NULL AND c.result_code != 'SKIP'
         GROUP BY co.industry
         ORDER BY conversion_rate DESC`,
        [userId]
      );
    }

    return ApiResponse.success(res, rows);
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/dashboard/hourly-industry-connections
 * 時間帯×業種別 接続数/接続率クロス集計 (累計・全期間)
 */
const getHourlyIndustryConnections = async (req, res, next) => {
  try {
    const userRole = req.user.role;
    const userId = req.query.user_id || req.user.id;
    const isManagerView = (userRole === 'admin' || userRole === 'manager') && !req.query.user_id;

    let rows, totalRows;
    if (isManagerView) {
      // 接続数（NO_ANSWER, SKIP除外）- チーム全体
      [rows] = await pool.query(
        `SELECT HOUR(c.call_started_at) as hour, co.industry, COUNT(*) as connections
         FROM calls c
         JOIN companies co ON c.company_id = co.id
         WHERE c.result_code NOT IN ('NO_ANSWER', 'SKIP') AND c.result_code IS NOT NULL
           AND co.industry IS NOT NULL
         GROUP BY HOUR(c.call_started_at), co.industry
         ORDER BY hour, co.industry`
      );
      // 総コール数（接続率計算用、SKIP除外）- チーム全体
      [totalRows] = await pool.query(
        `SELECT HOUR(c.call_started_at) as hour, co.industry, COUNT(*) as total_calls
         FROM calls c
         JOIN companies co ON c.company_id = co.id
         WHERE c.result_code != 'SKIP'
           AND co.industry IS NOT NULL
         GROUP BY HOUR(c.call_started_at), co.industry`
      );
    } else {
      // 接続数（NO_ANSWER, SKIP除外）
      [rows] = await pool.execute(
        `SELECT HOUR(c.call_started_at) as hour, co.industry, COUNT(*) as connections
         FROM calls c
         JOIN companies co ON c.company_id = co.id
         WHERE c.user_id = ? AND c.result_code NOT IN ('NO_ANSWER', 'SKIP') AND c.result_code IS NOT NULL
           AND co.industry IS NOT NULL
         GROUP BY HOUR(c.call_started_at), co.industry
         ORDER BY hour, co.industry`,
        [userId]
      );
      // 総コール数（接続率計算用、SKIP除外）
      [totalRows] = await pool.execute(
        `SELECT HOUR(c.call_started_at) as hour, co.industry, COUNT(*) as total_calls
         FROM calls c
         JOIN companies co ON c.company_id = co.id
         WHERE c.user_id = ? AND c.result_code != 'SKIP'
           AND co.industry IS NOT NULL
         GROUP BY HOUR(c.call_started_at), co.industry`,
        [userId]
      );
    }

    // ユニーク業種リスト
    const allIndustries = new Set([...rows.map(r => r.industry), ...totalRows.map(r => r.industry)]);
    const industries = [...allIndustries].sort();

    // 9〜19時のクロス集計テーブル整形
    const tableRows = [];
    const totals = {};
    const totalCalls = {};
    industries.forEach(ind => { totals[ind] = 0; totalCalls[ind] = 0; });
    let grandTotal = 0;
    let grandTotalCalls = 0;

    for (let h = 9; h <= 19; h++) {
      const row = { hour: h };
      let rowTotal = 0;
      let rowTotalCalls = 0;
      for (const ind of industries) {
        const found = rows.find(r => r.hour === h && r.industry === ind);
        const foundTotal = totalRows.find(r => r.hour === h && r.industry === ind);
        const val = found ? found.connections : 0;
        const calls = foundTotal ? foundTotal.total_calls : 0;
        row[ind] = val;
        row[`${ind}_total`] = calls;
        totals[ind] += val;
        totalCalls[ind] += calls;
        rowTotal += val;
        rowTotalCalls += calls;
      }
      row.total = rowTotal;
      row.totalCalls = rowTotalCalls;
      grandTotal += rowTotal;
      grandTotalCalls += rowTotalCalls;
      tableRows.push(row);
    }

    return ApiResponse.success(res, {
      industries,
      rows: tableRows,
      totals: { ...totals, total: grandTotal },
      totalCalls: { ...totalCalls, total: grandTotalCalls },
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
