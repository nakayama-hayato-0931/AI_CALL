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
      'SELECT id, name, email, role, is_active, operator_level, created_at, updated_at FROM users ORDER BY created_at DESC'
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
    const isOperator = userRole === 'operator';

    if (!name || !password) {
      return ApiResponse.badRequest(res, '名前・パスワードは必須です');
    }
    if (!isOperator && !email) {
      return ApiResponse.badRequest(res, 'オペレーター以外はメールアドレスが必須です');
    }

    const validRoles = ['admin', 'manager', 'operator', 'sales'];
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
    const { name, email, password, role, is_active, operator_level } = req.body;

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
      if (userRow.length > 0 && userRow[0].role !== 'operator') {
        return ApiResponse.badRequest(res, 'オペレーター以外はメールアドレスが必須です');
      }
    }

    const updates = [];
    const params = [];

    if (name !== undefined) { updates.push('name = ?'); params.push(name); }
    if (email !== undefined) { updates.push('email = ?'); params.push(email || null); }
    if (role !== undefined) { updates.push('role = ?'); params.push(role); }
    if (is_active !== undefined) { updates.push('is_active = ?'); params.push(is_active); }
    if (operator_level !== undefined) { updates.push('operator_level = ?'); params.push(operator_level || null); }

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
    const { period = 'daily', date } = req.query;
    const range = getDateRange(period, date || new Date().toISOString().slice(0, 10));
    if (!range) {
      return ApiResponse.badRequest(res, 'periodはdaily, weekly, monthly, cumulativeのいずれかです');
    }
    const { dateFrom, dateTo } = range;

    const [rows] = await pool.query(
      `SELECT
        u.id as user_id, u.name, u.operator_level,
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
      LEFT JOIN calls c ON c.user_id = u.id AND DATE(c.call_started_at) BETWEEN ? AND ? AND c.result_code != 'SKIP'
      LEFT JOIN ai_evaluations ae ON ae.call_id = c.id
      WHERE u.role = 'operator' AND u.is_active = 1
      GROUP BY u.id, u.name
      ORDER BY total_calls DESC`,
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

module.exports = {
  getUsers,
  createUser,
  updateUser,
  deleteUser,
  getAllOperatorPerformance,
  getCompanies,
  assignCompany,
  unassignCompany,
  getIndustryRegionRules,
  addIndustryRegionRule,
  deleteIndustryRegionRule,
  getExcludeWords,
  addExcludeWord,
  deleteExcludeWord,
  getTimeRules,
  addTimeRule,
  updateTimeRule,
  deleteTimeRule,
};
