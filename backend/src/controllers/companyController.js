/**
 * 企業コントローラー
 * 企業CRUD・検索・架電リスト取得・ロック管理
 */
const pool = require('../../config/database');
const ApiResponse = require('../utils/apiResponse');
const logger = require('../utils/logger');

// ロックタイムアウト（分）
const LOCK_TIMEOUT_MINUTES = 60;

// last_call_result_code カラムが存在するかをキャッシュ。
// 存在しない場合は従来の相関サブクエリにフォールバックして Unknown column エラーを回避。
// 起動直後に一度 false で初期化し、SHOW COLUMNS で確認。preflightで追加成功すれば true。
let hasLastCallResultCol = false;
(async () => {
  try {
    const [rows] = await pool.query("SHOW COLUMNS FROM companies LIKE 'last_call_result_code'");
    hasLastCallResultCol = rows.length > 0;
    logger.info(`[schemaCheck] last_call_result_code カラム = ${hasLastCallResultCol ? 'あり' : 'なし(フォールバック使用)'}`);
  } catch (e) {
    hasLastCallResultCol = false;
    logger.warn(`[schemaCheck] failed: ${e.message}`);
  }
  // 5秒ごとに再確認（preflightが遅れて完了する場合に対応）
  const recheckInterval = setInterval(async () => {
    try {
      const [rows] = await pool.query("SHOW COLUMNS FROM companies LIKE 'last_call_result_code'");
      const has = rows.length > 0;
      if (has && !hasLastCallResultCol) {
        hasLastCallResultCol = true;
        logger.info('[schemaCheck] last_call_result_code カラム検出 → 高速SQLに切替');
        clearInterval(recheckInterval);
      }
    } catch (e) { /* ignore */ }
  }, 5000);
})();

// 最終架電結果フィルタを生成（カラムがあれば高速、無ければ相関サブクエリ）
const lastResultFilterSQL = (resultCode) => hasLastCallResultCol
  ? `AND c.last_call_result_code = '${resultCode}'`
  : `AND (SELECT cl3.result_code FROM calls cl3 WHERE cl3.company_id = c.id ORDER BY cl3.call_started_at DESC LIMIT 1) = '${resultCode}'`;
// 別オペレーター判定（ティア5用）
const lastUserNotEqualSQL = () => hasLastCallResultCol
  ? `AND c.last_call_user_id != ?`
  : `AND (SELECT cl4.user_id FROM calls cl4 WHERE cl4.company_id = c.id ORDER BY cl4.call_started_at DESC LIMIT 1) != ?`;

// 架電リスト短期キャッシュ（10秒、user+mode+industry+callType単位）
// 15秒ポーリングで2回に1回はDBアクセスなしで即返却。
// 架電完了/結果保存/ロック取得時に invalidateCallListCache() で無効化する。
const CALL_LIST_CACHE_TTL_MS = 20 * 1000;
const callListCache = new Map();
const buildCallListCacheKey = (userId, callType, mode, industryParam, regionParam) => `${userId}|${callType}|${mode}|${industryParam || ''}|${regionParam || ''}`;
const invalidateCallListCache = (userId) => {
  if (userId == null) { callListCache.clear(); return; }
  for (const k of callListCache.keys()) if (k.startsWith(`${userId}|`)) callListCache.delete(k);
};

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
 * 同日中に自分が架電して結果コード入力した企業を除外するフィルタ。
 * 旧: 1時間以内除外 → 「1時間経過後に同日中の再架電が出る」事象があったため
 * 「今日 (DATE(call_started_at) = CURDATE())」単位に変更。
 */
const recentCallFilterSQL = `
  AND NOT EXISTS (
    SELECT 1 FROM calls cl
    WHERE cl.company_id = c.id
      AND cl.user_id = ?
      AND DATE(cl.call_started_at) = CURDATE()
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
    const { search, industry, region, show_excluded, list_type, is_sales_list, mylist, updated_since } = req.query;

    let whereClauses = [];
    let params = [];

    // updated_since=ISO8601 (例: 2026-05-21T12:00:00Z) で差分同期用
    //   companies.updated_at >= ? の行のみ返す。 fax-crm 等の外部システムが
    //   最終同期日時を保持して差分のみ pull するために使う
    if (updated_since) {
      // 緩いバリデーション: 数字とハイフン/コロン/T/Z/. のみ許容
      if (!/^[\d\-:TZ.\s+]+$/.test(updated_since)) {
        return ApiResponse.badRequest(res, 'updated_since は ISO8601 形式 (例: 2026-05-21T12:00:00Z)');
      }
      whereClauses.push('c.updated_at >= ?');
      params.push(updated_since);
    }

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
    // Phase 2: fax-crm DB にシャドー書き込み (fire-and-forget)
    try { require('../services/faxCrmDbWriter').shadowUpsertById(result.insertId); } catch (_e) {}
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

    // Phase 2: fax-crm DB にシャドー書き込み (fire-and-forget)
    try { require('../services/faxCrmDbWriter').shadowUpsertById(id); } catch (_e) {}
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
    WHEN c.industry LIKE '%清掃%' OR c.industry LIKE '%クリーニング%' OR c.industry LIKE '%ビルメンテ%' OR c.industry LIKE '%ビル管理%' OR c.industry LIKE '%ハウスクリーニング%' THEN '清掃'
    WHEN c.industry LIKE '%飲食店%' OR c.industry LIKE '%グルメ%' OR c.industry LIKE '%レストラン%' OR c.industry LIKE '%居酒屋%' OR c.industry LIKE '%ラーメン%' OR c.industry LIKE '%カフェ%' OR c.industry LIKE '%喫茶店%' OR c.industry LIKE '%寿司%' OR c.industry LIKE '%焼肉%' OR c.industry LIKE '%和食%' OR c.industry LIKE '%中華%' OR c.industry LIKE '%洋食%' OR c.industry LIKE '%食堂%' OR c.industry LIKE '%ダイニング%' OR c.industry LIKE '%そば%' OR c.industry LIKE '%うどん%' OR c.industry LIKE '%菓子%' THEN '飲食'
    WHEN c.industry LIKE '%サービス%' THEN 'サービス'
    ELSE 'その他'
  END
`;
const CATEGORY_NAMES_SQL = "('飲食','製造','小売','建設','宿泊','清掃','農業','介護','運輸','IT','金融','不動産','美容','サービス')";

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
 * NOT IN は大きなテーブルスキャンになりやすいので NOT EXISTS にしてインデックス活用。
 */
// is_auto=0 (手動割り当て) のみ対象。NO_ANSWER 経由の自動割り当ては「割り当て」扱いせず
// 通常の Tier 4 (2日後再ピックアップ) のフローに任せる。
const assignmentFilterSQL = `
  AND (
    NOT EXISTS (SELECT 1 FROM company_assignments ca WHERE ca.company_id = c.id AND ca.is_auto = 0)
    OR EXISTS (SELECT 1 FROM company_assignments ca WHERE ca.company_id = c.id AND ca.user_id = ? AND ca.is_auto = 0)
    OR (c.priority_expires_at IS NOT NULL AND c.priority_expires_at <= NOW())
  )
`;

