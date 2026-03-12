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
 */
const getProjects = async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));
    const offset = (page - 1) * limit;
    const { status, owner_user_id } = req.query;

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

    const whereStr = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

    const [countRows] = await pool.execute(
      `SELECT COUNT(*) as total FROM projects p ${whereStr}`,
      params
    );

    const [rows] = await pool.execute(
      `SELECT p.*, c.company_name, c.phone_number, c.industry,
              u.name as owner_name
       FROM projects p
       JOIN companies c ON p.company_id = c.id
       LEFT JOIN users u ON p.owner_user_id = u.id
       ${whereStr}
       ORDER BY p.created_at DESC
       LIMIT ? OFFSET ?`,
      [...params, limit, offset]
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
      status,
      memo,
    } = req.body;

    // ステータスバリデーション
    const validStatuses = [
      'NEW', 'MAIL_SENT', 'INTERVIEW_SET', 'INTERVIEW_DONE',
      'WAITING_RESULT', 'HIRED', 'LOST',
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
        status = COALESCE(?, status),
        memo = COALESCE(?, memo)
       WHERE id = ?`,
      [
        interview_date || null,
        interview_type || null,
        document_screening || null,
        mail_sent !== undefined ? (mail_sent ? 1 : 0) : null,
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
