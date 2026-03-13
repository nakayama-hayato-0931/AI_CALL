/**
 * 案件コントローラー
 * 案件CRUD・ステータス更新
 */
const pool = require('../../config/database');
const ApiResponse = require('../utils/apiResponse');
const logger = require('../utils/logger');

/**
 * GET /api/projects
 * 案件一覧 (最新順・ページネーション)
 * クエリパラメータ: status, owner_user_id, date_from, date_to, sort_by, sort_order
 */
const getProjects = async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));
    const offset = (page - 1) * limit;
    const { status, owner_user_id, date_from, date_to, sort_by, sort_order } = req.query;

    let whereClauses = [];
    let params = [];

    // operatorは自分の案件のみ表示、admin/manager/salesは全件表示可
    if (req.user.role === 'operator') {
      whereClauses.push('p.owner_user_id = ?');
      params.push(req.user.id);
    } else if (owner_user_id) {
      whereClauses.push('p.owner_user_id = ?');
      params.push(owner_user_id);
    }

    if (status) {
      whereClauses.push('p.status = ?');
      params.push(status);
    }

    // 期間フィルタ（獲得日=created_at ベース）
    if (date_from) {
      whereClauses.push('p.created_at >= ?');
      params.push(date_from);
    }
    if (date_to) {
      whereClauses.push('p.created_at <= ?');
      params.push(date_to + ' 23:59:59');
    }

    const whereStr = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

    // ソート
    const allowedSortColumns = ['created_at', 'interview_date', 'status', 'company_name'];
    const sortCol = allowedSortColumns.includes(sort_by) ? sort_by : 'created_at';
    const sortDir = sort_order === 'asc' ? 'ASC' : 'DESC';
    const orderPrefix = sortCol === 'company_name' ? 'c.' : 'p.';
    const orderBy = `${orderPrefix}${sortCol} ${sortDir}`;

    const [countRows] = await pool.execute(
      `SELECT COUNT(*) as total FROM projects p
       JOIN companies c ON p.company_id = c.id
       ${whereStr}`,
      params
    );

    const [rows] = await pool.execute(
      `SELECT p.*, c.company_name, c.phone_number, c.industry,
              u.name as owner_name
       FROM projects p
       JOIN companies c ON p.company_id = c.id
       LEFT JOIN users u ON p.owner_user_id = u.id
       ${whereStr}
       ORDER BY ${orderBy}
       LIMIT ? OFFSET ?`,
      [...params, String(limit), String(offset)]
    );

    return ApiResponse.success(res, {
      projects: rows,
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
 * GET /api/projects/:id
 * 案件詳細
 */
const getProjectById = async (req, res, next) => {
  try {
    const { id } = req.params;

    const [rows] = await pool.execute(
      `SELECT p.*, c.company_name, c.phone_number, c.industry, c.region, c.address,
              u.name as owner_name
       FROM projects p
       JOIN companies c ON p.company_id = c.id
       LEFT JOIN users u ON p.owner_user_id = u.id
       WHERE p.id = ?`,
      [id]
    );

    if (rows.length === 0) {
      return ApiResponse.notFound(res, '案件が見つかりません');
    }

    // 関連通話履歴
    const [callHistory] = await pool.execute(
      `SELECT cl.*, u.name as operator_name
       FROM calls cl
       LEFT JOIN users u ON cl.user_id = u.id
       WHERE cl.company_id = ?
       ORDER BY cl.call_started_at DESC`,
      [rows[0].company_id]
    );

    return ApiResponse.success(res, {
      project: rows[0],
      callHistory,
    });
  } catch (err) {
    next(err);
  }
};

/**
 * PUT /api/projects/:id
 * 案件更新
 */
const updateProject = async (req, res, next) => {
  try {
    // salesは編集不可
    if (req.user.role === 'sales') {
      return ApiResponse.forbidden(res, '営業担当者は案件を編集できません');
    }

    const { id } = req.params;
    const {
      interview_date,
      interview_type,
      document_screening,
      mail_sent,
      mail_replied,
      phone_confirmed,
      job_number,
      status,
      memo,
    } = req.body;

    // ステータスバリデーション
    const validStatuses = [
      'NAITEI', 'FUGOKAKU', 'KEKKA_MACHI', 'MENSETSU_KAKUTEI',
      'BOSHUCHU', 'SHORUI_CHU', 'LOST', 'BARASHI', 'HORYU',
      'SHORUI_OCHI', 'KISON_NASHI', 'MODOSHI', 'MODORI',
    ];
    if (status && !validStatuses.includes(status)) {
      return ApiResponse.badRequest(res, '無効なステータスです');
    }

    const [result] = await pool.execute(
      `UPDATE projects SET
        interview_date = COALESCE(?, interview_date),
        interview_type = COALESCE(?, interview_type),
        document_screening = COALESCE(?, document_screening),
        mail_sent = COALESCE(?, mail_sent),
        mail_replied = COALESCE(?, mail_replied),
        phone_confirmed = COALESCE(?, phone_confirmed),
        job_number = COALESCE(?, job_number),
        status = COALESCE(?, status),
        memo = COALESCE(?, memo)
       WHERE id = ?`,
      [
        interview_date || null,
        interview_type || null,
        document_screening || null,
        mail_sent !== undefined ? (mail_sent ? 1 : 0) : null,
        mail_replied !== undefined ? (mail_replied ? 1 : 0) : null,
        phone_confirmed !== undefined ? (phone_confirmed ? 1 : 0) : null,
        job_number || null,
        status || null,
        memo || null,
        id,
      ]
    );

    if (result.affectedRows === 0) {
      return ApiResponse.notFound(res, '案件が見つかりません');
    }

    logger.info(`案件更新: project=${id}, status=${status}`);

    return ApiResponse.success(res, null, '案件を更新しました');
  } catch (err) {
    next(err);
  }
};

module.exports = { getProjects, getProjectById, updateProject };