/**
 * 再ピックアップ除外SQL
 * - SKIP/PROJECT/RECALL/INTERESTED: 永久除外（再ピックアップ禁止）
 * - NO_ANSWER: 最終架電から2日後以降に再ピックアップ可能（リコール由来の不通のみ別途1時間後、endCall側で制御）
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
    // 営業もオペレーターと同じリスト (is_sales_list=0) を参照するよう統一。
    // call_type による分岐は撤回。架電結果集計は引き続き call_type で分離。
    const salesListFilter = 'AND c.is_sales_list = 0';

    // ピックアップモードフィルタ
    const mode = req.query.mode || 'auto';
    const industryParam = req.query.industry || '';
    const regionParam = req.query.region || ''; // 業種別モード時の都道府県絞込 (任意)
    const isMyList = mode === 'mylist';
    const isSpecialList = mode === 'special';
    // 業種別モードで industry が空のときは 400 を返す (無音で全件返すと「絞れていない」誤解の元)
    if (mode === 'industry' && !industryParam) {
      return ApiResponse.badRequest(res, '業種別モードでは industry パラメータが必要です');
    }
    let modeFilterSQL = '';
    let modeFilterParams = [];
    const CATEGORY_NAMES_LIST = ['飲食','製造','小売','建設','宿泊','清掃','農業','介護','運輸','IT','金融','不動産','美容','サービス'];
    if (mode === 'industry' && industryParam) {
      if (CATEGORY_NAMES_LIST.includes(industryParam)) {
        // 大枠カテゴリ: industry_category カラムの index 利用 (60万行で高速)
        // industry_category が NULL の企業 (再分類前データ) も含めることでピックアップ漏れを防ぐ。
        // 正確な絞り込みには顧客マスタ「業種診断」→「再計算」で全件分類済みにする。
        modeFilterSQL = `AND (c.industry_category = ? OR c.industry_category IS NULL)`;
        modeFilterParams = [industryParam];
      } else {
        // 自由キーワードは従来の部分一致
        modeFilterSQL = `AND c.industry LIKE CONCAT('%', ?, '%')`;
        modeFilterParams = [industryParam];
      }
      // 地域指定: 性能優先で 3 パターンのみ (中間一致 LIKE '%xxx%' は60万行クラスで重いため除外)
      //   (1) c.region 完全一致 (「東京都」「東京」両形式)
      //   (2) c.region 前方一致 (「東京都港区」のような長い形式) — index 活用
      //   (3) c.address 前方一致 (region 空欄企業) — index 活用
      if (regionParam) {
        const short = regionParam.replace(/(都|道|府|県)$/, '');
        modeFilterSQL += ` AND (
          c.region IN (?, ?)
          OR c.region LIKE CONCAT(?, '%')
          OR c.address LIKE CONCAT(?, '%')
        )`;
        modeFilterParams.push(regionParam, short || regionParam, short || regionParam, regionParam);
      }
    } else if (isMyList) {
      modeFilterSQL = `AND c.imported_by_user_id = ?`;
      modeFilterParams = [userId];
    }

    // 自作リスト/特別リストモード: 業種地域フィルタ・結果除外・割り当てフィルタをバイパス
    // 業種別モードでは ③業種地域ルール (industry_region_rules) をバイパスする。
    // ユーザーが明示的に業種を選んでいるため、ルール側の地域制限や業種除外を
    // すり抜けて出すのが直感的 (「建設で絞ったのに建設が出ない」事象の修正)。
    const irFilter = (isMyList || isSpecialList || mode === 'industry') ? '' : industryRegionFilterSQL;
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
           AND NOT EXISTS (
             SELECT 1 FROM calls cl
             WHERE cl.company_id = c.id AND cl.result_code IS NOT NULL
           )
           ${lockFilterSQL}
         ORDER BY c.id DESC
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
           AND NOT EXISTS (
             SELECT 1 FROM calls cl
             WHERE cl.company_id = c.id AND cl.result_code IS NOT NULL
           )
           ${modeFilterSQL}
         ORDER BY c.id DESC
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
              IF(EXISTS(SELECT 1 FROM company_assignments ca WHERE ca.company_id = c.id AND ca.user_id = ? AND ca.is_auto = 0), 1, 0) as is_assigned
       FROM companies c
       JOIN industry_time_rules itr ON c.industry = itr.industry_name
       WHERE c.exclusion_flag = 0 AND c.is_special = 0 ${salesListFilter}
         AND ? BETWEEN itr.start_time AND itr.end_time
         AND NOT EXISTS (SELECT 1 FROM recall_tasks rt WHERE rt.company_id = c.id AND rt.status = 'pending')
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
              IF(EXISTS(SELECT 1 FROM company_assignments ca WHERE ca.company_id = c.id AND ca.user_id = ? AND ca.is_auto = 0), 1, 0) as is_assigned
       FROM companies c
       WHERE c.exclusion_flag = 0 AND c.is_special = 0 ${salesListFilter} AND c.last_called_at IS NULL
         AND NOT EXISTS (SELECT 1 FROM recall_tasks rt WHERE rt.company_id = c.id AND rt.status = 'pending')
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

    // 4. 前回不通 → 2日後以降に再ピックアップ（リコール由来の不通は除く: recall_atで1時間後に再ピックアップ）
    const [noAnswerRows] = await pool.query(
      `SELECT c.*,
              (SELECT cl.memo FROM calls cl WHERE cl.company_id = c.id ORDER BY cl.call_started_at DESC LIMIT 1) as last_memo,
              IF(EXISTS(SELECT 1 FROM company_assignments ca WHERE ca.company_id = c.id AND ca.user_id = ? AND ca.is_auto = 0), 1, 0) as is_assigned
       FROM companies c
       WHERE c.exclusion_flag = 0 AND c.is_special = 0 ${salesListFilter}
         AND NOT EXISTS (SELECT 1 FROM recall_tasks rt WHERE rt.company_id = c.id AND rt.status = 'pending')
         ${lrFilter}
         ${lastResultFilterSQL('NO_ANSWER')}
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
              IF(EXISTS(SELECT 1 FROM company_assignments ca WHERE ca.company_id = c.id AND ca.user_id = ? AND ca.is_auto = 0), 1, 0) as is_assigned
       FROM companies c
       WHERE c.exclusion_flag = 0 AND c.is_special = 0 ${salesListFilter}
         AND NOT EXISTS (SELECT 1 FROM recall_tasks rt WHERE rt.company_id = c.id AND rt.status = 'pending')
         ${lrFilter}
         ${lastResultFilterSQL('NG')}
         AND c.last_called_at < DATE_SUB(NOW(), INTERVAL 3 MONTH)
         ${lastUserNotEqualSQL()}
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

    // ===== 短期キャッシュ（10秒） =====
    // 15秒間隔ポーリング前提で、2回に1回はDBクエリを丸ごとスキップ。
    // excludeパラメータ（直前完了企業ID）付きは「次の架電先を取りに来た」操作なのでキャッシュしない。
    const cacheKey = buildCallListCacheKey(userId, callType, req.query.mode || 'auto', req.query.industry || '', req.query.region || '');
    // refresh=1 のとき: クライアントの「更新」ボタンからの明示的な再取得 → キャッシュバイパス
    //   ついでに自分宛のキャッシュもクリアして直後のポーリングが古いデータを返さないように
    if (req.query.refresh) {
      for (const k of callListCache.keys()) if (k.startsWith(`${userId}|`)) callListCache.delete(k);
    } else if (!req.query.exclude) {
      const cached = callListCache.get(cacheKey);
      if (cached && (Date.now() - cached.at) < CALL_LIST_CACHE_TTL_MS) {
        return ApiResponse.success(res, cached.payload);
      }
    }
    // 営業もオペレーターと同じリスト (is_sales_list=0) を参照するよう統一。
    // call_type による分岐は撤回。架電結果集計は引き続き call_type で分離。
    const salesListFilter = 'AND c.is_sales_list = 0';

    // ピックアップモードフィルタ
    const mode = req.query.mode || 'auto';
    const industryParam = req.query.industry || '';
    const regionParam = req.query.region || ''; // 業種別モード時の都道府県絞込 (任意)
    const isMyList = mode === 'mylist';
    const isSpecialList = mode === 'special';
    // 業種別モードで industry が空のときは 400 を返す (無音で全件返すと「絞れていない」誤解の元)
    if (mode === 'industry' && !industryParam) {
      return ApiResponse.badRequest(res, '業種別モードでは industry パラメータが必要です');
    }
    let modeFilterSQL = '';
    let modeFilterParams = [];
    const CATEGORY_NAMES_LIST = ['飲食','製造','小売','建設','宿泊','清掃','農業','介護','運輸','IT','金融','不動産','美容','サービス'];
    if (mode === 'industry' && industryParam) {
      if (CATEGORY_NAMES_LIST.includes(industryParam)) {
        // 大枠カテゴリ: industry_category カラムの index 利用 (60万行で高速)
        // industry_category が NULL の企業 (再分類前データ) も含めることでピックアップ漏れを防ぐ。
        // 正確な絞り込みには顧客マスタ「業種診断」→「再計算」で全件分類済みにする。
        modeFilterSQL = `AND (c.industry_category = ? OR c.industry_category IS NULL)`;
        modeFilterParams = [industryParam];
      } else {
        // 自由キーワードは従来の部分一致
        modeFilterSQL = `AND c.industry LIKE CONCAT('%', ?, '%')`;
        modeFilterParams = [industryParam];
      }
      // 地域指定: 性能優先で 3 パターンのみ (中間一致 LIKE '%xxx%' は60万行クラスで重いため除外)
      //   (1) c.region 完全一致 (「東京都」「東京」両形式)
      //   (2) c.region 前方一致 (「東京都港区」のような長い形式) — index 活用
      //   (3) c.address 前方一致 (region 空欄企業) — index 活用
      if (regionParam) {
        const short = regionParam.replace(/(都|道|府|県)$/, '');
        modeFilterSQL += ` AND (
          c.region IN (?, ?)
          OR c.region LIKE CONCAT(?, '%')
          OR c.address LIKE CONCAT(?, '%')
        )`;
        modeFilterParams.push(regionParam, short || regionParam, short || regionParam, regionParam);
      }
    } else if (isMyList) {
      modeFilterSQL = `AND c.imported_by_user_id = ?`;
      modeFilterParams = [userId];
    }

    // 自作リスト/特別リストモード: 業種地域フィルタ・結果除外・割り当てフィルタをバイパス
    // 業種別モードでは ③業種地域ルール (industry_region_rules) をバイパスする。
    // ユーザーが明示的に業種を選んでいるため、ルール側の地域制限や業種除外を
    // すり抜けて出すのが直感的 (「建設で絞ったのに建設が出ない」事象の修正)。
    const irFilter = (isMyList || isSpecialList || mode === 'industry') ? '' : industryRegionFilterSQL;
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
              // 短縮形（東京）と完全名（東京都）両方をINに含めて確実にマッチ
              const allForms = [];
              for (const p of enabledPrefs) {
                allForms.push(p);
                const short = p.replace(/(都|道|府|県)$/, '');
                if (short !== p) allForms.push(short);
              }
              const phs = allForms.map(() => '?').join(',');
              // 「東京都港区...」のような address のみ持つ会社のフォールバック
              const addressStartConds = enabledPrefs.map(() => `c.address LIKE CONCAT(?, '%')`).join(' OR ');
              prefectureFilter = `AND (c.region IN (${phs}) OR (${addressStartConds}))`;
              prefectureParams.push(...allForms, ...enabledPrefs);
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
    // 一度でも架電結果が入力された企業は除外、表示順は直近追加順
    if (isSpecialList) {
      const isManager = req.user.role === 'admin' || req.user.role === 'manager';
      const specialAssignFilter = isManager
        ? ''
        : `AND (c.id IN (SELECT ca.company_id FROM company_assignments ca WHERE ca.user_id = ${Number(userId)})
           OR c.id NOT IN (SELECT ca.company_id FROM company_assignments ca))`;
      const [specialRows] = await pool.query(
        `SELECT c.id, c.company_name, c.phone_number, c.industry, c.industry_category, c.job_type, c.comment, c.data_source, c.address, c.region,
                'special' as reason,
                (SELECT cl.memo FROM calls cl WHERE cl.company_id = c.id ORDER BY cl.call_started_at DESC LIMIT 1) as last_memo,
                (SELECT cl.result_code FROM calls cl WHERE cl.company_id = c.id ORDER BY cl.call_started_at DESC LIMIT 1) as last_result
         FROM companies c
         WHERE c.exclusion_flag = 0 AND c.is_special = 1 ${salesListFilter}
           AND NOT EXISTS (
             SELECT 1 FROM calls cl
             WHERE cl.company_id = c.id AND cl.result_code IS NOT NULL
           )
           ${lockFilterSQL}
           ${specialAssignFilter}
         ORDER BY c.id DESC
         LIMIT ?`,
        [userId, LIST_SIZE]
      );
      const payload = { targets: specialRows };
      if (!req.query.exclude) callListCache.set(cacheKey, { at: Date.now(), payload });
      return ApiResponse.success(res, payload);
    }

    // 自作リストモード: 全件返す（上限1000件）
    // 一度でも架電結果が入力された企業は除外
    // 表示順: 自作リストに追加した日付の新しい順
    if (isMyList) {
      const [mylistRows] = await pool.query(
        `SELECT c.id, c.company_name, c.phone_number, c.industry, c.industry_category, c.job_type, c.comment, c.data_source, c.address, c.region,
                'mylist' as reason,
                (SELECT cl.memo FROM calls cl WHERE cl.company_id = c.id ORDER BY cl.call_started_at DESC LIMIT 1) as last_memo,
                (SELECT cl.result_code FROM calls cl WHERE cl.company_id = c.id ORDER BY cl.call_started_at DESC LIMIT 1) as last_result
         FROM companies c
         WHERE c.exclusion_flag = 0 AND c.is_special = 0 ${salesListFilter}
           AND NOT EXISTS (
             SELECT 1 FROM calls cl
             WHERE cl.company_id = c.id AND cl.result_code IS NOT NULL
           )
           ${lockFilterSQL}
           ${modeFilterSQL}
         ORDER BY c.id DESC
         LIMIT 1000`,
        [userId, ...modeFilterParams]
      );
      const payload = { targets: mylistRows };
      if (!req.query.exclude) callListCache.set(cacheKey, { at: Date.now(), payload });
      return ApiResponse.success(res, payload);
    }

    // 1. リコール期限（自分のリコールのみ）
    // リコールはユーザーが明示的に指定したものなので、1時間以内除外・業種地域フィルタは
    // バイパス。ただし業種別モード時は modeFilterSQL を適用して業種絞込を尊重する。
    const [recallRows] = await pool.query(
      `SELECT c.id, c.company_name, c.phone_number, c.industry, c.industry_category, c.job_type, c.comment, c.data_source, c.address, c.region,
              'recall_due' as reason, rt.recall_at
       FROM recall_tasks rt
       JOIN companies c ON rt.company_id = c.id
       WHERE rt.user_id = ? AND rt.status = 'pending' AND rt.recall_at <= ?
         AND c.exclusion_flag = 0 AND c.is_special = 0
         ${lockFilterSQL}
         ${modeFilterSQL}
       ORDER BY rt.recall_at ASC
       LIMIT ?`,
      [userId, now, userId, ...modeFilterParams, LIST_SIZE]
    );
    targets.push(...recallRows);
    excludeIds = targets.map(t => t.id);

    if (targets.length >= LIST_SIZE) {
      // Tier 1 (recall) で全枠埋まった = リコール期限の企業が大量に蓄積している状態。
      // debug 情報も返して件数表示で状況をフロントに伝える。
      const payload = {
        targets: targets.slice(0, LIST_SIZE),
        debug: { recall: recallRows.length, golden: 0, untouched: 0, retry_no_answer: 0, retry_ng: 0, recall_only: true },
      };
      if (!req.query.exclude) callListCache.set(cacheKey, { at: Date.now(), payload });
      return ApiResponse.success(res, payload);
    }

    // ===== Tier 0: 自分割り当て中の企業を必ず先頭に表示 =====
    // 管理画面で「○○割り当て中」とオレンジ表示される企業は、本人がオペレーター画面でも
    // 必ず架電できるようにする。
    // 永久除外 (SKIP/PROJECT/RECALL/INTERESTED)・業種地域フィルタ・last_called_at 経過日数条件
    // をバイパスし、ロック・1時間以内・recall除外を適用。
    // ②自動ピックアップ対象都道府県 (prefectureFilter) は最優先=絶対条件として常に適用。
    // 業種別モード時は modeFilterSQL も適用して業種絞込を尊重 (業種別が効かない事象の修正)。
    const [assignedRows] = await pool.query(
      `SELECT c.id, c.company_name, c.phone_number, c.industry, c.industry_category, c.job_type, c.comment, c.data_source, c.address, c.region,
              'assigned' as reason,
              1 as is_assigned
       FROM companies c
       WHERE c.exclusion_flag = 0 AND c.is_special = 0
         AND EXISTS (SELECT 1 FROM company_assignments ca WHERE ca.company_id = c.id AND ca.user_id = ? AND ca.is_auto = 0)
         AND NOT EXISTS (SELECT 1 FROM recall_tasks rt WHERE rt.company_id = c.id AND rt.status = 'pending')
         ${lockFilterSQL}
         ${recentCallFilterSQL}
         ${prefectureFilter}
         ${modeFilterSQL}
         ${notInClause(excludeIds)}
       ORDER BY c.priority_score DESC, c.last_called_at ASC
       LIMIT ?`,
      [userId, userId, userId, ...prefectureParams, ...modeFilterParams, ...excludeIds, LIST_SIZE]
    );
    // Tier 0 (assigned) は targets にはまだ push しない。
    // 「架電済みは未架電より優先度を下げて」の要望により、Tier 3 (untouched) の後に挿入する。
    // 後段の pushUnique フェーズで assignedRows を golden→untouched の後に処理する。
    // ここでは excludeIds への追加もせず、Tier 2-5 での再評価に任せる (重複は pushUnique で除外)。

    // ===== Tier 2-5 を並列実行 =====
    // 直列だと各ティアで重いサブクエリを毎回評価するため遅い（60万行クラスのDBで顕著）。
    // Tier 1(recall) の結果のみを exclude として渡し、Tier 2-5 は独立クエリとして並列実行。
    // 結果は優先順位順に Map で重複排除して結合 → LIMIT で切る。
    //
    // 自分に割り当てがある企業はピックアップ条件 (業種地域/業種除外) をバイパス。
    // ただし以下は絶対条件としてバイパス対象から外す:
    //   - ②自動ピックアップ対象都道府県 (prefectureFilter)
    //   - 業種別モードの業種絞り込み (modeFilterSQL) — 「建設選んでもローソンが出る」事象の修正
    // これらは SQL 本体側で別途 AND 適用する。
    const assignBypassWrap = `
       AND (
         EXISTS (SELECT 1 FROM company_assignments ca2 WHERE ca2.company_id = c.id AND ca2.user_id = ? AND ca2.is_auto = 0)
         OR (1=1 ${irFilter} ${goldenIndFilter})
       )`;
    // ORDER BY RAND() は 60万行スキャンになりタイムアウト/502 の原因になっていたため撤回。
    // refresh 時のランダム化はフロントの Fisher-Yates シャッフルに任せる (高速・確実)。
    const tier2Order = 'is_assigned DESC, itr.priority_weight DESC, c.priority_score DESC, c.last_called_at ASC';
    const tier3Order = 'is_assigned DESC, c.priority_score DESC, c.created_at ASC';
    const tier45Order = 'is_assigned DESC, c.last_called_at ASC';
    const tier2Promise = pool.query(
      `SELECT c.id, c.company_name, c.phone_number, c.industry, c.industry_category, c.job_type, c.comment, c.data_source, c.address, c.region,
              'golden_time' as reason,
              IF(EXISTS(SELECT 1 FROM company_assignments ca WHERE ca.company_id = c.id AND ca.user_id = ? AND ca.is_auto = 0), 1, 0) as is_assigned
       FROM companies c
       JOIN industry_time_rules itr ON c.industry = itr.industry_name
       WHERE c.exclusion_flag = 0 AND c.is_special = 0 ${salesListFilter}
         AND ? BETWEEN itr.start_time AND itr.end_time
         AND NOT EXISTS (SELECT 1 FROM recall_tasks rt WHERE rt.company_id = c.id AND rt.status = 'pending')
         AND (c.last_called_at IS NULL OR c.last_called_at < DATE_SUB(NOW(), INTERVAL 1 DAY))
         ${lrFilter}
         ${lockFilterSQL}
         ${recentCallFilterSQL}
         ${asFilter}
         ${assignBypassWrap}
         ${prefectureFilter}
         ${modeFilterSQL}
         ${notInClause(excludeIds)}
       ORDER BY ${tier2Order}
       LIMIT ?`,
      [userId, currentTime, userId, userId, userId, userId, ...goldenIndParams, ...prefectureParams, ...modeFilterParams, ...excludeIds, LIST_SIZE]
    );
    const tier3Promise = pool.query(
      `SELECT c.id, c.company_name, c.phone_number, c.industry, c.industry_category, c.job_type, c.comment, c.data_source, c.address, c.region,
              'untouched' as reason,
              IF(EXISTS(SELECT 1 FROM company_assignments ca WHERE ca.company_id = c.id AND ca.user_id = ? AND ca.is_auto = 0), 1, 0) as is_assigned
       FROM companies c
       WHERE c.exclusion_flag = 0 AND c.is_special = 0 ${salesListFilter} AND c.last_called_at IS NULL
         AND NOT EXISTS (SELECT 1 FROM recall_tasks rt WHERE rt.company_id = c.id AND rt.status = 'pending')
         ${lrFilter}
         ${lockFilterSQL}
         ${recentCallFilterSQL}
         ${asFilter}
         ${assignBypassWrap}
         ${prefectureFilter}
         ${modeFilterSQL}
         ${notInClause(excludeIds)}
       ORDER BY ${tier3Order}
       LIMIT ?`,
      [userId, userId, userId, userId, userId, ...goldenIndParams, ...prefectureParams, ...modeFilterParams, ...excludeIds, LIST_SIZE]
    );
    // フォールバック時（last_call_result_code カラム未追加）はティア4/5を完全スキップ。
    // 相関サブクエリで60万行に対し毎行評価され壊滅的に遅くなるため。
    // 未接触/ゴールデンで候補は十分埋まる。
    const useFast = hasLastCallResultCol;
    const tier4Promise = useFast ? pool.query(
      `SELECT c.id, c.company_name, c.phone_number, c.industry, c.industry_category, c.job_type, c.comment, c.data_source, c.address, c.region,
              'retry_no_answer' as reason,
              IF(EXISTS(SELECT 1 FROM company_assignments ca WHERE ca.company_id = c.id AND ca.user_id = ? AND ca.is_auto = 0), 1, 0) as is_assigned
       FROM companies c
       WHERE c.exclusion_flag = 0 AND c.is_special = 0 ${salesListFilter}
         AND NOT EXISTS (SELECT 1 FROM recall_tasks rt WHERE rt.company_id = c.id AND rt.status = 'pending')
         ${lrFilter}
         ${lastResultFilterSQL('NO_ANSWER')}
         AND c.last_called_at < DATE_SUB(NOW(), INTERVAL 2 DAY)
         ${lockFilterSQL}
         ${recentCallFilterSQL}
         ${asFilter}
         ${assignBypassWrap}
         ${prefectureFilter}
         ${modeFilterSQL}
         ${notInClause(excludeIds)}
       ORDER BY ${tier45Order}
       LIMIT ?`,
      [userId, userId, userId, userId, userId, ...goldenIndParams, ...prefectureParams, ...modeFilterParams, ...excludeIds, LIST_SIZE]
    ) : Promise.resolve([[]]);
    const tier5Promise = useFast ? pool.query(
      `SELECT c.id, c.company_name, c.phone_number, c.industry, c.industry_category, c.job_type, c.comment, c.data_source, c.address, c.region,
              'retry_ng' as reason,
              IF(EXISTS(SELECT 1 FROM company_assignments ca WHERE ca.company_id = c.id AND ca.user_id = ? AND ca.is_auto = 0), 1, 0) as is_assigned
       FROM companies c
       WHERE c.exclusion_flag = 0 AND c.is_special = 0 ${salesListFilter}
         AND NOT EXISTS (SELECT 1 FROM recall_tasks rt WHERE rt.company_id = c.id AND rt.status = 'pending')
         ${lrFilter}
         ${lastResultFilterSQL('NG')}
         AND c.last_called_at < DATE_SUB(NOW(), INTERVAL 3 MONTH)
         ${lastUserNotEqualSQL()}
         ${lockFilterSQL}
         ${recentCallFilterSQL}
         ${asFilter}
         ${assignBypassWrap}
         ${prefectureFilter}
         ${modeFilterSQL}
         ${notInClause(excludeIds)}
       ORDER BY ${tier45Order}
       LIMIT ?`,
      [userId, userId, userId, userId, userId, userId, ...goldenIndParams, ...prefectureParams, ...modeFilterParams, ...excludeIds, LIST_SIZE]
    ) : Promise.resolve([[]]);

    if (!useFast) {
      logger.warn('[getCallList] last_call_result_code 未追加のためティア4/5スキップ（fast path未有効）');
    }
    const [[goldenRows], [untouchedRows], [retryRows], [ngRetryRows]] = await Promise.all([
      tier2Promise, tier3Promise, tier4Promise, tier5Promise,
    ]);

    // 優先順位順に重複排除しながら結合
    // 順序: recall(既追加) > golden > untouched > assigned > retry_na > retry_ng
    // 「架電済みは未架電より優先度を下げる」要望により、Tier 0 (assigned) を
    // Tier 3 (untouched) の後に移動。自分割り当て中でも未架電が先に表示される。
    const seen = new Set(targets.map(t => t.id));
    const pushUnique = (arr) => {
      for (const r of arr) {
        if (seen.has(r.id)) continue;
        seen.add(r.id);
        targets.push(r);
        if (targets.length >= LIST_SIZE) return true;
      }
      return false;
    };
    // Tier 4(retry_no_answer) / Tier 5(retry_ng) は「未架電(Tier 3)が完全に枯渇」したときだけ採用。
    // 未架電が1件でもある限り、過去不通の再架電は表示しない方針。
    const hasUntouched = untouchedRows.length > 0;
    if (!pushUnique(goldenRows)) {
      if (!pushUnique(untouchedRows)) {
        if (!pushUnique(assignedRows)) {
          if (!hasUntouched) {
            if (!pushUnique(retryRows)) {
              pushUnique(ngRetryRows);
            }
          }
        }
      }
    }

    // デバッグ: 各ティアの件数をログ出力
    logger.info(`[getCallList] mode=${mode} user=${userId} recall=${recallRows.length} assigned=${assignedRows.length} golden=${goldenRows.length} untouched=${untouchedRows.length} retry_na=${retryRows.length} retry_ng=${ngRetryRows.length} total=${targets.length}`);

    let finalTargets = targets.slice(0, LIST_SIZE);
    // refresh=1 のとき: Tier 0 (assigned) と Tier 1 (recall) を先頭に固定し、
    // それ以外の Tier 2-5 を Fisher-Yates でシャッフルして「押すたびに違う候補」を見せる。
    if (req.query.refresh) {
      const stickyReasons = new Set(['assigned', 'recall_due']);
      const sticky = finalTargets.filter(t => stickyReasons.has(t.reason));
      const rest = finalTargets.filter(t => !stickyReasons.has(t.reason));
      for (let i = rest.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [rest[i], rest[j]] = [rest[j], rest[i]];
      }
      finalTargets = [...sticky, ...rest];
    }
    const payload = { targets: finalTargets, debug: {
      recall: recallRows.length,
      golden: goldenRows.length,
      untouched: untouchedRows.length,
      retry_no_answer: retryRows.length,
      retry_ng: ngRetryRows.length,
    } };
    // refresh のときはキャッシュ保存もしない (毎回ランダム結果を返したい)
    if (!req.query.exclude && !req.query.refresh) callListCache.set(cacheKey, { at: Date.now(), payload });
    return ApiResponse.success(res, payload);
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
        // 保持者の名前を取得して 409 に含める
        let lockerName = null;
        try {
          const [u] = await conn.execute(
            'SELECT name, email FROM users WHERE id = ? LIMIT 1',
            [company.locked_by_user_id]
          );
          if (u.length > 0) lockerName = u[0].name || u[0].email;
        } catch (_e) { /* ignore */ }
        await conn.rollback();
        const elapsedMin = Math.floor(elapsedMs / 60000);
        const msg = lockerName
          ? `この企業は${lockerName}が対応中です（${elapsedMin}分前から）`
          : 'この企業は他のオペレーターが対応中です';
        return res.status(409).json({
          success: false,
          message: msg,
          lockedBy: {
            userId: company.locked_by_user_id,
            name: lockerName,
            lockedAt: company.locked_at,
            elapsedMinutes: elapsedMin,
          },
        });
      }
    }

    // ロック取得
    await conn.execute(
      'UPDATE companies SET locked_by_user_id = ?, locked_at = NOW() WHERE id = ?',
      [userId, id]
    );

    await conn.commit();
    // 他ユーザーの架電リストキャッシュもこの企業を除外する必要があるため全クリア
    invalidateCallListCache();

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
    invalidateCallListCache();

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
    // 営業もオペレーターと同じリストを参照するよう統一 (架電リスト統一)
    const salesCond = 'AND c.is_sales_list = 0';

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

