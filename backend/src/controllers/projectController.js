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
    const { status, owner_user_id, date_from, date_to, sort_by, sort_order, is_legacy } = req.query;

    let whereClauses = [];
    let params = [];

    // legacy フィルタ（デフォルトは通常案件のみ）
    if (is_legacy === '1') {
      whereClauses.push('p.is_legacy = 1');
    } else {
      whereClauses.push('p.is_legacy = 0');
    }

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
       LEFT JOIN companies c ON p.company_id = c.id
       ${whereStr}`,
      params
    );

    const [rows] = await pool.execute(
      `SELECT p.*, COALESCE(c.company_name, p.legacy_company_name) as company_name,
              COALESCE(c.phone_number, p.legacy_phone) as phone_number, c.industry,
              COALESCE(u.name, p.legacy_operator_name) as owner_name,
              COALESCE(su.name, p.legacy_sales_name) as sales_name
       FROM projects p
       LEFT JOIN companies c ON p.company_id = c.id
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
      log_confirmed,
      job_posted,
      pre_confirmed,
      contact_person,
      contact_info,
      dashboard_checked,
      // 企業情報の編集フィールド
      company_name,
      industry,
      region,
      address,
    } = req.body;

    // ステータスバリデーション
    const validStatuses = [
      'NAITEI', 'NAITEI_TORIKESHI', 'FUGOKAKU', 'KEKKA_MACHI', 'MENSETSU_KAKUTEI',
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
    if (log_confirmed !== undefined) { updates.push('log_confirmed = ?'); updateParams.push(log_confirmed ? 1 : 0); }
    if (job_posted !== undefined) { updates.push('job_posted = ?'); updateParams.push(job_posted ? 1 : 0); }
    if (pre_confirmed !== undefined) { updates.push('pre_confirmed = ?'); updateParams.push(pre_confirmed ? 1 : 0); }
    if (contact_person !== undefined) { updates.push('contact_person = ?'); updateParams.push(contact_person || null); }
    if (contact_info !== undefined) { updates.push('contact_info = ?'); updateParams.push(contact_info || null); }
    if (dashboard_checked !== undefined) { updates.push('dashboard_checked = ?'); updateParams.push(dashboard_checked ? 1 : 0); }

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

    // 内定取消の場合、全内定者の初回入金・見込売上を0にし、is_cancelledを1にする
    if (status === 'NAITEI_TORIKESHI') {
      await pool.execute(
        'UPDATE project_hires SET initial_payment = 0, expected_revenue = 0, is_cancelled = 1 WHERE project_id = ?',
        [id]
      );
      logger.info(`内定取消: project=${id} — 全内定者の金額を0に変更`);
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

    // transcriptがnullの通話をGoogle Sheetsから同期取得（3秒タイムアウト）
    const missingTranscripts = calls.filter(c => !c.transcript && c.phone_number && c.call_started_at);
    if (missingTranscripts.length > 0) {
      try {
        const transcriptMap = await Promise.race([
          findTranscriptsBatch(missingTranscripts),
          new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 10000)),
        ]);
        for (const [callId, transcript] of transcriptMap) {
          await pool.execute('UPDATE calls SET transcript = ? WHERE id = ?', [transcript, callId]);
          const call = calls.find(c => c.id === callId);
          if (call) call.transcript = transcript;
        }
        if (transcriptMap.size > 0) {
          logger.info(`案件通話ログ: Transcript ${transcriptMap.size}件同期取得・保存`);
        }
      } catch (e) {
        if (e.message !== 'timeout') {
          logger.error('Transcript取得エラー:', e.message);
        }
      }
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

/**
 * GET /api/projects/:id/hires
 * 内定者情報取得
 */
const getProjectHires = async (req, res, next) => {
  try {
    const { id } = req.params;
    const [rows] = await pool.execute(
      'SELECT * FROM project_hires WHERE project_id = ? ORDER BY id ASC',
      [id]
    );
    return ApiResponse.success(res, rows);
  } catch (err) {
    next(err);
  }
};

/**
 * PUT /api/projects/:id/hires
 * 内定者情報の一括保存（既存を全削除して再挿入）
 */
const saveProjectHires = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { hires } = req.body; // [{registration_number, course, initial_payment, expected_revenue}]

    if (!Array.isArray(hires)) {
      return ApiResponse.badRequest(res, 'hires は配列で指定してください');
    }

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      // 既存を全削除
      await conn.execute('DELETE FROM project_hires WHERE project_id = ?', [id]);

      // 新規挿入
      for (const hire of hires) {
        await conn.execute(
          `INSERT INTO project_hires (project_id, registration_number, course, initial_payment, expected_revenue, is_cancelled)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [
            id,
            hire.registration_number || null,
            hire.course || '国内',
            hire.initial_payment != null ? hire.initial_payment : null,
            hire.expected_revenue != null ? hire.expected_revenue : null,
            hire.is_cancelled ? 1 : 0,
          ]
        );
      }

      await conn.commit();
      logger.info(`内定者情報保存: project=${id}, 件数=${hires.length}`);
      return ApiResponse.success(res, null, '内定者情報を保存しました');
    } catch (e) {
      await conn.rollback();
      throw e;
    } finally {
      conn.release();
    }
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/projects/import-legacy
 * 移行前案件のCSVインポート
 * CSVフォーマット: 日付,担当OP,企業名,電話番号,求人番号,担当営業,ステータス,面接日,面接方法,書類選考,メモ
 */
const importLegacyProjects = async (req, res, next) => {
  try {
    if (!req.file) return ApiResponse.badRequest(res, 'ファイルが必要です');

    const csvParse = require('csv-parse/sync');
    const XLSX = require('xlsx');
    let records = [];

    const ext = req.file.originalname.split('.').pop().toLowerCase();
    if (ext === 'csv') {
      const content = req.file.buffer.toString('utf-8');
      records = csvParse.parse(content, { columns: true, skip_empty_lines: true, bom: true });
    } else if (['xls', 'xlsx'].includes(ext)) {
      const wb = XLSX.read(req.file.buffer, { type: 'buffer' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      records = XLSX.utils.sheet_to_json(ws, { defval: '' });
    } else {
      return ApiResponse.badRequest(res, 'CSV/XLS/XLSX形式のみ対応');
    }

    if (records.length === 0) return ApiResponse.badRequest(res, 'データがありません');

    // ステータスマッピング
    const statusMap = {
      '募集中': 'BOSHUCHU', '書類選考中': 'SHORUI_CHU', '書類落ち': 'SHORUI_OCHI',
      '面接確定': 'MENSETSU_KAKUTEI', '結果待ち': 'KEKKA_MACHI', '内定': 'NAITEI',
      '内定取消': 'NAITEI_TORIKESHI', '不合格': 'FUGOKAKU', '失注': 'LOST',
      'バラシ': 'BARASHI', '保留': 'HORYU', '既存なし': 'KISON_NASHI', '戻し': 'MODOSHI', '戻り': 'MODORI',
    };
    const interviewMap = { 'オンライン': 'online', '対面': 'in_person', 'online': 'online', 'in_person': 'in_person' };
    const docMap = { 'あり': 'required', 'なし': 'not_required', '有': 'required', '無': 'not_required' };

    let imported = 0;
    let skipped = 0;

    for (const row of records) {
      const companyName = row['企業名'] || row['会社名'] || '';
      const phone = row['電話番号'] || row['電話'] || '';
      if (!companyName && !phone) { skipped++; continue; }

      const dateStr = row['日付'] || row['獲得日'] || row['作成日'] || '';
      const operatorName = row['担当OP'] || row['オペレーター'] || row['担当者'] || '';
      const salesName = row['担当営業'] || row['営業'] || '';
      const jobNumber = row['求人番号'] || row['求人No'] || '';
      const statusStr = row['ステータス'] || '';
      const interviewDateStr = row['面接日'] || '';
      const interviewTypeStr = row['面接方法'] || row['面接種別'] || '';
      const docStr = row['書類選考'] || '';
      const memo = row['メモ'] || row['備考'] || '';
      const mailSent = row['メール送付'] === '済' || row['メール送付'] === '1' ? 1 : 0;
      const phoneDone = row['電話確認'] === '済' || row['電話確認'] === '1' ? 1 : 0;

      const status = statusMap[statusStr] || 'BOSHUCHU';
      const interviewType = interviewMap[interviewTypeStr] || null;
      const docScreening = docMap[docStr] || null;

      // 日付パース
      let legacyDate = null;
      if (dateStr) {
        const d = new Date(dateStr);
        if (!isNaN(d.getTime())) legacyDate = d.toISOString().slice(0, 10);
      }
      let interviewDate = null;
      if (interviewDateStr) {
        const d = new Date(interviewDateStr);
        if (!isNaN(d.getTime())) interviewDate = d.toISOString().slice(0, 19).replace('T', ' ');
      }

      // オペレーターID検索（見つからなければNULL、名前をlegacyに保存）
      let ownerId = null;
      if (operatorName) {
        const [userRows] = await pool.query('SELECT id FROM users WHERE name = ? LIMIT 1', [operatorName]);
        if (userRows.length > 0) ownerId = userRows[0].id;
      }

      // 営業ID検索
      let salesId = null;
      if (salesName) {
        const [salesRows] = await pool.query('SELECT id FROM users WHERE name = ? LIMIT 1', [salesName]);
        if (salesRows.length > 0) salesId = salesRows[0].id;
      }

      await pool.execute(
        `INSERT INTO projects (company_id, owner_user_id, sales_user_id, job_number, status, interview_date, interview_type, document_screening, mail_sent, phone_confirmed, memo, is_legacy, legacy_company_name, legacy_phone, legacy_date, legacy_operator_name, legacy_sales_name, created_at)
         VALUES (NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?)`,
        [
          ownerId, salesId, jobNumber || null, status, interviewDate, interviewType, docScreening,
          mailSent, phoneDone, memo || null,
          companyName, phone || null, legacyDate,
          operatorName || null, salesName || null,
          legacyDate ? `${legacyDate} 00:00:00` : new Date().toISOString().slice(0, 19).replace('T', ' ')
        ]
      );
      imported++;
    }

    return ApiResponse.success(res, { imported, skipped, total: records.length }, `${imported}件の移行前案件をインポートしました`);
  } catch (err) {
    logger.error('移行前案件インポートエラー:', err);
    next(err);
  }
};

module.exports = { getProjects, getProjectById, updateProject, getCallLogs, getSalesUsers, getProjectHires, saveProjectHires, importLegacyProjects };
