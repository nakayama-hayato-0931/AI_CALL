/**
 * 管理者コントローラー
 * ユーザー管理・オペレーター成績・架電リスト管理
 */
const bcrypt = require('bcrypt');
const pool = require('../../config/database');
const ApiResponse = require('../utils/apiResponse');
const logger = require('../utils/logger');
const { getDateRange } = require('../utils/periodHelper');

// ==================== ユーザー管理 ====================

/**
 * GET /api/admin/users
 * 全ユーザー一覧
 */
const getUsers = async (req, res, next) => {
  try {
    const [rows] = await pool.query(
      'SELECT id, name, email, role, is_active, is_test_account, operator_level, commute_type, commute_teiki_monthly, commute_daily_amount, target_work_hours, target_calls_per_h, target_effective_per_h, target_person_per_h, target_project_hours, created_at, updated_at FROM users ORDER BY created_at DESC'
    );
    return ApiResponse.success(res, rows);
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/admin/users
 * ユーザー追加
 */
const createUser = async (req, res, next) => {
  try {
    const { name, email, password, role } = req.body;

    const userRole = role || 'operator';
    const isOperator = userRole === 'operator' || userRole === 'intern';

    if (!name || !password) {
      return ApiResponse.badRequest(res, '名前・パスワードは必須です');
    }
    if (!isOperator && !email) {
      return ApiResponse.badRequest(res, 'オペレーター以外はメールアドレスが必須です');
    }

    const validRoles = ['admin', 'manager', 'operator', 'sales', 'consultant', 'intern'];
    if (role && !validRoles.includes(role)) {
      return ApiResponse.badRequest(res, `ロールは ${validRoles.join(', ')} のいずれかを指定してください`);
    }

    // メール重複チェック（メールが入力されている場合のみ）
    if (email) {
      const [existing] = await pool.execute(
        'SELECT id FROM users WHERE email = ?',
        [email]
      );
      if (existing.length > 0) {
        return ApiResponse.badRequest(res, 'このメールアドレスは既に登録されています');
      }
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const [result] = await pool.execute(
      'INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)',
      [name, email || null, passwordHash, userRole]
    );

    const newUserId = result.insertId;
    logger.info(`ユーザー作成: ${name} (role: ${userRole})`);

    // オペレーターなら研修進捗を初期化
    if (userRole === 'operator') {
      const trainingSteps = [
        [1, '座学研修/サービス理解'],
        [2, 'トークスクリプト読み込み'],
        [3, 'ロープレ'],
        [4, 'コールシステム説明'],
        [5, '架電開始'],
        [6, '改善点フィードバック'],
        [7, '面談実施'],
      ];
      for (const [stepNum, stepName] of trainingSteps) {
        try {
          await pool.execute(
            'INSERT IGNORE INTO operator_training (user_id, step_number, step_name) VALUES (?, ?, ?)',
            [newUserId, stepNum, stepName]
          );
        } catch (e) { /* skip if table doesn't exist yet */ }
      }
    }

    return ApiResponse.created(res, {
      id: newUserId,
      name,
      email: email || null,
      role: userRole,
      is_active: 1,
    }, 'ユーザーを作成しました');
  } catch (err) {
    next(err);
  }
};

/**
 * PUT /api/admin/users/:id
 * ユーザー編集
 */
const updateUser = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { name, email, password, role, is_active, is_test_account, operator_level, commute_type, commute_teiki_monthly, commute_daily_amount, target_work_hours, target_calls_per_h, target_effective_per_h, target_person_per_h, target_project_hours } = req.body;

    const [existing] = await pool.execute('SELECT id FROM users WHERE id = ?', [id]);
    if (existing.length === 0) {
      return ApiResponse.notFound(res, 'ユーザーが見つかりません');
    }

    // メール重複チェック（自分以外、空でない場合のみ）
    if (email) {
      const [dup] = await pool.execute(
        'SELECT id FROM users WHERE email = ? AND id != ?',
        [email, id]
      );
      if (dup.length > 0) {
        return ApiResponse.badRequest(res, 'このメールアドレスは既に使用されています');
      }
    }

    // email空文字の場合はNULLに変換
    if (email !== undefined && !email) {
      const [userRow] = await pool.execute('SELECT role FROM users WHERE id = ?', [id]);
      if (userRow.length > 0 && !['operator', 'intern'].includes(userRow[0].role)) {
        return ApiResponse.badRequest(res, 'オペレーター以外はメールアドレスが必須です');
      }
    }

    const updates = [];
    const params = [];

    if (name !== undefined) { updates.push('name = ?'); params.push(name); }
    if (email !== undefined) { updates.push('email = ?'); params.push(email || null); }
    if (role !== undefined) { updates.push('role = ?'); params.push(role); }
    if (is_active !== undefined) { updates.push('is_active = ?'); params.push(is_active); }
    if (is_test_account !== undefined) { updates.push('is_test_account = ?'); params.push(is_test_account ? 1 : 0); }
    if (operator_level !== undefined) { updates.push('operator_level = ?'); params.push(operator_level || null); }
    if (commute_type !== undefined) { updates.push('commute_type = ?'); params.push(commute_type || null); }
    if (commute_teiki_monthly !== undefined) { updates.push('commute_teiki_monthly = ?'); params.push(commute_teiki_monthly != null ? Number(commute_teiki_monthly) : null); }
    if (commute_daily_amount !== undefined) { updates.push('commute_daily_amount = ?'); params.push(commute_daily_amount != null ? Number(commute_daily_amount) : null); }
    if (target_work_hours !== undefined) { updates.push('target_work_hours = ?'); params.push(target_work_hours != null && target_work_hours !== '' ? Number(target_work_hours) : null); }
    if (target_calls_per_h !== undefined) { updates.push('target_calls_per_h = ?'); params.push(target_calls_per_h != null && target_calls_per_h !== '' ? Number(target_calls_per_h) : null); }
    if (target_effective_per_h !== undefined) { updates.push('target_effective_per_h = ?'); params.push(target_effective_per_h != null && target_effective_per_h !== '' ? Number(target_effective_per_h) : null); }
    if (target_person_per_h !== undefined) { updates.push('target_person_per_h = ?'); params.push(target_person_per_h != null && target_person_per_h !== '' ? Number(target_person_per_h) : null); }
    if (target_project_hours !== undefined) { updates.push('target_project_hours = ?'); params.push(target_project_hours != null && target_project_hours !== '' ? Number(target_project_hours) : null); }

    if (password) {
      const passwordHash = await bcrypt.hash(password, 10);
      updates.push('password_hash = ?');
      params.push(passwordHash);
    }

    if (updates.length === 0) {
      return ApiResponse.badRequest(res, '更新する項目がありません');
    }

    params.push(id);
    await pool.execute(
      `UPDATE users SET ${updates.join(', ')} WHERE id = ?`,
      params
    );

    logger.info(`ユーザー更新: ID ${id}`);
    return ApiResponse.success(res, null, 'ユーザーを更新しました');
  } catch (err) {
    next(err);
  }
};

/**
 * DELETE /api/admin/users/:id
 * ユーザー完全削除（関連データも削除）
 */
const deleteUser = async (req, res, next) => {
  try {
    const { id } = req.params;

    if (req.user.id === parseInt(id)) {
      return ApiResponse.badRequest(res, '自分自身を削除することはできません');
    }

    const [existing] = await pool.execute('SELECT id, name FROM users WHERE id = ?', [id]);
    if (existing.length === 0) {
      return ApiResponse.notFound(res, 'ユーザーが見つかりません');
    }

    const userName = existing[0].name;

    // トランザクション内で外部キーチェックを無効化して削除
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      await conn.execute('SET FOREIGN_KEY_CHECKS = 0');

      // 関連データを安全に削除
      const tables = [
        ['ai_evaluations', 'user_id'],
        ['status_sheets', 'user_id'],
        ['status_sheets', 'created_by'],
        ['work_hours', 'user_id'],
        ['recall_tasks', 'user_id'],
        ['feature_requests', 'user_id'],
        ['cost_records', 'user_id'],
        ['evaluation_batch_logs', 'user_id'],
        ['priority_assignments', 'user_id'],
      ];
      for (const [table, col] of tables) {
        try { await conn.execute(`DELETE FROM ${table} WHERE ${col} = ?`, [id]); } catch (e) { /* skip */ }
      }
      // calls, projectsはuser参照をNULLに
      try { await conn.execute('UPDATE calls SET user_id = NULL WHERE user_id = ?', [id]); } catch (e) { /* skip */ }
      try { await conn.execute('UPDATE projects SET owner_user_id = NULL WHERE owner_user_id = ?', [id]); } catch (e) { /* skip */ }
      try { await conn.execute('UPDATE companies SET locked_by_user_id = NULL WHERE locked_by_user_id = ?', [id]); } catch (e) { /* skip */ }
      // ユーザー本体を削除
      await conn.execute('DELETE FROM users WHERE id = ?', [id]);

      await conn.execute('SET FOREIGN_KEY_CHECKS = 1');
      await conn.commit();
    } catch (e) {
      await conn.execute('SET FOREIGN_KEY_CHECKS = 1');
      await conn.rollback();
      throw e;
    } finally {
      conn.release();
    }

    logger.info(`ユーザー完全削除: ID ${id} (${userName})`);
    return ApiResponse.success(res, null, `${userName}を完全に削除しました`);
  } catch (err) {
    next(err);
  }
};