/**
 * テーブル作成（冪等）
 */
const ensureCompanyActionsTable = async () => {
  try {
    await pool.execute(`CREATE TABLE IF NOT EXISTS company_actions (
      id INT AUTO_INCREMENT PRIMARY KEY,
      company_id INT NOT NULL,
      action_date DATE NOT NULL,
      action_type VARCHAR(50) NOT NULL,
      user_id INT DEFAULT NULL,
      result VARCHAR(100) DEFAULT NULL,
      memo TEXT DEFAULT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_company (company_id),
      INDEX idx_date (action_date)
    )`);
  } catch (e) { /* ignore */ }
};

/**
 * GET /api/companies/:id/actions
 * 企業のアクション履歴を取得
 * 過去の架電履歴（calls）も統合して表示
 */
const getCompanyActions = async (req, res, next) => {
  try {
    await ensureCompanyActionsTable();
    const { id } = req.params;

    // 手動登録のアクション
    const [actions] = await pool.query(
      `SELECT a.id, a.company_id, a.action_date, a.action_type, a.user_id, a.result, a.memo, a.created_at,
              u.name AS user_name, 'manual' AS source
       FROM company_actions a
       LEFT JOIN users u ON a.user_id = u.id
       WHERE a.company_id = ?
       ORDER BY a.action_date DESC, a.id DESC`,
      [id]
    );

    // 架電履歴も統合表示（担当者情報を含む）
    const [calls] = await pool.query(
      `SELECT cl.id, cl.company_id,
              DATE(cl.call_started_at) AS action_date,
              '架電' AS action_type,
              cl.user_id,
              cl.result_code AS result,
              cl.memo,
              cl.call_started_at AS created_at,
              cl.contact_person_name,
              cl.contact_person_gender,
              cl.contact_person_phone,
              cl.contact_person_impression,
              cl.ng_reason,
              cl.is_person_in_charge,
              u.name AS user_name,
              'call' AS source
       FROM calls cl
       LEFT JOIN users u ON cl.user_id = u.id
       WHERE cl.company_id = ? AND cl.result_code IS NOT NULL
       ORDER BY cl.call_started_at DESC`,
      [id]
    );

    // fax-crm 側の contact_events も統合 (FAX送信履歴・受電報告)
    //   失敗しても他のソースは表示するので fail-soft
    let faxEvents = [];
    try {
      const faxCrmClient = require('../services/faxCrmClient');
      if (faxCrmClient.isEnabled()) {
        const r = await faxCrmClient.getFaxHistory(id);
        if (r.ok && Array.isArray(r.events)) {
          // fax-crm の event_type を action_type にマップ
          const EVENT_TYPE_LABEL = {
            send: 'FAX送信', response_inquiry: '受電(問合せ)', response_order: '受電(発注)',
            refusal: '拒否', invalid_number: '番号無効',
            project: '案件化', ng: 'NG', recall: 'リコール',
            material_sent: '資料送付', other: 'その他',
          };
          faxEvents = r.events.map((e) => ({
            id: e.id,
            company_id: id,
            action_date: (e.occurred_at || '').slice(0, 10),
            action_type: EVENT_TYPE_LABEL[e.event_type] || e.event_type || 'FAX',
            user_id: null,
            user_name: e.operator_name || null,
            result: e.result_label || null,
            memo: e.memo || null,
            created_at: e.occurred_at,
            source: 'fax-crm',
          }));
        }
      }
    } catch (e) {
      // fax-crm 取得失敗は無視 (ログのみ)
      try { require('../utils/logger').warn(`[getCompanyActions] fax-crm fetch失敗: ${e.message}`); } catch (_) {}
    }

    // マージしてソート (calls / manual company_actions / fax-crm events 全て)
    const merged = [...actions, ...calls, ...faxEvents].sort((a, b) => {
      const ad = new Date(a.created_at || a.action_date).getTime();
      const bd = new Date(b.created_at || b.action_date).getTime();
      return bd - ad;
    });

    return ApiResponse.success(res, { actions: merged });
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/companies/:id/actions
 * 企業にアクションを記録
 */
const createCompanyAction = async (req, res, next) => {
  try {
    await ensureCompanyActionsTable();
    const { id } = req.params;
    const { action_date, action_type, result, memo, user_id } = req.body;
    if (!action_date || !action_type) {
      return ApiResponse.badRequest(res, 'action_date と action_type が必要です');
    }
    const targetUserId = user_id || req.user?.id || null;
    const [r] = await pool.execute(
      `INSERT INTO company_actions (company_id, action_date, action_type, user_id, result, memo)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [id, action_date, action_type, targetUserId, result || null, memo || null]
    );
    return ApiResponse.success(res, { id: r.insertId });
  } catch (err) {
    next(err);
  }
};

/**
 * PUT /api/companies/:id/actions/:actionId
 */
const updateCompanyAction = async (req, res, next) => {
  try {
    const { actionId } = req.params;
    const { action_date, action_type, result, memo, user_id } = req.body;
    const updates = [];
    const params = [];
    if (action_date !== undefined) { updates.push('action_date = ?'); params.push(action_date); }
    if (action_type !== undefined) { updates.push('action_type = ?'); params.push(action_type); }
    if (result !== undefined) { updates.push('result = ?'); params.push(result || null); }
    if (memo !== undefined) { updates.push('memo = ?'); params.push(memo || null); }
    if (user_id !== undefined) { updates.push('user_id = ?'); params.push(user_id || null); }
    if (updates.length === 0) return ApiResponse.badRequest(res, '更新項目がありません');
    params.push(actionId);
    await pool.execute(`UPDATE company_actions SET ${updates.join(', ')} WHERE id = ?`, params);
    return ApiResponse.success(res, null);
  } catch (err) {
    next(err);
  }
};

/**
 * DELETE /api/companies/:id/actions/:actionId
 */
const deleteCompanyAction = async (req, res, next) => {
  try {
    const { actionId } = req.params;
    await pool.execute('DELETE FROM company_actions WHERE id = ?', [actionId]);
    return ApiResponse.success(res, null);
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/companies/unlock-all
 * 自分が現在ロック中の企業を一括解除 (架電画面の「ピックアップロック解除」ボタン)
 */
const unlockAllForSelf = async (req, res, next) => {
  try {
    const userId = req.user?.id;
    if (!userId) return ApiResponse.success(res, { released: 0 }, '認証なし');
    const [result] = await pool.execute(
      'UPDATE companies SET locked_by_user_id = NULL, locked_at = NULL WHERE locked_by_user_id = ?',
      [userId]
    );
    invalidateCallListCache();
    logger.info(`[unlockAllForSelf] user=${userId} released=${result.affectedRows}`);
    return ApiResponse.success(res, { released: result.affectedRows }, 'ロックを解除しました');
  } catch (err) {
    logger.error(`[unlockAllForSelf] ${err.message}`);
    return ApiResponse.error(res, 'ロック解除に失敗しました', 500);
  }
};

/**
 * GET /api/companies/industry-regions?industry=飲食
 * 業種別ピックアップ用に「その業種で設定されている都道府県」を返す。
 * 架電ルール (industry_region_rules) で設定されている地域のみ ∩ ②自動ピックアップ対象都道府県。
 */
const getIndustryRegions = async (req, res, next) => {
  try {
    const industry = (req.query.industry || '').trim();
    if (!industry) return ApiResponse.badRequest(res, 'industry は必須');

    const [rows] = await pool.query(
      'SELECT DISTINCT region FROM industry_region_rules WHERE industry_name = ? ORDER BY region',
      [industry]
    );
    let regions = rows.map(r => r.region).filter(Boolean);

    // ②自動ピックアップ対象都道府県と AND
    try {
      const [prefRows] = await pool.execute(
        "SELECT setting_value FROM system_settings WHERE setting_key = 'auto_pickup_prefectures'"
      );
      if (prefRows.length > 0) {
        const prefMap = JSON.parse(prefRows[0].setting_value || '{}');
        const entries = Object.entries(prefMap);
        if (entries.length > 0) {
          const enabledPrefs = new Set(
            entries.filter(([, v]) => v === true).map(([k]) => k)
          );
          const enabledShort = new Set(
            [...enabledPrefs].map(p => p.replace(/(都|道|府|県)$/, ''))
          );
          regions = regions.filter(r => enabledPrefs.has(r) || enabledShort.has(r));
        }
      }
    } catch (e) { /* ignore */ }

    return ApiResponse.success(res, { regions });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/companies/diagnose/prefecture
 * ② 自動ピックアップ対象都道府県の設定と companies.region 値の分布を返す。
 * 「関東で6件しか出ない」事象の原因を可視化。
 */
const diagnosePrefecture = async (req, res, next) => {
  try {
    // ② 設定
    let enabledPrefs = [];
    let disabledPrefs = [];
    try {
      const [pr] = await pool.execute(
        "SELECT setting_value FROM system_settings WHERE setting_key = 'auto_pickup_prefectures'"
      );
      if (pr.length > 0) {
        const map = JSON.parse(pr[0].setting_value || '{}');
        for (const [k, v] of Object.entries(map)) {
          if (v === true) enabledPrefs.push(k);
          else disabledPrefs.push(k);
        }
      }
    } catch (e) { /* ignore */ }

    // companies.region 値分布 (上位30件) — 全件対象 (除外/特別/旧営業も含む)
    const [regionDist] = await pool.query(
      `SELECT COALESCE(NULLIF(region, ''), '(空欄)') AS region, COUNT(*) AS cnt
         FROM companies
        GROUP BY COALESCE(NULLIF(region, ''), '(空欄)')
        ORDER BY cnt DESC LIMIT 30`
    );

    // 関東7県の件数チェック (region と address の両方) — 全件対象
    const KANTO = ['茨城県', '栃木県', '群馬県', '埼玉県', '千葉県', '東京都', '神奈川県'];
    const kantoCounts = {};
    for (const p of KANTO) {
      const short = p.replace(/(都|道|府|県)$/, '');
      try {
        const [c1] = await pool.query(
          "SELECT COUNT(*) AS cnt FROM companies WHERE (region = ? OR region = ?)",
          [p, short]
        );
        const [c2] = await pool.query(
          "SELECT COUNT(*) AS cnt FROM companies WHERE (region IS NULL OR region = '') AND address LIKE CONCAT(?, '%')",
          [p]
        );
        kantoCounts[p] = {
          by_region: Number(c1[0].cnt),
          by_address_only: Number(c2[0].cnt),
          enabled_in_setting: enabledPrefs.includes(p) || enabledPrefs.includes(short),
        };
      } catch (e) { kantoCounts[p] = { error: e.message }; }
    }

    return ApiResponse.success(res, {
      enabled_prefectures: enabledPrefs,
      enabled_count: enabledPrefs.length,
      disabled_prefectures: disabledPrefs,
      disabled_count: disabledPrefs.length,
      region_distribution_top30: regionDist.map(r => ({ region: r.region, count: Number(r.cnt) })),
      kanto_breakdown: kantoCounts,
      note: '関東で件数少ない場合: ① enabled_prefectures に関東各県が含まれているか確認 ② region_distribution で companies.region に「東京」のような短縮形があるか確認',
    });
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/companies/diagnose/recompute-industry-category
 * companies.industry_category を industry テキストから再分類して update する。
 * 「業種カテゴリの分類漏れ」を一括で解消する整理用エンドポイント。
 * dry_run=1 ならカウントだけ返して update は走らない。
 */
const recomputeIndustryCategory = async (req, res, next) => {
  try {
    const dryRun = req.query.dry_run === '1' || req.body?.dry_run === true;
    // CASE 式: companyController の getCallList などで使われている分類ロジックと同じ
    // CASE 順序: 複合キーワード(建材小売、建築資材販売)を先に「建設」扱いするため、
    // 建設を小売より前に評価する。同様に飲食系も小売「飲食料品小売業」を後回しに。
    // 製造系は「金属/部品/化学/食品/衣料/印刷/木製/プラスチック/ゴム/紙/繊維」など広めに拾う。
    const CATEGORY_SQL = `
      CASE
        WHEN industry LIKE '%建設%' OR industry LIKE '%建築%' OR industry LIKE '%工事%' OR industry LIKE '%土木%' OR industry LIKE '%リフォーム%' OR industry LIKE '%電気工事%' OR industry LIKE '%管工事%' OR industry LIKE '%建材%' OR industry LIKE '%住宅%' OR industry LIKE '%リノベ%' THEN '建設'
        WHEN industry LIKE '%宿泊%' OR industry LIKE '%ホテル%' OR industry LIKE '%旅館%' OR industry LIKE '%民宿%' THEN '宿泊'
        WHEN industry LIKE '%清掃%' OR industry LIKE '%クリーニング%' OR industry LIKE '%ビルメンテ%' OR industry LIKE '%ビル管理%' OR industry LIKE '%ハウスクリーニング%' THEN '清掃'
        WHEN industry LIKE '%介護%' OR industry LIKE '%デイサービス%' OR industry LIKE '%福祉%' OR industry LIKE '%老人ホーム%' OR industry LIKE '%グループホーム%' THEN '介護'
        WHEN industry LIKE '%飲食%' OR industry LIKE '%グルメ%' OR industry LIKE '%レストラン%' OR industry LIKE '%居酒屋%' OR industry LIKE '%ラーメン%' OR industry LIKE '%カフェ%' OR industry LIKE '%喫茶店%' OR industry LIKE '%寿司%' OR industry LIKE '%焼肉%' OR industry LIKE '%和食%' OR industry LIKE '%中華%' OR industry LIKE '%洋食%' OR industry LIKE '%食堂%' OR industry LIKE '%ダイニング%' OR industry LIKE '%そば%' OR industry LIKE '%うどん%' OR industry LIKE '%菓子%' THEN '飲食'
        WHEN industry LIKE '%農業%' OR industry LIKE '%農場%' OR industry LIKE '%農園%' OR industry LIKE '%畜産%' OR industry LIKE '%養鶏%' OR industry LIKE '%水産%' OR industry LIKE '%漁業%' OR industry LIKE '%林業%' OR industry LIKE '%農産%' THEN '農業'
        WHEN industry LIKE '%製造%' OR industry LIKE '%メーカー%' OR industry LIKE '%加工%' OR industry LIKE '%工場%' OR industry LIKE '%金属%' OR industry LIKE '%部品%' OR industry LIKE '%機械%' OR industry LIKE '%化学%' OR industry LIKE '%食品%' OR industry LIKE '%飲料%' OR industry LIKE '%繊維%' OR industry LIKE '%衣料%' OR industry LIKE '%印刷%' OR industry LIKE '%木材%' OR industry LIKE '%木製%' OR industry LIKE '%プラスチック%' OR industry LIKE '%ゴム%' OR industry LIKE '%紙%' OR industry LIKE '%パルプ%' OR industry LIKE '%セメント%' OR industry LIKE '%窯業%' OR industry LIKE '%電子%' OR industry LIKE '%輸送機%' OR industry LIKE '%自動車%' OR industry LIKE '%電気機械%' THEN '製造'
        WHEN industry LIKE '%小売%' OR industry LIKE '%卸売%' OR industry LIKE '%スーパー%' OR industry LIKE '%コンビニ%' OR industry LIKE '%ショッピング%' OR industry LIKE '%商社%' OR industry LIKE '%物販%' OR industry LIKE '%販売%' THEN '小売'
        ELSE 'その他'
      END
    `;

    // 変更件数を先に試算
    const [diff] = await pool.query(
      `SELECT
         SUM(CASE WHEN (${CATEGORY_SQL}) != COALESCE(industry_category, '') THEN 1 ELSE 0 END) AS will_change,
         COUNT(*) AS total
       FROM companies WHERE industry IS NOT NULL`
    );
    const willChange = Number(diff[0]?.will_change) || 0;
    const total = Number(diff[0]?.total) || 0;

    if (dryRun) {
      return ApiResponse.success(res, {
        dry_run: true,
        total_with_industry: total,
        will_change: willChange,
        note: 'dry_run なので更新は実行されていません。dry_run なしで POST すると実行されます。',
      });
    }

    // 実行
    const [r] = await pool.query(
      `UPDATE companies SET industry_category = (${CATEGORY_SQL}) WHERE industry IS NOT NULL AND (industry_category IS NULL OR industry_category != (${CATEGORY_SQL}))`
    );
    logger.info(`[recomputeIndustryCategory] updated=${r.affectedRows} (will_change estimated=${willChange})`);
    return ApiResponse.success(res, {
      updated: r.affectedRows,
      estimated: willChange,
      total_with_industry: total,
    });
  } catch (err) {
    logger.error(`[recomputeIndustryCategory] ${err.message}`);
    next(err);
  }
};

/**
 * GET /api/companies/diagnose/industry?category=建設
 * 業種別の件数内訳を返す。
 * - industry_category と industry テキストの両軸で集計し、分類漏れを可視化する。
 */
const diagnoseIndustryCounts = async (req, res, next) => {
  try {
    const category = (req.query.category || '').trim();
    if (!category) return ApiResponse.badRequest(res, 'category クエリが必要');

    // カテゴリごとのキーワードマップ (industry テキスト判定用)
    const KEYWORDS = {
      '建設': ['建設', '建築', '工事', '土木', 'リフォーム', '電気工事', '管工事'],
      '飲食': ['飲食', 'レストラン', '居酒屋', '食堂', 'ラーメン', 'カフェ', '寿司', '焼肉', '和食', '中華', '洋食'],
      '製造': ['製造', 'メーカー', '加工', '工場'],
      '小売': ['小売', '卸売', 'スーパー', 'コンビニ', 'ショッピング'],
      '宿泊': ['宿泊', 'ホテル', '旅館', '民宿'],
      '清掃': ['清掃', 'クリーニング', 'ビルメンテ', 'ハウスクリーニング'],
      '農業': ['農業', '農場', '農園', '畜産', '養鶏'],
      '介護': ['介護', 'デイサービス', '福祉', '老人ホーム', 'グループホーム'],
    };
    const kws = KEYWORDS[category] || [category];

    // industry_category が一致
    const [byCategory] = await pool.query(
      'SELECT COUNT(*) AS cnt FROM companies WHERE exclusion_flag = 0 AND is_special = 0 AND is_sales_list = 0 AND industry_category = ?',
      [category]
    );

    // industry テキストにキーワードが含まれる (全体)
    const likeConds = kws.map(() => 'c.industry LIKE ?').join(' OR ');
    const likeParams = kws.map(k => `%${k}%`);
    const [byKeyword] = await pool.query(
      `SELECT COUNT(*) AS cnt FROM companies c WHERE exclusion_flag = 0 AND is_special = 0 AND is_sales_list = 0 AND (${likeConds})`,
      likeParams
    );

    // industry にキーワードが含まれるのに industry_category が一致していない (= 分類漏れ候補)
    const [misCategorized] = await pool.query(
      `SELECT COUNT(*) AS cnt FROM companies c WHERE exclusion_flag = 0 AND is_special = 0 AND is_sales_list = 0
       AND (${likeConds}) AND (industry_category IS NULL OR industry_category != ?)`,
      [...likeParams, category]
    );

    // 分類漏れの実例 (上位 10件)
    const [misSamples] = await pool.query(
      `SELECT id, company_name, industry, industry_category FROM companies c
       WHERE exclusion_flag = 0 AND is_special = 0 AND is_sales_list = 0
       AND (${likeConds}) AND (industry_category IS NULL OR industry_category != ?)
       LIMIT 10`,
      [...likeParams, category]
    );

    // industry_category 内の永久除外/未架電内訳
    const [breakdown] = await pool.query(
      `SELECT
         SUM(CASE WHEN last_call_result_code IN ('SKIP','PROJECT','RECALL','INTERESTED') THEN 1 ELSE 0 END) AS permanent_excluded,
         SUM(CASE WHEN last_called_at IS NULL THEN 1 ELSE 0 END) AS untouched,
         SUM(CASE WHEN last_call_result_code = 'NO_ANSWER' THEN 1 ELSE 0 END) AS last_no_answer,
         SUM(CASE WHEN last_call_result_code = 'NG' THEN 1 ELSE 0 END) AS last_ng
       FROM companies
       WHERE exclusion_flag = 0 AND is_special = 0 AND is_sales_list = 0 AND industry_category = ?`,
      [category]
    );

    return ApiResponse.success(res, {
      category,
      keywords: kws,
      counts: {
        by_industry_category: Number(byCategory[0].cnt),
        by_industry_keyword: Number(byKeyword[0].cnt),
        miscategorized: Number(misCategorized[0].cnt),
        permanent_excluded: Number(breakdown[0]?.permanent_excluded) || 0,
        untouched: Number(breakdown[0]?.untouched) || 0,
        last_no_answer: Number(breakdown[0]?.last_no_answer) || 0,
        last_ng: Number(breakdown[0]?.last_ng) || 0,
      },
      miscategorized_samples: misSamples.map(r => ({
        id: r.id,
        company_name: r.company_name,
        industry: r.industry,
        industry_category: r.industry_category,
      })),
      note: 'by_industry_keyword (テキストマッチ) と by_industry_category (事前計算) の差分が「分類漏れ」。miscategorized が大きい場合は industry_category の再計算で件数が大幅に増える可能性。',
    });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/companies/diagnose/counts
 * companies テーブルの各フラグごとの件数内訳を返す診断ツール。
 * 「顧客マスタの件数と架電リストの件数が違う」の差分原因を可視化する。
 */
const diagnoseCompanyCounts = async (req, res, next) => {
  try {
    const queries = {
      total: 'SELECT COUNT(*) AS cnt FROM companies',
      excluded: 'SELECT COUNT(*) AS cnt FROM companies WHERE exclusion_flag = 1',
      special: 'SELECT COUNT(*) AS cnt FROM companies WHERE is_special = 1',
      sales_list: 'SELECT COUNT(*) AS cnt FROM companies WHERE is_sales_list = 1',
      // 顧客マスタ画面の表示対象
      customer_master_visible: 'SELECT COUNT(*) AS cnt FROM companies WHERE exclusion_flag = 0',
      // 架電リスト管理画面 (admin/companies) の表示対象
      call_list_admin: 'SELECT COUNT(*) AS cnt FROM companies WHERE exclusion_flag = 0 AND is_special = 0 AND is_sales_list = 0',
      // 永久除外 (SKIP/PROJECT/RECALL/INTERESTED) 状態
      permanent_excluded: "SELECT COUNT(*) AS cnt FROM companies WHERE exclusion_flag = 0 AND is_special = 0 AND is_sales_list = 0 AND last_call_result_code IN ('SKIP','PROJECT','RECALL','INTERESTED')",
      // 未架電
      untouched: 'SELECT COUNT(*) AS cnt FROM companies WHERE exclusion_flag = 0 AND is_special = 0 AND is_sales_list = 0 AND last_called_at IS NULL',
      // 前回 NO_ANSWER
      last_no_answer: "SELECT COUNT(*) AS cnt FROM companies WHERE exclusion_flag = 0 AND is_special = 0 AND is_sales_list = 0 AND last_call_result_code = 'NO_ANSWER'",
      // 前回 NG
      last_ng: "SELECT COUNT(*) AS cnt FROM companies WHERE exclusion_flag = 0 AND is_special = 0 AND is_sales_list = 0 AND last_call_result_code = 'NG'",
    };
    const result = {};
    for (const [k, sql] of Object.entries(queries)) {
      try {
        const [r] = await pool.query(sql);
        result[k] = Number(r[0]?.cnt) || 0;
      } catch (e) {
        result[k] = `error: ${e.message}`;
      }
    }
    return ApiResponse.success(res, {
      counts: result,
      note: '顧客マスタは customer_master_visible 件、架電リスト管理は call_list_admin 件。差分は special + sales_list で説明できる。',
    });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/companies/:id/pickup-diagnose
 * 特定企業がなぜ架電リストに出てこないかを診断する。
 * 各除外条件を1つずつ評価して、引っかかっている理由を返す。
 */
const diagnoseCompanyPickup = async (req, res, next) => {
  try {
    const companyId = parseInt(req.params.id, 10);
    if (!companyId) return ApiResponse.badRequest(res, 'id が不正です');
    const userId = req.user.id;

    const [rows] = await pool.query(
      `SELECT id, company_name, phone_number, industry, industry_category, region, address,
              exclusion_flag, is_special, is_sales_list,
              last_called_at, last_call_result_code, last_call_user_id,
              locked_by_user_id, locked_at
       FROM companies WHERE id = ?`,
      [companyId]
    );
    if (rows.length === 0) return ApiResponse.notFound(res, '企業が見つかりません');
    const c = rows[0];

    const reasons = [];
    const ok = [];

    if (c.exclusion_flag) reasons.push('exclusion_flag が立っている (完全除外)');
    else ok.push('exclusion_flag: OK');

    if (c.is_special) reasons.push('is_special が立っている (特別リスト扱い・auto モードで非表示)');
    else ok.push('is_special: OK');

    if (c.is_sales_list) reasons.push('is_sales_list が立っている (旧営業用リスト・現在は is_sales_list=0 のみピックアップ)');
    else ok.push('is_sales_list: OK');

    // 永久除外結果
    if (['SKIP', 'PROJECT', 'RECALL', 'INTERESTED'].includes(c.last_call_result_code)) {
      reasons.push(`前回結果が '${c.last_call_result_code}' のため永久除外`);
    } else {
      ok.push(`last_call_result_code='${c.last_call_result_code || 'なし'}': 永久除外対象外`);
    }

    // recall_tasks pending
    try {
      const [rt] = await pool.query(
        "SELECT user_id, status, recall_at FROM recall_tasks WHERE company_id = ? AND status = 'pending'",
        [companyId]
      );
      if (rt.length > 0) {
        const u = rt[0].user_id === userId ? '自分' : `user_id=${rt[0].user_id}`;
        reasons.push(`recall_tasks に pending が ${rt.length}件 (${u} の予約・Tier 1 で先頭表示)`);
      } else {
        ok.push('recall_tasks: pending なし');
      }
    } catch (e) {}

    // company_assignments (手動割当)
    try {
      const [ca] = await pool.query(
        'SELECT user_id, is_auto FROM company_assignments WHERE company_id = ?',
        [companyId]
      );
      const manualOthers = ca.filter(a => Number(a.is_auto) === 0 && a.user_id !== userId);
      const manualMine = ca.filter(a => Number(a.is_auto) === 0 && a.user_id === userId);
      if (manualOthers.length > 0) {
        reasons.push(`他オペレーターに手動割り当て (user_id=${manualOthers.map(x => x.user_id).join(',')})`);
      } else {
        ok.push('company_assignments: 他人手動割り当てなし');
      }
      if (manualMine.length > 0) ok.push('自分に手動割り当てあり (Tier 0 で表示されるはず)');
    } catch (e) {}

    // lock
    const LOCK_TIMEOUT_MIN = 30;
    if (c.locked_by_user_id && c.locked_by_user_id !== userId) {
      const lockedAt = c.locked_at ? new Date(c.locked_at) : null;
      const stale = lockedAt && (Date.now() - lockedAt.getTime() > LOCK_TIMEOUT_MIN * 60 * 1000);
      if (stale) ok.push('他人ロック中だがタイムアウト済 (許可)');
      else reasons.push(`他人ロック中 (user_id=${c.locked_by_user_id})`);
    } else {
      ok.push('ロック: OK');
    }

    // 今日架電済 (自分)
    try {
      const [tc] = await pool.query(
        "SELECT COUNT(*) as cnt FROM calls WHERE company_id = ? AND user_id = ? AND DATE(call_started_at) = CURDATE() AND result_code IS NOT NULL",
        [companyId, userId]
      );
      if (Number(tc[0].cnt) > 0) reasons.push('本日すでに自分が架電済 (同日内除外)');
      else ok.push('本日の自分の架電: なし');
    } catch (e) {}

    // ② 都道府県
    try {
      const [pr] = await pool.execute(
        "SELECT setting_value FROM system_settings WHERE setting_key = 'auto_pickup_prefectures'"
      );
      if (pr.length > 0) {
        const map = JSON.parse(pr[0].setting_value || '{}');
        const enabled = new Set(Object.entries(map).filter(([, v]) => v === true).map(([k]) => k));
        const short = new Set([...enabled].map(p => p.replace(/(都|道|府|県)$/, '')));
        const regionMatch = enabled.has(c.region || '') || short.has(c.region || '');
        const addressMatch = c.address && [...enabled].some(p => c.address.startsWith(p));
        if (enabled.size > 0 && !regionMatch && !addressMatch) {
          reasons.push(`②自動ピックアップ対象都道府県の範囲外 (region='${c.region}', address先頭='${(c.address || '').slice(0, 6)}')`);
        } else {
          ok.push('②都道府県: OK');
        }
      }
    } catch (e) {}

    // 業種地域ルール (③) は auto モードのみ判定
    try {
      const [irrs] = await pool.query(
        `SELECT industry_name, region FROM industry_region_rules
         WHERE (industry_name = ? OR ? LIKE CONCAT('%', industry_name, '%') OR industry_name = ?)`,
        [c.industry_category, c.industry, c.industry_category]
      );
      const ruleMatch = irrs.some(r => c.address && c.address.startsWith(r.region));
      if (irrs.length === 0) {
        ok.push('③業種地域ルール: 該当業種のルールなし (autoモードでは全国NG扱いになる場合あり)');
      } else if (ruleMatch) {
        ok.push('③業種地域ルール: 該当 (autoモードで許可)');
      } else {
        reasons.push(`③業種地域ルール: 業種=${c.industry_category} のルール ${irrs.length}件あり、いずれの地域 (${irrs.map(r => r.region).slice(0, 5).join('/')}) にもマッチしない (autoモードのみ影響、業種別モードならバイパス)`);
      }
    } catch (e) {}

    // ゴールデン業種 (auto モード時)
    try {
      const [g] = await pool.query(
        'SELECT COUNT(*) as cnt FROM industry_time_rules WHERE industry_name = ?',
        [c.industry]
      );
      if (Number(g[0].cnt) === 0) {
        reasons.push(`auto モードでは ゴールデン業種設定にこの業種 (${c.industry}) が無いため除外 (industry/mylist/special モードなら OK)`);
      } else {
        ok.push('ゴールデン業種: 登録あり');
      }
    } catch (e) {}

    // Tier 4/5: last_called_at 経過日数
    if (c.last_called_at) {
      const days = (Date.now() - new Date(c.last_called_at).getTime()) / (1000 * 60 * 60 * 24);
      if (c.last_call_result_code === 'NO_ANSWER' && days < 2) {
        reasons.push(`前回 NO_ANSWER から ${days.toFixed(1)}日 (2日未満のため Tier 4 で除外)`);
      }
      if (c.last_call_result_code === 'NG' && days < 90) {
        reasons.push(`前回 NG から ${days.toFixed(1)}日 (3ヶ月未満のため Tier 5 で除外)`);
      }
      if (c.last_call_result_code === 'NG' && c.last_call_user_id === userId) {
        reasons.push('前回 NG したのが自分のため Tier 5 で除外 (別オペレーターのみ可)');
      }
    }

    return ApiResponse.success(res, {
      companyId,
      summary: reasons.length === 0
        ? 'ピックアップ条件はすべて OK。表示されないとしたら自動モードのスコア順位の問題やキャッシュの可能性。「シャッフル」ボタンで再評価してみてください。'
        : `${reasons.length}個の除外条件に該当`,
      reasons,
      ok,
      company: c,
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
  getIndustryRegions,
  unlockAllForSelf,
  lockCallTarget,
  unlockCallTarget,
  diagnoseCompanyPickup,
  diagnoseCompanyCounts,
  diagnoseIndustryCounts,
  recomputeIndustryCategory,
  diagnosePrefecture,
  diagnoseCallList,
  getCompanyActions,
  createCompanyAction,
  updateCompanyAction,
  deleteCompanyAction,
  invalidateCallListCache,
};
