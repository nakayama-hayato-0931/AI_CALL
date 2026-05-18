/**
 * 企業コントローラー
 * 企業CRUD・検索・架電リスト取得・ロック管理
 */
const pool = require('../../config/database');
const ApiResponse = require('../utils/apiResponse');
const logger = require('../utils/logger');

// ロックタイムアウト（分）
const LOCK_TIMEOUT_MINUTES = 60;

/**
 * ロックフィルタ条件（他ユーザーのロック中企業を除外、期限切れロックは許可）
 * さらに他ユーザーが現在通話中(result_code IS NULL)の企業は常に除外
 */
const lockFilterSQL = `
  AND (c.locked_by_user_id IS NULL
       OR c.locked_by_user_id = ?
       OR c.locked_at < DATE_SUB(NOW(), INTERVAL ${LOCK_TIMEOUT_MINUTES} MINUTE))
`;

/**
 * 1時間以内に架電した企業を除外するフィルタ
 */
const recentCallFilterSQL = `
  AND c.id NOT IN (
    SELECT DISTINCT cl.company_id FROM calls cl
    WHERE cl.user_id = ? AND cl.call_started_at > DATE_SUB(NOW(), INTERVAL 1 HOUR)
    AND cl.result_code IS NOT NULL
  )
`;

/**
 * GET /api/companies
 * 企業一覧取得 (ページネーション対応)
 */
const getCompanies = async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));
    const offset = (page - 1) * limit;
    const { search, industry, region, show_excluded, list_type, is_sales_list, mylist } = req.query;

    let whereClauses = [];
    let params = [];

    // show_excluded=1 なら除外企業も表示、デフォルトは除外
    if (show_excluded !== '1') {
      whereClauses.push('c.exclusion_flag = 0');
    }

    // list_type=special なら特別リストのみ、それ以外は通常リスト
    if (list_type === 'special') {
      whereClauses.push('c.is_special = 1');
    } else {
      whereClauses.push('c.is_special = 0');
    }

    // mylist=1 なら自作リスト（リクエストユーザーがインポートした企業）のみ
    if (mylist === '1' && req.user?.id) {
      whereClauses.push('c.imported_by_user_id = ?');
      params.push(req.user.id);
    }

    // 営業/オペレーターリスト分離
    if (is_sales_list === '1') {
      whereClauses.push('c.is_sales_list = 1');
    } else {
      whereClauses.push('c.is_sales_list = 0');
    }

    if (search) {
      whereClauses.push('(c.company_name LIKE ? OR c.phone_number LIKE ?)');
      params.push(`%${search}%`, `%${search}%`);
    }
    if (industry) {
      whereClauses.push('c.industry = ?');
      params.push(industry);
    }
    if (region) {
      whereClauses.push('c.region = ?');
      params.push(region);
    }

    const whereStr = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

    const [countRows] = await pool.query(
      `SELECT COUNT(*) as total FROM companies c ${whereStr}`,
      params
    );
    const total = countRows[0].total;

    const [rows] = await pool.query(
      `SELECT c.*,
              u_lock.name as locked_by_user_name,
              (SELECT MAX(cl.call_started_at) FROM calls cl WHERE cl.company_id = c.id) as last_call_date,
              (SELECT cl.result_code FROM calls cl WHERE cl.company_id = c.id ORDER BY cl.call_started_at DESC LIMIT 1) as last_result
       FROM companies c
       LEFT JOIN users u_lock ON c.locked_by_user_id = u_lock.id
       ${whereStr}
       ORDER BY c.priority_score DESC, c.created_at DESC
       LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    return ApiResponse.success(res, {
      companies: rows,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/companies/:id
 * 企業詳細取得 (過去の通話履歴含む)
 */
const getCompanyById = async (req, res, next) => {
  try {
    const { id } = req.params;

    const [companies] = await pool.execute(
      'SELECT * FROM companies WHERE id = ?',
      [id]
    );

    if (companies.length === 0) {
      return ApiResponse.notFound(res, '企業が見つかりません');
    }

    const [calls] = await pool.execute(
      `SELECT c.*, u.name as operator_name
       FROM calls c
       LEFT JOIN users u ON c.user_id = u.id
       WHERE c.company_id = ?
       ORDER BY c.call_started_at DESC
       LIMIT 20`,
      [id]
    );

    return ApiResponse.success(res, {
      company: companies[0],
      callHistory: calls,
    });
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/companies
 * 企業新規作成
 */
const createCompany = async (req, res, next) => {
  try {
    const { company_name, phone_number, industry, job_type, comment, region, address } = req.body;

    if (!company_name || !phone_number) {
      return ApiResponse.badRequest(res, '企業名と電話番号は必須です');
    }

    const [result] = await pool.execute(
      `INSERT INTO companies (company_name, phone_number, industry, job_type, comment, region, address)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [company_name, phone_number, industry || null, job_type || null, comment || null, region || null, address || null]
    );

    logger.info(`企業作成: ${company_name} (ID: ${result.insertId})`);
    return ApiResponse.created(res, { id: result.insertId }, '企業を作成しました');
  } catch (err) {
    next(err);
  }
};

/**
 * PUT /api/companies/:id
 * 企業情報更新
 */
const updateCompany = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { company_name, phone_number, industry, job_type, comment, region, address, priority_score, exclusion_flag } = req.body;

    const [result] = await pool.execute(
      `UPDATE companies SET
        company_name = COALESCE(?, company_name),
        phone_number = COALESCE(?, phone_number),
        industry = COALESCE(?, industry),
        job_type = COALESCE(?, job_type),
        comment = COALESCE(?, comment),
        region = COALESCE(?, region),
        address = COALESCE(?, address),
        priority_score = COALESCE(?, priority_score),
        exclusion_flag = COALESCE(?, exclusion_flag)
       WHERE id = ?`,
      [company_name, phone_number, industry, job_type, comment, region, address, priority_score, exclusion_flag, id]
    );

    if (result.affectedRows === 0) {
      return ApiResponse.notFound(res, '企業が見つかりません');
    }

    return ApiResponse.success(res, null, '企業情報を更新しました');
  } catch (err) {
    next(err);
  }
};

