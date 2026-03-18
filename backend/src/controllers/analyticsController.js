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

    // コスト（CSVインポート出勤記録 × 時給）
    const [costRows] = await pool.query(
      `SELECT COALESCE(SUM(
        TIMESTAMPDIFF(MINUTE, CONCAT(cr.date, ' ', cr.start_time), CONCAT(cr.date, ' ', cr.end_time))
        - COALESCE(cr.break_minutes, 0)
      ), 0) as total_minutes
       FROM cost_records cr
       WHERE cr.date BETWEEN ? AND ? ${whUserCond.replace(/wh\./g, 'cr.')}`,
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
          `INSERT INTO cost_records (user_id, date, start_time, end_time, break_minutes)
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

/**
 * POST /api/analytics/import-cost-pdf
 * 出勤表PDFインポート
 * PDF内のテーブルから日付・名前・開始時刻・終了時刻・休憩時間を自動抽出
 */
const importCostPdf = async (req, res, next) => {
  try {
    if (!req.file) return ApiResponse.badRequest(res, 'ファイルが必要です');

    const pdfParse = require('pdf-parse');
    const pdfData = await pdfParse(req.file.buffer);
    const text = pdfData.text;

    if (!text || text.trim().length === 0) {
      return ApiResponse.badRequest(res, 'PDFからテキストを抽出できませんでした');
    }

    // ユーザー名→IDマッピング
    const [users] = await pool.execute('SELECT id, name FROM users WHERE is_active = 1');
    const nameMap = new Map();
    users.forEach(u => nameMap.set(u.name.trim(), u.id));

    const lines = text.split(/\n/).filter(l => l.trim());
    let imported = 0;
    let errors = [];
    let skipped = 0;

    // 日付パターン: YYYY/MM/DD, YYYY-MM-DD, MM/DD, M/D
    const datePatterns = [
      /(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})/,
      /(\d{1,2})[\/](\d{1,2})/,
    ];
    // 時刻パターン: HH:MM, H:MM
    const timePattern = /(\d{1,2}):(\d{2})/g;

    // PDFから年月の推定（ヘッダーなどから）
    let guessYear = new Date().getFullYear();
    let guessMonth = null;
    const ymMatch = text.match(/(\d{4})\s*年\s*(\d{1,2})\s*月/);
    if (ymMatch) {
      guessYear = parseInt(ymMatch[1], 10);
      guessMonth = parseInt(ymMatch[2], 10);
    }

    for (const line of lines) {
      // 行内に時刻が2つ以上含まれていれば出勤データ行の可能性
      const timesInLine = line.match(timePattern);
      if (!timesInLine || timesInLine.length < 2) continue;

      // 日付を探す
      let dateStr = null;
      const fullDateMatch = line.match(datePatterns[0]);
      if (fullDateMatch) {
        const y = fullDateMatch[1];
        const m = String(fullDateMatch[2]).padStart(2, '0');
        const d = String(fullDateMatch[3]).padStart(2, '0');
        dateStr = `${y}-${m}-${d}`;
      } else {
        const shortDateMatch = line.match(datePatterns[1]);
        if (shortDateMatch) {
          const m = String(shortDateMatch[1]).padStart(2, '0');
          const d = String(shortDateMatch[2]).padStart(2, '0');
          dateStr = `${guessYear}-${m}-${d}`;
        }
      }

      // 名前を探す（登録ユーザー名とマッチ）
      let matchedUserId = null;
      let matchedName = null;
      for (const [name, id] of nameMap) {
        if (line.includes(name)) {
          matchedUserId = id;
          matchedName = name;
          break;
        }
      }

      if (!dateStr || !matchedUserId) {
        // 日付と名前の両方が揃わない行はスキップ
        if (dateStr || matchedUserId) skipped++;
        continue;
      }

      // 時刻抽出（最初の2つを開始・終了とする）
      const startTime = timesInLine[0];
      const endTime = timesInLine[1];

      // 休憩時間の推定（3つ目の時刻 or 数値(分)パターン）
      let breakMinutes = 0;
      if (timesInLine.length >= 3) {
        // 3つ目の時刻が休憩時間（HH:MM形式）の場合
        const [bh, bm] = timesInLine[2].split(':').map(Number);
        breakMinutes = bh * 60 + bm;
      } else {
        // 「休憩」「休」の近くの数値を探す
        const breakMatch = line.match(/休[憩]?\s*(\d+)/);
        if (breakMatch) {
          breakMinutes = parseInt(breakMatch[1], 10);
        } else {
          // 行末付近の独立した数値（60, 45など）を休憩分とみなす
          const nums = line.match(/\b(\d{2,3})\b/g);
          if (nums && nums.length > 0) {
            const lastNum = parseInt(nums[nums.length - 1], 10);
            if (lastNum >= 0 && lastNum <= 120 && !timesInLine.includes(nums[nums.length - 1])) {
              breakMinutes = lastNum;
            }
          }
        }
      }

      try {
        await pool.execute(
          `INSERT INTO cost_records (user_id, date, start_time, end_time, break_minutes)
           VALUES (?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE start_time = VALUES(start_time), end_time = VALUES(end_time), break_minutes = VALUES(break_minutes)`,
          [matchedUserId, dateStr, startTime, endTime, breakMinutes]
        );
        imported++;
      } catch (e) {
        errors.push(`${matchedName} ${dateStr}: ${e.message}`);
      }
    }

    logger.info(`コストPDFインポート: ${imported}件成功, ${errors.length}件エラー, ${skipped}件スキップ`);
    return ApiResponse.success(res, {
      imported,
      skipped,
      errors: errors.slice(0, 20),
      hint: imported === 0 ? 'PDFの形式が認識できませんでした。CSV形式でのインポートもご利用ください。' : null,
    });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/analytics/cpa-all
 * 全オペレーター一括CPA指標（比較テーブル用）
 */
const getCpaAll = async (req, res, next) => {
  try {
    const date = req.query.date || new Date().toISOString().slice(0, 10);
    const period = req.query.period || 'monthly';
    const range = getDateRange(period, date);
    if (!range) return ApiResponse.badRequest(res, '無効な期間です');
    const { dateFrom, dateTo } = range;

    // アクティブオペレーター
    const [users] = await pool.execute(
      "SELECT id, name FROM users WHERE is_active = 1 AND role IN ('operator','manager','admin') ORDER BY name"
    );

    // コスト（全員分一括）
    const [costAll] = await pool.query(
      `SELECT cr.user_id,
        COALESCE(SUM(TIMESTAMPDIFF(MINUTE, CONCAT(cr.date,' ',cr.start_time), CONCAT(cr.date,' ',cr.end_time)) - COALESCE(cr.break_minutes,0)), 0) as total_minutes
       FROM cost_records cr WHERE cr.date BETWEEN ? AND ? GROUP BY cr.user_id`,
      [dateFrom, dateTo]
    );
    const costMap = new Map(costAll.map(r => [r.user_id, Math.round(Number(r.total_minutes) / 60 * HOURLY_RATE)]));

    // コール数（全員分一括）
    const [callAll] = await pool.query(
      `SELECT c.user_id, COUNT(*) as cnt
       FROM calls c WHERE DATE(c.call_started_at) BETWEEN ? AND ? AND c.result_code IS NOT NULL AND c.result_code != 'SKIP'
       GROUP BY c.user_id`,
      [dateFrom, dateTo]
    );
    const callMap = new Map(callAll.map(r => [r.user_id, Number(r.cnt)]));

    // 案件数・ステータス（全員分一括）
    const [projAll] = await pool.query(
      `SELECT p.owner_user_id as user_id,
        COUNT(*) as project_count,
        CAST(SUM(CASE WHEN p.status IN ('NAITEI','NAITEI_TORIKESHI','FUGOKAKU','KEKKA_MACHI') THEN 1 ELSE 0 END) AS SIGNED) as interview_count,
        CAST(SUM(CASE WHEN p.status = 'NAITEI' THEN 1 ELSE 0 END) AS SIGNED) as naitei_count,
        CAST(SUM(CASE WHEN p.status = 'FUGOKAKU' THEN 1 ELSE 0 END) AS SIGNED) as fugokaku_count,
        CAST(SUM(CASE WHEN p.status IN ('BARASHI','LOST') THEN 1 ELSE 0 END) AS SIGNED) as barashi_lost_count
       FROM projects p WHERE DATE(p.created_at) BETWEEN ? AND ? GROUP BY p.owner_user_id`,
      [dateFrom, dateTo]
    );
    const projMap = new Map(projAll.map(r => [r.user_id, r]));

    // 金額（全員分一括）
    const [finAll] = await pool.query(
      `SELECT p.owner_user_id as user_id,
        COALESCE(SUM(ph.initial_payment), 0) as ip, COALESCE(SUM(ph.expected_revenue), 0) as er
       FROM project_hires ph JOIN projects p ON ph.project_id = p.id
       WHERE DATE(p.created_at) BETWEEN ? AND ? AND ph.is_cancelled = 0
       GROUP BY p.owner_user_id`,
      [dateFrom, dateTo]
    );
    const finMap = new Map(finAll.map(r => [r.user_id, { ip: Number(r.ip), er: Number(r.er) }]));

    // チーム全体
    const teamCost = [...costMap.values()].reduce((s, v) => s + v, 0);
    const teamCalls = [...callMap.values()].reduce((s, v) => s + v, 0);
    const teamProjects = projAll.reduce((s, r) => s + Number(r.project_count), 0);
    const teamInterviews = projAll.reduce((s, r) => s + Number(r.interview_count), 0);
    const teamNaitei = projAll.reduce((s, r) => s + Number(r.naitei_count), 0);
    const teamFugokaku = projAll.reduce((s, r) => s + Number(r.fugokaku_count), 0);
    const teamBarashiLost = projAll.reduce((s, r) => s + Number(r.barashi_lost_count), 0);
    const teamIp = finAll.reduce((s, r) => s + Number(r.ip), 0);
    const teamEr = finAll.reduce((s, r) => s + Number(r.er), 0);

    const buildRow = (cost, calls, proj, fin) => {
      const pc = proj ? Number(proj.project_count) : 0;
      const ic = proj ? Number(proj.interview_count) : 0;
      return {
        cost,
        callCount: calls,
        projectRate: calls > 0 ? Math.round(pc / calls * 10000) / 100 : 0,
        projectCount: pc,
        projectCpa: pc > 0 ? Math.round(cost / pc) : 0,
        interviewCount: ic,
        interviewCpa: ic > 0 ? Math.round(cost / ic) : 0,
        naiteiCount: proj ? Number(proj.naitei_count) : 0,
        fugokakuCount: proj ? Number(proj.fugokaku_count) : 0,
        barashiLostCount: proj ? Number(proj.barashi_lost_count) : 0,
        initialPayment: fin ? fin.ip : 0,
        expectedRevenue: fin ? fin.er : 0,
        roas: cost > 0 && fin ? Math.round(fin.ip / cost * 10000) / 100 : 0,
      };
    };

    const operators = users.map(u => ({
      userId: u.id,
      name: u.name,
      ...buildRow(costMap.get(u.id) || 0, callMap.get(u.id) || 0, projMap.get(u.id), finMap.get(u.id)),
    }));

    const team = {
      name: '全体',
      ...buildRow(teamCost, teamCalls, {
        project_count: teamProjects, interview_count: teamInterviews,
        naitei_count: teamNaitei, fugokaku_count: teamFugokaku, barashi_lost_count: teamBarashiLost,
      }, { ip: teamIp, er: teamEr }),
    };

    return ApiResponse.success(res, { dateFrom, dateTo, team, operators });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/analytics/quality-all
 * 全オペレーター一括案件質指標
 */
const getQualityAll = async (req, res, next) => {
  try {
    const date = req.query.date || new Date().toISOString().slice(0, 10);
    const period = req.query.period || 'monthly';
    const range = getDateRange(period, date);
    if (!range) return ApiResponse.badRequest(res, '無効な期間です');
    const { dateFrom, dateTo } = range;

    const [users] = await pool.execute(
      "SELECT id, name FROM users WHERE is_active = 1 AND role IN ('operator','manager','admin') ORDER BY name"
    );

    const [rows] = await pool.query(
      `SELECT p.owner_user_id as user_id,
        COUNT(*) as total,
        CAST(SUM(CASE WHEN p.status = 'LOST' THEN 1 ELSE 0 END) AS SIGNED) as lost,
        CAST(SUM(CASE WHEN COALESCE(p.mail_sent,0)=0 AND COALESCE(p.phone_confirmed,0)=0 THEN 1 ELSE 0 END) AS SIGNED) as waiting_contact,
        CAST(SUM(CASE WHEN p.interview_date IS NOT NULL THEN 1 ELSE 0 END) AS SIGNED) as interview_set,
        CAST(SUM(CASE WHEN p.status IN ('KEKKA_MACHI','NAITEI','NAITEI_TORIKESHI','FUGOKAKU') THEN 1 ELSE 0 END) AS SIGNED) as interview_done,
        CAST(SUM(CASE WHEN p.status = 'BARASHI' THEN 1 ELSE 0 END) AS SIGNED) as barashi,
        CAST(SUM(CASE WHEN p.interview_type = 'online' THEN 1 ELSE 0 END) AS SIGNED) as online_interview,
        CAST(SUM(CASE WHEN p.document_screening = 'not_required' THEN 1 ELSE 0 END) AS SIGNED) as no_screening,
        CAST(SUM(CASE WHEN p.status = 'SHORUI_OCHI' THEN 1 ELSE 0 END) AS SIGNED) as screening_failed
       FROM projects p WHERE DATE(p.created_at) BETWEEN ? AND ? GROUP BY p.owner_user_id`,
      [dateFrom, dateTo]
    );
    const qMap = new Map(rows.map(r => [r.user_id, r]));

    const buildQ = (r) => {
      const t = r ? Number(r.total) : 0;
      const p = (v) => t > 0 ? Math.round(v / t * 10000) / 100 : 0;
      const n = (f) => r ? Number(r[f]) : 0;
      return {
        total: t, lost: n('lost'), lostPct: p(n('lost')),
        waitingContact: n('waiting_contact'), waitingContactPct: p(n('waiting_contact')),
        interviewSet: n('interview_set'), interviewSetPct: p(n('interview_set')),
        interviewDone: n('interview_done'), interviewDonePct: p(n('interview_done')),
        barashi: n('barashi'), barashiPct: p(n('barashi')),
        onlineInterview: n('online_interview'), onlineInterviewPct: p(n('online_interview')),
        noScreening: n('no_screening'), noScreeningPct: p(n('no_screening')),
        screeningFailed: n('screening_failed'), screeningFailedPct: p(n('screening_failed')),
      };
    };

    // チーム全体
    const allR = {};
    for (const f of ['total','lost','waiting_contact','interview_set','interview_done','barashi','online_interview','no_screening','screening_failed']) {
      allR[f] = rows.reduce((s, r) => s + Number(r[f]), 0);
    }
    const team = { name: '全体', ...buildQ(allR) };
    const operators = users.map(u => ({ userId: u.id, name: u.name, ...buildQ(qMap.get(u.id)) }));

    return ApiResponse.success(res, { dateFrom, dateTo, team, operators });
  } catch (err) {
    next(err);
  }
};

module.exports = { getCpaMetrics, getQualityMetrics, getOperators, importCostCsv, importCostPdf, getCpaAll, getQualityAll };