// ==================== オペレーター成績 ====================

/**
 * GET /api/admin/performance
 * 全オペレーター成績
 * Query: period=daily|weekly|monthly|cumulative, date=YYYY-MM-DD
 */
const getAllOperatorPerformance = async (req, res, next) => {
  try {
    const { period = 'daily', date, call_type } = req.query;
    let dateFrom, dateTo;
    if (period === 'cumulative' && req.query.date_from && req.query.date_to) {
      dateFrom = req.query.date_from;
      dateTo = req.query.date_to;
    } else {
      const range = getDateRange(period, date || new Date().toISOString().slice(0, 10));
      if (!range) {
        return ApiResponse.badRequest(res, 'periodはdaily, weekly, monthly, cumulativeのいずれかです');
      }
      dateFrom = range.dateFrom;
      dateTo = range.dateTo;
    }
    const targetRoles = call_type === 'sales' ? "'sales'" : "'operator','intern'";
    const callTypeFilter = call_type === 'sales' ? "AND c.call_type = 'sales'" : "AND c.call_type = 'operator'";

    const [rows] = await pool.query(
      `SELECT
        u.id as user_id, u.name, u.role, u.operator_level,
        COUNT(DISTINCT c.id) as total_calls,
        CAST(SUM(CASE WHEN c.is_effective_connection = 1 THEN 1 ELSE 0 END) AS SIGNED) as effective_connections,
        CAST(SUM(CASE WHEN c.is_person_in_charge = 1 THEN 1 ELSE 0 END) AS SIGNED) as person_connections,
        CAST(SUM(CASE WHEN c.result_code = 'PROJECT' THEN 1 ELSE 0 END) AS SIGNED) as projects,
        CAST(SUM(CASE WHEN c.result_code = 'RECALL' THEN 1 ELSE 0 END) AS SIGNED) as recall_gained,
        COALESCE(ROUND(AVG(ae.overall_score), 1), 0) as avg_ai_score,
        COALESCE(ROUND(AVG(ae.opening_score), 1), 0) as avg_opening,
        COALESCE(ROUND(AVG(ae.clarity_score), 1), 0) as avg_clarity,
        COALESCE(ROUND(AVG(ae.hearing_score), 1), 0) as avg_hearing,
        COALESCE(ROUND(AVG(ae.rebuttal_score), 1), 0) as avg_rebuttal,
        COALESCE(ROUND(AVG(ae.closing_score), 1), 0) as avg_closing
      FROM users u
      LEFT JOIN calls c ON c.user_id = u.id AND DATE(c.call_started_at) BETWEEN ? AND ? AND c.result_code != 'SKIP' ${callTypeFilter}
      LEFT JOIN ai_evaluations ae ON ae.call_id = c.id
      WHERE u.role IN (${targetRoles}) AND u.is_active = 1 AND u.is_test_account = 0
      GROUP BY u.id, u.name, u.role
      ORDER BY u.id ASC`,
      [dateFrom, dateTo]
    );

    // リコール消化数と稼働時間を各オペレーターに追加
    for (const op of rows) {
      try {
        const [recallRows] = await pool.query(
          `SELECT COUNT(*) as cnt FROM recall_tasks WHERE user_id = ? AND status = 'completed' AND DATE(updated_at) BETWEEN ? AND ?`,
          [op.user_id, dateFrom, dateTo]
        );
        op.recall_done = recallRows[0]?.cnt || 0;
      } catch (e) {
        op.recall_done = 0;
      }

      try {
        const [whRows] = await pool.query(
          `SELECT SUM(
             TIMESTAMPDIFF(MINUTE, STR_TO_DATE(start_time, '%H:%i'), STR_TO_DATE(end_time, '%H:%i'))
             - COALESCE(break_minutes, 0)
           ) as total_minutes
           FROM work_hours
           WHERE user_id = ? AND date BETWEEN ? AND ?`,
          [op.user_id, dateFrom, dateTo]
        );
        op.work_minutes = whRows[0]?.total_minutes || 0;
      } catch (e) {
        op.work_minutes = 0;
      }

      // 案件数: projectsテーブルから直接カウント（手動追加案件も含む）
      try {
        const projCTFilter = call_type === 'sales' ? "AND p.call_type = 'sales'" : "AND p.call_type = 'operator'";
        const [projRows] = await pool.query(
          `SELECT COUNT(*) as cnt FROM projects p
           WHERE p.owner_user_id = ? AND p.is_legacy = 0 AND p.is_prospect = 0
             AND DATE(p.created_at) BETWEEN ? AND ? ${projCTFilter}`,
          [op.user_id, dateFrom, dateTo]
        );
        op.projects = Number(projRows[0]?.cnt) || 0;
      } catch (e) { /* keep calls-based count */ }

      // KPI補正値: 日別は上書き、月別/週別/累計は集計（合計）として加算
      try {
        const [adjRows] = await pool.query(
          'SELECT field, date, value FROM kpi_adjustments WHERE user_id = ? AND date BETWEEN ? AND ?',
          [op.user_id, dateFrom, dateTo]
        );
        const fieldMap = {
          'call_count': 'total_calls',
          'recall_gained': 'recall_gained',
          'recall_done': 'recall_done',
          'effective_count': 'effective_connections',
          'person_count': 'person_connections',
          'project_count': 'projects',
        };
        if (period === 'daily') {
          // 日別: 単一日の値をそのまま置き換え
          for (const adj of adjRows) {
            const key = fieldMap[adj.field];
            if (key) op[key] = Number(adj.value);
          }
        } else {
          // 月別/週別/累計: 補正がある日については補正値を使い、その他は実績の合計を使う
          // 実装: 各補正レコードについて、その日の実績値を引いて補正値を加算する
          for (const adj of adjRows) {
            const key = fieldMap[adj.field];
            if (!key) continue;
            // その日の実績値を取得
            let actualForDay = 0;
            try {
              if (adj.field === 'recall_done') {
                const [r] = await pool.query(
                  `SELECT COUNT(*) as cnt FROM recall_tasks WHERE user_id = ? AND status = 'completed' AND DATE(updated_at) = ?`,
                  [op.user_id, adj.date]
                );
                actualForDay = Number(r[0]?.cnt) || 0;
              } else if (adj.field === 'project_count') {
                const projCTFilter = call_type === 'sales' ? "AND p.call_type = 'sales'" : "AND p.call_type = 'operator'";
                const [r] = await pool.query(
                  `SELECT COUNT(*) as cnt FROM projects p
                   WHERE p.owner_user_id = ? AND p.is_legacy = 0 AND p.is_prospect = 0
                     AND DATE(p.created_at) = ? ${projCTFilter}`,
                  [op.user_id, adj.date]
                );
                actualForDay = Number(r[0]?.cnt) || 0;
              } else {
                // calls系
                const colMap = {
                  'call_count': 'COUNT(*)',
                  'effective_count': "SUM(CASE WHEN is_effective_connection = 1 THEN 1 ELSE 0 END)",
                  'person_count': "SUM(CASE WHEN is_person_in_charge = 1 THEN 1 ELSE 0 END)",
                  'recall_gained': "SUM(CASE WHEN result_code = 'RECALL' THEN 1 ELSE 0 END)",
                };
                const expr = colMap[adj.field];
                if (expr) {
                  const ctf = call_type === 'sales' ? "AND call_type = 'sales'" : "AND call_type = 'operator'";
                  const [r] = await pool.query(
                    `SELECT ${expr} as v FROM calls WHERE user_id = ? AND DATE(call_started_at) = ? AND result_code != 'SKIP' ${ctf}`,
                    [op.user_id, adj.date]
                  );
                  actualForDay = Number(r[0]?.v) || 0;
                }
              }
            } catch (e) { /* ignore */ }
            op[key] = (Number(op[key]) || 0) - actualForDay + Number(adj.value);
          }
        }
      } catch (e) { /* ignore */ }
    }

    return ApiResponse.success(res, {
      period,
      dateFrom,
      dateTo,
      operators: rows,
    });
  } catch (err) {
    next(err);
  }
};

