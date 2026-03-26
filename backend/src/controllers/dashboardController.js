/**
 * ダッシュボードコントローラー
 * KPI集計・グラフデータ取得
 */
const pool = require('../../config/database');
const ApiResponse = require('../utils/apiResponse');
const { getDateRange } = require('../utils/periodHelper');

/**
 * 業種を大分類にまとめるマッピング
 */
const INDUSTRY_CATEGORY_MAP = {
  // 製造業
  '食料品製造業': '製造業',
  '飲料・たばこ・飼料製造業': '製造業',
  '繊維工業': '製造業',
  '木材・木製品製造業': '製造業',
  '家具・装備品製造業': '製造業',
  'パルプ・紙・紙加工品製造業': '製造業',
  '印刷・同関連業': '製造業',
  '化学工業': '製造業',
  '石油製品・石炭製品製造業': '製造業',
  'プラスチック製品製造業': '製造業',
  'ゴム製品製造業': '製造業',
  'なめし革・同製品・毛皮製造業': '製造業',
  '窯業・土石製品製造業': '製造業',
  '鉄鋼業': '製造業',
  '非鉄金属製造業': '製造業',
  '金属製品製造業': '製造業',
  'はん用機械器具製造業': '製造業',
  '生産用機械器具製造業': '製造業',
  '業務用機械器具製造業': '製造業',
  '電子部品・デバイス・電子回路製造業': '製造業',
  '電気機械器具製造業': '製造業',
  '情報通信機械器具製造業': '製造業',
  '輸送用機械器具製造業': '製造業',
  'その他の製造業': '製造業',

  // 飲食
  '飲食店': '飲食',
  '持ち帰り・配達飲食サービス業': '飲食',
  '飲食サービス業': '飲食',
  'グルメ・飲食': '飲食',
  '食堂・レストラン': '飲食',
  '焼肉・ステーキ・すき焼き': '飲食',
  '割烹・料亭': '飲食',
  '魚・うなぎ・かき・かに': '飲食',
  '和食・日本料理': '飲食',
  // 宿泊
  '宿泊業': '宿泊',
  '宿泊業，飲食サービス業': '飲食',

  // 建設
  '総合工事業': '建設業',
  '職別工事業': '建設業',
  '設備工事業': '建設業',
  '建設業': '建設業',

  // 卸売・小売
  '各種商品卸売業': '卸売・小売',
  '繊維・衣服等卸売業': '卸売・小売',
  '飲食料品卸売業': '卸売・小売',
  '建築材料，鉱物・金属材料等卸売業': '卸売・小売',
  '機械器具卸売業': '卸売・小売',
  'その他の卸売業': '卸売・小売',
  '各種商品小売業': '卸売・小売',
  '織物・衣服・身の回り品小売業': '卸売・小売',
  '飲食料品小売業': '卸売・小売',
  '機械器具小売業': '卸売・小売',
  'その他の小売業': '卸売・小売',
  '無店舗小売業': '卸売・小売',

  // 運輸
  '道路旅客運送業': '運輸業',
  '道路貨物運送業': '運輸業',
  '水運業': '運輸業',
  '航空運輸業': '運輸業',
  '倉庫業': '運輸業',
  '運輸に附帯するサービス業': '運輸業',
  '郵便業': '運輸業',

  // 情報通信
  '通信業': '情報通信',
  '放送業': '情報通信',
  '情報サービス業': '情報通信',
  'インターネット附随サービス業': '情報通信',
  '映像・音声・文字情報制作業': '情報通信',

  // サービス
  '洗濯・理容・美容・浴場業': 'サービス業',
  'その他の生活関連サービス業': 'サービス業',
  '娯楽業': 'サービス業',
  '廃棄物処理業': 'サービス業',
  '自動車整備業': 'サービス業',
  '機械等修理業': 'サービス業',
  '職業紹介・労働者派遣業': 'サービス業',
  'その他の事業サービス業': 'サービス業',
  'その他のサービス業': 'サービス業',

  // 医療・福祉
  '医療業': '医療・福祉',
  '保健衛生': '医療・福祉',
  '社会保険・社会福祉・介護事業': '医療・福祉',
  '老人福祉・介護事業': '医療・福祉',
  '児童福祉事業': '医療・福祉',

  // 教育・学習支援
  '学校教育': '教育',
  'その他の教育，学習支援業': '教育',

  // 不動産
  '不動産取引業': '不動産',
  '不動産賃貸業・管理業': '不動産',

  // 農林漁業
  '農業': '農林漁業',
  '林業': '農林漁業',
  '漁業': '農林漁業',
};

