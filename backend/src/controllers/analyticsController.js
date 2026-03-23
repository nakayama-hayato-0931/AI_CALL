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

    // コスト（CSVインポート出勤記録 × 時給 + 交通費）
    const [costRows] = await pool.query(
      `SELECT COALESCE(SUM(
        TIMESTAMPDIFF(MINUTE, CONCAT(cr.date, ' ', cr.start_time), CONCAT(cr.date, ' ', cr.end_time))
        - COALESCE(cr.break_minutes, 0)
      ), 0) as total_minutes,
      COUNT(DISTINCT cr.date) as work_days
       FROM cost_records cr
       WHERE cr.date BETWEEN ? AND ? ${whUserCond.replace(/wh\./g, 'cr.')}`,
      whParams
    );
    const totalMinutes = Number(costRows[0].total_minutes) || 0;
    let cost = Math.round(totalMinutes / 60 * HOURLY_RATE);
    // 交通費加算（個人指定時のみ）
    if (targetUserId) {
      const [uRows] = await pool.query('SELECT commute_type, commute_teiki_monthly, commute_daily_amount FROM users WHERE id = ?', [targetUserId]);
      if (uRows.length > 0) {
        const u = uRows[0];
        if (u.commute_type === 'teiki') {
          const d1 = new Date(dateFrom), d2 = new Date(dateTo);
          const months = (d2.getFullYear() - d1.getFullYear()) * 12 + (d2.getMonth() - d1.getMonth()) + 1;
          cost += (u.commute_teiki_monthly || 0) * Math.min(months, 12);
        } else if (u.commute_type === 'daily') {
          cost += (u.commute_daily_amount || 0) * Number(costRows[0].work_days || 0);
        }
      }
    }

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
      "SELECT id, name, operator_level, target_work_hours, target_calls_per_h, target_effective_per_h, target_person_per_h, target_project_hours FROM users WHERE is_active = 1 AND role = 'operator' ORDER BY id ASC"
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

    // CSVの日付範囲を先に取得し、その範囲の既存データを削除（上書きモード）
    const dataLines = lines.slice(1);
    const csvDates = new Set();
    for (const line of dataLines) {
      const cols = line.split(',');
      if (cols[0] && cols[0].match(/^\d{4}-\d{2}-\d{2}$/)) csvDates.add(cols[0]);
    }
    if (csvDates.size > 0) {
      const minDate = [...csvDates].sort()[0];
      const maxDate = [...csvDates].sort().reverse()[0];
      await pool.execute('DELETE FROM cost_records WHERE date BETWEEN ? AND ?', [minDate, maxDate]);
    }

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
    const period = req.query.period || 'monthly';
    let dateFrom, dateTo;
    if (req.query.date_from && req.query.date_to) {
      dateFrom = req.query.date_from;
      dateTo = req.query.date_to;
    } else {
      const date = req.query.date || new Date().toISOString().slice(0, 10);
      const range = getDateRange(period, date);
      if (!range) return ApiResponse.badRequest(res, '無効な期間です');
      dateFrom = range.dateFrom;
      dateTo = range.dateTo;
    }

    // アクティブオペレーター（交通費情報含む）
    const [users] = await pool.execute(
      "SELECT id, name, operator_level, commute_type, commute_teiki_monthly, commute_daily_amount FROM users WHERE is_active = 1 AND role = 'operator' ORDER BY id ASC"
    );

    // コスト（全員分一括）
    const [costAll] = await pool.query(
      `SELECT cr.user_id,
        COALESCE(SUM(TIMESTAMPDIFF(MINUTE, CONCAT(cr.date,' ',cr.start_time), CONCAT(cr.date,' ',cr.end_time)) - COALESCE(cr.break_minutes,0)), 0) as total_minutes,
        COUNT(DISTINCT cr.date) as work_days
       FROM cost_records cr WHERE cr.date BETWEEN ? AND ? GROUP BY cr.user_id`,
      [dateFrom, dateTo]
    );
    // コスト = 人件費 + 交通費
    const costMap = new Map();
    for (const r of costAll) {
      const laborCost = Math.round(Number(r.total_minutes) / 60 * HOURLY_RATE);
      const u = users.find(u => u.id === r.user_id);
      let commuteCost = 0;
      if (u) {
        if (u.commute_type === 'teiki') {
          // 定期券: 期間に応じて按分（月額 × 期間月数）
          const d1 = new Date(dateFrom), d2 = new Date(dateTo);
          const months = (d2.getFullYear() - d1.getFullYear()) * 12 + (d2.getMonth() - d1.getMonth()) + 1;
          commuteCost = (u.commute_teiki_monthly || 0) * Math.min(months, 12);
        } else if (u.commute_type === 'daily') {
          // 1日あたり: 稼働日数 × 日額
          commuteCost = (u.commute_daily_amount || 0) * Number(r.work_days || 0);
        }
      }
      costMap.set(r.user_id, laborCost + commuteCost);
    }

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
       FROM projects p WHERE p.is_legacy = 0 AND DATE(p.created_at) BETWEEN ? AND ? GROUP BY p.owner_user_id`,
      [dateFrom, dateTo]
    );
    const projMap = new Map(projAll.map(r => [r.user_id, r]));

    // 金額（全員分一括）
    const [finAll] = await pool.query(
      `SELECT p.owner_user_id as user_id,
        COALESCE(SUM(ph.initial_payment), 0) as ip, COALESCE(SUM(ph.expected_revenue), 0) as er
       FROM project_hires ph JOIN projects p ON ph.project_id = p.id
       WHERE p.is_legacy = 0 AND DATE(p.created_at) BETWEEN ? AND ? AND ph.is_cancelled = 0
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

    // 過去CPAデータを合算（月別・累計のみ。週別は過去データなし）
    let pastCost = 0, pastCalls = 0, pastProjects = 0, pastInterviews = 0;
    let pastNaitei = 0, pastFugokaku = 0, pastBarashiLost = 0, pastIp = 0, pastEr = 0;
    const pastByUser = new Map(); // user_id -> past data
    try {
      // 過去データフィルタ:
      // - date_fromがある行（週別データ）: 日付範囲の重なりでフィルタ
      // - date_fromがない行（月別データ）: 年月でフィルタ
      const fromDate = new Date(dateFrom);
      const toDate = new Date(dateTo);
      const fromYM = fromDate.getFullYear() * 100 + (fromDate.getMonth() + 1);
      const toYM = toDate.getFullYear() * 100 + (toDate.getMonth() + 1);

      const [pastAll] = await pool.query(
        `SELECT user_id, SUM(cost) as cost, SUM(call_count) as calls, SUM(project_count) as projects,
                SUM(interview_count) as interviews, SUM(naitei_count) as naitei,
                SUM(fugokaku_count) as fugokaku, SUM(barashi_lost_count) as barashi,
                SUM(initial_payment) as ip, SUM(expected_revenue) as er
         FROM past_cpa_data
         WHERE (
           (date_from IS NOT NULL AND date_from <= ? AND date_to >= ?)
           OR
           (date_from IS NULL AND (period_year * 100 + period_month) >= ? AND (period_year * 100 + period_month) <= ?)
         )
         GROUP BY user_id`,
        [dateTo, dateFrom, fromYM, toYM]
      );
      for (const pr of pastAll) {
        const pd = {
          cost: Number(pr.cost) || 0, calls: Number(pr.calls) || 0,
          projects: Number(pr.projects) || 0, interviews: Number(pr.interviews) || 0,
          naitei: Number(pr.naitei) || 0, fugokaku: Number(pr.fugokaku) || 0,
          barashi: Number(pr.barashi) || 0, ip: Number(pr.ip) || 0, er: Number(pr.er) || 0,
        };
        if (!pr.user_id || pr.user_id === 0) {
          // チーム全体
          pastCost = pd.cost; pastCalls = pd.calls; pastProjects = pd.projects;
          pastInterviews = pd.interviews; pastNaitei = pd.naitei; pastFugokaku = pd.fugokaku;
          pastBarashiLost = pd.barashi; pastIp = pd.ip; pastEr = pd.er;
        } else {
          // 個人
          pastByUser.set(pr.user_id, pd);
        }
      }
    } catch (e) { /* table may not exist yet */ }

    // 個人にも過去データを加算
    const operators = users.map(u => {
      const past = pastByUser.get(u.id);
      const curCost = costMap.get(u.id) || 0;
      const curCalls = callMap.get(u.id) || 0;
      const curProj = projMap.get(u.id);
      const curFin = finMap.get(u.id);
      if (past) {
        return {
          userId: u.id, name: u.name,
          ...buildRow(
            curCost + past.cost,
            curCalls + past.calls,
            {
              project_count: (curProj ? Number(curProj.project_count) : 0) + past.projects,
              interview_count: (curProj ? Number(curProj.interview_count) : 0) + past.interviews,
              naitei_count: (curProj ? Number(curProj.naitei_count) : 0) + past.naitei,
              fugokaku_count: (curProj ? Number(curProj.fugokaku_count) : 0) + past.fugokaku,
              barashi_lost_count: (curProj ? Number(curProj.barashi_lost_count) : 0) + past.barashi,
            },
            { ip: (curFin ? curFin.ip : 0) + past.ip, er: (curFin ? curFin.er : 0) + past.er }
          ),
        };
      }
      return {
        userId: u.id, name: u.name,
        ...buildRow(curCost, curCalls, curProj, curFin),
      };
    });

    const team = {
      name: '全体',
      ...buildRow(teamCost + pastCost, teamCalls + pastCalls, {
        project_count: teamProjects + pastProjects, interview_count: teamInterviews + pastInterviews,
        naitei_count: teamNaitei + pastNaitei, fugokaku_count: teamFugokaku + pastFugokaku, barashi_lost_count: teamBarashiLost + pastBarashiLost,
      }, { ip: teamIp + pastIp, er: teamEr + pastEr }),
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
    const period = req.query.period || 'monthly';
    let dateFrom, dateTo;
    if (req.query.date_from && req.query.date_to) {
      dateFrom = req.query.date_from;
      dateTo = req.query.date_to;
    } else {
      const date = req.query.date || new Date().toISOString().slice(0, 10);
      const range = getDateRange(period, date);
      if (!range) return ApiResponse.badRequest(res, '無効な期間です');
      dateFrom = range.dateFrom;
      dateTo = range.dateTo;
    }

    const [users] = await pool.execute(
      "SELECT id, name, operator_level, target_work_hours, target_calls_per_h, target_effective_per_h, target_person_per_h, target_project_hours FROM users WHERE is_active = 1 AND role = 'operator' ORDER BY id ASC"
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
       FROM projects p WHERE p.is_legacy = 0 AND DATE(p.created_at) BETWEEN ? AND ? GROUP BY p.owner_user_id`,
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