// ==================== 架電リスト管理 ====================

/**
 * GET /api/admin/companies
 * 架電リスト一覧（割り当て状況含む）
 */
const getCompanies = async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, parseInt(req.query.limit) || 20);
    const offset = (page - 1) * limit;
    const { search, industry } = req.query;

    let whereClauses = ['co.exclusion_flag = 0'];
    let params = [];

    if (search) {
      whereClauses.push('(co.company_name LIKE ? OR co.phone_number LIKE ?)');
      params.push(`%${search}%`, `%${search}%`);
    }
    if (industry) {
      whereClauses.push('co.industry = ?');
      params.push(industry);
    }

    const whereStr = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

    const [countRows] = await pool.query(
      `SELECT COUNT(*) as total FROM companies co ${whereStr}`,
      params
    );

    const [rows] = await pool.query(
      `SELECT co.*,
        GROUP_CONCAT(DISTINCT CONCAT(u.id, ':', u.name) SEPARATOR ',') as assigned_operators
      FROM companies co
      LEFT JOIN company_assignments ca ON ca.company_id = co.id
      LEFT JOIN users u ON ca.user_id = u.id AND u.is_active = 1
      ${whereStr}
      GROUP BY co.id
      ORDER BY co.created_at DESC
      LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    // パース
    const companies = rows.map(r => ({
      ...r,
      assigned_operators: r.assigned_operators
        ? r.assigned_operators.split(',').map(s => {
            const [id, name] = s.split(':');
            return { id: parseInt(id), name };
          })
        : [],
    }));

    return ApiResponse.success(res, {
      companies,
      pagination: {
        page,
        limit,
        total: countRows[0].total,
        totalPages: Math.ceil(countRows[0].total / limit),
      },
    });
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/admin/companies/assign
 * 企業をOPに割り当て
 */
const assignCompany = async (req, res, next) => {
  try {
    const { company_id, user_id } = req.body;

    if (!company_id || !user_id) {
      return ApiResponse.badRequest(res, '企業IDとユーザーIDは必須です');
    }

    // ユーザーが存在しoperatorか確認
    const [userRows] = await pool.execute(
      'SELECT id, role FROM users WHERE id = ? AND is_active = 1',
      [user_id]
    );
    if (userRows.length === 0) {
      return ApiResponse.notFound(res, 'ユーザーが見つかりません');
    }

    try {
      await pool.execute(
        'INSERT INTO company_assignments (company_id, user_id, assigned_by) VALUES (?, ?, ?)',
        [company_id, user_id, req.user.id]
      );
    } catch (err) {
      if (err.code === 'ER_DUP_ENTRY') {
        return ApiResponse.badRequest(res, 'この企業は既にこのオペレーターに割り当て済みです');
      }
      throw err;
    }

    logger.info(`企業割り当て: company=${company_id} → user=${user_id}`);
    return ApiResponse.created(res, null, '割り当てを追加しました');
  } catch (err) {
    next(err);
  }
};

/**
 * DELETE /api/admin/companies/:companyId/assign/:userId
 * 割り当て解除（企業IDとユーザーIDのペアで削除）
 */
const unassignCompany = async (req, res, next) => {
  try {
    const { companyId, userId } = req.params;

    const [result] = await pool.execute(
      'DELETE FROM company_assignments WHERE company_id = ? AND user_id = ?',
      [companyId, userId]
    );

    if (result.affectedRows === 0) {
      return ApiResponse.notFound(res, '割り当てが見つかりません');
    }

    logger.info(`企業割り当て解除: company=${companyId}, user=${userId}`);
    return ApiResponse.success(res, null, '割り当てを解除しました');
  } catch (err) {
    next(err);
  }
};

// ==================== 業種×地域ルール ====================

/**
 * GET /api/admin/industry-region-rules
 * ルール一覧 + 選択肢（業種・地域のDISTINCT）
 */
const getIndustryRegionRules = async (req, res, next) => {
  try {
    const [rules] = await pool.query(
      'SELECT id, industry_name, region, created_at FROM industry_region_rules ORDER BY industry_name, region'
    );
    // 企業テーブルから業種・地域の選択肢を取得
    const [industries] = await pool.query(
      "SELECT DISTINCT industry FROM companies WHERE industry IS NOT NULL AND industry != '' ORDER BY industry"
    );
    const [regions] = await pool.query(
      "SELECT DISTINCT region FROM companies WHERE region IS NOT NULL AND region != '' ORDER BY region"
    );

    return ApiResponse.success(res, {
      rules,
      industries: industries.map(r => r.industry),
      regions: regions.map(r => r.region),
    });
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/admin/industry-region-rules
 * ルール追加
 */
const addIndustryRegionRule = async (req, res, next) => {
  try {
    const { industry_name, region } = req.body;
    if (!industry_name || !region) {
      return ApiResponse.badRequest(res, '業種と地域は必須です');
    }
    try {
      const [result] = await pool.execute(
        'INSERT INTO industry_region_rules (industry_name, region) VALUES (?, ?)',
        [industry_name, region]
      );
      logger.info(`エリアルール追加: ${industry_name} → ${region}`);
      return ApiResponse.created(res, { id: result.insertId, industry_name, region }, 'ルールを追加しました');
    } catch (err) {
      if (err.code === 'ER_DUP_ENTRY') {
        return ApiResponse.badRequest(res, 'このルールは既に登録されています');
      }
      throw err;
    }
  } catch (err) {
    next(err);
  }
};

/**
 * DELETE /api/admin/industry-region-rules/:id
 * ルール削除
 */
const deleteIndustryRegionRule = async (req, res, next) => {
  try {
    const { id } = req.params;
    const [result] = await pool.execute('DELETE FROM industry_region_rules WHERE id = ?', [id]);
    if (result.affectedRows === 0) {
      return ApiResponse.notFound(res, 'ルールが見つかりません');
    }
    logger.info(`エリアルール削除: ID ${id}`);
    return ApiResponse.success(res, null, 'ルールを削除しました');
  } catch (err) {
    next(err);
  }
};

// ==================== 業種別NGワード ====================

/**
 * GET /api/admin/exclude-words
 * NGワード一覧
 */
const getExcludeWords = async (req, res, next) => {
  try {
    const [rows] = await pool.query(
      'SELECT id, industry_name, keyword, created_at FROM industry_exclude_words ORDER BY industry_name, keyword'
    );
    return ApiResponse.success(res, rows);
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/admin/exclude-words
 * NGワード追加
 */
const addExcludeWord = async (req, res, next) => {
  try {
    const { keyword } = req.body;
    const industry_name = '*'; // 全業種共通
    if (!keyword) {
      return ApiResponse.badRequest(res, 'NGワードは必須です');
    }
    try {
      const [result] = await pool.execute(
        'INSERT INTO industry_exclude_words (industry_name, keyword) VALUES (?, ?)',
        [industry_name, keyword]
      );
      logger.info(`NGワード追加: ${industry_name} → ${keyword}`);
      return ApiResponse.created(res, { id: result.insertId, industry_name, keyword }, 'NGワードを追加しました');
    } catch (err) {
      if (err.code === 'ER_DUP_ENTRY') {
        return ApiResponse.badRequest(res, 'このNGワードは既に登録されています');
      }
      throw err;
    }
  } catch (err) {
    next(err);
  }
};

/**
 * DELETE /api/admin/exclude-words/:id
 * NGワード削除
 */
const deleteExcludeWord = async (req, res, next) => {
  try {
    const { id } = req.params;
    const [result] = await pool.execute('DELETE FROM industry_exclude_words WHERE id = ?', [id]);
    if (result.affectedRows === 0) {
      return ApiResponse.notFound(res, 'NGワードが見つかりません');
    }
    logger.info(`NGワード削除: ID ${id}`);
    return ApiResponse.success(res, null, 'NGワードを削除しました');
  } catch (err) {
    next(err);
  }
};

// ==================== 架電時間ルール ====================

/**
 * GET /api/admin/time-rules
 * 業種別ゴールデンタイムルール一覧
 */
const getTimeRules = async (req, res, next) => {
  try {
    const [rows] = await pool.query(
      'SELECT * FROM industry_time_rules ORDER BY industry_name, start_time'
    );
    return ApiResponse.success(res, rows);
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/admin/time-rules
 * ゴールデンタイムルール追加
 */
const addTimeRule = async (req, res, next) => {
  try {
    const { industry_name, start_time, end_time, priority_weight } = req.body;
    if (!industry_name || !start_time || !end_time) {
      return ApiResponse.badRequest(res, '業種・開始時間・終了時間は必須です');
    }
    const [result] = await pool.execute(
      'INSERT INTO industry_time_rules (industry_name, start_time, end_time, priority_weight) VALUES (?, ?, ?, ?)',
      [industry_name, start_time, end_time, priority_weight || 10]
    );
    logger.info(`架電時間ルール追加: ${industry_name} ${start_time}-${end_time} (weight:${priority_weight})`);
    return ApiResponse.success(res, { id: result.insertId }, '架電時間ルールを追加しました');
  } catch (err) {
    next(err);
  }
};

/**
 * PUT /api/admin/time-rules/:id
 * ゴールデンタイムルール更新
 */
const updateTimeRule = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { industry_name, start_time, end_time, priority_weight } = req.body;
    if (!industry_name || !start_time || !end_time) {
      return ApiResponse.badRequest(res, '業種・開始時間・終了時間は必須です');
    }
    const [result] = await pool.execute(
      'UPDATE industry_time_rules SET industry_name = ?, start_time = ?, end_time = ?, priority_weight = ? WHERE id = ?',
      [industry_name, start_time, end_time, priority_weight || 10, id]
    );
    if (result.affectedRows === 0) {
      return ApiResponse.notFound(res, 'ルールが見つかりません');
    }
    logger.info(`架電時間ルール更新: ID ${id} → ${industry_name} ${start_time}-${end_time} (weight: ${priority_weight})`);
    return ApiResponse.success(res, null, '架電時間ルールを更新しました');
  } catch (err) {
    next(err);
  }
};

/**
 * DELETE /api/admin/time-rules/:id
 * ゴールデンタイムルール削除
 */
const deleteTimeRule = async (req, res, next) => {
  try {
    const { id } = req.params;
    const [result] = await pool.execute('DELETE FROM industry_time_rules WHERE id = ?', [id]);
    if (result.affectedRows === 0) {
      return ApiResponse.notFound(res, 'ルールが見つかりません');
    }
    logger.info(`架電時間ルール削除: ID ${id}`);
    return ApiResponse.success(res, null, '架電時間ルールを削除しました');
  } catch (err) {
    next(err);
  }
};

// module.exports is at the end of the file after all function definitions

/**
 * GET /api/admin/special-list-batches
 * 特別リストバッチ一覧 + 架電進捗
 */
const getSpecialListBatches = async (req, res, next) => {
  try {
    const [batches] = await pool.query(
      `SELECT b.id, b.name, b.total_count, b.created_at, u.name as created_by_name,
        (SELECT COUNT(*) FROM companies c WHERE c.import_batch_id = b.id) as current_count,
        (SELECT COUNT(DISTINCT cl.company_id) FROM calls cl JOIN companies c2 ON cl.company_id = c2.id
         WHERE c2.import_batch_id = b.id AND cl.result_code IS NOT NULL AND cl.result_code != 'SKIP') as called_count,
        (SELECT COUNT(DISTINCT cl.company_id) FROM calls cl JOIN companies c2 ON cl.company_id = c2.id
         WHERE c2.import_batch_id = b.id AND cl.result_code = 'NO_ANSWER') as no_answer_count,
        (SELECT COUNT(DISTINCT cl.company_id) FROM calls cl JOIN companies c2 ON cl.company_id = c2.id
         WHERE c2.import_batch_id = b.id AND cl.result_code = 'NG') as ng_count,
        (SELECT COUNT(DISTINCT cl.company_id) FROM calls cl JOIN companies c2 ON cl.company_id = c2.id
         WHERE c2.import_batch_id = b.id AND cl.result_code = 'RECALL') as recall_count,
        (SELECT COUNT(DISTINCT cl.company_id) FROM calls cl JOIN companies c2 ON cl.company_id = c2.id
         WHERE c2.import_batch_id = b.id AND cl.result_code = 'INTERESTED') as interested_count,
        (SELECT COUNT(DISTINCT cl.company_id) FROM calls cl JOIN companies c2 ON cl.company_id = c2.id
         WHERE c2.import_batch_id = b.id AND cl.result_code = 'PROJECT') as project_count
       FROM import_batches b
       LEFT JOIN users u ON b.created_by = u.id
       WHERE b.list_type = 'special'
       ORDER BY b.created_at DESC`
    );
    return ApiResponse.success(res, batches);
  } catch (err) { next(err); }
};

/**
 * GET /api/admin/special-list-batches/:id/details
 * バッチ内の全企業 + 架電結果詳細
 */
const getSpecialListBatchDetails = async (req, res, next) => {
  try {
    const { id } = req.params;
    const [companies] = await pool.query(
      `SELECT c.id, c.company_name, c.phone_number, c.industry, c.region,
        (SELECT COUNT(*) FROM calls cl WHERE cl.company_id = c.id AND cl.result_code IS NOT NULL AND cl.result_code != 'SKIP') as call_count,
        (SELECT cl.result_code FROM calls cl WHERE cl.company_id = c.id AND cl.result_code IS NOT NULL ORDER BY cl.call_started_at DESC LIMIT 1) as last_result,
        (SELECT cl.call_started_at FROM calls cl WHERE cl.company_id = c.id AND cl.result_code IS NOT NULL ORDER BY cl.call_started_at DESC LIMIT 1) as last_called_at,
        (SELECT cl.memo FROM calls cl WHERE cl.company_id = c.id AND cl.result_code IS NOT NULL ORDER BY cl.call_started_at DESC LIMIT 1) as last_memo,
        (SELECT u.name FROM calls cl JOIN users u ON cl.user_id = u.id WHERE cl.company_id = c.id AND cl.result_code IS NOT NULL ORDER BY cl.call_started_at DESC LIMIT 1) as last_caller
       FROM companies c
       WHERE c.import_batch_id = ?
       ORDER BY c.id ASC`,
      [id]
    );
    return ApiResponse.success(res, companies);
  } catch (err) { next(err); }
};

/**
 * GET /api/admin/special-list-batches/:id/export
 * CSVエクスポート
 */
const exportSpecialListBatch = async (req, res, next) => {
  try {
    const { id } = req.params;
    const [batch] = await pool.query('SELECT name FROM import_batches WHERE id = ?', [id]);
    const [companies] = await pool.query(
      `SELECT c.company_name, c.phone_number, c.industry, c.region,
        (SELECT COUNT(*) FROM calls cl WHERE cl.company_id = c.id AND cl.result_code IS NOT NULL AND cl.result_code != 'SKIP') as call_count,
        (SELECT cl.result_code FROM calls cl WHERE cl.company_id = c.id AND cl.result_code IS NOT NULL ORDER BY cl.call_started_at DESC LIMIT 1) as last_result,
        (SELECT cl.call_started_at FROM calls cl WHERE cl.company_id = c.id AND cl.result_code IS NOT NULL ORDER BY cl.call_started_at DESC LIMIT 1) as last_called_at,
        (SELECT cl.memo FROM calls cl WHERE cl.company_id = c.id AND cl.result_code IS NOT NULL ORDER BY cl.call_started_at DESC LIMIT 1) as last_memo,
        (SELECT u.name FROM calls cl JOIN users u ON cl.user_id = u.id WHERE cl.company_id = c.id AND cl.result_code IS NOT NULL ORDER BY cl.call_started_at DESC LIMIT 1) as last_caller
       FROM companies c WHERE c.import_batch_id = ? ORDER BY c.id ASC`,
      [id]
    );

    const RESULT_LABELS = { NO_ANSWER: '不通', NG: 'NG', RECALL: 'リコール', INTERESTED: '興味あり', PROJECT: '案件化', SKIP: 'SKIP' };
    const header = '企業名,電話番号,業種,地域,架電回数,最終結果,最終架電日,架電者,メモ\n';
    const rows = companies.map(c =>
      [c.company_name, c.phone_number, c.industry || '', c.region || '', c.call_count,
       RESULT_LABELS[c.last_result] || c.last_result || '未架電', c.last_called_at || '', c.last_caller || '', (c.last_memo || '').replace(/[\n\r,]/g, ' ')
      ].map(v => `"${v}"`).join(',')
    ).join('\n');

    const bom = '\uFEFF';
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent((batch[0]?.name || 'export') + '.csv')}"`);
    res.send(bom + header + rows);
  } catch (err) { next(err); }
};