const getIndustryCategory = (industry) => {
  if (!industry) return 'その他';
  if (INDUSTRY_CATEGORY_MAP[industry]) return INDUSTRY_CATEGORY_MAP[industry];
  // 部分一致でカテゴリ推定
  if (industry.includes('製造') || industry.includes('加工') || industry.includes('鉄鋼') || industry.includes('金属')) return '製造業';
  if (industry.includes('飲食') || industry.includes('食堂') || industry.includes('レストラン') || industry.includes('グルメ') || industry.includes('焼肉') || industry.includes('割烹') || industry.includes('料亭') || industry.includes('うなぎ') || industry.includes('和食') || industry.includes('日本料理') || industry.includes('ステーキ') || industry.includes('すき焼')) return '飲食';
  if (industry.includes('建設') || industry.includes('工事')) return '建設業';
  if (industry.includes('卸売') || industry.includes('小売')) return '卸売・小売';
  if (industry.includes('運送') || industry.includes('運輸') || industry.includes('倉庫')) return '運輸業';
  if (industry.includes('情報') || industry.includes('通信') || industry.includes('ソフト')) return '情報通信';
  if (industry.includes('医療') || industry.includes('福祉') || industry.includes('介護')) return '医療・福祉';
  if (industry.includes('教育') || industry.includes('学習')) return '教育';
  if (industry.includes('不動産')) return '不動産';
  if (industry.includes('農') || industry.includes('林') || industry.includes('漁')) return '農林漁業';
  if (industry.includes('宿泊') || industry.includes('ホテル')) return '宿泊';
  return 'その他';
};

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
       WHERE DATE(c.call_started_at) BETWEEN ? AND ? AND c.result_code IS NOT NULL AND c.result_code != 'SKIP'
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
             ) - COALESCE(break_minutes, 0)
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
          'SELECT start_time, end_time, break_minutes FROM work_hours WHERE user_id = ? AND date = ?',
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
               ) - COALESCE(break_minutes, 0)
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
 * ?date=YYYY-MM-DD&period=daily|weekly|monthly|cumulative&scope=self|team|operator&target_user_id=N
 */
