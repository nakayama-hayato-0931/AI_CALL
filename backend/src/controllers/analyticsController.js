/**
 * CPA・案件質分析コントローラー
 */
const pool = require('../../config/database');
const ApiResponse = require('../utils/apiResponse');
const { getDateRange } = require('../utils/periodHelper');
const logger = require('../utils/logger');

const HOURLY_RATE = 1500; // 時給（円）
const INTERN_HOURLY_RATE = 1250; // インターン時給（円）

// ユーザーのロールに応じたコスト計算
const calcUserCost = (totalMinutes, workDays, user) => {
  const isIntern = user?.role === 'intern';
  const rate = isIntern ? INTERN_HOURLY_RATE : HOURLY_RATE;
  let laborCost = Math.round(totalMinutes / 60 * rate);
  let commuteCost = 0;
  if (user) {
    if (user.commute_type === 'teiki') {
      // 定期: 月額計算（期間指定時はgetCpaAllで別途処理）
    } else if (user.commute_type === 'daily') {
      commuteCost = (user.commute_daily_amount || 0) * workDays;
    }
  }
  const totalCost = laborCost + commuteCost;
  return isIntern ? Math.round(totalCost / 2) : totalCost;
};

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
    // インターン対応: ユーザーのロールに応じて時給・半額計算
    if (targetUserId) {
      const [uRows] = await pool.query('SELECT role, commute_type, commute_teiki_monthly, commute_daily_amount FROM users WHERE id = ?', [targetUserId]);
      if (uRows.length > 0) {
        const u = uRows[0];
        const rate = u.role === 'intern' ? INTERN_HOURLY_RATE : HOURLY_RATE;
        cost = Math.round(totalMinutes / 60 * rate);
        if (u.commute_type === 'teiki') {
          // 定期券: 月額を日数按分（月額 / 30 × 対象日数）
          const d1 = new Date(dateFrom), d2 = new Date(dateTo);
          const days = Math.max(1, Math.round((d2 - d1) / (1000 * 60 * 60 * 24)) + 1);
          cost += Math.round((u.commute_teiki_monthly || 0) / 30 * days);
        } else if (u.commute_type === 'daily') {
          cost += (u.commute_daily_amount || 0) * Number(costRows[0].work_days || 0);
        }
        if (u.role === 'intern') cost = Math.round(cost / 2);
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
    const interviewRate = projectCount > 0 ? Math.round(interviewCount / projectCount * 10000) / 100 : 0;
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
      interviewRate,
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
         CAST(SUM(CASE WHEN COALESCE(p.mail_replied, 0) = 0 AND COALESCE(p.phone_confirmed, 0) = 0 AND (p.status IS NULL OR p.status NOT IN ('LOST','SHORUI_CHU','SHORUI_OCHI','MODOSHI','BARASHI','HORYU')) THEN 1 ELSE 0 END) AS SIGNED) as waiting_contact,
         CAST(SUM(CASE WHEN p.status = 'SHORUI_CHU' THEN 1 ELSE 0 END) AS SIGNED) as screening_in_progress,
         CAST(SUM(CASE WHEN p.interview_date IS NOT NULL
                AND (p.status IS NULL OR p.status NOT IN ('LOST','BARASHI','HORYU','MODOSHI','SHORUI_CHU','SHORUI_OCHI'))
                AND (p.interview_date >= CURDATE() OR p.status IN ('NAITEI','FUGOKAKU','KEKKA_MACHI','NAITEI_TORIKESHI'))
              THEN 1 ELSE 0 END) AS SIGNED) as interview_set,
         CAST(SUM(CASE WHEN p.status IN ('KEKKA_MACHI','NAITEI','NAITEI_TORIKESHI','FUGOKAKU') THEN 1 ELSE 0 END) AS SIGNED) as interview_done,
         CAST(SUM(CASE WHEN p.status = 'BARASHI' THEN 1 ELSE 0 END) AS SIGNED) as barashi,
         CAST(SUM(CASE WHEN p.interview_type = 'online' THEN 1 ELSE 0 END) AS SIGNED) as online_interview,
         CAST(SUM(CASE WHEN p.document_screening IN ('not_required', 'なし') THEN 1 ELSE 0 END) AS SIGNED) as no_screening,
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
      screeningInProgress: Number(rows[0].screening_in_progress) || 0,
      screeningInProgressPct: pct(Number(rows[0].screening_in_progress) || 0),
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
      "SELECT id, name, role, operator_level, target_work_hours, target_calls_per_h, target_effective_per_h, target_person_per_h, target_project_hours FROM users WHERE is_active = 1 AND role IN ('operator','intern') AND is_test_account = 0 ORDER BY id ASC"
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

    // ユーザー名→IDマッピング（スペース除去で正規化して照合）
    const [users] = await pool.execute('SELECT id, name FROM users WHERE is_active = 1');
    const nameMap = new Map();
    users.forEach(u => {
      nameMap.set(u.name.trim(), u.id);
      nameMap.set(u.name.replace(/\s+/g, ''), u.id);
    });

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
/**
 * 給与支給控除一覧PDF → 月次給与コスト抽出
 * 行構造: 従業員氏名 / 支給合計額 / 健康保険料 / 介護保険料 / 厚生年金保険料 / 雇用保険料
 * 各列が1人の従業員。X座標で同じ列のセルを紐付ける。
 */
const parsePayrollPdf = async (buffer) => {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const path = require('path');
  const cMapUrl = path.join(__dirname, '../../node_modules/pdfjs-dist/cmaps') + '/';
  const doc = await pdfjs.getDocument({ data: new Uint8Array(buffer), cMapUrl, cMapPacked: true }).promise;

  // 年月推定（最初のページから抽出）
  let yearMonth = null;
  let employees = []; // [{ name, year_month, gross_pay, health, care, pension, employment }]

  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const tc = await page.getTextContent();

    // Y座標でまとめて1行に
    const rowMap = new Map();
    for (const it of tc.items) {
      const y = Math.round(it.transform[5] / 3) * 3;
      if (!rowMap.has(y)) rowMap.set(y, []);
      rowMap.get(y).push({ x: it.transform[4], str: it.str });
    }
    // X座標でソート
    for (const arr of rowMap.values()) arr.sort((a, b) => a.x - b.x);

    const rows = [...rowMap.entries()].sort((a, b) => b[0] - a[0]);

    // 年月抽出
    if (!yearMonth) {
      const fullText = rows.map(([, arr]) => arr.map(i => i.str).join(' ')).join(' ');
      const ym = fullText.match(/(\d{4})\s*年\s*(\d{1,2})\s*月/);
      if (ym) yearMonth = `${ym[1]}-${String(ym[2]).padStart(2, '0')}`;
    }

    // 従業員氏名の行を探す
    const nameRow = rows.find(([, arr]) => arr.some(i => /従業員氏名/.test(i.str)));
    if (!nameRow) continue;

    // 「従業員氏名」ラベル自体は除外し、残りを名前として X 位置とともに保持
    // ただし複数の文字列が連結された名前にも対応（隣接アイテムをマージ）
    const labelX = nameRow[1].find(i => /従業員氏名/.test(i.str))?.x ?? 0;
    const nameItems = nameRow[1]
      .filter(i => i.x > labelX + 5 && i.str.trim() !== '')
      .filter(i => !/^[\s.,-]*$/.test(i.str));
    // 隣接（x差<25）かつ名前っぽい文字列同士をマージ
    const names = [];
    for (const it of nameItems) {
      if (names.length > 0 && it.x - names[names.length - 1].endX < 8) {
        names[names.length - 1].name += it.str;
        names[names.length - 1].endX = it.x + it.str.length * 4;
      } else {
        names.push({ name: it.str, x: it.x, endX: it.x + it.str.length * 4 });
      }
    }

    // 各データ行の値を、X座標で最も近い名前列に割り当てる
    const findRow = (label) => rows.find(([, arr]) => arr.some(i => new RegExp(label).test(i.str)));
    const extractRowValues = (label) => {
      const found = findRow(label);
      if (!found) return new Map();
      const items = found[1];
      // ラベル位置を取得
      const labelItem = items.find(i => new RegExp(label).test(i.str));
      const lx = labelItem ? labelItem.x : 0;
      // ラベル以降の数値系セルだけ抽出
      const numItems = items.filter(i => i.x > lx + 5 && /^-?[\d,]+$/.test(i.str.trim()));
      // 最寄りの名前列にマッピング
      const map = new Map();
      for (const ni of numItems) {
        let bestName = null;
        let bestDist = Infinity;
        for (const n of names) {
          const d = Math.abs(n.x - ni.x);
          if (d < bestDist) { bestDist = d; bestName = n.name; }
        }
        if (bestName && bestDist < 50) {
          const val = parseInt(ni.str.replace(/,/g, ''), 10);
          if (!isNaN(val)) {
            if (!map.has(bestName)) map.set(bestName, val);
          }
        }
      }
      return map;
    };

    const gross = extractRowValues('支給合計額');
    const health = extractRowValues('健康保険料');
    const care = extractRowValues('介護保険料');
    const pension = extractRowValues('厚生年金保険料');
    const employment = extractRowValues('雇用保険料');

    for (const n of names) {
      const name = n.name.trim();
      if (!name) continue;
      const g = gross.get(name) || 0;
      const h = health.get(name) || 0;
      const c = care.get(name) || 0;
      const ps = pension.get(name) || 0;
      const e = employment.get(name) || 0;
      const insurance = h + c + ps + e;
      employees.push({
        name,
        year_month: yearMonth,
        gross_pay: g,
        health_insurance: h,
        care_insurance: c,
        pension_insurance: ps,
        employment_insurance: e,
        total_insurance: insurance,
        total_cost: g + insurance,
      });
    }
  }

  return { yearMonth, employees };
};

const importCostPdf = async (req, res, next) => {
  try {
    if (!req.file) return ApiResponse.badRequest(res, 'ファイルが必要です');
    logger.info(`[importCostPdf] size=${req.file.size} mime=${req.file.mimetype}`);

    // 給与PDFかどうかを判定するため、まず軽くスキャン
    let isPayroll = false;
    try {
      const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
      const path = require('path');
      const cMapUrl = path.join(__dirname, '../../node_modules/pdfjs-dist/cmaps') + '/';
      const probe = await pdfjs.getDocument({
        data: new Uint8Array(req.file.buffer), cMapUrl, cMapPacked: true,
      }).promise;
      const p1 = await probe.getPage(1);
      const tc = await p1.getTextContent();
      const text1 = tc.items.map(i => i.str).join('');
      if (/給与支給控除一覧|支給合計額/.test(text1)) isPayroll = true;
    } catch (e) { /* fallback to stamp parsing */ }

    if (isPayroll) {
      // 給与PDF: 月次給与コストを保存
      const { yearMonth, employees } = await parsePayrollPdf(req.file.buffer);
      if (!yearMonth) {
        return ApiResponse.badRequest(res, 'PDFから年月が読み取れませんでした');
      }
      const [users] = await pool.execute('SELECT id, name FROM users WHERE is_active = 1');
      const nameMap = new Map();
      users.forEach(u => {
        nameMap.set(u.name.trim(), u.id);
        nameMap.set(u.name.replace(/\s+/g, ''), u.id);
      });

      // テーブル作成（冪等）
      try {
        await pool.execute(`CREATE TABLE IF NOT EXISTS monthly_payroll_records (
          id INT AUTO_INCREMENT PRIMARY KEY,
          user_id INT NOT NULL,
          year_month VARCHAR(7) NOT NULL,
          gross_pay INT NOT NULL DEFAULT 0,
          health_insurance INT NOT NULL DEFAULT 0,
          care_insurance INT NOT NULL DEFAULT 0,
          pension_insurance INT NOT NULL DEFAULT 0,
          employment_insurance INT NOT NULL DEFAULT 0,
          total_cost INT NOT NULL DEFAULT 0,
          imported_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          UNIQUE KEY uk_user_ym (user_id, year_month)
        )`);
      } catch (e) {}

      let imported = 0;
      const errors = [];
      const matched = [];
      const unmatched = [];
      for (const e of employees) {
        const uid = nameMap.get(e.name) || nameMap.get(e.name.replace(/\s+/g, ''));
        if (!uid) { unmatched.push(e.name); continue; }
        try {
          await pool.execute(
            `INSERT INTO monthly_payroll_records
              (user_id, year_month, gross_pay, health_insurance, care_insurance, pension_insurance, employment_insurance, total_cost)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE
               gross_pay = VALUES(gross_pay),
               health_insurance = VALUES(health_insurance),
               care_insurance = VALUES(care_insurance),
               pension_insurance = VALUES(pension_insurance),
               employment_insurance = VALUES(employment_insurance),
               total_cost = VALUES(total_cost),
               imported_at = CURRENT_TIMESTAMP`,
            [uid, e.year_month, e.gross_pay, e.health_insurance, e.care_insurance, e.pension_insurance, e.employment_insurance, e.total_cost]
          );
          matched.push({ name: e.name, total_cost: e.total_cost });
          imported++;
        } catch (err) {
          errors.push(`${e.name}: ${err.message}`);
        }
      }

      logger.info(`給与PDFインポート: ${imported}件, 未マッチ: ${unmatched.length}件`);
      return ApiResponse.success(res, {
        type: 'payroll',
        yearMonth,
        imported,
        matched,
        unmatched,
        errors: errors.slice(0, 20),
      });
    }

    // 従来の打刻PDF処理
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
    logger.error(`[importCostPdf] ${err.message}\n${err.stack}`);
    return ApiResponse.error(res, `PDFインポート失敗: ${err.message}`, 500);
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

    // オペレーター一覧（無効ユーザーも含む。データがあれば集計に含めるため）
    const [users] = await pool.execute(
      "SELECT id, name, role, is_active, operator_level, commute_type, commute_teiki_monthly, commute_daily_amount FROM users WHERE role IN ('operator','intern') AND is_test_account = 0 ORDER BY id ASC"
    );

    // コスト（全員分一括）
    const [costAll] = await pool.query(
      `SELECT cr.user_id,
        COALESCE(SUM(TIMESTAMPDIFF(MINUTE, CONCAT(cr.date,' ',cr.start_time), CONCAT(cr.date,' ',cr.end_time)) - COALESCE(cr.break_minutes,0)), 0) as total_minutes,
        COUNT(DISTINCT cr.date) as work_days
       FROM cost_records cr WHERE cr.date BETWEEN ? AND ? GROUP BY cr.user_id`,
      [dateFrom, dateTo]
    );
    // コスト = 人件費 + 交通費（常にcost_recordsから取得）
    const costMap = new Map();
    const workHoursMap = new Map(); // 稼働時間（時間）
    for (const r of costAll) {
      const totalMinutes = Number(r.total_minutes);
      const u = users.find(u => u.id === r.user_id);
      const isIntern = u?.role === 'intern';
      const rate = isIntern ? INTERN_HOURLY_RATE : HOURLY_RATE;
      const laborCost = Math.round(totalMinutes / 60 * rate);
      let commuteCost = 0;
      if (u) {
        if (u.commute_type === 'teiki') {
          // 定期券: 月額を日数按分（月額 / 30 × 対象日数）
          const d1 = new Date(dateFrom), d2 = new Date(dateTo);
          const days = Math.max(1, Math.round((d2 - d1) / (1000 * 60 * 60 * 24)) + 1);
          commuteCost = Math.round((u.commute_teiki_monthly || 0) / 30 * days);
        } else if (u.commute_type === 'daily') {
          commuteCost = (u.commute_daily_amount || 0) * Number(r.work_days || 0);
        }
      }
      const totalCost = laborCost + commuteCost;
      costMap.set(r.user_id, isIntern ? Math.round(totalCost / 2) : totalCost);
      workHoursMap.set(r.user_id, Math.round(totalMinutes / 6) / 10); // 小数第1位まで
    }

    // 月次給与PDFがインポート済みなら、対応する月のコストを上書き
    // （支給合計額 + 社会保険料合計 = total_cost を採用）
    // 期間に複数月が含まれる場合は各月の重なり日数で按分
    try {
      const ymStart = `${dateFrom.slice(0, 4)}-${dateFrom.slice(5, 7)}`;
      const ymEnd = `${dateTo.slice(0, 4)}-${dateTo.slice(5, 7)}`;
      const [payrollRows] = await pool.query(
        `SELECT user_id, year_month, total_cost FROM monthly_payroll_records
         WHERE year_month BETWEEN ? AND ?`,
        [ymStart, ymEnd]
      );
      if (payrollRows.length > 0) {
        // 単純化: 期間が単一月ならそのまま、複数月にまたがる場合は合算
        const byUser = new Map();
        for (const r of payrollRows) {
          const cur = byUser.get(r.user_id) || 0;
          byUser.set(r.user_id, cur + Number(r.total_cost || 0));
        }
        for (const [uid, total] of byUser) {
          costMap.set(uid, total); // 給与PDFが優先
        }
      }
    } catch (e) { /* table may not exist yet */ }

    // テスト運用期間: 2026年3月末まではシステムデータをCPA計算から除外
    // （past_cpa_dataの手動入力データのみ使用）
    // 4月以降はシステムデータを使用
    // 3月から打刻データ(cost_records)が存在するためコストは3月から有効
    // ただしcalls/projectsは4月以降のシステム稼働分のみ
    const SYSTEM_DATA_START = '2026-04-01';
    const systemDateFrom = dateFrom >= SYSTEM_DATA_START ? dateFrom : (dateTo >= SYSTEM_DATA_START ? SYSTEM_DATA_START : null);
    const systemDateTo = dateTo;
    // コストはcost_recordsを常に使用（3月分の打刻データを含めるため）
    const useCostRecords = true;

    // コール数（全員分一括）- 4月以降のみ
    let callMap = new Map();
    if (systemDateFrom) {
      const [callAll] = await pool.query(
        `SELECT c.user_id, COUNT(*) as cnt
         FROM calls c WHERE DATE(c.call_started_at) BETWEEN ? AND ? AND c.result_code IS NOT NULL AND c.result_code != 'SKIP'
         GROUP BY c.user_id`,
        [systemDateFrom, systemDateTo]
      );
      callMap = new Map(callAll.map(r => [r.user_id, Number(r.cnt)]));
    }

    // 案件数・ステータス（全員分一括）- 4月以降のみ
    let projAll = [];
    if (systemDateFrom) {
      const [rows] = await pool.query(
        `SELECT p.owner_user_id as user_id,
          COUNT(*) as project_count,
          CAST(SUM(CASE WHEN p.status IN ('NAITEI','NAITEI_TORIKESHI','FUGOKAKU','KEKKA_MACHI') THEN 1 ELSE 0 END) AS SIGNED) as interview_count,
          CAST(SUM(CASE WHEN p.status = 'NAITEI' THEN 1 ELSE 0 END) AS SIGNED) as naitei_count,
          CAST(SUM(CASE WHEN p.status = 'FUGOKAKU' THEN 1 ELSE 0 END) AS SIGNED) as fugokaku_count,
          CAST(SUM(CASE WHEN p.status IN ('BARASHI','LOST') THEN 1 ELSE 0 END) AS SIGNED) as barashi_lost_count
         FROM projects p WHERE p.is_legacy = 0 AND p.is_prospect = 0 AND DATE(p.created_at) BETWEEN ? AND ? GROUP BY p.owner_user_id`,
        [systemDateFrom, systemDateTo]
      );
      projAll = rows;
    }
    const projMap = new Map(projAll.map(r => [r.user_id, r]));

    // ダッシュボードのKPI補正値（kpi_adjustments）を案件数・コール数に反映
    if (systemDateFrom) {
      try {
        const [adjRows] = await pool.query(
          `SELECT user_id, field, date, value FROM kpi_adjustments
           WHERE field IN ('project_count','call_count') AND date BETWEEN ? AND ?`,
          [systemDateFrom, systemDateTo]
        );
        for (const adj of adjRows) {
          const uid = adj.user_id;
          if (adj.field === 'project_count') {
            // その日の実績案件数を取得して差し引き、補正値を加算
            const [r] = await pool.query(
              `SELECT COUNT(*) as cnt FROM projects p
               WHERE p.owner_user_id = ? AND p.is_legacy = 0 AND p.is_prospect = 0 AND DATE(p.created_at) = ?`,
              [uid, adj.date]
            );
            const actual = Number(r[0]?.cnt) || 0;
            const delta = Number(adj.value) - actual;
            let row = projMap.get(uid);
            if (!row) {
              row = { user_id: uid, project_count: 0, interview_count: 0, naitei_count: 0, fugokaku_count: 0, barashi_lost_count: 0 };
              projMap.set(uid, row);
              projAll.push(row);
            }
            row.project_count = Number(row.project_count) + delta;
          } else if (adj.field === 'call_count') {
            const [r] = await pool.query(
              `SELECT COUNT(*) as cnt FROM calls
               WHERE user_id = ? AND DATE(call_started_at) = ? AND result_code IS NOT NULL AND result_code != 'SKIP'`,
              [uid, adj.date]
            );
            const actual = Number(r[0]?.cnt) || 0;
            const delta = Number(adj.value) - actual;
            callMap.set(uid, (callMap.get(uid) || 0) + delta);
          }
        }
      } catch (e) { /* ignore */ }
    }

    // 金額（全員分一括）- 4月以降のみ
    let finAll = [];
    if (systemDateFrom) {
      const [rows] = await pool.query(
        `SELECT p.owner_user_id as user_id,
          COALESCE(SUM(ph.initial_payment), 0) as ip, COALESCE(SUM(ph.expected_revenue), 0) as er
         FROM project_hires ph JOIN projects p ON ph.project_id = p.id
         WHERE p.is_legacy = 0 AND DATE(p.created_at) BETWEEN ? AND ? AND ph.is_cancelled = 0
         GROUP BY p.owner_user_id`,
        [systemDateFrom, systemDateTo]
      );
      finAll = rows;
    }
    const finMap = new Map(finAll.map(r => [r.user_id, { ip: Number(r.ip), er: Number(r.er) }]));

    // チーム全体
    const teamCost = [...costMap.values()].reduce((s, v) => s + v, 0);
    const teamWorkHours = [...workHoursMap.values()].reduce((s, v) => s + v, 0);
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
        interviewRate: pc > 0 ? Math.round(ic / pc * 10000) / 100 : 0,
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

      // 週別表示(custom)なら週別データ(date_from有り)のみ、月別/累計なら月別データ(date_from無し)のみ
      // 週別: 過去レコードの期間がクエリ範囲に完全に含まれる場合のみ集計（重なりではなく含有で判定）
      const useWeeklyPast = (period === 'custom');
      const [pastAll] = await pool.query(
        useWeeklyPast
          ? `SELECT user_id, SUM(cost) as cost, SUM(call_count) as calls, SUM(project_count) as projects,
                    SUM(interview_count) as interviews, SUM(naitei_count) as naitei,
                    SUM(fugokaku_count) as fugokaku, SUM(barashi_lost_count) as barashi,
                    SUM(initial_payment) as ip, SUM(expected_revenue) as er
             FROM past_cpa_data
             WHERE date_from IS NOT NULL AND date_from >= ? AND date_to <= ?
             GROUP BY user_id`
          : `SELECT user_id, SUM(cost) as cost, SUM(call_count) as calls, SUM(project_count) as projects,
                    SUM(interview_count) as interviews, SUM(naitei_count) as naitei,
                    SUM(fugokaku_count) as fugokaku, SUM(barashi_lost_count) as barashi,
                    SUM(initial_payment) as ip, SUM(expected_revenue) as er
             FROM past_cpa_data
             WHERE date_from IS NULL AND (period_year * 100 + period_month) >= ? AND (period_year * 100 + period_month) <= ?
             GROUP BY user_id`,
        useWeeklyPast ? [dateFrom, dateTo] : [fromYM, toYM]
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

      // 面接数は案件質の interview_done に合わせる（past_quality_dataから取得）
      try {
        const [qAll] = await pool.query(
          useWeeklyPast
            ? `SELECT user_id, SUM(interview_done) as interviews FROM past_quality_data
               WHERE date_from IS NOT NULL AND date_from >= ? AND date_to <= ? GROUP BY user_id`
            : `SELECT user_id, SUM(interview_done) as interviews FROM past_quality_data
               WHERE date_from IS NULL AND (period_year * 100 + period_month) >= ? AND (period_year * 100 + period_month) <= ? GROUP BY user_id`,
          useWeeklyPast ? [dateFrom, dateTo] : [fromYM, toYM]
        );
        for (const qr of qAll) {
          const interviews = Number(qr.interviews) || 0;
          if (!qr.user_id || qr.user_id === 0) {
            pastInterviews = interviews;
          } else {
            const exist = pastByUser.get(qr.user_id);
            if (exist) exist.interviews = interviews;
            else pastByUser.set(qr.user_id, { cost:0, calls:0, projects:0, interviews, naitei:0, fugokaku:0, barashi:0, ip:0, er:0 });
          }
        }
      } catch (e) { /* fallback to past_cpa_data.interview_count */ }
    } catch (e) { /* table may not exist yet */ }

    // 個人にも過去データを加算
    // 注意: コストはpast_cpa_dataとcost_recordsで二重にならないよう制御
    // systemDateFromがnull（全期間が3月以前）→ cost_recordsは使わずpast_cpa_dataのみ
    const operators = users.map(u => {
      const past = pastByUser.get(u.id);
      const curCost = costMap.get(u.id) || 0; // cost_records（3月以降の打刻データ）
      const curCalls = callMap.get(u.id) || 0;
      const curProj = projMap.get(u.id);
      const curFin = finMap.get(u.id);
      const curWorkHours = workHoursMap.get(u.id) || 0;
      if (past) {
        return {
          userId: u.id, name: u.name, role: u.role, isActive: !!u.is_active, workHours: curWorkHours,
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
        userId: u.id, name: u.name, role: u.role, isActive: !!u.is_active, workHours: curWorkHours,
        ...buildRow(curCost, curCalls, curProj, curFin),
      };
    }).filter(op => {
      // 無効ユーザーは数値が1以上の時のみ含める
      if (op.isActive) return true;
      return (Number(op.callCount) || 0) > 0 || (Number(op.projectCount) || 0) > 0
        || (Number(op.interviewCount) || 0) > 0 || (Number(op.cost) || 0) > 0;
    });

    const effectiveTeamCost = teamCost; // cost_records（3月以降の打刻データ）
    const team = {
      name: '全体', workHours: Math.round(teamWorkHours * 10) / 10,
      ...buildRow(effectiveTeamCost + pastCost, teamCalls + pastCalls, {
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
      "SELECT id, name, role, is_active, operator_level, target_work_hours, target_calls_per_h, target_effective_per_h, target_person_per_h, target_project_hours FROM users WHERE role IN ('operator','intern') AND is_test_account = 0 ORDER BY id ASC"
    );

    // システム案件のみ（4月以降）。3月まではpast_quality_dataから取得
    const SYSTEM_DATA_START = '2026-04-01';
    const qSystemFrom = dateFrom >= SYSTEM_DATA_START ? dateFrom : (dateTo >= SYSTEM_DATA_START ? SYSTEM_DATA_START : null);
    const fields = ['total','lost','waiting_contact','screening_in_progress','interview_set','interview_done','barashi','online_interview','no_screening','screening_failed'];

    let rows = [];
    if (qSystemFrom) {
      const [r] = await pool.query(
        `SELECT p.owner_user_id as user_id,
          COUNT(*) as total,
          CAST(SUM(CASE WHEN p.status = 'LOST' THEN 1 ELSE 0 END) AS SIGNED) as lost,
          CAST(SUM(CASE WHEN COALESCE(p.mail_replied,0)=0 AND COALESCE(p.phone_confirmed,0)=0 AND (p.status IS NULL OR p.status NOT IN ('LOST','SHORUI_CHU','SHORUI_OCHI','MODOSHI','BARASHI','HORYU')) THEN 1 ELSE 0 END) AS SIGNED) as waiting_contact,
          CAST(SUM(CASE WHEN p.status = 'SHORUI_CHU' THEN 1 ELSE 0 END) AS SIGNED) as screening_in_progress,
          CAST(SUM(CASE WHEN p.interview_date IS NOT NULL
                AND (p.status IS NULL OR p.status NOT IN ('LOST','BARASHI','HORYU','MODOSHI','SHORUI_CHU','SHORUI_OCHI'))
                AND (p.interview_date >= CURDATE() OR p.status IN ('NAITEI','FUGOKAKU','KEKKA_MACHI','NAITEI_TORIKESHI'))
              THEN 1 ELSE 0 END) AS SIGNED) as interview_set,
          CAST(SUM(CASE WHEN p.status IN ('KEKKA_MACHI','NAITEI','NAITEI_TORIKESHI','FUGOKAKU') THEN 1 ELSE 0 END) AS SIGNED) as interview_done,
          CAST(SUM(CASE WHEN p.status = 'BARASHI' THEN 1 ELSE 0 END) AS SIGNED) as barashi,
          CAST(SUM(CASE WHEN p.interview_type = 'online' THEN 1 ELSE 0 END) AS SIGNED) as online_interview,
          CAST(SUM(CASE WHEN p.document_screening IN ('not_required', 'なし') THEN 1 ELSE 0 END) AS SIGNED) as no_screening,
          CAST(SUM(CASE WHEN p.status = 'SHORUI_OCHI' THEN 1 ELSE 0 END) AS SIGNED) as screening_failed
         FROM projects p WHERE p.is_legacy = 0 AND p.is_prospect = 0 AND DATE(p.created_at) BETWEEN ? AND ? GROUP BY p.owner_user_id`,
        [qSystemFrom, dateTo]
      );
      rows = r;
    }
    const qMap = new Map(rows.map(r => [r.user_id, r]));

    // kpi_adjustments を反映（CPAと一致させる）
    if (qSystemFrom) {
      try {
        // field → rowのキー と 実績算出SQL条件のマップ
        const adjustMap = {
          project_count: { rowKey: 'total', actualSql: `SELECT COUNT(*) as cnt FROM projects p WHERE p.owner_user_id = ? AND p.is_legacy = 0 AND p.is_prospect = 0 AND DATE(p.created_at) = ?` },
          q_lost: { rowKey: 'lost', actualSql: `SELECT COUNT(*) as cnt FROM projects p WHERE p.owner_user_id = ? AND p.is_legacy = 0 AND p.is_prospect = 0 AND p.status = 'LOST' AND DATE(p.created_at) = ?` },
          q_waiting_contact: { rowKey: 'waiting_contact', actualSql: `SELECT COUNT(*) as cnt FROM projects p WHERE p.owner_user_id = ? AND p.is_legacy = 0 AND p.is_prospect = 0 AND COALESCE(p.mail_replied,0)=0 AND COALESCE(p.phone_confirmed,0)=0 AND (p.status IS NULL OR p.status NOT IN ('LOST','SHORUI_CHU','SHORUI_OCHI','MODOSHI','BARASHI','HORYU')) AND DATE(p.created_at) = ?` },
          q_screening_in_progress: { rowKey: 'screening_in_progress', actualSql: `SELECT COUNT(*) as cnt FROM projects p WHERE p.owner_user_id = ? AND p.is_legacy = 0 AND p.is_prospect = 0 AND p.status = 'SHORUI_CHU' AND DATE(p.created_at) = ?` },
          q_interview_set: { rowKey: 'interview_set', actualSql: `SELECT COUNT(*) as cnt FROM projects p WHERE p.owner_user_id = ? AND p.is_legacy = 0 AND p.is_prospect = 0 AND p.interview_date IS NOT NULL AND (p.status IS NULL OR p.status NOT IN ('LOST','BARASHI','HORYU','MODOSHI','SHORUI_CHU','SHORUI_OCHI')) AND (p.interview_date >= CURDATE() OR p.status IN ('NAITEI','FUGOKAKU','KEKKA_MACHI','NAITEI_TORIKESHI')) AND DATE(p.created_at) = ?` },
          q_interview_done: { rowKey: 'interview_done', actualSql: `SELECT COUNT(*) as cnt FROM projects p WHERE p.owner_user_id = ? AND p.is_legacy = 0 AND p.is_prospect = 0 AND p.status IN ('KEKKA_MACHI','NAITEI','NAITEI_TORIKESHI','FUGOKAKU') AND DATE(p.created_at) = ?` },
          q_barashi: { rowKey: 'barashi', actualSql: `SELECT COUNT(*) as cnt FROM projects p WHERE p.owner_user_id = ? AND p.is_legacy = 0 AND p.is_prospect = 0 AND p.status = 'BARASHI' AND DATE(p.created_at) = ?` },
          q_online_interview: { rowKey: 'online_interview', actualSql: `SELECT COUNT(*) as cnt FROM projects p WHERE p.owner_user_id = ? AND p.is_legacy = 0 AND p.is_prospect = 0 AND p.interview_type = 'online' AND DATE(p.created_at) = ?` },
          q_no_screening: { rowKey: 'no_screening', actualSql: `SELECT COUNT(*) as cnt FROM projects p WHERE p.owner_user_id = ? AND p.is_legacy = 0 AND p.is_prospect = 0 AND p.document_screening IN ('not_required','なし') AND DATE(p.created_at) = ?` },
          q_screening_failed: { rowKey: 'screening_failed', actualSql: `SELECT COUNT(*) as cnt FROM projects p WHERE p.owner_user_id = ? AND p.is_legacy = 0 AND p.is_prospect = 0 AND p.status = 'SHORUI_OCHI' AND DATE(p.created_at) = ?` },
        };
        const [adjRows] = await pool.query(
          `SELECT user_id, date, field, value FROM kpi_adjustments
           WHERE field IN (${Object.keys(adjustMap).map(() => '?').join(',')}) AND date BETWEEN ? AND ?`,
          [...Object.keys(adjustMap), qSystemFrom, dateTo]
        );
        for (const adj of adjRows) {
          const cfg = adjustMap[adj.field];
          if (!cfg) continue;
          const uid = adj.user_id;
          const [rActual] = await pool.query(cfg.actualSql, [uid, adj.date]);
          const actual = Number(rActual[0]?.cnt) || 0;
          const delta = Number(adj.value) - actual;
          let row = qMap.get(uid);
          if (!row) {
            row = { user_id: uid, total: 0, lost: 0, waiting_contact: 0, screening_in_progress: 0, interview_set: 0, interview_done: 0, barashi: 0, online_interview: 0, no_screening: 0, screening_failed: 0 };
            qMap.set(uid, row);
            rows.push(row);
          }
          row[cfg.rowKey] = Number(row[cfg.rowKey] || 0) + delta;
        }
      } catch (e) { /* ignore */ }
    }

    const buildQ = (r) => {
      const t = r ? Number(r.total) : 0;
      const p = (v) => t > 0 ? Math.round(v / t * 10000) / 100 : 0;
      const n = (f) => r ? Number(r[f]) : 0;
      return {
        total: t, lost: n('lost'), lostPct: p(n('lost')),
        waitingContact: n('waiting_contact'), waitingContactPct: p(n('waiting_contact')),
        screeningInProgress: n('screening_in_progress'), screeningInProgressPct: p(n('screening_in_progress')),
        interviewSet: n('interview_set'), interviewSetPct: p(n('interview_set')),
        interviewDone: n('interview_done'), interviewDonePct: p(n('interview_done')),
        barashi: n('barashi'), barashiPct: p(n('barashi')),
        onlineInterview: n('online_interview'), onlineInterviewPct: p(n('online_interview')),
        noScreening: n('no_screening'), noScreeningPct: p(n('no_screening')),
        screeningFailed: n('screening_failed'), screeningFailedPct: p(n('screening_failed')),
      };
    };

    // 過去案件質データ合算（past_quality_data）
    const useWeeklyPast = (period === 'custom');
    const fromDate = new Date(dateFrom);
    const toDate = new Date(dateTo);
    const fromYM = fromDate.getFullYear() * 100 + (fromDate.getMonth() + 1);
    const toYM = toDate.getFullYear() * 100 + (toDate.getMonth() + 1);
    let pastQ = null;
    const pastUserMap = new Map();
    try {
      // 全体（user_id IS NULL）
      // 週別: 過去レコードの期間がクエリ範囲に完全に含まれる場合のみ集計（含有判定）
      const pastWhere = useWeeklyPast
        ? 'date_from IS NOT NULL AND date_from >= ? AND date_to <= ? AND user_id IS NULL'
        : 'date_from IS NULL AND user_id IS NULL AND (period_year * 100 + period_month) >= ? AND (period_year * 100 + period_month) <= ?';
      const [pastRows] = await pool.query(
        `SELECT SUM(total_projects) as total, SUM(lost) as lost, SUM(waiting_contact) as waiting_contact, SUM(interview_confirmed) as interview_set, SUM(interview_done) as interview_done, SUM(barashi) as barashi, SUM(online_interview) as online_interview, SUM(no_screening) as no_screening, SUM(screening_failed) as screening_failed FROM past_quality_data WHERE ${pastWhere}`,
        useWeeklyPast ? [dateFrom, dateTo] : [fromYM, toYM]
      );
      if (pastRows.length > 0 && pastRows[0].total) pastQ = pastRows[0];

      // 個人別
      const pastUserWhere = useWeeklyPast
        ? 'date_from IS NOT NULL AND date_from >= ? AND date_to <= ? AND user_id IS NOT NULL'
        : 'date_from IS NULL AND user_id IS NOT NULL AND (period_year * 100 + period_month) >= ? AND (period_year * 100 + period_month) <= ?';
      const [pastUserRows] = await pool.query(
        `SELECT user_id, SUM(total_projects) as total, SUM(lost) as lost, SUM(waiting_contact) as waiting_contact, SUM(interview_confirmed) as interview_set, SUM(interview_done) as interview_done, SUM(barashi) as barashi, SUM(online_interview) as online_interview, SUM(no_screening) as no_screening, SUM(screening_failed) as screening_failed FROM past_quality_data WHERE ${pastUserWhere} GROUP BY user_id`,
        useWeeklyPast ? [dateFrom, dateTo] : [fromYM, toYM]
      );
      pastUserRows.forEach(r => pastUserMap.set(r.user_id, r));
    } catch (e) { /* skip */ }

    // チーム全体（システム + 過去データ）
    const allR = {};
    for (const f of fields) {
      allR[f] = rows.reduce((s, r) => s + Number(r[f] || 0), 0);
      if (pastQ && pastQ[f] != null) allR[f] += Number(pastQ[f]);
    }
    const team = { name: '全体', ...buildQ(allR) };
    const operators = users.map(u => {
      const sysData = qMap.get(u.id);
      const pastData = pastUserMap.get(u.id);
      // システム + 過去データを合算
      if (sysData && pastData) {
        const merged = { ...sysData };
        for (const f of fields) merged[f] = Number(sysData[f] || 0) + Number(pastData[f] || 0);
        return { userId: u.id, name: u.name, role: u.role, isActive: !!u.is_active, ...buildQ(merged) };
      }
      return { userId: u.id, name: u.name, role: u.role, isActive: !!u.is_active, ...buildQ(sysData || pastData || null) };
    }).filter(op => {
      // 無効ユーザーは案件数が1以上の時のみ含める
      if (op.isActive) return true;
      return (Number(op.total) || 0) > 0;
    });

    return ApiResponse.success(res, { dateFrom, dateTo, team, operators });
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/analytics/import-stamp-csv
 * 勤怠打刻ログCSVインポート（Shift-JIS対応）
 * CSV: 社員ID,打刻日時,勤務区分,打刻拠点,社員番号,氏名,部門,拠点,位置情報,デバイス
 * 勤務区分: 出勤 / 退勤 / 休憩開始 / 休憩終了
 */
const importStampCsv = async (req, res, next) => {
  try {
    if (!req.file) return ApiResponse.badRequest(res, 'ファイルが必要です');
    const duplicateMode = req.body.duplicate_mode || 'overwrite'; // 'overwrite' or 'skip'

    const iconv = require('iconv-lite');
    // Shift-JIS → UTF-8 変換（UTF-8の場合はそのまま）
    let content;
    const buf = req.file.buffer;
    // BOM or ASCII header check
    const head = buf.slice(0, 20).toString('utf-8');
    if (head.includes('社員ID') || head.includes('打刻')) {
      content = buf.toString('utf-8');
    } else {
      content = iconv.decode(buf, 'Shift_JIS');
    }

    const lines = content.split(/\r?\n/).filter(l => l.trim());
    if (lines.length < 2) return ApiResponse.badRequest(res, 'データがありません');

    // ヘッダー検証
    const header = lines[0];
    if (!header.includes('勤務区分')) {
      return ApiResponse.badRequest(res, '打刻ログCSVのフォーマットではありません。ヘッダーに「勤務区分」が必要です。');
    }

    // ユーザー名→IDマッピング（スペース除去で正規化して照合）
    const [users] = await pool.execute('SELECT id, name FROM users WHERE is_active = 1');
    const nameMap = new Map();
    users.forEach(u => {
      nameMap.set(u.name.trim(), u.id);
      // スペース除去版も登録（CSVにスペースがない場合に対応）
      nameMap.set(u.name.replace(/\s+/g, ''), u.id);
    });

    // 打刻データをパース
    // { "2026-03-27_中田倫哉": { name, date, stamps: [{time, type}] } }
    const dayMap = new Map();

    for (let i = 1; i < lines.length; i++) {
      // CSV パース（ダブルクォート考慮）
      const cols = [];
      let cur = '', inQ = false;
      for (const ch of lines[i]) {
        if (ch === '"') { inQ = !inQ; }
        else if (ch === ',' && !inQ) { cols.push(cur.trim()); cur = ''; }
        else { cur += ch; }
      }
      cols.push(cur.trim());
      if (cols.length < 6) continue;

      const stampDatetime = cols[1]; // 2026/03/27 18:28:48
      const stampType = cols[2];     // 出勤/退勤/休憩開始/休憩終了
      const name = cols[5];

      if (!stampDatetime || !stampType || !name) continue;
      if (!['出勤', '退勤', '休憩開始', '休憩終了'].includes(stampType)) continue;

      // 日付と時刻を分離（月日は1〜2桁の両方に対応）
      const dtMatch = stampDatetime.match(/(\d{4})\/(\d{1,2})\/(\d{1,2})\s+(\d{1,2}):(\d{2})/);
      if (!dtMatch) continue;

      const pad = (s) => String(s).padStart(2, '0');
      const dateStr = `${dtMatch[1]}-${pad(dtMatch[2])}-${pad(dtMatch[3])}`;
      const timeStr = `${pad(dtMatch[4])}:${dtMatch[5]}`;
      const key = `${dateStr}_${name}`;

      if (!dayMap.has(key)) {
        dayMap.set(key, { name, date: dateStr, stamps: [] });
      }
      dayMap.get(key).stamps.push({ time: timeStr, type: stampType, minutes: parseInt(dtMatch[4]) * 60 + parseInt(dtMatch[5]) });
    }

    // 日別・人別にcost_recordsを生成
    const csvDates = new Set();
    dayMap.forEach(v => csvDates.add(v.date));

    let imported = 0;
    let skipped = 0;
    const errors = [];

    // dry_runモード: 重複チェックのみ（DB書き込みなし）
    if (duplicateMode === 'dry_run') {
      let dupCount = 0;
      let validCount = 0;
      const duplicates = [];
      for (const [key, entry] of dayMap) {
        const userId = nameMap.get(entry.name) || nameMap.get(entry.name.replace(/\s+/g, ''));
        if (!userId) continue;
        const stamps = entry.stamps;
        const arrival = stamps.find(s => s.type === '出勤');
        const departure = stamps.find(s => s.type === '退勤');
        if (!arrival || !departure) continue;
        validCount++;
        const [existing] = await pool.execute('SELECT start_time, end_time FROM cost_records WHERE user_id = ? AND date = ?', [userId, entry.date]);
        if (existing.length > 0) {
          dupCount++;
          duplicates.push({
            name: entry.name,
            date: entry.date,
            existing: `${existing[0].start_time}〜${existing[0].end_time}`,
            new: `${arrival.time}〜${departure.time}`,
          });
        }
      }
      return ApiResponse.success(res, { duplicateCount: dupCount, total: validCount, duplicates });
    }

    // 上書きモードの場合は既存データを事前削除
    if (duplicateMode === 'overwrite' && csvDates.size > 0) {
      const sortedDates = [...csvDates].sort();
      await pool.execute('DELETE FROM cost_records WHERE date BETWEEN ? AND ?', [sortedDates[0], sortedDates[sortedDates.length - 1]]);
    }

    for (const [key, entry] of dayMap) {
      const userId = nameMap.get(entry.name) || nameMap.get(entry.name.replace(/\s+/g, ''));
      if (!userId) {
        errors.push(`${entry.date} ${entry.name}: ユーザーが見つかりません`);
        continue;
      }

      const stamps = entry.stamps;
      // 出勤時刻を探す
      const arrival = stamps.find(s => s.type === '出勤');
      const departure = stamps.find(s => s.type === '退勤');

      if (!arrival || !departure) {
        errors.push(`${entry.date} ${entry.name}: 出勤または退勤の打刻がありません`);
        continue;
      }

      // 休憩時間を計算（休憩開始〜休憩終了のペア）
      const breakStarts = stamps.filter(s => s.type === '休憩開始').sort((a, b) => a.minutes - b.minutes);
      const breakEnds = stamps.filter(s => s.type === '休憩終了').sort((a, b) => a.minutes - b.minutes);
      let breakMinutes = 0;
      for (let b = 0; b < breakStarts.length; b++) {
        if (b < breakEnds.length) {
          breakMinutes += breakEnds[b].minutes - breakStarts[b].minutes;
        }
      }

      try {
        if (duplicateMode === 'skip') {
          // スキップモード: 既存データがあればスキップ
          const [existing] = await pool.execute(
            'SELECT id FROM cost_records WHERE user_id = ? AND date = ?', [userId, entry.date]
          );
          if (existing.length > 0) {
            skipped++;
            continue;
          }
          await pool.execute(
            `INSERT INTO cost_records (user_id, date, start_time, end_time, break_minutes) VALUES (?, ?, ?, ?, ?)`,
            [userId, entry.date, arrival.time, departure.time, breakMinutes]
          );
        } else {
          // 上書きモード（デフォルト）
          await pool.execute(
            `INSERT INTO cost_records (user_id, date, start_time, end_time, break_minutes)
             VALUES (?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE start_time = VALUES(start_time), end_time = VALUES(end_time), break_minutes = VALUES(break_minutes)`,
            [userId, entry.date, arrival.time, departure.time, breakMinutes]
          );
        }
        imported++;
      } catch (e) {
        errors.push(`${entry.date} ${entry.name}: ${e.message}`);
      }
    }

    logger.info(`打刻ログCSVインポート: ${imported}件成功, ${skipped}件スキップ, ${errors.length}件エラー`);
    return ApiResponse.success(res, { imported, skipped, errors: errors.slice(0, 20) });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/analytics/sales-performance
 * 営業別売上・内定・面接パフォーマンス一覧
 */
const getSalesPerformance = async (req, res, next) => {
  try {
    const { date_from, date_to, date_base } = req.query;
    let dateFrom = '2000-01-01', dateTo = '2099-12-31';
    if (date_from) dateFrom = date_from;
    if (date_to) dateTo = date_to;
    // date_base: 'naitei'（内定日）/ 'created'（案件獲得日）/ 'interview'（面接日）
    const base = date_base === 'created' ? 'created' : date_base === 'interview' ? 'interview' : 'naitei';

    // 営業ユーザー一覧
    const [salesUsers] = await pool.query(
      "SELECT id, name FROM users WHERE role = 'sales' AND is_active = 1 ORDER BY name"
    );

    // 集計基準別フィルタ
    // - mainDateFilter: 内定企業数・hires集計用（"内定/案件獲得/面接"の月を基準）
    // - interviewMetricFilter: 面接実施数・面接者数・バラシ用（面接日が指定月にある案件で集計）
    const mainDateFilter =
      base === 'naitei' ? 'p.naitei_date BETWEEN ? AND ?'
      : base === 'interview' ? 'p.interview_date BETWEEN ? AND ?'
      : 'DATE(p.created_at) BETWEEN ? AND ?';
    // 面接系の指標は「実施月＝面接日が指定月」が直感的なので
    // - interview基準時: interview_date
    // - naitei/created基準時: 従来通り created_at
    const interviewMetricFilter =
      base === 'interview' ? 'p.interview_date BETWEEN ? AND ?'
      : 'DATE(p.created_at) BETWEEN ? AND ?';

    const [rows] = await pool.query(
      `SELECT
        p.sales_user_id,
        CAST(SUM(CASE WHEN p.status = 'NAITEI' AND ${mainDateFilter} THEN 1 ELSE 0 END) AS SIGNED) as naitei_companies,
        CAST(SUM(CASE WHEN p.status IN ('NAITEI','FUGOKAKU','KEKKA_MACHI','NAITEI_TORIKESHI') AND ${interviewMetricFilter} THEN 1 ELSE 0 END) AS SIGNED) as interview_count,
        COALESCE(SUM(CASE WHEN p.status IN ('NAITEI','FUGOKAKU','KEKKA_MACHI','NAITEI_TORIKESHI') AND ${interviewMetricFilter} THEN p.interview_attendees ELSE 0 END), 0) as total_attendees,
        CAST(SUM(CASE WHEN p.status = 'BARASHI' AND ${interviewMetricFilter} THEN 1 ELSE 0 END) AS SIGNED) as barashi_count
      FROM projects p
      WHERE p.is_prospect = 0
        AND p.sales_user_id IS NOT NULL
      GROUP BY p.sales_user_id`,
      [dateFrom, dateTo, dateFrom, dateTo, dateFrom, dateTo, dateFrom, dateTo]
    );

    // 内定者集計（国内/海外別）
    const [hireRows] = await pool.query(
      `SELECT
        p.sales_user_id,
        CAST(SUM(CASE WHEN ph.course != '転職' THEN 1 ELSE 0 END) AS SIGNED) as total_hires,
        CAST(SUM(CASE WHEN ph.course = '国内' THEN 1 ELSE 0 END) AS SIGNED) as domestic_hires,
        CAST(SUM(CASE WHEN ph.course = '海外' THEN 1 ELSE 0 END) AS SIGNED) as overseas_hires,
        CAST(SUM(CASE WHEN ph.course = '転職' THEN 1 ELSE 0 END) AS SIGNED) as tenshoku_hires,
        COALESCE(SUM(ph.initial_payment), 0) as initial_payment,
        COALESCE(SUM(ph.expected_revenue), 0) as expected_revenue
      FROM project_hires ph
      JOIN projects p ON ph.project_id = p.id
      WHERE p.is_prospect = 0
        AND p.sales_user_id IS NOT NULL
        AND ph.is_cancelled = 0
        AND ${mainDateFilter}
      GROUP BY p.sales_user_id`,
      [dateFrom, dateTo]
    );

    // マージ
    const projMap = new Map();
    rows.forEach(r => projMap.set(r.sales_user_id, r));
    const hireMap = new Map();
    hireRows.forEach(r => hireMap.set(r.sales_user_id, r));

    const salesData = salesUsers.map(su => {
      const proj = projMap.get(su.id) || {};
      const hire = hireMap.get(su.id) || {};
      const interviews = Number(proj.interview_count) || 0;
      const naiteiCo = Number(proj.naitei_companies) || 0;
      const totalHires = Number(hire.total_hires) || 0;
      return {
        userId: su.id,
        name: su.name,
        naiteiCompanies: naiteiCo,
        totalHires,
        domesticHires: Number(hire.domestic_hires) || 0,
        overseasHires: Number(hire.overseas_hires) || 0,
        tenshokuHires: Number(hire.tenshoku_hires) || 0,
        interviewCount: interviews,
        totalAttendees: Number(proj.total_attendees) || 0,
        passRate: interviews > 0 ? ((naiteiCo / interviews) * 100).toFixed(1) : '0',
        hiresPerInterview: interviews > 0 ? (totalHires / interviews).toFixed(2) : '0',
        barashiCount: Number(proj.barashi_count) || 0,
        initialPayment: Number(hire.initial_payment) || 0,
        expectedRevenue: Number(hire.expected_revenue) || 0,
      };
    });

    // 合計行
    const team = salesData.reduce((acc, s) => {
      acc.naiteiCompanies += s.naiteiCompanies;
      acc.totalHires += s.totalHires;
      acc.domesticHires += s.domesticHires;
      acc.overseasHires += s.overseasHires;
      acc.tenshokuHires += s.tenshokuHires;
      acc.interviewCount += s.interviewCount;
      acc.totalAttendees += s.totalAttendees;
      acc.barashiCount += s.barashiCount;
      acc.initialPayment += s.initialPayment;
      acc.expectedRevenue += s.expectedRevenue;
      return acc;
    }, { naiteiCompanies: 0, totalHires: 0, domesticHires: 0, overseasHires: 0, tenshokuHires: 0, interviewCount: 0, totalAttendees: 0, barashiCount: 0, initialPayment: 0, expectedRevenue: 0 });
    team.passRate = team.interviewCount > 0 ? ((team.naiteiCompanies / team.interviewCount) * 100).toFixed(1) : '0';
    team.hiresPerInterview = team.interviewCount > 0 ? (team.totalHires / team.interviewCount).toFixed(2) : '0';

    return ApiResponse.success(res, { team, sales: salesData, dateFrom, dateTo });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/analytics/sales-detail
 * 営業売上の明細（数値クリック時に表示）
 * ?sales_user_id=N&type=naitei|interview|barashi&date_from=&date_to=
 */
const getSalesDetail = async (req, res, next) => {
  try {
    const { sales_user_id, type, date_from, date_to, date_base } = req.query;
    let dateFrom = date_from || '2000-01-01', dateTo = date_to || '2099-12-31';
    const base = date_base === 'created' ? 'created' : date_base === 'interview' ? 'interview' : 'naitei';
    let statusFilter = '';
    let dateCol = 'DATE(p.created_at)';

    if (type === 'naitei') {
      statusFilter = "AND p.status = 'NAITEI'";
      // 内定明細の日付軸: base が naitei→naitei_date / interview→interview_date / created→created_at
      dateCol = base === 'interview' ? 'p.interview_date'
              : base === 'created' ? 'DATE(p.created_at)'
              : 'p.naitei_date';
    } else if (type === 'interview') {
      statusFilter = "AND p.status IN ('NAITEI','FUGOKAKU','KEKKA_MACHI','NAITEI_TORIKESHI')";
      // 面接系明細: interview基準なら interview_date 軸
      if (base === 'interview') dateCol = 'p.interview_date';
    } else if (type === 'barashi') {
      statusFilter = "AND p.status = 'BARASHI'";
      if (base === 'interview') dateCol = 'p.interview_date';
    }

    let userFilter = '';
    const params = [dateFrom, dateTo];
    if (sales_user_id) {
      userFilter = 'AND p.sales_user_id = ?';
      params.push(sales_user_id);
    }

    const [rows] = await pool.query(
      `SELECT p.id, p.job_number, COALESCE(c.company_name, p.legacy_company_name) as company_name,
              p.status, p.naitei_date, p.interview_attendees, su.name as sales_name,
              (SELECT COUNT(*) FROM project_hires ph WHERE ph.project_id = p.id AND ph.is_cancelled = 0) as hire_count,
              (SELECT COALESCE(SUM(ph.initial_payment), 0) FROM project_hires ph WHERE ph.project_id = p.id AND ph.is_cancelled = 0) as initial_payment,
              (SELECT COALESCE(SUM(ph.expected_revenue), 0) FROM project_hires ph WHERE ph.project_id = p.id AND ph.is_cancelled = 0) as expected_revenue
       FROM projects p
       LEFT JOIN companies c ON p.company_id = c.id
       LEFT JOIN users su ON p.sales_user_id = su.id
       WHERE p.is_prospect = 0 AND p.sales_user_id IS NOT NULL
         AND ${dateCol} BETWEEN ? AND ?
         ${statusFilter} ${userFilter}
       ORDER BY p.naitei_date DESC, p.created_at DESC`,
      params
    );

    return ApiResponse.success(res, rows);
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/analytics/sales-performance-by-industry
 * 業種別の内定率・売上集計
 * date_base: naitei | created | interview
 */
const getSalesPerformanceByIndustry = async (req, res, next) => {
  try {
    const { date_from, date_to, date_base } = req.query;
    let dateFrom = date_from || '2000-01-01', dateTo = date_to || '2099-12-31';
    const base = date_base === 'created' ? 'created' : date_base === 'interview' ? 'interview' : 'naitei';

    const mainDateFilter =
      base === 'naitei' ? 'p.naitei_date BETWEEN ? AND ?'
      : base === 'interview' ? 'p.interview_date BETWEEN ? AND ?'
      : 'DATE(p.created_at) BETWEEN ? AND ?';
    const interviewMetricFilter =
      base === 'interview' ? 'p.interview_date BETWEEN ? AND ?'
      : 'DATE(p.created_at) BETWEEN ? AND ?';

    // 業種カテゴリ式（companies.industry_categoryが空の場合は industry から判定）
    // companies.industry_categoryが既に大枠分類（製造/小売/建設/...）になっているのでそれを使用
    const CATEGORY_EXPR = `COALESCE(NULLIF(c.industry_category, ''), 'その他')`;

    // 案件・面接・内定の業種別集計（大枠カテゴリ単位）
    const [projRows] = await pool.query(
      `SELECT
        ${CATEGORY_EXPR} AS industry,
        CAST(SUM(CASE WHEN ${interviewMetricFilter} THEN 1 ELSE 0 END) AS SIGNED) as project_count,
        CAST(SUM(CASE WHEN p.status IN ('NAITEI','FUGOKAKU','KEKKA_MACHI','NAITEI_TORIKESHI') AND ${interviewMetricFilter} THEN 1 ELSE 0 END) AS SIGNED) as interview_count,
        CAST(SUM(CASE WHEN p.status = 'NAITEI' AND ${mainDateFilter} THEN 1 ELSE 0 END) AS SIGNED) as naitei_companies,
        CAST(SUM(CASE WHEN p.status = 'BARASHI' AND ${interviewMetricFilter} THEN 1 ELSE 0 END) AS SIGNED) as barashi_count
      FROM projects p
      LEFT JOIN companies c ON p.company_id = c.id
      WHERE p.is_prospect = 0
      GROUP BY ${CATEGORY_EXPR}`,
      [dateFrom, dateTo, dateFrom, dateTo, dateFrom, dateTo, dateFrom, dateTo]
    );

    // 業種別の内定者数・売上（大枠カテゴリ単位）
    const [hireRows] = await pool.query(
      `SELECT
        ${CATEGORY_EXPR} AS industry,
        CAST(SUM(CASE WHEN ph.course != '転職' THEN 1 ELSE 0 END) AS SIGNED) as total_hires,
        COALESCE(SUM(ph.initial_payment), 0) as initial_payment,
        COALESCE(SUM(ph.expected_revenue), 0) as expected_revenue
      FROM project_hires ph
      JOIN projects p ON ph.project_id = p.id
      LEFT JOIN companies c ON p.company_id = c.id
      WHERE p.is_prospect = 0
        AND ph.is_cancelled = 0
        AND ${mainDateFilter}
      GROUP BY ${CATEGORY_EXPR}`,
      [dateFrom, dateTo]
    );

    const hireMap = new Map();
    hireRows.forEach(r => hireMap.set(r.industry, r));

    const industries = projRows
      .map(r => {
        const interview = Number(r.interview_count) || 0;
        const project = Number(r.project_count) || 0;
        const naitei = Number(r.naitei_companies) || 0;
        const hire = hireMap.get(r.industry) || {};
        return {
          industry: r.industry,
          projectCount: project,
          interviewCount: interview,
          naiteiCompanies: naitei,
          barashiCount: Number(r.barashi_count) || 0,
          totalHires: Number(hire.total_hires) || 0,
          initialPayment: Number(hire.initial_payment) || 0,
          expectedRevenue: Number(hire.expected_revenue) || 0,
          naiteiRateInterview: interview > 0 ? ((naitei / interview) * 100).toFixed(1) : '0',
          naiteiRateProject: project > 0 ? ((naitei / project) * 100).toFixed(1) : '0',
        };
      })
      .filter(r => r.projectCount > 0 || r.interviewCount > 0 || r.naiteiCompanies > 0)
      .sort((a, b) => b.naiteiCompanies - a.naiteiCompanies || b.interviewCount - a.interviewCount);

    const team = industries.reduce((acc, r) => {
      acc.projectCount += r.projectCount;
      acc.interviewCount += r.interviewCount;
      acc.naiteiCompanies += r.naiteiCompanies;
      acc.barashiCount += r.barashiCount;
      acc.totalHires += r.totalHires;
      acc.initialPayment += r.initialPayment;
      acc.expectedRevenue += r.expectedRevenue;
      return acc;
    }, { projectCount: 0, interviewCount: 0, naiteiCompanies: 0, barashiCount: 0, totalHires: 0, initialPayment: 0, expectedRevenue: 0 });
    team.naiteiRateInterview = team.interviewCount > 0 ? ((team.naiteiCompanies / team.interviewCount) * 100).toFixed(1) : '0';
    team.naiteiRateProject = team.projectCount > 0 ? ((team.naiteiCompanies / team.projectCount) * 100).toFixed(1) : '0';

    return ApiResponse.success(res, { team, industries, dateFrom, dateTo });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/analytics/waiting-contact-detail
 * 連絡待ち（mail_replied/phone_confirmed が両方空）案件の明細
 * 面接日の有無で2グループに分けて返す
 * 2026-04-01以降のみ対象
 */
const getWaitingContactDetail = async (req, res, next) => {
  try {
    const { date_from, date_to, user_id } = req.query;
    const SYSTEM_START = '2026-04-01';
    let dateFrom = date_from || SYSTEM_START;
    if (dateFrom < SYSTEM_START) dateFrom = SYSTEM_START;
    const dateTo = date_to || new Date().toISOString().slice(0, 10);

    const params = [dateFrom, dateTo];
    let userFilter = '';
    if (user_id) {
      userFilter = 'AND p.owner_user_id = ?';
      params.push(user_id);
    }

    const [rows] = await pool.query(
      `SELECT p.id, p.job_number, p.status, p.created_at, p.interview_date, p.memo,
              COALESCE(co.company_name, p.legacy_company_name) AS company_name,
              ou.name AS owner_name,
              su.name AS sales_name
       FROM projects p
       LEFT JOIN companies co ON p.company_id = co.id
       LEFT JOIN users ou ON p.owner_user_id = ou.id
       LEFT JOIN users su ON p.sales_user_id = su.id
       WHERE p.is_legacy = 0 AND p.is_prospect = 0
         AND COALESCE(p.mail_replied, 0) = 0
         AND COALESCE(p.phone_confirmed, 0) = 0
         AND (p.status IS NULL OR p.status NOT IN ('LOST','SHORUI_CHU','SHORUI_OCHI','MODOSHI','BARASHI','HORYU'))
         AND DATE(p.created_at) BETWEEN ? AND ?
         ${userFilter}
       ORDER BY p.interview_date IS NULL, p.interview_date ASC, p.created_at DESC`,
      params
    );

    const withInterview = [];
    const withoutInterview = [];
    for (const r of rows) {
      const item = {
        projectId: r.id,
        jobNumber: r.job_number,
        companyName: r.company_name,
        ownerName: r.owner_name,
        salesName: r.sales_name,
        status: r.status,
        createdAt: r.created_at,
        interviewDate: r.interview_date,
        memo: r.memo,
      };
      if (r.interview_date) withInterview.push(item);
      else withoutInterview.push(item);
    }

    return ApiResponse.success(res, {
      dateFrom, dateTo,
      withInterview,
      withoutInterview,
      total: rows.length,
    });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/analytics/industry-monthly-analysis?months=6
 * 業種別×月別の指標
 *  - projectCount: 案件数
 *  - callCount: コール数（calls JOIN companies）
 *  - naiteiCount: 内定数（status=NAITEI、naitei_date基準）
 *  - interviewDoneCount: 面接実施数（status IN ('NAITEI','FUGOKAKU','KEKKA_MACHI','NAITEI_TORIKESHI')）
 *  - lostCount, barashiCount
 * 返却した数値からフロントで率を算出
 */
const getIndustryMonthlyAnalysis = async (req, res, next) => {
  try {
    const months = Math.min(24, Math.max(1, parseInt(req.query.months, 10) || 6));
    const groupBy = req.query.group_by === 'region' ? 'region' : 'industry';
    const now = new Date();
    const monthList = [];
    for (let i = months - 1; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
      monthList.push({
        ym,
        dateFrom: `${ym}-01`,
        dateTo: `${ym}-${String(lastDay).padStart(2, '0')}`,
      });
    }

    // グループ式
    // industry: industry_category 優先 + industry テキストからキーワード判定
    // 注意: 「飲食料品小売業」のように2つのキーワードを含む業種があるため、
    //       先に「小売」を判定して飲食を後にする（「料品小売」を飲食扱いしない）
    // region: c.region（都道府県）。NULL/空は '(未設定)'
    const INDUSTRY_CAT = `(
      CASE
        WHEN c.industry_category IN ('飲食','製造','小売','建設','宿泊') THEN c.industry_category
        WHEN c.industry LIKE '%小売%' OR c.industry LIKE '%卸売%' OR c.industry LIKE '%スーパー%' OR c.industry LIKE '%コンビニ%'
             OR c.industry LIKE '%ショッピング%' OR c.industry LIKE '%商社%' OR c.industry LIKE '%物販%' THEN '小売'
        WHEN c.industry LIKE '%製造%' OR c.industry LIKE '%メーカー%' OR c.industry LIKE '%加工%' THEN '製造'
        WHEN c.industry LIKE '%建設%' OR c.industry LIKE '%工事%' OR c.industry LIKE '%建築%' OR c.industry LIKE '%土木%'
             OR c.industry LIKE '%リフォーム%' THEN '建設'
        WHEN c.industry LIKE '%宿泊%' OR c.industry LIKE '%ホテル%' OR c.industry LIKE '%旅館%' OR c.industry LIKE '%民宿%' THEN '宿泊'
        WHEN c.industry LIKE '%飲食%' OR c.industry LIKE '%グルメ%' OR c.industry LIKE '%レストラン%' OR c.industry LIKE '%居酒屋%'
             OR c.industry LIKE '%ラーメン%' OR c.industry LIKE '%カフェ%' OR c.industry LIKE '%喫茶店%' OR c.industry LIKE '%寿司%'
             OR c.industry LIKE '%焼肉%' OR c.industry LIKE '%和食%' OR c.industry LIKE '%中華%' OR c.industry LIKE '%洋食%'
             OR c.industry LIKE '%食堂%' OR c.industry LIKE '%ダイニング%' OR c.industry LIKE '%そば%' OR c.industry LIKE '%うどん%'
             OR c.industry LIKE '%菓子%' THEN '飲食'
        ELSE 'その他'
      END
    )`;
    const REGION_EXPR = `COALESCE(NULLIF(c.region, ''), '(未設定)')`;
    const CAT = groupBy === 'region' ? REGION_EXPR : INDUSTRY_CAT;

    // 業種別月別データを1回のクエリで取得
    // projects: created_at（案件獲得日）月でグループ化
    const [projAll] = await pool.query(
      `SELECT
         DATE_FORMAT(p.created_at, '%Y-%m') AS ym,
         ${CAT} AS industry_cat,
         COUNT(*) AS project_count,
         CAST(SUM(CASE WHEN p.status = 'NAITEI' THEN 1 ELSE 0 END) AS SIGNED) AS naitei_count,
         CAST(SUM(CASE WHEN p.status IN ('NAITEI','FUGOKAKU','KEKKA_MACHI','NAITEI_TORIKESHI') THEN 1 ELSE 0 END) AS SIGNED) AS interview_done_count,
         CAST(SUM(CASE WHEN p.status = 'LOST' THEN 1 ELSE 0 END) AS SIGNED) AS lost_count,
         CAST(SUM(CASE WHEN p.status = 'BARASHI' THEN 1 ELSE 0 END) AS SIGNED) AS barashi_count
       FROM projects p
       LEFT JOIN companies c ON p.company_id = c.id
       WHERE p.is_prospect = 0 AND p.is_legacy = 0
         AND DATE(p.created_at) BETWEEN ? AND ?
       GROUP BY DATE_FORMAT(p.created_at, '%Y-%m'), ${CAT}`,
      [monthList[0].dateFrom, monthList[monthList.length - 1].dateTo]
    );

    // コール数 (有効な架電のみ。SKIP除外)
    const [callAll] = await pool.query(
      `SELECT
         DATE_FORMAT(cl.call_started_at, '%Y-%m') AS ym,
         ${CAT} AS industry_cat,
         COUNT(*) AS call_count
       FROM calls cl
       LEFT JOIN companies c ON cl.company_id = c.id
       WHERE cl.result_code IS NOT NULL AND cl.result_code != 'SKIP'
         AND DATE(cl.call_started_at) BETWEEN ? AND ?
       GROUP BY DATE_FORMAT(cl.call_started_at, '%Y-%m'), ${CAT}`,
      [monthList[0].dateFrom, monthList[monthList.length - 1].dateTo]
    );

    // 業種モード: 飲食/製造/小売/建設/宿泊 + その他
    // 地域モード: そのまま採用
    const SHOW_CATEGORIES = new Set(['飲食', '製造', '小売', '建設', '宿泊']);
    const normalizeIndustry = groupBy === 'region'
      ? (cat) => cat || '(未設定)'
      : (cat) => SHOW_CATEGORIES.has(cat) ? cat : 'その他';

    // 業種一覧
    const industrySet = groupBy === 'region'
      ? new Set() // 地域モードは実データから収集
      : new Set(['飲食', '製造', '小売', '建設', '宿泊', 'その他']);
    if (groupBy === 'region') {
      for (const r of projAll) industrySet.add(normalizeIndustry(r.industry_cat));
      for (const r of callAll) industrySet.add(normalizeIndustry(r.industry_cat));
    }

    // ymごとに { industry: { ... } } マップを構築（その他には統合）
    const dataKey = (ym, industry) => `${ym}|${industry}`;
    const projMap = new Map();
    for (const r of projAll) {
      const norm = normalizeIndustry(r.industry_cat);
      const k = dataKey(r.ym, norm);
      const existing = projMap.get(k);
      if (existing) {
        existing.project_count = Number(existing.project_count) + Number(r.project_count || 0);
        existing.naitei_count = Number(existing.naitei_count) + Number(r.naitei_count || 0);
        existing.interview_done_count = Number(existing.interview_done_count) + Number(r.interview_done_count || 0);
        existing.lost_count = Number(existing.lost_count) + Number(r.lost_count || 0);
        existing.barashi_count = Number(existing.barashi_count) + Number(r.barashi_count || 0);
      } else {
        projMap.set(k, { ...r });
      }
    }
    const callMap = new Map();
    for (const r of callAll) {
      const norm = normalizeIndustry(r.industry_cat);
      const k = dataKey(r.ym, norm);
      const existing = callMap.get(k);
      if (existing) {
        existing.call_count = Number(existing.call_count) + Number(r.call_count || 0);
      } else {
        callMap.set(k, { ...r });
      }
    }

    // 業種ごとに月別配列を作成
    // 都道府県の表示順（北→南）
    const REGION_ORDER = [
      '北海道','青森県','岩手県','宮城県','秋田県','山形県','福島県',
      '茨城県','栃木県','群馬県','埼玉県','千葉県','東京都','神奈川県',
      '新潟県','富山県','石川県','福井県','山梨県','長野県','岐阜県','静岡県','愛知県',
      '三重県','滋賀県','京都府','大阪府','兵庫県','奈良県','和歌山県',
      '鳥取県','島根県','岡山県','広島県','山口県',
      '徳島県','香川県','愛媛県','高知県',
      '福岡県','佐賀県','長崎県','熊本県','大分県','宮崎県','鹿児島県','沖縄県',
      '(未設定)',
    ];
    const INDUSTRY_ORDER = ['飲食','製造','小売','建設','宿泊','その他'];
    const CATEGORY_ORDER = groupBy === 'region' ? REGION_ORDER : INDUSTRY_ORDER;
    const industries = [...industrySet].sort((a, b) => {
      const ia = CATEGORY_ORDER.indexOf(a);
      const ib = CATEGORY_ORDER.indexOf(b);
      const sa = ia === -1 ? 999 : ia;
      const sb = ib === -1 ? 999 : ib;
      return sa - sb;
    }).map(industry => {
      const monthlyData = monthList.map(m => {
        const p = projMap.get(dataKey(m.ym, industry)) || {};
        const c = callMap.get(dataKey(m.ym, industry)) || {};
        const projectCount = Number(p.project_count) || 0;
        const naiteiCount = Number(p.naitei_count) || 0;
        const interviewDone = Number(p.interview_done_count) || 0;
        const lostCount = Number(p.lost_count) || 0;
        const barashiCount = Number(p.barashi_count) || 0;
        const callCount = Number(c.call_count) || 0;
        return {
          ym: m.ym,
          projectCount,
          callCount,
          naiteiCount,
          interviewDoneCount: interviewDone,
          lostCount,
          barashiCount,
          // 各種率（%、小数1桁）
          projectRate: callCount > 0 ? Math.round(projectCount / callCount * 1000) / 10 : 0,
          naiteiPerProject: projectCount > 0 ? Math.round(naiteiCount / projectCount * 1000) / 10 : 0,
          interviewPerProject: projectCount > 0 ? Math.round(interviewDone / projectCount * 1000) / 10 : 0,
          naiteiPerInterview: interviewDone > 0 ? Math.round(naiteiCount / interviewDone * 1000) / 10 : 0,
          lostPerProject: projectCount > 0 ? Math.round(lostCount / projectCount * 1000) / 10 : 0,
          barashiPerProject: projectCount > 0 ? Math.round(barashiCount / projectCount * 1000) / 10 : 0,
        };
      });
      // 業種総計
      const total = monthlyData.reduce((acc, m) => {
        acc.projectCount += m.projectCount;
        acc.callCount += m.callCount;
        acc.naiteiCount += m.naiteiCount;
        acc.interviewDoneCount += m.interviewDoneCount;
        acc.lostCount += m.lostCount;
        acc.barashiCount += m.barashiCount;
        return acc;
      }, { projectCount: 0, callCount: 0, naiteiCount: 0, interviewDoneCount: 0, lostCount: 0, barashiCount: 0 });
      total.projectRate = total.callCount > 0 ? Math.round(total.projectCount / total.callCount * 1000) / 10 : 0;
      total.naiteiPerProject = total.projectCount > 0 ? Math.round(total.naiteiCount / total.projectCount * 1000) / 10 : 0;
      total.interviewPerProject = total.projectCount > 0 ? Math.round(total.interviewDoneCount / total.projectCount * 1000) / 10 : 0;
      total.naiteiPerInterview = total.interviewDoneCount > 0 ? Math.round(total.naiteiCount / total.interviewDoneCount * 1000) / 10 : 0;
      total.lostPerProject = total.projectCount > 0 ? Math.round(total.lostCount / total.projectCount * 1000) / 10 : 0;
      total.barashiPerProject = total.projectCount > 0 ? Math.round(total.barashiCount / total.projectCount * 1000) / 10 : 0;
      return { industry, monthlyData, total };
    });

    return ApiResponse.success(res, {
      groupBy,
      months: monthList.map(m => m.ym),
      industries,
    });
  } catch (err) {
    logger.error(`[getIndustryMonthlyAnalysis] ${err.message}`);
    return ApiResponse.error(res, err.message, 500);
  }
};

/**
 * GET /api/analytics/quality-industry-detail
 * 案件質の特定ステータス（LOST/BARASHI/NAITEI）について、業種別件数を返す
 * ?status=LOST|BARASHI|NAITEI&date_from=&date_to=&user_id=
 */
const getQualityIndustryDetail = async (req, res, next) => {
  try {
    const { date_from, date_to, user_id, status } = req.query;
    const allowedStatuses = ['LOST', 'BARASHI', 'NAITEI'];
    if (!allowedStatuses.includes(status)) {
      return ApiResponse.badRequest(res, 'status は LOST/BARASHI/NAITEI のいずれか');
    }
    const dateFrom = date_from || '2026-04-01';
    const dateTo = date_to || new Date().toISOString().slice(0, 10);
    const params = [dateFrom, dateTo];
    let userFilter = '';
    if (user_id) {
      userFilter = 'AND p.owner_user_id = ?';
      params.push(user_id);
    }
    // NAITEI は naitei_date 基準、それ以外は created_at
    const dateCol = status === 'NAITEI' ? 'p.naitei_date' : 'DATE(p.created_at)';

    const CAT = `COALESCE(NULLIF(c.industry_category, ''), 'その他')`;
    const [rows] = await pool.query(
      `SELECT ${CAT} AS industry_cat, COUNT(*) AS cnt
       FROM projects p
       LEFT JOIN companies c ON p.company_id = c.id
       WHERE p.is_prospect = 0
         AND p.status = ?
         AND ${dateCol} BETWEEN ? AND ?
         ${userFilter}
       GROUP BY ${CAT}
       ORDER BY cnt DESC`,
      [status, ...params]
    );

    // 明細も取得
    const detailParams = [status, dateFrom, dateTo, ...(user_id ? [user_id] : [])];
    const [detailRows] = await pool.query(
      `SELECT p.id, p.job_number, p.status, p.created_at, p.naitei_date,
              ${CAT} AS industry_cat,
              COALESCE(c.company_name, p.legacy_company_name) AS company_name,
              ou.name AS owner_name, su.name AS sales_name
       FROM projects p
       LEFT JOIN companies c ON p.company_id = c.id
       LEFT JOIN users ou ON p.owner_user_id = ou.id
       LEFT JOIN users su ON p.sales_user_id = su.id
       WHERE p.is_prospect = 0
         AND p.status = ?
         AND ${dateCol} BETWEEN ? AND ?
         ${userFilter}
       ORDER BY ${dateCol} DESC`,
      detailParams
    );

    const total = rows.reduce((s, r) => s + Number(r.cnt), 0);
    return ApiResponse.success(res, {
      status, dateFrom, dateTo, total,
      industries: rows.map(r => ({ industry: r.industry_cat, count: Number(r.cnt) })),
      projects: detailRows.map(r => ({ ...r, industry: r.industry_cat })),
    });
  } catch (err) {
    logger.error(`[getQualityIndustryDetail] ${err.message}`);
    return ApiResponse.error(res, err.message, 500);
  }
};

/**
 * GET /api/analytics/industry-period-detail
 * 業種カテゴリ × 期間 × 指標タイプ で対象案件/コールの明細を返す
 * ?industry=飲食&month=2026-04&type=project|naitei|interview|lost|barashi|call
 */
const getIndustryPeriodDetail = async (req, res, next) => {
  try {
    const { industry, month, type } = req.query;
    const groupBy = req.query.group_by === 'region' ? 'region' : 'industry';
    if (!industry || !month || !type) {
      return ApiResponse.badRequest(res, 'industry, month, type が必要です');
    }
    if (!/^\d{4}-\d{2}$/.test(month)) {
      return ApiResponse.badRequest(res, 'month の形式が不正です');
    }
    const [yStr, mStr] = month.split('-');
    const y = parseInt(yStr, 10);
    const m = parseInt(mStr, 10);
    const lastDay = new Date(y, m, 0).getDate();
    const dateFrom = `${month}-01`;
    const dateTo = `${month}-${String(lastDay).padStart(2, '0')}`;

    // CATEGORY_SQL: industry_category 優先、不整合時は industry テキストから判定（業種別分析と同じロジック）
    const INDUSTRY_CAT = `(
      CASE
        WHEN c.industry_category IN ('飲食','製造','小売','建設','宿泊') THEN c.industry_category
        WHEN c.industry LIKE '%小売%' OR c.industry LIKE '%卸売%' OR c.industry LIKE '%スーパー%' OR c.industry LIKE '%コンビニ%'
             OR c.industry LIKE '%ショッピング%' OR c.industry LIKE '%商社%' OR c.industry LIKE '%物販%' THEN '小売'
        WHEN c.industry LIKE '%製造%' OR c.industry LIKE '%メーカー%' OR c.industry LIKE '%加工%' THEN '製造'
        WHEN c.industry LIKE '%建設%' OR c.industry LIKE '%工事%' OR c.industry LIKE '%建築%' OR c.industry LIKE '%土木%'
             OR c.industry LIKE '%リフォーム%' THEN '建設'
        WHEN c.industry LIKE '%宿泊%' OR c.industry LIKE '%ホテル%' OR c.industry LIKE '%旅館%' OR c.industry LIKE '%民宿%' THEN '宿泊'
        WHEN c.industry LIKE '%飲食%' OR c.industry LIKE '%グルメ%' OR c.industry LIKE '%レストラン%' OR c.industry LIKE '%居酒屋%'
             OR c.industry LIKE '%ラーメン%' OR c.industry LIKE '%カフェ%' OR c.industry LIKE '%喫茶店%' OR c.industry LIKE '%寿司%'
             OR c.industry LIKE '%焼肉%' OR c.industry LIKE '%和食%' OR c.industry LIKE '%中華%' OR c.industry LIKE '%洋食%'
             OR c.industry LIKE '%食堂%' OR c.industry LIKE '%ダイニング%' OR c.industry LIKE '%そば%' OR c.industry LIKE '%うどん%'
             OR c.industry LIKE '%菓子%' THEN '飲食'
        ELSE 'その他'
      END
    )`;
    const REGION_EXPR = `COALESCE(NULLIF(c.region, ''), '(未設定)')`;
    const CAT = groupBy === 'region' ? REGION_EXPR : INDUSTRY_CAT;
    const industryWhere = `${CAT} = ?`;
    const industryParams = [industry];

    if (type === 'call') {
      // コール明細
      const [rows] = await pool.query(
        `SELECT cl.id, cl.call_started_at, cl.result_code, cl.memo,
                u.name AS operator_name,
                co.company_name, co.phone_number, co.industry, ${CAT} AS industry_cat
         FROM calls cl
         LEFT JOIN companies co ON cl.company_id = co.id
         LEFT JOIN users u ON cl.user_id = u.id
         LEFT JOIN companies c ON cl.company_id = c.id
         WHERE cl.result_code IS NOT NULL AND cl.result_code != 'SKIP'
           AND DATE(cl.call_started_at) BETWEEN ? AND ?
           AND ${industryWhere}
         ORDER BY cl.call_started_at DESC
         LIMIT 500`,
        [dateFrom, dateTo, ...industryParams]
      );
      return ApiResponse.success(res, { type, industry, month, count: rows.length, calls: rows });
    }

    // type → status filter
    const typeStatusMap = {
      project: null, // 全案件
      naitei: ['NAITEI'],
      interview: ['NAITEI', 'FUGOKAKU', 'KEKKA_MACHI', 'NAITEI_TORIKESHI'],
      lost: ['LOST'],
      barashi: ['BARASHI'],
    };
    if (!(type in typeStatusMap)) {
      return ApiResponse.badRequest(res, 'type が不正です');
    }
    const statuses = typeStatusMap[type];
    const params = [dateFrom, dateTo, ...industryParams];
    let statusFilter = '';
    if (statuses && statuses.length > 0) {
      statusFilter = `AND p.status IN (${statuses.map(() => '?').join(',')})`;
      params.push(...statuses);
    }

    const [rows] = await pool.query(
      `SELECT p.id, p.job_number, p.status, p.created_at, p.naitei_date, p.interview_date,
              COALESCE(c.company_name, p.legacy_company_name) AS company_name,
              c.industry, ${CAT} AS industry_cat,
              ou.name AS owner_name, su.name AS sales_name
       FROM projects p
       LEFT JOIN companies c ON p.company_id = c.id
       LEFT JOIN users ou ON p.owner_user_id = ou.id
       LEFT JOIN users su ON p.sales_user_id = su.id
       WHERE p.is_prospect = 0 AND p.is_legacy = 0
         AND DATE(p.created_at) BETWEEN ? AND ?
         AND ${industryWhere}
         ${statusFilter}
       ORDER BY p.created_at DESC
       LIMIT 500`,
      params
    );
    return ApiResponse.success(res, { type, industry, month, count: rows.length, projects: rows });
  } catch (err) {
    logger.error(`[getIndustryPeriodDetail] ${err.message}`);
    return ApiResponse.error(res, err.message, 500);
  }
};

module.exports = { getCpaMetrics, getQualityMetrics, getOperators, importCostCsv, importCostPdf, importStampCsv, getCpaAll, getQualityAll, getSalesPerformance, getSalesDetail, getSalesPerformanceByIndustry, getWaitingContactDetail, getIndustryMonthlyAnalysis, getQualityIndustryDetail, getIndustryPeriodDetail };