/**
 * 業種×地域ルールフィルタ（ホワイトリスト方式）
 * ルールが0件の場合はフィルターをスキップ（全企業表示）
 *
 * 業種判定: 大枠カテゴリ名（飲食/製造/小売/建設/宿泊/農業/介護等）で
 *   ルール登録された場合、優先順位付きカテゴリ判定で厳密マッチ。
 *   → 「飲食料品小売業」は "小売" のみにマッチし "飲食" には含まれない
 *   → 「食料品製造業」は "製造" のみにマッチ
 * 自由キーワード（大枠以外）は従来の部分一致。
 */
const CATEGORY_SQL_EXPR = `
  CASE
    WHEN c.industry LIKE '%製造%' OR c.industry LIKE '%メーカー%' OR c.industry LIKE '%加工%' THEN '製造'
    WHEN c.industry LIKE '%小売%' OR c.industry LIKE '%卸売%' OR c.industry LIKE '%スーパー%' OR c.industry LIKE '%コンビニ%' OR c.industry LIKE '%ショッピング%' OR c.industry LIKE '%商社%' OR c.industry LIKE '%物販%' THEN '小売'
    WHEN c.industry LIKE '%建設%' OR c.industry LIKE '%工事%' OR c.industry LIKE '%建築%' OR c.industry LIKE '%土木%' OR c.industry LIKE '%リフォーム%' THEN '建設'
    WHEN c.industry LIKE '%宿泊%' OR c.industry LIKE '%ホテル%' OR c.industry LIKE '%旅館%' OR c.industry LIKE '%民宿%' THEN '宿泊'
    WHEN c.industry LIKE '%農業%' OR c.industry LIKE '%農産%' OR c.industry LIKE '%畜産%' OR c.industry LIKE '%水産%' OR c.industry LIKE '%漁業%' OR c.industry LIKE '%林業%' THEN '農業'
    WHEN c.industry LIKE '%介護%' OR c.industry LIKE '%医療%' OR c.industry LIKE '%福祉%' OR c.industry LIKE '%病院%' OR c.industry LIKE '%クリニック%' OR c.industry LIKE '%歯科%' THEN '介護'
    WHEN c.industry LIKE '%運輸%' OR c.industry LIKE '%運送%' OR c.industry LIKE '%輸送%' OR c.industry LIKE '%物流%' OR c.industry LIKE '%タクシー%' OR c.industry LIKE '%鉄道%' OR c.industry LIKE '%配送%' THEN '運輸'
    WHEN c.industry LIKE '%情報通信%' OR c.industry LIKE '%ソフトウェア%' OR c.industry LIKE '%IT業%' OR c.industry LIKE '%システム%' THEN 'IT'
    WHEN c.industry LIKE '%金融%' OR c.industry LIKE '%銀行%' OR c.industry LIKE '%保険%' OR c.industry LIKE '%証券%' THEN '金融'
    WHEN c.industry LIKE '%不動産%' THEN '不動産'
    WHEN c.industry LIKE '%美容%' OR c.industry LIKE '%エステ%' OR c.industry LIKE '%理容%' OR c.industry LIKE '%サロン%' THEN '美容'
    WHEN c.industry LIKE '%飲食店%' OR c.industry LIKE '%グルメ%' OR c.industry LIKE '%レストラン%' OR c.industry LIKE '%居酒屋%' OR c.industry LIKE '%ラーメン%' OR c.industry LIKE '%カフェ%' OR c.industry LIKE '%喫茶店%' OR c.industry LIKE '%寿司%' OR c.industry LIKE '%焼肉%' OR c.industry LIKE '%和食%' OR c.industry LIKE '%中華%' OR c.industry LIKE '%洋食%' OR c.industry LIKE '%食堂%' OR c.industry LIKE '%ダイニング%' OR c.industry LIKE '%そば%' OR c.industry LIKE '%うどん%' OR c.industry LIKE '%菓子%' THEN '飲食'
    WHEN c.industry LIKE '%サービス%' THEN 'サービス'
    ELSE 'その他'
  END
`;
const CATEGORY_NAMES_SQL = "('飲食','製造','小売','建設','宿泊','農業','介護','運輸','IT','金融','不動産','美容','サービス')";

const industryRegionFilterSQL = `
  AND (
    (SELECT COUNT(*) FROM industry_region_rules) = 0
    OR EXISTS (
      SELECT 1 FROM industry_region_rules irr
      WHERE (
        (irr.industry_name IN ${CATEGORY_NAMES_SQL} AND c.industry_category = irr.industry_name)
        OR (irr.industry_name NOT IN ${CATEGORY_NAMES_SQL} AND c.industry LIKE CONCAT('%', irr.industry_name, '%'))
      )
      AND c.address LIKE CONCAT(irr.region, '%')
    )
  )
`;

/**
 * 割り当てフィルタSQL（自分に割り当て or 未割り当てのみ表示、他OPに割り当て済みは除外）
 */
const assignmentFilterSQL = `
  AND (c.id NOT IN (SELECT ca.company_id FROM company_assignments ca)
       OR c.id IN (SELECT ca.company_id FROM company_assignments ca WHERE ca.user_id = ?)
       OR (c.priority_expires_at IS NOT NULL AND c.priority_expires_at <= NOW()))
`;

/**
 * 再ピックアップ除外SQL
 * - SKIP/PROJECT/RECALL/INTERESTED: 永久除外（再ピックアップ禁止）
 * - NO_ANSWER: 最終架電から2日後以降に再ピックアップ可能
 * - NG: 最終架電から3ヶ月後以降に別オペレーターのみ再ピックアップ可能
 */
const lastResultExclusionSQL = `
  AND NOT EXISTS (
    SELECT 1 FROM calls cl2
    WHERE cl2.company_id = c.id
      AND cl2.result_code IN ('SKIP', 'PROJECT', 'RECALL', 'INTERESTED')
  )
`;

/**
 * GET /api/companies/call-list/next
 * 次の架電先を1件取得 (自動架電リスト)
 * 割り当て優先: 自分に割り当てられた企業 → 未割り当て企業
 */