const getHourlyCalls = async (req, res, next) => {
  try {
    const userRole = req.user.role;
    const date = req.query.date || new Date().toISOString().slice(0, 10);
    const period = req.query.period || 'daily';
    const scope = req.query.scope || 'self';
    const targetUserId = req.query.target_user_id;

    const range = getDateRange(period, date);
    const { dateFrom, dateTo } = range;

    // ユーザー条件
    let userCond = '';
    const params = [dateFrom, dateTo];
    if (scope === 'team' && (userRole === 'admin' || userRole === 'manager')) {
      // 全ユーザー
    } else if (scope === 'operator' && targetUserId && (userRole === 'admin' || userRole === 'manager')) {
      userCond = 'AND user_id = ?';
      params.push(targetUserId);
    } else {
      userCond = 'AND user_id = ?';
      params.push(req.user.id);
    }

    const [rows] = await pool.query(
      `SELECT HOUR(call_started_at) as hour, COUNT(*) as count
       FROM calls
       WHERE DATE(call_started_at) BETWEEN ? AND ? AND result_code IS NOT NULL AND result_code != 'SKIP'
         ${userCond}
       GROUP BY HOUR(call_started_at)
       ORDER BY hour`,
      params
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
 * 業種別案件化率
 * ?date=YYYY-MM-DD&period=daily|weekly|monthly|cumulative&scope=self|team|operator&target_user_id=N
 */
const getIndustryConversion = async (req, res, next) => {
  try {
    const userRole = req.user.role;
    const date = req.query.date || new Date().toISOString().slice(0, 10);
    const period = req.query.period || 'cumulative';
    const scope = req.query.scope || 'self';
    const targetUserId = req.query.target_user_id;

    const range = getDateRange(period, date);
    const { dateFrom, dateTo } = range;

    let userCond = '';
    const params = [dateFrom, dateTo];
    if (scope === 'team' && (userRole === 'admin' || userRole === 'manager')) {
      // 全ユーザー
    } else if (scope === 'operator' && targetUserId && (userRole === 'admin' || userRole === 'manager')) {
      userCond = 'AND c.user_id = ?';
      params.push(targetUserId);
    } else {
      userCond = 'AND c.user_id = ?';
      params.push(req.user.id);
    }

    // 案件化したコールのみを対象に、業種別の件数と割合を算出
    const [rows] = await pool.query(
      `SELECT
         co.industry,
         COUNT(c.id) as projects
       FROM calls c
       JOIN companies co ON c.company_id = co.id
       WHERE DATE(c.call_started_at) BETWEEN ? AND ?
         AND co.industry IS NOT NULL AND c.result_code IS NOT NULL AND c.result_code != 'SKIP'
         AND c.is_project_created = 1
         ${userCond}
       GROUP BY co.industry
       ORDER BY projects DESC`,
      params
    );

    // 業種を大分類にまとめる
    const grouped = {};
    for (const r of rows) {
      const cat = getIndustryCategory(r.industry);
      grouped[cat] = (grouped[cat] || 0) + Number(r.projects);
    }

    const totalProjects = Object.values(grouped).reduce((s, v) => s + v, 0);
    const data = Object.entries(grouped)
      .map(([industry, projects]) => ({
        industry,
        projects,
        conversion_rate: totalProjects > 0 ? Math.round(projects / totalProjects * 1000) / 10 : 0,
      }))
      .sort((a, b) => b.projects - a.projects);

    return ApiResponse.success(res, data);
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/dashboard/hourly-industry-connections
 * 時間帯×業種別 接続数/接続率クロス集計
 * ?date=YYYY-MM-DD&period=daily|weekly|monthly|cumulative&scope=self|team|operator&target_user_id=N
 */
const getHourlyIndustryConnections = async (req, res, next) => {
  try {
    const userRole = req.user.role;
    const date = req.query.date || new Date().toISOString().slice(0, 10);
    const period = req.query.period || 'cumulative';
    const scope = req.query.scope || 'self';
    const targetUserId = req.query.target_user_id;

    const range = getDateRange(period, date);
    const { dateFrom, dateTo } = range;

    let userCond = '';
    const params = [dateFrom, dateTo];
    if (scope === 'team' && (userRole === 'admin' || userRole === 'manager')) {
      // 全ユーザー
    } else if (scope === 'operator' && targetUserId && (userRole === 'admin' || userRole === 'manager')) {
      userCond = 'AND c.user_id = ?';
      params.push(targetUserId);
    } else {
      userCond = 'AND c.user_id = ?';
      params.push(req.user.id);
    }

    // 接続数（NO_ANSWER, SKIP除外）
    const [rows] = await pool.query(
      `SELECT HOUR(c.call_started_at) as hour, co.industry, COUNT(*) as connections
       FROM calls c
       JOIN companies co ON c.company_id = co.id
       WHERE DATE(c.call_started_at) BETWEEN ? AND ?
         AND c.result_code NOT IN ('NO_ANSWER', 'SKIP') AND c.result_code IS NOT NULL
         AND co.industry IS NOT NULL
         ${userCond}
       GROUP BY HOUR(c.call_started_at), co.industry
       ORDER BY hour, co.industry`,
      params
    );
    // 総コール数（接続率計算用、SKIP除外）
    const connParams = [dateFrom, dateTo];
    if (userCond) connParams.push(params[params.length - 1]);
    const [totalRows] = await pool.query(
      `SELECT HOUR(c.call_started_at) as hour, co.industry, COUNT(*) as total_calls
       FROM calls c
       JOIN companies co ON c.company_id = co.id
       WHERE DATE(c.call_started_at) BETWEEN ? AND ?
         AND c.result_code IS NOT NULL AND c.result_code != 'SKIP'
         AND co.industry IS NOT NULL
         ${userCond}
       GROUP BY HOUR(c.call_started_at), co.industry`,
      connParams
    );

    // 大分類にまとめて集計
    const catRows = rows.map(r => ({ ...r, industry: getIndustryCategory(r.industry) }));
    const catTotalRows = totalRows.map(r => ({ ...r, industry: getIndustryCategory(r.industry) }));

    // ユニーク大分類リスト
    const allIndustries = new Set([...catRows.map(r => r.industry), ...catTotalRows.map(r => r.industry)]);
    const industries = [...allIndustries].sort();

    // 9〜19時のクロス集計テーブル整形
    const tableRowsArr = [];
    const totals = {};
    const totalCallsMap = {};
    industries.forEach(ind => { totals[ind] = 0; totalCallsMap[ind] = 0; });
    let grandTotal = 0;
    let grandTotalCalls = 0;

    for (let h = 9; h <= 19; h++) {
      const row = { hour: h };
      let rowTotal = 0;
      let rowTotalCalls = 0;
      for (const ind of industries) {
        const val = catRows.filter(r => r.hour === h && r.industry === ind).reduce((s, r) => s + r.connections, 0);
        const calls = catTotalRows.filter(r => r.hour === h && r.industry === ind).reduce((s, r) => s + r.total_calls, 0);
        row[ind] = val;
        row[`${ind}_total`] = calls;
        totals[ind] += val;
        totalCallsMap[ind] += calls;
        rowTotal += val;
        rowTotalCalls += calls;
      }
      row.total = rowTotal;
      row.totalCalls = rowTotalCalls;
      grandTotal += rowTotal;
      grandTotalCalls += rowTotalCalls;
      tableRowsArr.push(row);
    }

    return ApiResponse.success(res, {
      industries,
      rows: tableRowsArr,
      totals: { ...totals, total: grandTotal },
      totalCalls: { ...totalCallsMap, total: grandTotalCalls },
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
      'SELECT start_time, end_time, break_minutes FROM work_hours WHERE user_id = ? AND date = ?',
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
    const { date, start_time, end_time, break_minutes } = req.body;
    if (!date || !start_time || !end_time) {
      return ApiResponse.badRequest(res, '日付・開始時間・終了時間は必須です');
    }
    const breakMin = parseInt(break_minutes) || 0;
    await pool.execute(
      `INSERT INTO work_hours (user_id, date, start_time, end_time, break_minutes)
       VALUES (?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE start_time = VALUES(start_time), end_time = VALUES(end_time), break_minutes = VALUES(break_minutes)`,
      [req.user.id, date, start_time, end_time, breakMin]
    );
    return ApiResponse.success(res, { date, start_time, end_time, break_minutes: breakMin }, '稼働時間を保存しました');
  } catch (err) {
    next(err);
  }
};

module.exports = { getDailyStats, getHourlyCalls, getIndustryConversion, getHourlyIndustryConnections, getWorkHours, saveWorkHours };
