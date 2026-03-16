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
      'SELECT id, name, email, role, is_active, created_at, updated_at FROM users ORDER BY created_at DESC'
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

    if (!name || !email || !password) {
      return ApiResponse.badRequest(res, '名前・メールアドレス・パスワードは必須です');
    }

    const validRoles = ['admin', 'manager', 'operator', 'sales'];
    if (role && !validRoles.includes(role)) {
      return ApiResponse.badRequest(res, `ロールは ${validRoles.join(', ')} のいずれかを指定してください`);
    }

    // メール重複チェック
    const [existing] = await pool.execute(
      'SELECT id FROM users WHERE email = ?',
      [email]
    );
    if (existing.length > 0) {
      return ApiResponse.badRequest(res, 'このメールアドレスは既に登録されています');
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const [result] = await pool.execute(
      'INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)',
      [name, email, passwordHash, role || 'operator']
    );

    logger.info(`ユーザー作成: ${email} (role: ${role || 'operator'})`);

    return ApiResponse.created(res, {
      id: result.insertId,
      name,
      email,
      role: role || 'operator',
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
    const { name, email, password, role, is_active } = req.body;

    const [existing] = await pool.execute('SELECT id FROM users WHERE id = ?', [id]);
    if (existing.length === 0) {
      return ApiResponse.notFound(res, 'ユーザーが見つかりません');
    }

    // メール重複チェック（自分以外）
    if (email) {
      const [dup] = await pool.execute(
        'SELECT id FROM users WHERE email = ? AND id != ?',
        [email, id]
      );
      if (dup.length > 0) {
        return ApiResponse.badRequest(res, 'このメールアドレスは既に使用されています');
      }
    }

    const updates = [];
    const params = [];

    if (name !== undefined) { updates.push('name = ?'); params.push(name); }
    if (email !== undefined) { updates.push('email = ?'); params.push(email); }
    if (role !== undefined) { updates.push('role = ?'); params.push(role); }
    if (is_active !== undefined) { updates.push('is_active = ?'); params.push(is_active); }

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
 * ユーザーソフト削除
 */
const deleteUser = async (req, res, next) => {
  try {
    const { id } = req.params;

    if (req.user.id === parseInt(id)) {
      return ApiResponse.badRequest(res, '自分自身を削除することはできません');
    }

    const [existing] = await pool.execute('SELECT id FROM users WHERE id = ?', [id]);
    if (existing.length === 0) {
      return ApiResponse.notFound(res, 'ユーザーが見つかりません');
    }

    await pool.execute('UPDATE users SET is_active = 0 WHERE id = ?', [id]);

    logger.info(`ユーザー無効化: ID ${id}`);
    return ApiResponse.success(res, null, 'ユーザーを無効化しました');
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
        u.id as user_id, u.name,
        COUNT(DISTINCT c.id) as total_calls,
        SUM(CASE WHEN c.is_effective_connection = 1 THEN 1 ELSE 0 END) as effective_connections,
        SUM(CASE WHEN c.is_person_in_charge = 1 THEN 1 ELSE 0 END) as person_connections,
        SUM(CASE WHEN c.result_code = 'PROJECT' THEN 1 ELSE 0 END) as projects,
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
};