const getNextCallTarget = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const now = new Date();
    const currentTime = now.toTimeString().slice(0, 8);

    // 架電種別（営業 or オペレーター）
    const callType = req.query.call_type || (req.user.role === 'sales' ? 'sales' : 'operator');
    const salesListFilter = callType === 'sales' ? 'AND c.is_sales_list = 1' : 'AND c.is_sales_list = 0';

    // ピックアップモードフィルタ
    const mode = req.query.mode || 'auto';
    const industryParam = req.query.industry || '';
    const isMyList = mode === 'mylist';
    const isSpecialList = mode === 'special';
    let modeFilterSQL = '';
    let modeFilterParams = [];
    const CATEGORY_NAMES_LIST = ['飲食','製造','小売','建設','宿泊','農業','介護','運輸','IT','金融','不動産','美容','サービス'];
    if (mode === 'industry' && industryParam) {
      if (CATEGORY_NAMES_LIST.includes(industryParam)) {
        // 大枠カテゴリ指定時は優先順位付きカテゴリ判定で厳密マッチ
        modeFilterSQL = `AND c.industry_category = ?`;
        modeFilterParams = [industryParam];
      } else {
        // 自由キーワードは従来の部分一致
        modeFilterSQL = `AND c.industry LIKE CONCAT('%', ?, '%')`;
        modeFilterParams = [industryParam];
      }
    } else if (isMyList) {
      modeFilterSQL = `AND c.imported_by_user_id = ?`;
      modeFilterParams = [userId];
    }

    // 自作リスト/特別リストモード: 業種地域フィルタ・結果除外・割り当てフィルタをバイパス
    const irFilter = (isMyList || isSpecialList) ? '' : industryRegionFilterSQL;
    const lrFilter = (isMyList || isSpecialList) ? '' : lastResultExclusionSQL;
    const asFilter = (isMyList || isSpecialList) ? '' : assignmentFilterSQL;
    // autoモードのみ: ゴールデンタイム未設定業種を除外
    const goldenIndFilter = (mode === 'auto')
      ? `AND c.industry IN (SELECT DISTINCT industry_name FROM industry_time_rules)`
      : '';

    // 特別リストモード: is_special=1の企業のみ
    if (isSpecialList) {
      const [specialRows] = await pool.query(
        `SELECT c.*,
                (SELECT cl.memo FROM calls cl WHERE cl.company_id = c.id ORDER BY cl.call_started_at DESC LIMIT 1) as last_memo,
                (SELECT cl.result_code FROM calls cl WHERE cl.company_id = c.id ORDER BY cl.call_started_at DESC LIMIT 1) as last_result
         FROM companies c
         WHERE c.exclusion_flag = 0 AND c.is_special = 1 ${salesListFilter}
           ${lockFilterSQL}
         ORDER BY c.created_at DESC
         LIMIT 1`,
        [userId]
      );
      if (specialRows.length > 0) {
        return ApiResponse.success(res, { target: specialRows[0], reason: 'special' });
      }
      return ApiResponse.success(res, { target: null, reason: 'no_target' }, '架電対象がありません');
    }

    // 自作リストモード: シンプルに全件返す（フィルタなし）
    if (isMyList) {
      const [mylistRows] = await pool.query(
        `SELECT c.*,
                (SELECT cl.memo FROM calls cl WHERE cl.company_id = c.id ORDER BY cl.call_started_at DESC LIMIT 1) as last_memo,
                (SELECT cl.result_code FROM calls cl WHERE cl.company_id = c.id ORDER BY cl.call_started_at DESC LIMIT 1) as last_result
         FROM companies c
         WHERE c.exclusion_flag = 0 AND c.is_special = 0 ${salesListFilter}
           ${modeFilterSQL}
         ORDER BY c.created_at DESC
         LIMIT 1`,
        [...modeFilterParams]
      );
      if (mylistRows.length > 0) {
        return ApiResponse.success(res, { target: mylistRows[0], reason: 'mylist' });
      }
      return ApiResponse.success(res, { target: null, reason: 'no_target' }, '架電対象がありません');
    }

    // 1. リコール期限
    // リコールはユーザーが明示的に指定したものなので、業種地域・モード絞込をバイパス
    const [recallRows] = await pool.execute(
      `SELECT rt.id as recall_task_id, c.*,
              (SELECT cl.memo FROM calls cl WHERE cl.id = rt.call_id) as last_memo,
              (SELECT cl.result_code FROM calls cl WHERE cl.id = rt.call_id) as last_result
       FROM recall_tasks rt
       JOIN companies c ON rt.company_id = c.id
       WHERE rt.user_id = ? AND rt.status = 'pending' AND rt.recall_at <= ?
         AND c.exclusion_flag = 0 AND c.is_special = 0
       ORDER BY rt.recall_at ASC
       LIMIT 1`,
      [userId, now]
    );
    if (recallRows.length > 0) {
      return ApiResponse.success(res, { target: recallRows[0], reason: 'recall_due' });
    }

    // 2. ゴールデンタイム（割り当て優先）
    const [goldenRows] = await pool.query(
      `SELECT c.*, itr.priority_weight,
              (SELECT cl.memo FROM calls cl WHERE cl.company_id = c.id ORDER BY cl.call_started_at DESC LIMIT 1) as last_memo,
              (SELECT cl.result_code FROM calls cl WHERE cl.company_id = c.id ORDER BY cl.call_started_at DESC LIMIT 1) as last_result,
              IF(EXISTS(SELECT 1 FROM company_assignments ca WHERE ca.company_id = c.id AND ca.user_id = ?), 1, 0) as is_assigned
       FROM companies c
       JOIN industry_time_rules itr ON c.industry = itr.industry_name
       WHERE c.exclusion_flag = 0 AND c.is_special = 0 ${salesListFilter}
         AND ? BETWEEN itr.start_time AND itr.end_time
         AND c.id NOT IN (SELECT rt.company_id FROM recall_tasks rt WHERE rt.status = 'pending')
         AND (c.last_called_at IS NULL OR c.last_called_at < DATE_SUB(NOW(), INTERVAL 1 DAY))
         ${lrFilter}
         ${asFilter}
         ${irFilter}
         ${goldenIndFilter}
         ${modeFilterSQL}
       ORDER BY is_assigned DESC, itr.priority_weight DESC, c.priority_score DESC, c.last_called_at ASC
       LIMIT 1`,
      [userId, currentTime, userId, ...modeFilterParams]
    );
    if (goldenRows.length > 0) {
      return ApiResponse.success(res, { target: goldenRows[0], reason: 'golden_time' });
    }

    // 3. 未接触（割り当て優先）
    const [untouchedRows] = await pool.query(
      `SELECT c.*,
              IF(EXISTS(SELECT 1 FROM company_assignments ca WHERE ca.company_id = c.id AND ca.user_id = ?), 1, 0) as is_assigned
       FROM companies c
       WHERE c.exclusion_flag = 0 AND c.is_special = 0 ${salesListFilter} AND c.last_called_at IS NULL
         AND c.id NOT IN (SELECT rt.company_id FROM recall_tasks rt WHERE rt.status = 'pending')
         ${lrFilter}
         ${asFilter}
         ${irFilter}
         ${goldenIndFilter}
         ${modeFilterSQL}
       ORDER BY is_assigned DESC, c.priority_score DESC, c.created_at ASC
       LIMIT 1`,
      [userId, userId, ...modeFilterParams]
    );
    if (untouchedRows.length > 0) {
      return ApiResponse.success(res, { target: untouchedRows[0], reason: 'untouched' });
    }

    // 4. 前回不通 → 2日後以降に再ピックアップ
    const [noAnswerRows] = await pool.query(
      `SELECT c.*,
              (SELECT cl.memo FROM calls cl WHERE cl.company_id = c.id ORDER BY cl.call_started_at DESC LIMIT 1) as last_memo,
              IF(EXISTS(SELECT 1 FROM company_assignments ca WHERE ca.company_id = c.id AND ca.user_id = ?), 1, 0) as is_assigned
       FROM companies c
       WHERE c.exclusion_flag = 0 AND c.is_special = 0 ${salesListFilter}
         AND c.id NOT IN (SELECT rt.company_id FROM recall_tasks rt WHERE rt.status = 'pending')
         ${lrFilter}
         AND (SELECT cl3.result_code FROM calls cl3 WHERE cl3.company_id = c.id ORDER BY cl3.call_started_at DESC LIMIT 1) = 'NO_ANSWER'
         AND c.last_called_at < DATE_SUB(NOW(), INTERVAL 2 DAY)
         ${asFilter}
         ${irFilter}
         ${goldenIndFilter}
         ${modeFilterSQL}
       ORDER BY is_assigned DESC, c.last_called_at ASC
       LIMIT 1`,
      [userId, userId, ...modeFilterParams]
    );
    if (noAnswerRows.length > 0) {
      return ApiResponse.success(res, { target: noAnswerRows[0], reason: 'retry_no_answer' });
    }

    // 5. 前回NG → 3ヶ月後以降に別オペレーターのみ再ピックアップ
    const [ngRetryRows] = await pool.query(
      `SELECT c.*,
              (SELECT cl.memo FROM calls cl WHERE cl.company_id = c.id ORDER BY cl.call_started_at DESC LIMIT 1) as last_memo,
              IF(EXISTS(SELECT 1 FROM company_assignments ca WHERE ca.company_id = c.id AND ca.user_id = ?), 1, 0) as is_assigned
       FROM companies c
       WHERE c.exclusion_flag = 0 AND c.is_special = 0 ${salesListFilter}
         AND c.id NOT IN (SELECT rt.company_id FROM recall_tasks rt WHERE rt.status = 'pending')
         ${lrFilter}
         AND (SELECT cl3.result_code FROM calls cl3 WHERE cl3.company_id = c.id ORDER BY cl3.call_started_at DESC LIMIT 1) = 'NG'
         AND c.last_called_at < DATE_SUB(NOW(), INTERVAL 3 MONTH)
         AND (SELECT cl4.user_id FROM calls cl4 WHERE cl4.company_id = c.id ORDER BY cl4.call_started_at DESC LIMIT 1) != ?
         ${asFilter}
         ${irFilter}
         ${goldenIndFilter}
         ${modeFilterSQL}
       ORDER BY is_assigned DESC, c.last_called_at ASC
       LIMIT 1`,
      [userId, userId, userId, ...modeFilterParams]
    );
    if (ngRetryRows.length > 0) {
      return ApiResponse.success(res, { target: ngRetryRows[0], reason: 'retry_ng' });
    }

    return ApiResponse.success(res, { target: null, reason: 'no_target' }, '架電対象がありません');
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/companies/call-list
 * 架電候補リスト取得 (最大10件、4段優先度)
 * ロック中の企業は除外（自分のロック + 期限切れは許可）
 */
