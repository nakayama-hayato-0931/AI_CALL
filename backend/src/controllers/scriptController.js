/**
 * スクリプトコントローラー
 * アウト返し・Q&A管理
 */
const pool = require('../../config/database');
const ApiResponse = require('../utils/apiResponse');
const logger = require('../utils/logger');

/**
 * GET /api/scripts?type=&search=&industry=
 * オペレーター用 — approved のみ
 */
const getApprovedScripts = async (req, res, next) => {
  try {
    const { type, search, industry } = req.query;
    let sql = 'SELECT id, type, category, industry, trigger_text, response_text, sort_order FROM script_items WHERE status = "approved"';
    const params = [];

    if (type) {
      sql += ' AND type = ?';
      params.push(type);
    }
    if (industry) {
      sql += ' AND (industry IS NULL OR industry = "" OR industry = ?)';
      params.push(industry);
    }
    if (search) {
      sql += ' AND (trigger_text LIKE ? OR response_text LIKE ?)';
      params.push(`%${search}%`, `%${search}%`);
    }

    sql += ' ORDER BY type, sort_order, id';
    const [rows] = await pool.query(sql, params);
    return ApiResponse.success(res, rows);
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/admin/scripts?type=&status=&page=&limit=
 * 管理者用 — 全ステータス
 */
const getScripts = async (req, res, next) => {
  try {
    const { type, status, page = 1, limit = 50 } = req.query;
    let countSql = 'SELECT COUNT(*) as total FROM script_items WHERE 1=1';
    let sql = 'SELECT * FROM script_items WHERE 1=1';
    const params = [];

    if (type) {
      countSql += ' AND type = ?';
      sql += ' AND type = ?';
      params.push(type);
    }
    if (status) {
      countSql += ' AND status = ?';
      sql += ' AND status = ?';
      params.push(status);
    }

    const [countRows] = await pool.query(countSql, params);
    const total = countRows[0].total;

    sql += ' ORDER BY status = "pending" DESC, type, sort_order, id';
    const offset = (Number(page) - 1) * Number(limit);
    sql += ' LIMIT ? OFFSET ?';
    const [rows] = await pool.query(sql, [...params, Number(limit), offset]);

    return ApiResponse.success(res, { items: rows, total, page: Number(page), limit: Number(limit) });
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/admin/scripts
 * 手動追加
 */
const createScript = async (req, res, next) => {
  try {
    const { type, category, industry, trigger_text, response_text, status } = req.body;
    if (!type || !trigger_text || !response_text) {
      return ApiResponse.badRequest(res, 'タイプ・質問/反論・回答は必須です');
    }

    const insertStatus = status || 'approved';
    const [result] = await pool.execute(
      'INSERT INTO script_items (type, category, industry, trigger_text, response_text, status, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [type, category || null, industry || null, trigger_text, response_text, insertStatus, req.user.id]
    );

    logger.info(`スクリプト追加: ID ${result.insertId} type=${type} by user ${req.user.id}`);
    return ApiResponse.success(res, { id: result.insertId }, 'スクリプトを追加しました');
  } catch (err) {
    next(err);
  }
};

/**
 * PUT /api/admin/scripts/:id
 * 編集
 */
const updateScript = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { type, category, industry, trigger_text, response_text, sort_order } = req.body;

    const [result] = await pool.execute(
      'UPDATE script_items SET type = COALESCE(?, type), category = ?, industry = ?, trigger_text = COALESCE(?, trigger_text), response_text = COALESCE(?, response_text), sort_order = COALESCE(?, sort_order) WHERE id = ?',
      [type || null, category !== undefined ? category : null, industry !== undefined ? industry : null, trigger_text || null, response_text || null, sort_order !== undefined ? sort_order : null, id]
    );

    if (result.affectedRows === 0) {
      return ApiResponse.notFound(res, 'スクリプトが見つかりません');
    }

    logger.info(`スクリプト更新: ID ${id} by user ${req.user.id}`);
    return ApiResponse.success(res, null, 'スクリプトを更新しました');
  } catch (err) {
    next(err);
  }
};

/**
 * PUT /api/admin/scripts/:id/approve
 */
const approveScript = async (req, res, next) => {
  try {
    const { id } = req.params;
    const [result] = await pool.execute(
      'UPDATE script_items SET status = "approved", approved_by = ?, approved_at = NOW() WHERE id = ? AND status = "pending"',
      [req.user.id, id]
    );

    if (result.affectedRows === 0) {
      return ApiResponse.notFound(res, '承認待ちスクリプトが見つかりません');
    }

    logger.info(`スクリプト承認: ID ${id} by user ${req.user.id}`);
    return ApiResponse.success(res, null, 'スクリプトを承認しました');
  } catch (err) {
    next(err);
  }
};

/**
 * PUT /api/admin/scripts/:id/reject
 */
const rejectScript = async (req, res, next) => {
  try {
    const { id } = req.params;
    const [result] = await pool.execute(
      'UPDATE script_items SET status = "rejected" WHERE id = ? AND status = "pending"',
      [id]
    );

    if (result.affectedRows === 0) {
      return ApiResponse.notFound(res, '承認待ちスクリプトが見つかりません');
    }

    logger.info(`スクリプト却下: ID ${id} by user ${req.user.id}`);
    return ApiResponse.success(res, null, 'スクリプトを却下しました');
  } catch (err) {
    next(err);
  }
};

/**
 * DELETE /api/admin/scripts/:id
 */
const deleteScript = async (req, res, next) => {
  try {
    const { id } = req.params;
    const [result] = await pool.execute('DELETE FROM script_items WHERE id = ?', [id]);

    if (result.affectedRows === 0) {
      return ApiResponse.notFound(res, 'スクリプトが見つかりません');
    }

    logger.info(`スクリプト削除: ID ${id} by user ${req.user.id}`);
    return ApiResponse.success(res, null, 'スクリプトを削除しました');
  } catch (err) {
    next(err);
  }
};

module.exports = {
  getApprovedScripts,
  getScripts,
  createScript,
  updateScript,
  approveScript,
  rejectScript,
  deleteScript,
};
