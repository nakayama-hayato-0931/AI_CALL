/**
 * specialListController.js
 *
 * 特別リスト (is_special=1) の独立ページ用 API。
 *
 * 設計:
 *   - ユーザーごとに company_assignments.sort_order を持ち、 並び順を完全制御。
 *   - 1 ページ 100 件のページネーションで 800 件規模を想定。
 *   - 1 ページ内で D&D 並び替え (フロントで sort_order を入れ替えて PUT)。
 *   - operator/sales: 強制的に自分の user_id。
 *   - admin/manager/consultant: ?user_id= で他人の sort_order も操作可能。
 *
 * エンドポイント:
 *   GET  /api/companies/special-list?user_id=&page=1&limit=100
 *   PUT  /api/companies/special-list/reorder    body: { user_id?, items: [{ company_id, sort_order }, ...] }
 *   GET  /api/companies/special-list/users      ユーザー選択ドロップダウン用 (admin/manager/consultant のみ)
 */
const pool = require('../../config/database');
const ApiResponse = require('../utils/apiResponse');
const logger = require('../utils/logger');

const PRIVILEGED_ROLES = ['admin', 'manager', 'consultant'];
const isPrivileged = (role) => PRIVILEGED_ROLES.includes(role);

/**
 * GET /api/companies/special-list
 * 特別リストをユーザーごとに sort_order 順で取得。
 */
const getSpecialList = async (req, res, next) => {
  try {
    const role = req.user.role;
    const reqUserId = isPrivileged(role) && req.query.user_id
      ? parseInt(req.query.user_id, 10)
      : req.user.id;
    if (!reqUserId || isNaN(reqUserId)) {
      return ApiResponse.badRequest(res, 'user_id が不正です');
    }

    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(500, Math.max(1, parseInt(req.query.limit, 10) || 100));
    const offset = (page - 1) * limit;

    // 件数取得
    const [countRows] = await pool.query(
      `SELECT COUNT(*) AS cnt
       FROM company_assignments ca
       JOIN companies c ON c.id = ca.company_id
       WHERE ca.user_id = ? AND c.is_special = 1 AND c.exclusion_flag = 0`,
      [reqUserId]
    );
    const total = countRows[0]?.cnt || 0;

    // 本体取得: 各企業の最新架電結果 (last_called_at, last_result, last_memo) を JOIN
    const [items] = await pool.query(
      `SELECT
          c.id AS company_id,
          ca.id AS assignment_id,
          ca.sort_order,
          ca.user_id,
          c.company_name,
          c.phone_number,
          c.industry,
          c.industry_category,
          c.job_type,
          c.address,
          c.region,
          c.comment,
          c.data_source,
          c.last_called_at,
          c.last_call_result_code AS last_result,
          (SELECT cl.memo FROM calls cl WHERE cl.company_id = c.id ORDER BY cl.call_started_at DESC LIMIT 1) AS last_memo
       FROM company_assignments ca
       JOIN companies c ON c.id = ca.company_id
       WHERE ca.user_id = ? AND c.is_special = 1 AND c.exclusion_flag = 0
       ORDER BY ca.sort_order ASC, ca.id ASC
       LIMIT ? OFFSET ?`,
      [reqUserId, limit, offset]
    );

    return ApiResponse.success(res, {
      items,
      total,
      page,
      limit,
      totalPages: Math.max(1, Math.ceil(total / limit)),
      user_id: reqUserId,
    });
  } catch (err) {
    logger.error(`[getSpecialList] ${err.code || ''} ${err.message}`);
    next(err);
  }
};

/**
 * PUT /api/companies/special-list/reorder
 * 1 ページ内 D&D の結果を一括反映。
 */
const reorderSpecialList = async (req, res, next) => {
  try {
    const role = req.user.role;
    const targetUserId = isPrivileged(role) && req.body.user_id
      ? parseInt(req.body.user_id, 10)
      : req.user.id;
    if (!targetUserId || isNaN(targetUserId)) {
      return ApiResponse.badRequest(res, 'user_id が不正です');
    }

    // operator/sales が他人の user_id を指定したらブロック
    if (!isPrivileged(role) && targetUserId !== req.user.id) {
      return ApiResponse.forbidden(res, '他のユーザーの並び順は変更できません');
    }

    const items = Array.isArray(req.body.items) ? req.body.items : [];
    if (items.length === 0) {
      return ApiResponse.badRequest(res, 'items は 1 件以上指定してください');
    }
    if (items.length > 500) {
      return ApiResponse.badRequest(res, '一度に並び替えできるのは 500 件までです');
    }

    // 入力バリデーション
    const normalized = [];
    for (const it of items) {
      const cid = parseInt(it.company_id, 10);
      const so = parseInt(it.sort_order, 10);
      if (!cid || isNaN(cid)) {
        return ApiResponse.badRequest(res, 'items[].company_id が不正です');
      }
      if (isNaN(so)) {
        return ApiResponse.badRequest(res, 'items[].sort_order が不正です');
      }
      normalized.push({ company_id: cid, sort_order: so });
    }

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      let updated = 0;
      for (const it of normalized) {
        const [r] = await conn.execute(
          'UPDATE company_assignments SET sort_order = ? WHERE user_id = ? AND company_id = ?',
          [it.sort_order, targetUserId, it.company_id]
        );
        updated += r.affectedRows || 0;
      }
      await conn.commit();
      logger.info(`[reorderSpecialList] user=${targetUserId} updated=${updated}/${normalized.length} by=${req.user.id}`);
      return ApiResponse.success(res, { updated, requested: normalized.length });
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  } catch (err) {
    logger.error(`[reorderSpecialList] ${err.code || ''} ${err.message}`);
    next(err);
  }
};

/**
 * GET /api/companies/special-list/users
 * admin/manager/consultant 向け: 特別リストを持つユーザー一覧。
 */
const getSpecialListUsers = async (req, res, next) => {
  try {
    if (!isPrivileged(req.user.role)) {
      return ApiResponse.forbidden(res, '権限がありません');
    }
    const [rows] = await pool.query(
      `SELECT u.id, u.name, u.role,
              COUNT(ca.id) AS assignment_count
       FROM users u
       LEFT JOIN company_assignments ca ON ca.user_id = u.id
       LEFT JOIN companies c ON c.id = ca.company_id AND c.is_special = 1 AND c.exclusion_flag = 0
       WHERE u.is_active = 1
         AND u.role IN ('operator', 'intern', 'sales', 'manager', 'admin', 'consultant')
       GROUP BY u.id, u.name, u.role
       ORDER BY assignment_count DESC, u.name ASC`
    );
    return ApiResponse.success(res, rows);
  } catch (err) {
    logger.error(`[getSpecialListUsers] ${err.code || ''} ${err.message}`);
    next(err);
  }
};

module.exports = {
  getSpecialList,
  reorderSpecialList,
  getSpecialListUsers,
};