const getCallList = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const now = new Date();
    const currentTime = now.toTimeString().slice(0, 8);
    const LIST_SIZE = 25;

    // 架電種別（営業 or オペレーター）
    const callType = req.query.call_type || (req.user.role === 'sales' ? 'sales' : 'operator');
    const salesListFilter = callType === 'sales' ? 'AND c.is_sales_list = 1' : 'AND c.is_sales_list = 0';

    // ピックアップモードフィルタ
    const mode = req.query.mode || 'auto';
    const industryParam = req.query.industry || '';
    const isMyList = mode === 'mylist';
    const isSpecialList = mode === 'special';
    let modeFilterSQL = '';
    let modeFilterParams = [];
    const CATEGORY_NAMES_LIST = ['飲食','製造','小売','建設','宿泊','農業','介護','運輸','IT','金融','不動産','美容','サービス'];
    if (mode === 'industry' && industryParam) {
      if (CATEGORY_NAMES_LIST.includes(industryParam)) {
        // 大枠カテゴリ指定時は優先順位付きカテゴリ判定で厳密マッチ
        modeFilterSQL = `AND c.industry_category = ?`;
        modeFilterParams = [industryParam];
      } else {
        // 自由キーワードは従来の部分一致
        modeFilterSQL = `AND c.industry LIKE CONCAT('%', ?, '%')`;
        modeFilterParams = [industryParam];
      }
    } else if (isMyList) {
      modeFilterSQL = `AND c.imported_by_user_id = ?`;
      modeFilterParams = [userId];
    }

    // 自作リスト/特別リストモード: 業種地域フィルタ・結果除外・割り当てフィルタをバイパス
    const irFilter = (isMyList || isSpecialList) ? '' : industryRegionFilterSQL;
    const lrFilter = (isMyList || isSpecialList) ? '' : lastResultExclusionSQL;
    const asFilter = (isMyList || isSpecialList) ? '' : assignmentFilterSQL;
    // autoモードのみ: 自動対象から外された業種（管理者チェック外し業種）を除外
    // ※ 旧「ゴールデンタイム未設定業種除外」は STRICT equality でAUTOが全除外される問題があったため削除
    //   ゴールデンタイム優先はTier2でJOIN industry_time_rulesにより実現
    let goldenIndFilter = '';
    const goldenIndParams = [];
    if (mode === 'auto') {
      try {
        const [rows] = await pool.execute(
          "SELECT setting_value FROM system_settings WHERE setting_key = 'auto_pickup_industries'"
        );
        if (rows.length > 0) {
          const map = JSON.parse(rows[0].setting_value || '{}');
          const disabledCats = Object.entries(map).filter(([k, v]) => v === false).map(([k]) => k);
          if (disabledCats.length > 0) {
            const placeholders = disabledCats.map(() => '?').join(',');
            goldenIndFilter = `AND (c.industry_category IS NULL OR c.industry_category NOT IN (${placeholders}))`;
            goldenIndParams.push(...disabledCats);
          }
        }
      } catch (e) { /* ignore */ }
    }

    // 自動ピックアップ対象都道府県（auto / industry モードに適用）
    // 「true 設定された都道府県」のみピックアップ許可（positive list）
    // - 全47都道府県全部 true → フィルタなし（最速）
    // - 一部 true → c.region IN (enabled)
    // - 全部 false / マップ空 → 1=0
    // c.region は CSVインポート時に都道府県名が入っているのでこれだけで判定
    let prefectureFilter = '';
    const prefectureParams = [];
    if (mode === 'auto' || mode === 'industry') {
      try {
        const [prefRows] = await pool.execute(
          "SELECT setting_value FROM system_settings WHERE setting_key = 'auto_pickup_prefectures'"
        );
        if (prefRows.length > 0) {
          const prefMap = JSON.parse(prefRows[0].setting_value || '{}');
          const entries = Object.entries(prefMap);
          if (entries.length > 0) {
            const enabledPrefs = entries.filter(([, v]) => v === true).map(([k]) => k);
            const disabledCount = entries.filter(([, v]) => v === false).length;
            if (enabledPrefs.length === 0) {
              // 全部チェック外し
              prefectureFilter = 'AND 1 = 0';
            } else if (disabledCount === 0) {
              // 全部有効 → フィルタなし
            } else {
              // 一部有効
              // region/address どちらかで都道府県名のキーワードが含まれていればOK
              // 表記揺れに強くするため、address は %prefname% (anywhere) も試す
              const phs = enabledPrefs.map(() => '?').join(',');
              const addressStartConds = enabledPrefs.map(() => `c.address LIKE CONCAT(?, '%')`).join(' OR ');
              const regionStartConds = enabledPrefs.map(() => `c.region LIKE CONCAT(?, '%')`).join(' OR ');
              prefectureFilter = `AND (c.region IN (${phs}) OR ${regionStartConds} OR ${addressStartConds})`;
              prefectureParams.push(...enabledPrefs, ...enabledPrefs, ...enabledPrefs);
              logger.info(`[getCallList prefecture] mode=${mode} enabled=${enabledPrefs.length}: ${enabledPrefs.join(',')}`);
            }
          }
        }
      } catch (e) { /* ignore */ }
    }

    let targets = [];
    // excludeクエリパラメータ: 直前に完了した企業IDを除外
    const excludeParam = req.query.exclude;
    let excludeIds = excludeParam ? [parseInt(excludeParam, 10)].filter(id => !isNaN(id)) : [];

    // NOT IN句を安全に構築するヘルパー
    const notInClause = (ids) => {
      if (ids.length === 0) return '';
      return `AND c.id NOT IN (${ids.map(() => '?').join(',')})`;
    };

    // 特別リストモード: is_special=1の企業のみ
    // オペレーター: 自分に割り当てられた企業 or 未割り当ての企業
    // 管理者: 全て表示
    if (isSpecialList) {
      const isManager = req.user.role === 'admin' || req.user.role === 'manager';
      const specialAssignFilter = isManager
        ? ''
        : `AND (c.id IN (SELECT ca.company_id FROM company_assignments ca WHERE ca.user_id = ${Number(userId)})
           OR c.id NOT IN (SELECT ca.company_id FROM company_assignments ca))`;
      const [specialRows] = await pool.query(
        `SELECT c.id, c.company_name, c.phone_number, c.industry, c.job_type, c.comment, c.data_source, c.address, c.region,
                'special' as reason,
                (SELECT cl.memo FROM calls cl WHERE cl.company_id = c.id ORDER BY cl.call_started_at DESC LIMIT 1) as last_memo,
                (SELECT cl.result_code FROM calls cl WHERE cl.company_id = c.id ORDER BY cl.call_started_at DESC LIMIT 1) as last_result
         FROM companies c
         WHERE c.exclusion_flag = 0 AND c.is_special = 1 ${salesListFilter}
           ${lockFilterSQL}
           ${specialAssignFilter}
         ORDER BY c.created_at DESC
         LIMIT ?`,
        [userId, LIST_SIZE]
      );
      return ApiResponse.success(res, { targets: specialRows });
    }

    // 自作リストモード: 全件返す（上限1000件）
    if (isMyList) {
      const [mylistRows] = await pool.query(
        `SELECT c.id, c.company_name, c.phone_number, c.industry, c.job_type, c.comment, c.data_source, c.address, c.region,
                'mylist' as reason,
                (SELECT cl.memo FROM calls cl WHERE cl.company_id = c.id ORDER BY cl.call_started_at DESC LIMIT 1) as last_memo,
                (SELECT cl.result_code FROM calls cl WHERE cl.company_id = c.id ORDER BY cl.call_started_at DESC LIMIT 1) as last_result
         FROM companies c
         WHERE c.exclusion_flag = 0 AND c.is_special = 0 ${salesListFilter}
           ${lockFilterSQL}
           ${modeFilterSQL}
         ORDER BY c.created_at DESC
         LIMIT 1000`,
        [userId, ...modeFilterParams]
      );
      return ApiResponse.success(res, { targets: mylistRows });
    }

    // 1. リコール期限（自分のリコールのみ）
    // リコールはユーザーが明示的に指定したものなので、1時間以内除外フィルタ・
    // 業種地域フィルタ・モード絞込はバイパスして必ずピックアップする
    const [recallRows] = await pool.query(
      `SELECT c.id, c.company_name, c.phone_number, c.industry, c.job_type, c.comment, c.data_source, c.address, c.region,
              'recall_due' as reason, rt.recall_at
       FROM recall_tasks rt
       JOIN companies c ON rt.company_id = c.id
       WHERE rt.user_id = ? AND rt.status = 'pending' AND rt.recall_at <= ?
         AND c.exclusion_flag = 0 AND c.is_special = 0
         ${lockFilterSQL}
       ORDER BY rt.recall_at ASC
       LIMIT ?`,
      [userId, now, userId, LIST_SIZE]
    );
    targets.push(...recallRows);
    excludeIds = targets.map(t => t.id);

    if (targets.length >= LIST_SIZE) {
      return ApiResponse.success(res, { targets: targets.slice(0, LIST_SIZE) });
    }

    // 2. ゴールデンタイム（割り当て優先）
    const remaining2 = LIST_SIZE - targets.length;
    const [goldenRows] = await pool.query(
      `SELECT c.id, c.company_name, c.phone_number, c.industry, c.job_type, c.comment, c.data_source, c.address, c.region,
              'golden_time' as reason,
              IF(EXISTS(SELECT 1 FROM company_assignments ca WHERE ca.company_id = c.id AND ca.user_id = ?), 1, 0) as is_assigned
       FROM companies c
       JOIN industry_time_rules itr ON c.industry = itr.industry_name
       WHERE c.exclusion_flag = 0 AND c.is_special = 0 ${salesListFilter}
         AND ? BETWEEN itr.start_time AND itr.end_time
         AND c.id NOT IN (SELECT rt.company_id FROM recall_tasks rt WHERE rt.status = 'pending')
         AND (c.last_called_at IS NULL OR c.last_called_at < DATE_SUB(NOW(), INTERVAL 1 DAY))
         ${lrFilter}
         ${lockFilterSQL}
         ${recentCallFilterSQL}
         ${asFilter}
         ${irFilter}
         ${goldenIndFilter}
         ${prefectureFilter}
         ${modeFilterSQL}
         ${notInClause(excludeIds)}
       ORDER BY is_assigned DESC, itr.priority_weight DESC, c.priority_score DESC, c.last_called_at ASC
       LIMIT ?`,
      [userId, currentTime, userId, userId, userId, ...goldenIndParams, ...prefectureParams, ...modeFilterParams, ...excludeIds, remaining2]
    );
    targets.push(...goldenRows);
    excludeIds = targets.map(t => t.id);

    if (targets.length >= LIST_SIZE) {
      return ApiResponse.success(res, { targets: targets.slice(0, LIST_SIZE) });
    }

    // 3. 未接触（割り当て優先）
    const remaining3 = LIST_SIZE - targets.length;
    const [untouchedRows] = await pool.query(
      `SELECT c.id, c.company_name, c.phone_number, c.industry, c.job_type, c.comment, c.data_source, c.address, c.region,
              'untouched' as reason,
              IF(EXISTS(SELECT 1 FROM company_assignments ca WHERE ca.company_id = c.id AND ca.user_id = ?), 1, 0) as is_assigned
       FROM companies c
       WHERE c.exclusion_flag = 0 AND c.is_special = 0 ${salesListFilter} AND c.last_called_at IS NULL
         AND c.id NOT IN (SELECT rt.company_id FROM recall_tasks rt WHERE rt.status = 'pending')
         ${lrFilter}
         ${lockFilterSQL}
         ${recentCallFilterSQL}
         ${asFilter}
         ${irFilter}
         ${goldenIndFilter}
         ${prefectureFilter}
         ${modeFilterSQL}
         ${notInClause(excludeIds)}
       ORDER BY is_assigned DESC, c.priority_score DESC, c.created_at ASC
       LIMIT ?`,
      [userId, userId, userId, userId, ...goldenIndParams, ...prefectureParams, ...modeFilterParams, ...excludeIds, remaining3]
    );
    targets.push(...untouchedRows);
    excludeIds = targets.map(t => t.id);

    if (targets.length >= LIST_SIZE) {
      return ApiResponse.success(res, { targets: targets.slice(0, LIST_SIZE) });
    }

    // 4. 前回不通 → 2日後以降に再ピックアップ
    const remaining4 = LIST_SIZE - targets.length;
    const [retryRows] = await pool.query(
      `SELECT c.id, c.company_name, c.phone_number, c.industry, c.job_type, c.comment, c.data_source, c.address, c.region,
              'retry_no_answer' as reason,
              IF(EXISTS(SELECT 1 FROM company_assignments ca WHERE ca.company_id = c.id AND ca.user_id = ?), 1, 0) as is_assigned
       FROM companies c
       WHERE c.exclusion_flag = 0 AND c.is_special = 0 ${salesListFilter}
         AND c.id NOT IN (SELECT rt.company_id FROM recall_tasks rt WHERE rt.status = 'pending')
         ${lrFilter}
         AND (SELECT cl3.result_code FROM calls cl3 WHERE cl3.company_id = c.id ORDER BY cl3.call_started_at DESC LIMIT 1) = 'NO_ANSWER'
         AND c.last_called_at < DATE_SUB(NOW(), INTERVAL 2 DAY)
         ${lockFilterSQL}
         ${recentCallFilterSQL}
         ${asFilter}
         ${irFilter}
         ${goldenIndFilter}
         ${prefectureFilter}
         ${modeFilterSQL}
         ${notInClause(excludeIds)}
       ORDER BY is_assigned DESC, c.last_called_at ASC
       LIMIT ?`,
      [userId, userId, userId, userId, ...goldenIndParams, ...prefectureParams, ...modeFilterParams, ...excludeIds, remaining4]
    );
    targets.push(...retryRows);
    excludeIds = targets.map(t => t.id);

    if (targets.length >= LIST_SIZE) {
      return ApiResponse.success(res, { targets: targets.slice(0, LIST_SIZE) });
    }

    // 5. 前回NG → 3ヶ月後以降に別OPのみ再ピックアップ
    const remaining5 = LIST_SIZE - targets.length;
    const [ngRetryRows] = await pool.query(
      `SELECT c.id, c.company_name, c.phone_number, c.industry, c.job_type, c.comment, c.data_source, c.address, c.region,
              'retry_ng' as reason,
              IF(EXISTS(SELECT 1 FROM company_assignments ca WHERE ca.company_id = c.id AND ca.user_id = ?), 1, 0) as is_assigned
       FROM companies c
       WHERE c.exclusion_flag = 0 AND c.is_special = 0 ${salesListFilter}
         AND c.id NOT IN (SELECT rt.company_id FROM recall_tasks rt WHERE rt.status = 'pending')
         ${lrFilter}
         AND (SELECT cl3.result_code FROM calls cl3 WHERE cl3.company_id = c.id ORDER BY cl3.call_started_at DESC LIMIT 1) = 'NG'
         AND c.last_called_at < DATE_SUB(NOW(), INTERVAL 3 MONTH)
         AND (SELECT cl4.user_id FROM calls cl4 WHERE cl4.company_id = c.id ORDER BY cl4.call_started_at DESC LIMIT 1) != ?
         ${lockFilterSQL}
         ${recentCallFilterSQL}
         ${asFilter}
         ${irFilter}
         ${goldenIndFilter}
         ${prefectureFilter}
         ${modeFilterSQL}
         ${notInClause(excludeIds)}
       ORDER BY is_assigned DESC, c.last_called_at ASC
       LIMIT ?`,
      [userId, userId, userId, userId, userId, ...goldenIndParams, ...prefectureParams, ...modeFilterParams, ...excludeIds, remaining5]
    );
    targets.push(...ngRetryRows);

    // デバッグ: 各ティアの件数をログ出力
    logger.info(`[getCallList] mode=${mode} user=${userId} recall=${recallRows.length} golden=${goldenRows.length} untouched=${untouchedRows.length} retry_na=${retryRows.length} retry_ng=${ngRetryRows.length} total=${targets.length}`);

    return ApiResponse.success(res, { targets, debug: {
      recall: recallRows.length,
      golden: goldenRows.length,
      untouched: untouchedRows.length,
      retry_no_answer: retryRows.length,
      retry_ng: ngRetryRows.length,
    } });
  } catch (err) {
    logger.error(`[getCallList] ${err.code} ${err.message} sqlMessage=${err.sqlMessage} sql=${(err.sql || '').slice(0, 500)}`);
    return ApiResponse.error(res, `架電リスト取得失敗: ${err.sqlMessage || err.message}`, 500);
  }
};