/**
 * PUT /api/admin/kpi-adjustment
 * KPI補正値を保存（管理者のみ）
 * { user_id, date, field, value }
 * value = 最終的な目標値（差分ではなく絶対値）
 */
const saveKpiAdjustment = async (req, res, next) => {
  try {
    const { user_id, date, field, value } = req.body;
    const validFields = ['call_count', 'recall_gained', 'recall_done', 'effective_count', 'person_count', 'project_count'];
    if (!user_id || !date || !field || !validFields.includes(field)) {
      return ApiResponse.badRequest(res, 'user_id, date, field（有効なフィールド名）は必須です');
    }
    await pool.execute(
      `INSERT INTO kpi_adjustments (user_id, date, field, value, updated_by)
       VALUES (?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE value = VALUES(value), updated_by = VALUES(updated_by)`,
      [user_id, date, field, parseInt(value) || 0, req.user.id]
    );
    logger.info(`KPI補正: user=${user_id}, date=${date}, ${field}=${value}, by=${req.user.id}`);
    return ApiResponse.success(res, null, 'KPIを更新しました');
  } catch (err) { next(err); }
};

/**
 * POST /api/admin/time-rules/ai-suggest
 * AIによるゴールデンタイム自動設定
 * 過去の架電接続データを業種×時間帯で分析し、最適なルールを生成
 */
