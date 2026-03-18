/**
 * CPA・案件質分析コントローラー
 */
const pool = require('../../config/database');
const ApiResponse = require('../utils/apiResponse');
const { getDateRange } = require('../utils/periodHelper');
const logger = require('../utils/logger');

const HOURLY_RATE = 1500; // 時給（円）

/**
 * GET /api/analytics/cpa
 * CPA指標集計
 * ?date=YYYY-MM-DD&period=monthly|weekly|cumulative&scope=team|operator&target_user_id=N
 */
const getCpaMetrics = async (req, res, next) => {
  try {
    const date = req.query.date || new Date().toISOString().slice(0, 10);
    const period = req.query.period || 'monthly';
    const scope = req.query.scope || 'team';
    const targetUserId = req.query.target_user_id;

    const range = getDateRange(period, date);
    if (!range) return ApiResponse.badRequest(res, '無効な期間です');
    const { dateFrom, dateTo } = range;

    // ユーザー条件
    let callUserCond = '';
    let projUserCond = '';
    let whUserCond = '';
    const callParams = [dateFrom, dateTo];
    const projParams = [dateFrom, dateTo];
    const whParams = [dateFrom, dateTo];

    if (scope === 'operator' && targetUserId) {
      callUserCond = 'AND c.user_id = ?';
      callParams.push(targetUserId);
      projUserCond = 'AND p.owner_user_id = ?';
      projParams.push(targetUserId);
      whUserCond = 'AND wh.user_id = ?';
      whParams.push(targetUserId);
    }

    // コスト（稼働時間 × 時給）
    const [costRows] = await pool.query(
      `SELECT COALESCE(SUM(
        TIMESTAMPDIFF(MINUTE, CONCAT(wh.date, ' ', wh.start_time), CONCAT(wh.date, ' ', wh.end_time))
        - COALESCE(wh.break_minutes, 0)
      ), 0) as total_minutes
       FROM work_hours wh
       WHERE wh.date BETWEEN ? AND ? ${whUserCond}`,
      whParams
    );
    const totalMinutes = Number(costRows[0].total_minutes) || 0;
    const cost = Math.round(totalMinutes / 60 * HOURLY_RATE);

    // コール数
    const [callRows] = await pool.query(
      `SELECT COUNT(*) as call_count
       FROM calls c
       WHERE DATE(c.call_started_at) BETWEEN ? AND ?
         AND c.result_code IS NOT NULL AND c.result_code != 'SKIP'
         ${callUserCond}`,
      callParams
    );
    const callCount = Number(callRows[0].call_count) || 0;

    // 案件数
    const [projCountRows] = await pool.query(
      `SELECT COUNT(*) as project_count
       FROM projects p
       WHERE DATE(p.created_at) BETWEEN ? AND ? ${projUserCond}`,
      projParams
    );
    const projectCount = Number(projCountRows[0].project_count) || 0;

    // ステータス別集計
    const [statusRows] = await pool.query(
      `SELECT
         CAST(SUM(CASE WHEN p.status IN ('NAITEI','NAITEI_TORIKESHI','FUGOKAKU','KEKKA_MACHI') THEN 1 ELSE 0 END) AS SIGNED) as interview_count,
         CAST(SUM(CASE WHEN p.status = 'NAITEI' THEN 1 ELSE 0 END) AS SIGNED) as naitei_count,
         CAST(SUM(CASE WHEN p.status = 'FUGOKAKU' THEN 1 ELSE 0 END) AS SIGNED) as fugokaku_count,
         CAST(SUM(CASE WHEN p.status IN ('BARASHI','LOST') THEN 1 ELSE 0 END) AS SIGNED) as barashi_lost_count
       FROM projects p
       WHERE DATE(p.created_at) BETWEEN ? AND ? ${projUserCond}`,
      projParams
    );
    const interviewCount = Number(statusRows[0].interview_count) || 0;
    const naiteiCount = Number(statusRows[0].naitei_count) || 0;
    const fugokakuCount = Number(statusRows[0].fugokaku_count) || 0;
    const barashiLostCount = Number(statusRows[0].barashi_lost_count) || 0;

    // 初回入金・見込売上
    const [finRows] = await pool.query(
      `SELECT
         COALESCE(SUM(ph.initial_payment), 0) as total_initial_payment,
         COALESCE(SUM(ph.expected_revenue), 0) as total_expected_revenue
       FROM project_hires ph
       JOIN projects p ON ph.project_id = p.id
       WHERE DATE(p.created_at) BETWEEN ? AND ?
         AND ph.is_cancelled = 0
         ${projUserCond}`,
      projParams
    );
    const initialPayment = Number(finRows[0].total_initial_payment) || 0;
    const expectedRevenue = Number(finRows[0].total_expected_revenue) || 0;

    // 算出
    const projectRate = callCount > 0 ? (projectCount / callCount * 100) : 0;
    const projectCpa = projectCount > 0 ? Math.round(cost / projectCount) : 0;
    const interviewCpa = interviewCount > 0 ? Math.round(cost / interviewCount) : 0;
    const roas = cost > 0 ? (initialPayment / cost * 100) : 0;

    return ApiResponse.success(res, {
      dateFrom, dateTo,
      cost,
      callCount,
      projectRate: Math.round(projectRate * 100) / 100,
      projectCount,
      projectCpa,
      interviewCount,
      interviewCpa,
      naiteiCount,
      fugokakuCount,
      barashiLostCount,
      initialPayment,
      expectedRevenue,
      roas: Math.round(roas * 100) / 100,
    });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/analytics/quality
 * 案件質向上指標
 */
const getQualityMetrics = async (req, res, next) => {
  try {
    const date = req.query.date || new Date().toISOString().slice(0, 10);
    const period = req.query.period || 'monthly';
    const scope = req.query.scope || 'team';
    const targetUserId = req.query.target_user_id;

    const range = getDateRange(period, date);
    if (!range) return ApiResponse.badRequest(res, '無効な期間です');
    const { dateFrom, dateTo } = range;

    let userCond = '';
    const params = [dateFrom, dateTo];
    if (scope === 'operator' && targetUserId) {
      userCond = 'AND p.owner_user_id = ?';
      params.push(targetUserId);
    }

    const [rows] = await pool.query(
      `SELECT
         COUNT(*) as total,
         CAST(SUM(CASE WHEN p.status = 'LOST' THEN 1 ELSE 0 END) AS SIGNED) as lost,
         CAST(SUM(CASE WHEN COALESCE(p.mail_sent, 0) = 0 AND COALESCE(p.phone_confirmed, 0) = 0 THEN 1 ELSE 0 END) AS SIGNED) as waiting_contact,
         CAST(SUM(CASE WHEN p.interview_date IS NOT NULL THEN 1 ELSE 0 END) AS SIGNED) as interview_set,
         CAST(SUM(CASE WHEN p.status IN ('KEKKA_MACHI','NAITEI','NAITEI_TORIKESHI','FUGOKAKU') THEN 1 ELSE 0 END) AS SIGNED) as interview_done,
         CAST(SUM(CASE WHEN p.status = 'BARASHI' THEN 1 ELSE 0 END) AS SIGNED) as barashi,
         CAST(SUM(CASE WHEN p.interview_type = 'online' THEN 1 ELSE 0 END) AS SIGNED) as online_interview,
         CAST(SUM(CASE WHEN p.document_screening = 'not_required' THEN 1 ELSE 0 END) AS SIGNED) as no_screening,
         CAST(SUM(CASE WHEN p.status = 'SHORUI_OCHI' THEN 1 ELSE 0 END) AS SIGNED) as screening_failed
       FROM projects p
       WHERE DATE(p.created_at) BETWEEN ? AND ? ${userCond}`,
      params
    );

    const total = Number(rows[0].total) || 0;
    const pct = (v) => total > 0 ? Math.round(v / total * 10000) / 100 : 0;

    const data = {
      dateFrom, dateTo,
      total,
      lost: Number(rows[0].lost) || 0,
      lostPct: pct(Number(rows[0].lost) || 0),
      waitingContact: Number(rows[0].waiting_contact) || 0,
      waitingContactPct: pct(Number(rows[0].waiting_contact) || 0),
      interviewSet: Number(rows[0].interview_set) || 0,
      interviewSetPct: pct(Number(rows[0].interview_set) || 0),
      interviewDone: Number(rows[0].interview_done) || 0,
      interviewDonePct: pct(Number(rows[0].interview_done) || 0),
      barashi: Number(rows[0].barashi) || 0,
      barashiPct: pct(Number(rows[0].barashi) || 0),
      onlineInterview: Number(rows[0].online_interview) || 0,
      onlineInterviewPct: pct(Number(rows[0].online_interview) || 0),
      noScreening: Number(rows[0].no_screening) || 0,
      noScreeningPct: pct(Number(rows[0].no_screening) || 0),
      screeningFailed: Number(rows[0].screening_failed) || 0,
      screeningFailedPct: pct(Number(rows[0].screening_failed) || 0),
    };

    return ApiResponse.success(res, data);
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/analytics/operators
 * オペレーター一覧（比較用）
 */
const getOperators = async (req, res, next) => {
  try {
    const [rows] = await pool.execute(
      "SELECT id, name FROM users WHERE is_active = 1 AND role IN ('operator','manager','admin') ORDER BY name"
    );
    return ApiResponse.success(res, rows);
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/analytics/import-cost-csv
 * コストCSVインポート（出勤時間）
 * CSV: 日付,名前,開始,終了,休憩(分)
 */
const importCostCsv = async (req, res, next) => {
  try {
    if (!req.file) return ApiResponse.badRequest(res, 'ファイルが必要です');

    const content = req.file.buffer.toString('utf-8');
    const lines = content.split(/\r?\n/).filter(l => l.trim());
    if (lines.length < 2) return ApiResponse.badRequest(res, 'データがありません');

    // ユーザー名→IDマッピング
    const [users] = await pool.execute('SELECT id, name FROM users WHERE is_active = 1');
    const nameMap = new Map();
    users.forEach(u => nameMap.set(u.name.trim(), u.id));

    let imported = 0;
    let errors = [];

    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(',').map(c => c.trim());
      if (cols.length < 4) continue;

      const [dateStr, name, startTime, endTime, breakMin] = cols;
      const userId = nameMap.get(name);
      if (!userId) {
        errors.push(`行${i + 1}: ユーザー「${name}」が見つかりません`);
        continue;
      }

      try {
        await pool.execute(
          `INSERT INTO work_hours (user_id, date, start_time, end_time, break_minutes)
           VALUES (?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE start_time = VALUES(start_time), end_time = VALUES(end_time), break_minutes = VALUES(break_minutes)`,
          [userId, dateStr, startTime, endTime, parseInt(breakMin, 10) || 0]
        );
        imported++;
      } catch (e) {
        errors.push(`行${i + 1}: ${e.message}`);
      }
    }

    logger.info(`コストCSVインポート: ${imported}件成功, ${errors.length}件エラー`);
    return ApiResponse.success(res, { imported, errors: errors.slice(0, 20) });
  } catch (err) {
    next(err);
  }
};

module.exports = { getCpaMetrics, getQualityMetrics, getOperators, importCostCsv };