/**
 * POST /api/companies/:id/lock
 * 架電対象のロックを取得 (SELECT FOR UPDATEによる排他制御)
 */
const lockCallTarget = async (req, res, next) => {
  const conn = await pool.getConnection();
  try {
    const { id } = req.params;
    const userId = req.user.id;

    await conn.beginTransaction();

    // 行ロック取得
    const [rows] = await conn.execute(
      'SELECT id, locked_by_user_id, locked_at, imported_by_user_id FROM companies WHERE id = ? FOR UPDATE',
      [id]
    );

    if (rows.length === 0) {
      await conn.rollback();
      return ApiResponse.notFound(res, '企業が見つかりません');
    }

    const company = rows[0];
    const now = new Date();

    // 自分がこの企業の割当ユーザー(company_assignments) または
    // 自作リストとしてインポートしたユーザーなら、他のロックを上書き可能
    let canOverride = false;
    if (company.imported_by_user_id === userId) {
      canOverride = true;
    } else {
      const [assignRows] = await conn.execute(
        'SELECT 1 FROM company_assignments WHERE company_id = ? AND user_id = ? LIMIT 1',
        [id, userId]
      );
      if (assignRows.length > 0) canOverride = true;
    }

    // 他ユーザーが有効なロックを保持しているか確認
    if (!canOverride && company.locked_by_user_id && company.locked_by_user_id !== userId) {
      const lockedAt = new Date(company.locked_at);
      const elapsedMs = now - lockedAt;
      if (elapsedMs < LOCK_TIMEOUT_MINUTES * 60 * 1000) {
        await conn.rollback();
        return res.status(409).json({
          success: false,
          message: 'この企業は他のオペレーターが対応中です',
        });
      }
    }

    // ロック取得
    await conn.execute(
      'UPDATE companies SET locked_by_user_id = ?, locked_at = NOW() WHERE id = ?',
      [userId, id]
    );

    await conn.commit();

    // 企業情報 + 通話履歴を返す
    const [companyData] = await pool.execute('SELECT * FROM companies WHERE id = ?', [id]);
    const [callHistory] = await pool.execute(
      `SELECT c.*, u.name as operator_name
       FROM calls c LEFT JOIN users u ON c.user_id = u.id
       WHERE c.company_id = ? ORDER BY c.call_started_at DESC LIMIT 20`,
      [id]
    );

    logger.info(`ロック取得: user=${userId}, company=${id}`);

    return ApiResponse.success(res, {
      company: companyData[0],
      callHistory,
    }, 'ロックを取得しました');
  } catch (err) {
    await conn.rollback();
    next(err);
  } finally {
    conn.release();
  }
};