const aiSuggestTimeRules = async (req, res, next) => {
  try {
    const { apply } = req.body; // true: 即適用, false/undefined: プレビューのみ

    // 過去の架電データを業種×時間帯で集計（直近3ヶ月）
    const [stats] = await pool.query(`
      SELECT
        co.industry,
        HOUR(c.call_started_at) as call_hour,
        COUNT(*) as total_calls,
        SUM(CASE WHEN c.result_code NOT IN ('NO_ANSWER','SKIP') THEN 1 ELSE 0 END) as connected_calls,
        SUM(c.is_effective_connection) as effective_calls,
        SUM(c.is_person_in_charge) as person_in_charge_calls,
        SUM(CASE WHEN c.result_code IN ('INTERESTED','PROJECT') THEN 1 ELSE 0 END) as positive_results
      FROM calls c
      JOIN companies co ON c.company_id = co.id
      WHERE c.call_started_at >= DATE_SUB(NOW(), INTERVAL 3 MONTH)
        AND c.result_code IS NOT NULL
        AND c.result_code != 'SKIP'
        AND co.industry IS NOT NULL
        AND co.industry != ''
      GROUP BY co.industry, HOUR(c.call_started_at)
      HAVING total_calls >= 3
      ORDER BY co.industry, call_hour
    `);

    if (stats.length === 0) {
      return ApiResponse.badRequest(res, '分析に必要な架電データが不足しています（直近3ヶ月で業種別3件以上必要）');
    }

    // 業種ごとにデータを整理
    const industryData = {};
    for (const row of stats) {
      if (!industryData[row.industry]) industryData[row.industry] = [];
      industryData[row.industry].push({
        hour: row.call_hour,
        totalCalls: Number(row.total_calls),
        connectedCalls: Number(row.connected_calls),
        effectiveCalls: Number(row.effective_calls),
        personInCharge: Number(row.person_in_charge_calls),
        positiveResults: Number(row.positive_results),
        connectionRate: row.total_calls > 0 ? Math.round(Number(row.connected_calls) / Number(row.total_calls) * 100) : 0,
        effectiveRate: row.total_calls > 0 ? Math.round(Number(row.effective_calls) / Number(row.total_calls) * 100) : 0,
      });
    }

    // AI分析用プロンプト作成
    const Anthropic = require('@anthropic-ai/sdk');
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    const dataText = Object.entries(industryData).map(([industry, hours]) => {
      const hourLines = hours.map(h =>
        `  ${h.hour}時台: 架電${h.totalCalls}件, 接続${h.connectedCalls}件(${h.connectionRate}%), 有効接続${h.effectiveCalls}件(${h.effectiveRate}%), 担当者接続${h.personInCharge}件, 案件化${h.positiveResults}件`
      ).join('\n');
      return `【${industry}】\n${hourLines}`;
    }).join('\n\n');

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 2000,
      temperature: 0.2,
      system: `あなたは法人営業のコールセンター最適化AIです。
業種別・時間帯別の架電データを分析し、ゴールデンタイム（優先的に架電すべき時間帯）を提案してください。

以下の基準で判断してください：
- 接続率（電話がつながる率）が高い時間帯
- 有効接続率（担当者・決裁者につながる率）が高い時間帯
- 案件化率（INTERESTED/PROJECT）が高い時間帯
- データ量が少ない時間帯は信頼度を下げる

各業種について、最大2つの時間帯（ゴールデンタイム）を提案してください。
1時間〜2時間の範囲で設定し、優先度(priority_weight)は5〜30で設定してください。

必ず以下のJSON形式で返答してください：
{
  "rules": [
    {
      "industry_name": "業種名",
      "start_time": "HH:MM",
      "end_time": "HH:MM",
      "priority_weight": 数値,
      "reason": "この時間帯を推奨する理由（1行）"
    }
  ],
  "analysis_summary": "全体分析の要約（2-3行）"
}`,
      messages: [{ role: 'user', content: `以下の架電データを分析し、業種別のゴールデンタイムを提案してください。\n\n${dataText}` }],
    });

    const text = response.content[0].text;
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return ApiResponse.error(res, 'AI分析結果の解析に失敗しました', 500);
    }
    const aiResult = JSON.parse(jsonMatch[0]);

    // 適用モード: 既存ルールを削除して新ルールを挿入
    if (apply) {
      await pool.execute('DELETE FROM industry_time_rules');
      for (const rule of aiResult.rules) {
        await pool.execute(
          'INSERT INTO industry_time_rules (industry_name, start_time, end_time, priority_weight) VALUES (?, ?, ?, ?)',
          [rule.industry_name, rule.start_time, rule.end_time, rule.priority_weight || 10]
        );
      }
      logger.info(`AI ゴールデンタイム自動設定: ${aiResult.rules.length}件のルールを適用 by user=${req.user.id}`);
    }

    return ApiResponse.success(res, {
      rules: aiResult.rules,
      summary: aiResult.analysis_summary,
      rawData: industryData,
      applied: !!apply,
    });
  } catch (err) {
    logger.error(`AI ゴールデンタイム分析エラー: ${err.message}`);
    next(err);
  }
};

module.exports = {
  getUsers, createUser, updateUser, deleteUser,
  getAllOperatorPerformance,
  getCompanies, assignCompany, unassignCompany,
  getIndustryRegionRules, addIndustryRegionRule, deleteIndustryRegionRule,
  getExcludeWords, addExcludeWord, deleteExcludeWord,
  getTimeRules, addTimeRule, updateTimeRule, deleteTimeRule, aiSuggestTimeRules,
  getSpecialListBatches, getSpecialListBatchDetails, exportSpecialListBatch,
  saveKpiAdjustment,
};
