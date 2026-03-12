/**
 * 通話コントローラー
 * 架電開始・終了・結果登録・スキップ・履歴取得
 */
const pool = require('../../config/database');
const ApiResponse = require('../utils/apiResponse');
const logger = require('../utils/logger');

/**
 * POST /api/calls/start
 * 架電開始を記録（ロック所有を検証）
 */
const startCall = async (req, res, next) => {
  try {
    const { company_id } = req.body;
    const userId = req.user.id;

    if (!company_id) {
      return ApiResponse.badRequest(res, '企業IDは必須です');
    }

    // 企業存在チェック + ロック検証
    const [companies] = await pool.execute(
      'SELECT id, locked_by_user_id FROM companies WHERE id = ?',
      [company_id]
    );
    if (companies.length === 0) {
      return ApiResponse.notFound(res, '企業が見つかりません');
    }

    // ロックを保持していることを確認
    if (companies[0].locked_by_user_id !== userId) {
      return res.status(409).json({
        success: false,
        message: 'この企業のロックを先に取得してください',
      });
    }

    const [result] = await pool.execute(
      `INSERT INTO calls (user_id, company_id, call_started_at)
       VALUES (?, ?, NOW())`,
      [userId, company_id]
    );

    // 企業のlast_called_atを更新
    await pool.execute(
      'UPDATE companies SET last_called_at = NOW() WHERE id = ?',
      [company_id]
    );

    logger.info(`架電開始: user=${userId}, company=${company_id}, call=${result.insertId}`);

    return ApiResponse.created(res, { callId: result.insertId }, '架電を開始しました');
  } catch (err) {
    next(err);
  }
};

/**
 * PUT /api/calls/:id/end
 * 通話結果を登録（ロックも解除）
 */
const endCall = async (req, res, next) => {
  const conn = await pool.getConnection();
  try {
    const { id } = req.params;
    const {
      result_code,
      memo,
      recall_at,
      is_effective_connection,
      is_person_in_charge,
    } = req.body;

    // バリデーション（SKIPも許可）
    const validCodes = ['NO_ANSWER', 'NG', 'RECALL', 'INTERESTED', 'PROJECT', 'SKIP'];
    if (!result_code || !validCodes.includes(result_code)) {
      return ApiResponse.badRequest(res, '有効な結果コードを指定してください');
    }
    if (result_code === 'RECALL' && !recall_at) {
      return ApiResponse.badRequest(res, 'リコールの場合はrecall_atが必須です');
    }

    await conn.beginTransaction();

    // 通話レコード更新
    const [updateResult] = await conn.execute(
      `UPDATE calls SET
        call_ended_at = NOW(),
        result_code = ?,
        memo = ?,
        recall_at = ?,
        is_effective_connection = ?,
        is_person_in_charge = ?,
        is_project_created = ?
       WHERE id = ?`,
      [
        result_code,
        memo || null,
        recall_at || null,
        is_effective_connection ? 1 : 0,
        is_person_in_charge ? 1 : 0,
        result_code === 'PROJECT' ? 1 : 0,
        id,
      ]
    );

    if (updateResult.affectedRows === 0) {
      await conn.rollback();
      return ApiResponse.notFound(res, '通話が見つかりません');
    }

    // 通話情報を取得
    const [callRows] = await conn.execute('SELECT * FROM calls WHERE id = ?', [id]);
    const call = callRows[0];

    // RECALL: リコールタスク作成
    if (result_code === 'RECALL') {
      await conn.execute(
        `INSERT INTO recall_tasks (call_id, company_id, user_id, recall_at, status)
         VALUES (?, ?, ?, ?, 'pending')`,
        [id, call.company_id, call.user_id, recall_at]
      );
    }

    // PROJECT: 案件レコード作成
    let projectId = null;
    if (result_code === 'PROJECT') {
      const [projectResult] = await conn.execute(
        `INSERT INTO projects (company_id, created_call_id, owner_user_id, status)
         VALUES (?, ?, ?, 'NEW')`,
        [call.company_id, id, call.user_id]
      );
      projectId = projectResult.insertId;
    }

    // ロック解除
    await conn.execute(
      'UPDATE companies SET locked_by_user_id = NULL, locked_at = NULL WHERE id = ?',
      [call.company_id]
    );

    await conn.commit();

    logger.info(`通話結果登録: call=${id}, result=${result_code}`);

    return ApiResponse.success(res, { callId: parseInt(id), projectId }, '通話結果を保存しました');
  } catch (err) {
    await conn.rollback();
    next(err);
  } finally {
    conn.release();
  }
};

/**
 * POST /api/calls/skip
 * 架電スキップ（通話せずに記録、ロック解除）
 */
const skipCall = async (req, res, next) => {
  const conn = await pool.getConnection();
  try {
    const { company_id, memo } = req.body;
    const userId = req.user.id;

    if (!company_id) {
      return ApiResponse.badRequest(res, '企業IDは必須です');
    }

    await conn.beginTransaction();

    // SKIPの通話レコード作成（開始と終了を同時刻で記録）
    await conn.execute(
      `INSERT INTO calls (user_id, company_id, call_started_at, call_ended_at, result_code, memo)
       VALUES (?, ?, NOW(), NOW(), 'SKIP', ?)`,
      [userId, company_id, memo || null]
    );

    // last_called_atを更新し、ロック解除
    await conn.execute(
      'UPDATE companies SET last_called_at = NOW(), locked_by_user_id = NULL, locked_at = NULL WHERE id = ?',
      [company_id]
    );

    await conn.commit();

    logger.info(`架電スキップ: user=${userId}, company=${company_id}`);

    return ApiResponse.success(res, null, 'スキップしました');
  } catch (err) {
    await conn.rollback();
    next(err);
  } finally {
    conn.release();
  }
};

/**
 * GET /api/calls
 * 通話履歴一覧 (ページネーション)
 */
const getCalls = async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));
    const offset = (page - 1) * limit;
    const { user_id, company_id, result_code, date_from, date_to } = req.query;

    let whereClauses = [];
    let params = [];

    if (user_id) {
      whereClauses.push('c.user_id = ?');
      params.push(user_id);
    }
    if (company_id) {
      whereClauses.push('c.company_id = ?');
      params.push(company_id);
    }
    if (result_code) {
      whereClauses.push('c.result_code = ?');
      params.push(result_code);
    }
    if (date_from) {
      whereClauses.push('c.call_started_at >= ?');
      params.push(date_from);
    }
    if (date_to) {
      whereClauses.push('c.call_started_at <= ?');
      params.push(date_to);
    }

    const whereStr = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

    const [countRows] = await pool.execute(
      `SELECT COUNT(*) as total FROM calls c ${whereStr}`,
      params
    );

    const [rows] = await pool.execute(
      `SELECT c.*, u.name as operator_name, co.company_name, co.phone_number
       FROM calls c
       LEFT JOIN users u ON c.user_id = u.id
       LEFT JOIN companies co ON c.company_id = co.id
       ${whereStr}
       ORDER BY c.call_started_at DESC
       LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    return ApiResponse.success(res, {
      calls: rows,
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

module.exports = { startCall, endCall, skipCall, getCalls };