/**
 * POST /api/companies/:id/unlock
 * ロック解除（自分のロックのみ）
 */
const unlockCallTarget = async (req, res, next) => {
  try {
    const { id } = req.params;
    const userId = req.user?.id;
    if (!userId) {
      return ApiResponse.success(res, null, '認証なし（無視）');
    }

    await pool.execute(
      'UPDATE companies SET locked_by_user_id = NULL, locked_at = NULL WHERE id = ? AND locked_by_user_id = ?',
      [id, userId]
    );

    return ApiResponse.success(res, null, 'ロックを解除しました');
  } catch (err) {
    logger.error(`[unlockCallTarget] code=${err.code} message=${err.message} sqlMessage=${err.sqlMessage}`);
    // 失敗しても成功扱いにする（ロック解除は致命的ではない）
    return ApiResponse.success(res, null, 'ロック解除失敗（無視）');
  }
};

/**
 * GET /api/companies/call-list/diagnose
 * 各フィルタ段階のカウントを返す診断エンドポイント
 */
const diagnoseCallList = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const callType = req.query.call_type || (req.user.role === 'sales' ? 'sales' : 'operator');
    const salesCond = callType === 'sales' ? 'AND c.is_sales_list = 1' : 'AND c.is_sales_list = 0';

    const steps = [];
    const runCount = async (label, sql, params = []) => {
      try {
        const [rows] = await pool.query(`SELECT COUNT(*) AS cnt FROM companies c WHERE ${sql}`, params);
        steps.push({ label, count: Number(rows[0].cnt) });
      } catch (e) {
        steps.push({ label, count: null, error: e.message });
      }
    };

    await runCount('全企業', `1=1 ${salesCond}`);
    await runCount('exclusion_flag=0', `c.exclusion_flag = 0 ${salesCond}`);
    await runCount('+ is_special=0', `c.exclusion_flag = 0 AND c.is_special = 0 ${salesCond}`);
    await runCount('+ 未架電 (last_called_at IS NULL)', `c.exclusion_flag = 0 AND c.is_special = 0 AND c.last_called_at IS NULL ${salesCond}`);
    await runCount('+ リコール除外', `c.exclusion_flag = 0 AND c.is_special = 0 AND c.last_called_at IS NULL ${salesCond}
      AND c.id NOT IN (SELECT rt.company_id FROM recall_tasks rt WHERE rt.status = 'pending')`);

    // 都道府県フィルタの現在の設定
    const [prefRows] = await pool.execute(
      "SELECT setting_value FROM system_settings WHERE setting_key = 'auto_pickup_prefectures'"
    );
    let prefMap = {};
    try { prefMap = prefRows.length ? JSON.parse(prefRows[0].setting_value || '{}') : {}; } catch (e) {}
    const enabledPrefs = Object.entries(prefMap).filter(([, v]) => v === true).map(([k]) => k);
    const disabledPrefs = Object.entries(prefMap).filter(([, v]) => v === false).map(([k]) => k);

    // 業種フィルタの現在の設定
    const [indRows] = await pool.execute(
      "SELECT setting_value FROM system_settings WHERE setting_key = 'auto_pickup_industries'"
    );
    let indMap = {};
    try { indMap = indRows.length ? JSON.parse(indRows[0].setting_value || '{}') : {}; } catch (e) {}
    const disabledInds = Object.entries(indMap).filter(([, v]) => v === false).map(([k]) => k);

    // 都道府県別件数（上位）
    const [byRegion] = await pool.query(
      `SELECT COALESCE(NULLIF(c.region, ''), '(未設定)') AS region, COUNT(*) AS cnt
       FROM companies c
       WHERE c.exclusion_flag = 0 AND c.is_special = 0 ${salesCond}
         AND c.last_called_at IS NULL
       GROUP BY region ORDER BY cnt DESC LIMIT 20`
    );

    // address 先頭サンプル
    const [byAddress] = await pool.query(
      `SELECT LEFT(c.address, 4) AS addr_prefix, COUNT(*) AS cnt
       FROM companies c
       WHERE c.exclusion_flag = 0 AND c.is_special = 0 ${salesCond}
         AND c.last_called_at IS NULL
         AND c.address IS NOT NULL AND c.address != ''
       GROUP BY addr_prefix ORDER BY cnt DESC LIMIT 20`
    );

    // 都道府県フィルタを実際に適用した場合の件数
    let prefFilterResult = null;
    if (enabledPrefs.length > 0 && disabledPrefs.length > 0) {
      const phs = enabledPrefs.map(() => '?').join(',');
      const addressStart = enabledPrefs.map(() => `c.address LIKE CONCAT(?, '%')`).join(' OR ');
      const regionStart = enabledPrefs.map(() => `c.region LIKE CONCAT(?, '%')`).join(' OR ');
      try {
        const [rows] = await pool.query(
          `SELECT COUNT(*) AS cnt FROM companies c
           WHERE c.exclusion_flag = 0 AND c.is_special = 0 ${salesCond}
             AND c.last_called_at IS NULL
             AND (c.region IN (${phs}) OR ${regionStart} OR ${addressStart})`,
          [...enabledPrefs, ...enabledPrefs, ...enabledPrefs]
        );
        prefFilterResult = Number(rows[0].cnt);
      } catch (e) {
        prefFilterResult = { error: e.message };
      }
    }

    return ApiResponse.success(res, {
      callType,
      steps,
      prefectureSetting: {
        totalEntries: Object.keys(prefMap).length,
        enabled: enabledPrefs.length,
        disabled: disabledPrefs.length,
        enabledList: enabledPrefs,
        disabledList: disabledPrefs,
      },
      industrySetting: {
        totalEntries: Object.keys(indMap).length,
        disabledList: disabledInds,
      },
      untouchedByRegion: byRegion,
      untouchedByAddressPrefix: byAddress,
      prefectureFilterMatchCount: prefFilterResult,
    });
  } catch (err) {
    next(err);
  }
};

module.exports = {
  getCompanies,
  getCompanyById,
  createCompany,
  updateCompany,
  getNextCallTarget,
  getCallList,
  lockCallTarget,
  unlockCallTarget,
  diagnoseCallList,
};
