/**
 * 案件コントローラー
 * 案件CRUD・ステータス更新
 */
const pool = require('../../config/database');
const ApiResponse = require('../utils/apiResponse');
const logger = require('../utils/logger');
const { findTranscriptsBatch } = require('../services/googleSheetsService');

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

    // my_only=1 で自分の案件のみフィルタ (全ロール共通)
    const { my_only } = req.query;
    if (my_only === '1') {
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
              u.name as owner_name,
              su.name as sales_name
       FROM projects p
       JOIN companies c ON p.company_id = c.id
       LEFT JOIN users u ON p.owner_user_id = u.id
       LEFT JOIN users su ON p.sales_user_id = su.id
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
              u.name as owner_name,
              su.name as sales_name
       FROM projects p
       JOIN companies c ON p.company_id = c.id
       LEFT JOIN users u ON p.owner_user_id = u.id
       LEFT JOIN users su ON p.sales_user_id = su.id
       WHERE p.id = ?`,
      [id]
    );

    if (rows.length === 0) {
      return ApiResponse.notFound(res, '案件が見つかりません');
    }

    // 関連通話履歴（transcript含む）
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
      sales_user_id,
      // 企業情報の編集フィールド
      company_name,
      industry,
      region,
      address,
    } = req.body;

    // 営業ロールは sales_user_id のみ更新可能
    if (req.user.role === 'sales') {
      if (sales_user_id === undefined) {
        return ApiResponse.forbidden(res, '営業担当者は担当営業の割り当てのみ変更できます');
      }
      const [result] = await pool.execute(
        'UPDATE projects SET sales_user_id = ? WHERE id = ?',
        [sales_user_id || null, id]
      );
      if (result.affectedRows === 0) {
        return ApiResponse.notFound(res, '案件が見つかりません');
      }
      logger.info(`担当営業割り当て: project=${id}, sales_user_id=${sales_user_id}`);
      return ApiResponse.success(res, null, '担当営業を更新しました');
    }

    // ステータスバリデーション
    const validStatuses = [
      'NAITEI', 'FUGOKAKU', 'KEKKA_MACHI', 'MENSETSU_KAKUTEI',
      'BOSHUCHU', 'SHORUI_CHU', 'LOST', 'BARASHI', 'HORYU',
      'SHORUI_OCHI', 'KISON_NASHI', 'MODOSHI', 'MODORI',
    ];
    if (status && !validStatuses.includes(status)) {
      return ApiResponse.badRequest(res, '無効なステータスです');
    }

    // 更新フィールドを動的に構築（undefinedでない項目のみ更新）
    const updates = [];
    const updateParams = [];

    if (interview_date !== undefined) { updates.push('interview_date = ?'); updateParams.push(interview_date || null); }
    if (interview_type !== undefined) { updates.push('interview_type = ?'); updateParams.push(interview_type || null); }
    if (document_screening !== undefined) { updates.push('document_screening = ?'); updateParams.push(document_screening || null); }
    if (mail_sent !== undefined) { updates.push('mail_sent = ?'); updateParams.push(mail_sent ? 1 : 0); }
    if (mail_replied !== undefined) { updates.push('mail_replied = ?'); updateParams.push(mail_replied ? 1 : 0); }
    if (phone_confirmed !== undefined) { updates.push('phone_confirmed = ?'); updateParams.push(phone_confirmed ? 1 : 0); }
    if (job_number !== undefined) { updates.push('job_number = ?'); updateParams.push(job_number || null); }
    if (status !== undefined) { updates.push('status = ?'); updateParams.push(status || null); }
    if (memo !== undefined) { updates.push('memo = ?'); updateParams.push(memo || null); }
    if (sales_user_id !== undefined) { updates.push('sales_user_id = ?'); updateParams.push(sales_user_id || null); }

    if (updates.length === 0 && !company_name && industry === undefined && region === undefined && address === undefined) {
      return ApiResponse.badRequest(res, '更新項目がありません');
    }

    let result = { affectedRows: 1 };
    if (updates.length > 0) {
      updateParams.push(id);
      const [dbResult] = await pool.execute(
        `UPDATE projects SET ${updates.join(', ')} WHERE id = ?`,
        updateParams
      );
      result = dbResult;
    }

    if (result.affectedRows === 0) {
      return ApiResponse.notFound(res, '案件が見つかりません');
    }

    // 企業情報の更新（company_name, industry, region, address）
    if (company_name || industry !== undefined || region !== undefined || address !== undefined) {
      const [proj] = await pool.execute('SELECT company_id FROM projects WHERE id = ?', [id]);
      if (proj.length > 0) {
        await pool.execute(
          `UPDATE companies SET
            company_name = COALESCE(?, company_name),
            industry = COALESCE(?, industry),
            region = COALESCE(?, region),
            address = COALESCE(?, address)
           WHERE id = ?`,
          [company_name || null, industry !== undefined ? (industry || null) : null, region !== undefined ? (region || null) : null, address !== undefined ? (address || null) : null, proj[0].company_id]
        );
      }
    }

    logger.info(`案件更新: project=${id}, status=${status}`);

    return ApiResponse.success(res, null, '案件を更新しました');
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/projects/:id/call-logs
 * 案件の企業への全通話ログ（同じ電話番号の全通話を含む）
 */
const getCallLogs = async (req, res, next) => {
  try {
    const { id } = req.params;

    // 案件の企業情報を取得
    const [projRows] = await pool.execute(
      'SELECT p.company_id, c.phone_number FROM projects p JOIN companies c ON p.company_id = c.id WHERE p.id = ?',
      [id]
    );
    if (projRows.length === 0) {
      return ApiResponse.notFound(res, '案件が見つかりません');
    }

    const { company_id, phone_number } = projRows[0];

    // 同じ電話番号を持つ全企業への通話を取得
    const [calls] = await pool.query(
      `SELECT cl.id, cl.call_started_at, cl.call_ended_at, cl.result_code, cl.memo, cl.transcript,
              u.name as operator_name, co.phone_number
       FROM calls cl
       LEFT JOIN users u ON cl.user_id = u.id
       LEFT JOIN companies co ON cl.company_id = co.id
       WHERE co.phone_number = ? OR cl.company_id = ?
       ORDER BY cl.call_started_at DESC`,
      [phone_number, company_id]
    );

    // transcriptがnullの通話をGoogle Sheetsからバックグラウンドで取得
    const missingTranscripts = calls.filter(c => !c.transcript && c.phone_number && c.call_started_at);
    if (missingTranscripts.length > 0) {
      findTranscriptsBatch(missingTranscripts).then(async (transcriptMap) => {
        for (const [callId, transcript] of transcriptMap) {
          await pool.execute('UPDATE calls SET transcript = ? WHERE id = ?', [transcript, callId]);
        }
        if (transcriptMap.size > 0) {
          logger.info(`案件通話ログ: Transcript ${transcriptMap.size}件取得・保存`);
        }
      }).catch(e => {
        logger.error('Transcript取得エラー:', e.message);
      });
    }

    return ApiResponse.success(res, calls);
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/projects/sales-users
 * 営業ロールのユーザー一覧
 */
const getSalesUsers = async (req, res, next) => {
  try {
    const [rows] = await pool.execute(
      "SELECT id, name FROM users WHERE role = 'sales' AND is_active = 1 ORDER BY name"
    );
    return ApiResponse.success(res, rows);
  } catch (err) {
    next(err);
  }
};

module.exports = { getProjects, getProjectById, updateProject, getCallLogs, getSalesUsers };
