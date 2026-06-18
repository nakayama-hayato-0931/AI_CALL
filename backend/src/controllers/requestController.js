/**
 * 申請コントローラー
 * オペレーター→管理者への要望送信・管理
 */
const pool = require('../../config/database');
const ApiResponse = require('../utils/apiResponse');
const logger = require('../utils/logger');

/**
 * POST /api/requests
 * オペレーターが要望を送信
 */
const createRequest = async (req, res, next) => {
  try {
    const { subject, content } = req.body;

    if (!subject || !content) {
      return ApiResponse.badRequest(res, '件名と内容は必須です');
    }

    const [result] = await pool.execute(
      'INSERT INTO operator_requests (user_id, subject, content) VALUES (?, ?, ?)',
      [req.user.id, subject, content]
    );

    logger.info(`申請送信: user=${req.user.id}, subject=${subject}`);

    return ApiResponse.created(res, {
      id: result.insertId,
      subject,
      content,
      status: 'pending',
    }, '申請を送信しました');
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/requests
 * オペレーター自分の要望一覧
 */
const getMyRequests = async (req, res, next) => {
  try {
    const [rows] = await pool.query(
      `SELECT r.*, u.name as replier_name
       FROM operator_requests r
       LEFT JOIN users u ON r.replied_by = u.id
       WHERE r.user_id = ?
       ORDER BY r.created_at DESC`,
      [req.user.id]
    );
    return ApiResponse.success(res, rows);
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/admin/requests
 * 管理者: 全要望一覧
 */
const getAllRequests = async (req, res, next) => {
  try {
    const { status } = req.query;
    let whereClause = '';
    let params = [];

    if (status) {
      whereClause = 'WHERE r.status = ?';
      params.push(status);
    }

    const [rows] = await pool.query(
      `SELECT r.*, u.name as requester_name, u.email as requester_email,
              ru.name as replier_name
       FROM operator_requests r
       LEFT JOIN users u ON r.user_id = u.id
       LEFT JOIN users ru ON r.replied_by = ru.id
       ${whereClause}
       ORDER BY r.created_at DESC`,
      params
    );
    return ApiResponse.success(res, rows);
  } catch (err) {
    next(err);
  }
};

/**
 * PUT /api/admin/requests/:id
 * 管理者: 返信・ステータス更新
 */
const replyToRequest = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { admin_reply, status } = req.body;

    const validStatuses = ['pending', 'reviewed', 'resolved'];
    if (status && !validStatuses.includes(status)) {
      return ApiResponse.badRequest(res, `ステータスは ${validStatuses.join(', ')} のいずれかです`);
    }

    const [existing] = await pool.execute(
      'SELECT id FROM operator_requests WHERE id = ?',
      [id]
    );
    if (existing.length === 0) {
      return ApiResponse.notFound(res, '申請が見つかりません');
    }

    const updates = [];
    const params = [];

    if (admin_reply !== undefined) {
      updates.push('admin_reply = ?');
      params.push(admin_reply);
      updates.push('replied_by = ?');
      params.push(req.user.id);
      updates.push('replied_at = DATE_ADD(UTC_TIMESTAMP(), INTERVAL 9 HOUR)');
    }
    if (status) {
      updates.push('status = ?');
      params.push(status);
    }

    if (updates.length === 0) {
      return ApiResponse.badRequest(res, '更新する項目がありません');
    }

    params.push(id);
    await pool.execute(
      `UPDATE operator_requests SET ${updates.join(', ')} WHERE id = ?`,
      params
    );

    logger.info(`申請返信: request=${id}, by=${req.user.id}`);
    return ApiResponse.success(res, null, '返信しました');
  } catch (err) {
    next(err);
  }
};

module.exports = {
  createRequest,
  getMyRequests,
  getAllRequests,
  replyToRequest,
};
