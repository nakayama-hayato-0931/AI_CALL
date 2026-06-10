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
 * クエリパラメータ: status, owner_user_id, sales_user_id, date_from, date_to, sort_by, sort_order
 */
const getProjects = async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));
    const offset = (page - 1) * limit;
    const { status, owner_user_id, sales_user_id, date_from, date_to, sort_by, sort_order, is_legacy } = req.query;

    let whereClauses = [];
    let params = [];

    // legacy フィルタ（デフォルトは通常案件のみ）
    if (is_legacy === '1') {
      whereClauses.push('p.is_legacy = 1');
    } else {
      whereClauses.push('p.is_legacy = 0');
    }

    // 見込案件フィルタ
    const { is_prospect } = req.query;
    if (is_prospect === '1') {
      whereClauses.push('p.is_prospect = 1');
    } else if (is_legacy !== '1') {
      // 通常案件タブではis_prospect=0のみ表示
      whereClauses.push('p.is_prospect = 0');
    }

    // my_only=1 で自分の案件のみフィルタ
    const { my_only } = req.query;
    if (my_only === '1') {
      if (req.user.role === 'sales') {
        // 営業: 担当営業が自分の案件
        whereClauses.push('p.sales_user_id = ?');
        params.push(req.user.id);
      } else {
        // オペレーター: 架電担当が自分の案件
        whereClauses.push('p.owner_user_id = ?');
        params.push(req.user.id);
      }
    } else if (owner_user_id) {
      whereClauses.push('p.owner_user_id = ?');
      params.push(owner_user_id);
    }

    if (sales_user_id === 'none') {
      whereClauses.push('p.sales_user_id IS NULL');
    } else if (sales_user_id) {
      whereClauses.push('p.sales_user_id = ?');
      params.push(sales_user_id);
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

    // フリーワード検索（求人番号 or 企業名）
    const { search, call_type } = req.query;
    if (search) {
      whereClauses.push('(COALESCE(c.company_name, p.legacy_company_name) LIKE ? OR p.job_number LIKE ?)');
      const s = `%${search}%`;
      params.push(s, s);
    }

    // 架電種別フィルタ（オペレーター/営業分離）
    if (call_type && is_legacy !== '1') {
      whereClauses.push('p.call_type = ?');
      params.push(call_type);
    }

    // 業務カテゴリ (技人国/特定技能) フィルタ
    const { buildWorkCategoryFilter } = require('../middlewares/auth');
    const wcFilter = buildWorkCategoryFilter(req, 'p.work_category');
    if (wcFilter.sql) {
      whereClauses.push(wcFilter.sql.replace(/^\s*AND\s+/i, ''));
      params.push(...wcFilter.params);
    }

    // 書類選考の有無フィルタ
    //   required=あり / not_required=なし（未選択・NULLも「なし」に含める）
    const { doc_screening, interview_kind } = req.query;
    if (doc_screening === 'required') {
      whereClauses.push("p.document_screening = 'required'");
    } else if (doc_screening === 'not_required') {
      whereClauses.push("(p.document_screening IS NULL OR p.document_screening = '' OR p.document_screening = 'not_required')");
    }

    // 対面の有無フィルタ
    //   in_person=対面 / online=オンライン
    if (interview_kind === 'in_person') {
      whereClauses.push("p.interview_type = 'in_person'");
    } else if (interview_kind === 'online') {
      whereClauses.push("p.interview_type = 'online'");
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
      `SELECT p.*,
              COALESCE(c.company_name, p.legacy_company_name) as company_name,
              COALESCE(c.phone_number, p.legacy_phone) as phone_number,
              c.industry, c.region, c.address,
              COALESCE(u.name, p.legacy_operator_name) as owner_name,
              COALESCE(su.name, p.legacy_sales_name) as sales_name
       FROM projects p
       LEFT JOIN companies c ON p.company_id = c.id
       LEFT JOIN users u ON p.owner_user_id = u.id
       LEFT JOIN users su ON p.sales_user_id = su.id
       WHERE p.id = ?`,
      [id]
    );

    if (rows.length === 0) {
      return ApiResponse.notFound(res, '案件が見つかりません');
    }

    // 関連通話履歴（transcript含む）- 移行前案件はcompany_idがないので空配列
    let callHistory = [];
    if (rows[0].company_id) {
      const [calls] = await pool.execute(
        `SELECT cl.*, u.name as operator_name
         FROM calls cl
         LEFT JOIN users u ON cl.user_id = u.id
         WHERE cl.company_id = ?
         ORDER BY cl.call_started_at DESC`,
        [rows[0].company_id]
      );
      callHistory = calls;
    }

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
    logger.info(`[updateProject] id=${id} body=${JSON.stringify(req.body)}`);
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
      contact_phone,
      contact_email,
      dashboard_checked,
      interview_attendees,
      naitei_date,
      recruitment_start_date,
      resume_sent_date,
      // 企業情報の編集フィールド
      company_name,
      industry,
      region,
      address,
    } = req.body;

    // ステータスバリデーション（元のENUM値 + 現行の値）
    const validStatuses = [
      'NEW', 'MAIL_SENT', 'INTERVIEW_SET', 'INTERVIEW_DONE', 'WAITING_RESULT', 'HIRED',
      'NAITEI', 'NAITEI_TORIKESHI', 'FUGOKAKU', 'KEKKA_MACHI', 'MENSETSU_KAKUTEI',
      'BOSHUCHU', 'SHORUI_CHU', 'LOST', 'BARASHI', 'HORYU',
      'SHORUI_OCHI', 'KISON_NASHI', 'MODOSHI', 'MODORI',
    ];
    if (status && !validStatuses.includes(status)) {
      return ApiResponse.badRequest(res, `無効なステータスです: ${status}`);
    }

    // 更新フィールドを動的に構築（undefinedでない項目のみ更新）
    const updates = [];
    const updateParams = [];

    if (interview_date !== undefined) { updates.push('interview_date = ?'); updateParams.push(interview_date || null); }
    if (interview_type !== undefined) { updates.push('interview_type = ?'); updateParams.push(interview_type || null); }
    if (interview_attendees !== undefined) { updates.push('interview_attendees = ?'); updateParams.push(interview_attendees || null); }
    if (naitei_date !== undefined) { updates.push('naitei_date = ?'); updateParams.push(naitei_date || null); }
    if (recruitment_start_date !== undefined) { updates.push('recruitment_start_date = ?'); updateParams.push(recruitment_start_date || null); }
    if (resume_sent_date !== undefined) { updates.push('resume_sent_date = ?'); updateParams.push(resume_sent_date || null); }
    if (document_screening !== undefined) { updates.push('document_screening = ?'); updateParams.push(document_screening || null); }
    if (mail_sent !== undefined) { updates.push('mail_sent = ?'); updateParams.push(mail_sent || null); }
    if (mail_replied !== undefined) { updates.push('mail_replied = ?'); updateParams.push(mail_replied || null); }
    if (phone_confirmed !== undefined) { updates.push('phone_confirmed = ?'); updateParams.push(phone_confirmed || null); }
    if (job_number !== undefined) { updates.push('job_number = ?'); updateParams.push(job_number || null); }
    if (status !== undefined) { updates.push('status = ?'); updateParams.push(status || null); }
    if (memo !== undefined) { updates.push('memo = ?'); updateParams.push(memo || null); }
    if (sales_user_id !== undefined) { updates.push('sales_user_id = ?'); updateParams.push(sales_user_id || null); }
    if (log_confirmed !== undefined) { updates.push('log_confirmed = ?'); updateParams.push(log_confirmed ? 1 : 0); }
    if (job_posted !== undefined) { updates.push('job_posted = ?'); updateParams.push(job_posted ? 1 : 0); }
    if (pre_confirmed !== undefined) { updates.push('pre_confirmed = ?'); updateParams.push(pre_confirmed ? 1 : 0); }
    if (contact_person !== undefined) { updates.push('contact_person = ?'); updateParams.push(contact_person || null); }
    if (contact_info !== undefined) { updates.push('contact_info = ?'); updateParams.push(contact_info || null); }
    if (contact_phone !== undefined) { updates.push('contact_phone = ?'); updateParams.push(contact_phone || null); }
    if (contact_email !== undefined) { updates.push('contact_email = ?'); updateParams.push(contact_email || null); }
    if (dashboard_checked !== undefined) { updates.push('dashboard_checked = ?'); updateParams.push(dashboard_checked ? 1 : 0); }

    if (updates.length === 0 && !company_name && industry === undefined && region === undefined && address === undefined) {
      return ApiResponse.badRequest(res, '更新項目がありません');
    }

    let result = { affectedRows: 1 };
    if (updates.length > 0) {
      updateParams.push(id);
      try {
        const [dbResult] = await pool.execute(
          `UPDATE projects SET ${updates.join(', ')} WHERE id = ?`,
          updateParams
        );
        result = dbResult;
      } catch (sqlErr) {
        logger.error(`[updateProject] SQL error: ${sqlErr.code} ${sqlErr.message} sql=UPDATE projects SET ${updates.join(', ')} WHERE id=? params=${JSON.stringify(updateParams)}`);
        return ApiResponse.badRequest(res, `更新失敗: ${sqlErr.code || ''} ${sqlErr.sqlMessage || sqlErr.message}`);
      }
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
      'SELECT p.company_id, p.legacy_phone, c.phone_number FROM projects p LEFT JOIN companies c ON p.company_id = c.id WHERE p.id = ?',
      [id]
    );
    if (projRows.length === 0) {
      return ApiResponse.notFound(res, '案件が見つかりません');
    }

    const { company_id, phone_number, legacy_phone } = projRows[0];

    // 移行前案件（company_idなし）は通話ログなし
    if (!company_id) {
      return ApiResponse.success(res, []);
    }

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

    let csvParse;
    try { csvParse = require('csv-parse/sync'); } catch(e) { csvParse = null; }
    const XLSX = require('xlsx');
    let records = [];

    const ext = req.file.originalname.split('.').pop().toLowerCase();
    if (ext === 'csv') {
      const content = req.file.buffer.toString('utf-8');
      records = csvParse.parse(content, { columns: true, skip_empty_lines: true, bom: true });
    } else if (['xls', 'xlsx'].includes(ext)) {
      const wb = XLSX.read(req.file.buffer, { type: 'buffer' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      records = XLSX.utils.sheet_to_json(ws, { defval: '', raw: true });
    } else {
      return ApiResponse.badRequest(res, 'CSV/XLS/XLSX形式のみ対応');
    }

    if (records.length === 0) return ApiResponse.badRequest(res, 'データがありません');

    // カラム名の改行を統一（\r\n → \n）、値をString化（Date型は日付文字列に）
    records = records.map(row => {
      const normalized = {};
      for (const [key, val] of Object.entries(row)) {
        let strVal = '';
        if (val != null) {
          if (val instanceof Date) {
            strVal = val.toISOString().slice(0, 10);
          } else {
            strVal = String(val);
          }
        }
        normalized[key.replace(/\r\n/g, '\n')] = strVal;
      }
      return normalized;
    });

    // ステータスマッピング
    const statusMap = {
      '募集中': 'BOSHUCHU', '書類選考中': 'SHORUI_CHU', '書類落ち': 'SHORUI_OCHI', '書類選考落ち': 'SHORUI_OCHI',
      '面接確定': 'MENSETSU_KAKUTEI', '結果待ち': 'KEKKA_MACHI', '内定': 'NAITEI',
      '内定取消': 'NAITEI_TORIKESHI', '不合格': 'FUGOKAKU', '失注': 'LOST',
      'バラシ': 'BARASHI', '保留': 'HORYU', '既存なし': 'KISON_NASHI', '戻し': 'MODOSHI', '戻り': 'MODORI', '戻し戻り': 'MODORI',
    };

    // 苗字→フルネーム マッピング
    const operatorNameMap = {
      '中田': '中田 倫哉', '中田 ※': '中田 倫哉',
      '吉田': '吉田 拓矢', '吉田(坂圦)': '吉田 拓矢',
      '常': '常 委', '渡邊': '渡邊 樹', '佐藤': '佐藤 綾香',
      '兒玉': '兒玉 良美', '寺西': '寺西 リナ', '小林': '小林 あや',
      '中嶋': '中嶋 太一', '海瀬': '海瀬 裕太', '森川': '森川 葵',
    };

    // Excel serial number → date
    const excelSerialToDate = (val) => {
      if (!val && val !== 0) return null;
      const s = String(val).trim();
      if (!s || s === 'nan' || s === 'undefined') return null;
      // Already a date string (YYYY-MM-DD or YYYY/M/D)
      if (s.includes('-') && s.length >= 8) {
        const d = new Date(s);
        return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
      }
      if (s.includes('/')) {
        const d = new Date(s.split('\n')[0].trim());
        return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
      }
      // Try to parse as serial number
      const num = parseInt(parseFloat(s));
      if (isNaN(num) || num < 1 || num > 100000) return null;
      const base = new Date(1899, 11, 30);
      base.setDate(base.getDate() + num);
      return base.toISOString().slice(0, 10);
    };

    const parseBool = (val) => {
      if (!val) return 0;
      const s = String(val).trim().toLowerCase();
      return ['true', '1', 'yes', '○', 'o'].includes(s) ? 1 : 0;
    };

    // ユーザーIDキャッシュを事前構築
    const [allUsers] = await pool.query('SELECT id, name FROM users WHERE is_active = 1');
    const userIdByName = {};
    allUsers.forEach(u => { userIdByName[u.name] = u.id; });

    // memoカラムをTEXTに拡張（VARCHARだと長いメモが入らない）
    try { await pool.execute('ALTER TABLE projects MODIFY COLUMN memo TEXT'); } catch (e) {}

    // appendモードでなければ既存legacy案件を削除
    const appendMode = req.query.append === '1' || req.body?.append === '1';
    if (!appendMode) {
      await pool.execute('DELETE FROM projects WHERE is_legacy = 1');
    }

    let imported = 0;
    let skipped = 0;
    const skipReasons = [];

    for (const row of records) {
      // カラム名はExcelの実際のヘッダーに対応（改行含む）
      let rawCn = String(row['会社名'] || '').trim();
      // emailプレフィックスが最初の行にある場合のみ除去
      if (rawCn.includes('@') && rawCn.includes('\n')) {
        const lines = rawCn.split('\n');
        if (lines[0].includes('@')) lines.shift();
        rawCn = lines.join('\n');
      }
      let companyName = rawCn.replace(/\n/g, ' ').trim();
      if (!companyName) { skipped++; skipReasons.push({ reason: 'no_company', raw: String(row['会社名'] || '').slice(0, 50) }); continue; }
      // 【ヒトキワ】【グーナビ】等を先頭から末尾に移動
      const tagMatch = companyName.match(/^(【[^】]+】)\s*/);
      if (tagMatch) {
        companyName = companyName.replace(tagMatch[0], '').trim() + ' ' + tagMatch[1];
        companyName = companyName.trim();
      }

      const dateStr = row['案件獲得日'] || '';
      const legacyDate = excelSerialToDate(dateStr);
      if (!legacyDate) { skipped++; skipReasons.push({ reason: 'no_date', raw: String(dateStr).slice(0, 50), company: companyName.slice(0, 30) }); continue; }

      // オペレーター名（苗字→フルネーム変換）
      const rawOp = (row['架電担当'] || '').trim();
      const operatorName = operatorNameMap[rawOp] || rawOp;
      const salesName = (row['営業担当者'] || '').trim();
      const statusStr = (row['状況'] || '').trim();
      const phone = (row['かけた電話番号'] || '').trim();

      // 面接日パース
      // 面接日パース（日付+時刻が混在）
      const rawIntDate = (row['面接日'] || '').trim();
      const rawIntTime = (row['開始時間'] || '').trim();
      let interviewDate = null;
      // 面接日列自体に時刻が含まれている場合 (例: "2025/4/14\n15:00予定")
      let datePart = rawIntDate;
      let timePart = rawIntTime;
      if (rawIntDate.includes('\n')) {
        const lines = rawIntDate.split('\n');
        datePart = lines[0].trim();
        if (!timePart && lines[1]) timePart = lines[1].trim();
      }
      const intDateParsed = excelSerialToDate(datePart);
      if (intDateParsed) {
        let timeStr = '00:00:00';
        // 時刻を面接日列or開始時間列からパース
        const allTimeText = (timePart || '').replace(/予定|～|〜|　/g, '').trim();
        const tm = allTimeText.match(/(\d{1,2})[：:](\d{2})/);
        if (tm) {
          timeStr = `${tm[1].padStart(2,'0')}:${tm[2]}:00`;
        } else {
          const tmH = allTimeText.match(/(\d{1,2})時/);
          if (tmH) timeStr = `${tmH[1].padStart(2,'0')}:00:00`;
        }
        interviewDate = `${intDateParsed} ${timeStr}`;
      }

      const onlineOk = parseBool(row['オンライン\n面接OK']);
      const interviewType = onlineOk ? 'online' : null;
      const noScreening = parseBool(row['書類選考\n無し']);
      const docScreening = noScreening ? 'not_required' : null;
      // メール送付等は日付パース（True/False/日付文字列/Excel serial対応）
      const parseFieldDate = (val) => {
        if (!val || val === 'False' || val === 'false' || val === '0') return null;
        if (val === 'True' || val === 'true' || val === '1') return null; // True but no date
        // Excel serial number
        const num = parseInt(parseFloat(val));
        if (!isNaN(num) && num > 40000 && num < 100000) {
          const base = new Date(1899, 11, 30);
          base.setDate(base.getDate() + num);
          return base.toISOString().slice(0, 10);
        }
        // Date string
        const d = new Date(val);
        if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
        return null;
      };
      const mailSent = parseFieldDate(row['メール\n送付']);
      const mailReplied = parseFieldDate(row['メール\n返信']);
      const phoneDone = parseFieldDate(row['電話確認']);
      const logConfirmed = parseBool(row['ログ確認']);
      const jobPosted = parseBool(row['求人済']);
      const preConfirmed = parseBool(row['事前確認']);
      const dashboardInput = (row['ダッシュボード\n入力'] || '').trim();
      const dashboardChecked = dashboardInput ? 1 : 0;
      // 求人番号: 専用列があればそちら優先、なければダッシュボード入力列
      const jobNumber = (row['求人番号'] || '').trim() || dashboardInput || null;

      // 企業担当者・連絡先
      const contactPerson = (row['担当者'] || '').trim().replace(/\n/g, ' ') || null;
      const contactInfo = (row['連絡先(電話番号とメールアドレス)'] || '').trim().replace(/\n/g, ', ') || null;

      // メモ組立
      const memoParts = [];
      const impression = (row['担当者の印象\n連絡可能時間帯'] || '').trim();
      if (impression) memoParts.push(`【担当者印象】${impression.replace(/\n/g, ' ')}`);
      const remarks = (row['備考'] || '').trim();
      if (remarks) memoParts.push(`【備考】${remarks}`);
      const salesMemo = (row['採用人数、状況、営業メモ'] || '').trim();
      if (salesMemo) memoParts.push(`【営業メモ】${salesMemo.replace(/\n/g, ' ')}`);
      const temp = (row['温度感'] || '').trim();
      if (temp) memoParts.push(`【温度感】${temp}`);
      const industry = (row['業種'] || '').trim();
      if (industry) memoParts.push(`【業種】${industry}`);
      let memo = memoParts.length > 0 ? memoParts.join('\n') : null;
      if (memo && memo.length > 5000) memo = memo.slice(0, 5000) + '...(省略)';

      const status = statusMap[statusStr] || 'BOSHUCHU';

      // オペレーターID（キャッシュから）
      const ownerId = operatorName ? (userIdByName[operatorName] || null) : null;

      // 営業ID（名前の先頭一致で検索）
      let salesId = null;
      if (salesName) {
        const salesFirst = salesName.split(' ')[0];
        const found = allUsers.find(u => u.name.startsWith(salesFirst));
        if (found) salesId = found.id;
      }

      try {
        await pool.execute(
          `INSERT INTO projects (company_id, owner_user_id, sales_user_id, job_number, status,
            interview_date, interview_type, document_screening,
            mail_sent, mail_replied, phone_confirmed, memo, is_legacy,
            legacy_company_name, legacy_phone, legacy_date,
            legacy_operator_name, legacy_sales_name,
            log_confirmed, job_posted, pre_confirmed,
            contact_person, contact_info, dashboard_checked,
            created_at)
           VALUES (NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            ownerId, salesId, jobNumber, status, interviewDate, interviewType, docScreening,
            mailSent, mailReplied, phoneDone, memo,
            companyName, phone || null, legacyDate,
            operatorName || null, salesName || null,
            logConfirmed, jobPosted, preConfirmed,
            contactPerson, contactInfo, dashboardChecked,
            `${legacyDate} 00:00:00`
          ]
        );
        imported++;
      } catch (e) {
        logger.warn(`移行インポートスキップ行: ${e.message}`);
        skipped++;
        skipReasons.push({ reason: 'db_error', error: e.message.slice(0, 100), company: companyName.slice(0, 30) });
      }
    }

    return ApiResponse.success(res, { imported, skipped, total: records.length, skipReasons: skipReasons.slice(0, 20) }, `${imported}件の移行前案件をインポートしました`);
  } catch (err) {
    logger.error('移行前案件インポートエラー:', err.message, err.stack);
    return res.status(500).json({ success: false, message: `インポートエラー: ${err.message}` });
  }
};

/**
 * DELETE /api/projects/:id
 * 案件削除（管理者のみ）
 */
const deleteProject = async (req, res, next) => {
  try {
    const { id } = req.params;
    // 関連データ削除
    await pool.execute('DELETE FROM project_hires WHERE project_id = ?', [id]);
    await pool.execute('DELETE FROM projects WHERE id = ?', [id]);
    logger.info(`案件削除: ID ${id}`);
    return ApiResponse.success(res, null, '案件を削除しました');
  } catch (err) {
    next(err);
  }
};

/**
 * PUT /api/projects/:id/promote
 * 見込案件を正式案件に昇格
 */
const promoteProject = async (req, res, next) => {
  const conn = await pool.getConnection();
  try {
    const { id } = req.params;

    // 案件情報を取得
    const [rows] = await conn.execute('SELECT * FROM projects WHERE id = ?', [id]);
    if (rows.length === 0) {
      conn.release();
      return ApiResponse.notFound(res, '案件が見つかりません');
    }
    const project = rows[0];
    if (!project.is_prospect) {
      conn.release();
      return ApiResponse.badRequest(res, 'この案件は既に正式案件です');
    }

    await conn.beginTransaction();

    // 見込フラグを解除、昇格日時を記録
    await conn.execute(
      'UPDATE projects SET is_prospect = 0, promoted_at = NOW() WHERE id = ?',
      [id]
    );

    // 対応する通話レコードの is_project_created を1に更新（カウントに含める）
    if (project.created_call_id) {
      await conn.execute(
        'UPDATE calls SET is_project_created = 1 WHERE id = ?',
        [project.created_call_id]
      );
    }

    await conn.commit();
    conn.release();

    logger.info(`見込案件を正式案件に昇格: project=${id}, call=${project.created_call_id}`);
    return ApiResponse.success(res, null, '見込案件を正式案件に昇格しました');
  } catch (err) {
    await conn.rollback();
    conn.release();
    next(err);
  }
};

/**
 * POST /api/projects/manual
 * 手動案件作成（折り返し電話等、架電画面を経由しない案件獲得用）
 */
const createProjectManual = async (req, res, next) => {
  try {
    const { company_name, phone_number, status, job_number, interview_date, interview_type,
      document_screening, mail_sent, mail_replied, phone_confirmed, memo,
      contact_person, contact_info, contact_phone, contact_email, call_type, created_date } = req.body;

    if (!company_name) {
      return ApiResponse.badRequest(res, '企業名は必須です');
    }

    const resolvedCallType = call_type || (req.user.role === 'sales' ? 'sales' : 'operator');

    const createdAt = created_date ? `${created_date} 00:00:00` : new Date().toISOString().slice(0, 19).replace('T', ' ');

    const [result] = await pool.execute(
      `INSERT INTO projects (
        legacy_company_name, legacy_phone, owner_user_id, status,
        job_number, interview_date, interview_type, document_screening,
        mail_sent, mail_replied, phone_confirmed, memo,
        contact_person, contact_info, contact_phone, contact_email, call_type, is_legacy, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`,
      [
        company_name, phone_number || null, req.user.id, status || 'NEW',
        job_number || null, interview_date || null, interview_type || null, document_screening || 'not_required',
        mail_sent || null, mail_replied || null, phone_confirmed || null, memo || null,
        contact_person || null, contact_info || null, contact_phone || null, contact_email || null, resolvedCallType, createdAt,
      ]
    );

    logger.info(`手動案件作成: id=${result.insertId}, user=${req.user.id}, company=${company_name}`);
    return ApiResponse.created(res, { projectId: result.insertId }, '案件を作成しました');
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/projects/assignment-overview
 * 営業別案件割り振り状況 + 未割当案件
 * 失注(LOST)/バラシ(BARASHI)は除外
 */
const getAssignmentOverview = async (req, res, next) => {
  try {
    const EXCLUDE_STATUSES = ['LOST', 'BARASHI'];
    const placeholders = EXCLUDE_STATUSES.map(() => '?').join(',');

    // 月フィルター（YYYY-MM、'all'または未指定で全期間）
    // 集計は面接日(interview_date)ベース
    const month = (req.query.month || '').slice(0, 7);
    let interviewDateFilter = '';
    let interviewDateParams = [];
    if (month && /^\d{4}-\d{2}$/.test(month)) {
      const [yStr, mStr] = month.split('-');
      const y = parseInt(yStr, 10);
      const m = parseInt(mStr, 10);
      const lastDay = new Date(y, m, 0).getDate();
      const dateFrom = `${month}-01`;
      const dateTo = `${month}-${String(lastDay).padStart(2, '0')}`;
      interviewDateFilter = ' AND p.interview_date BETWEEN ? AND ?';
      interviewDateParams = [dateFrom, dateTo];
    }

    // 営業ユーザー一覧（無効ユーザーでも担当中があれば表示するため全取得）
    const [salesUsers] = await pool.execute(
      "SELECT id, name, is_active FROM users WHERE role = 'sales' ORDER BY is_active DESC, name ASC"
    );

    // 営業別ステータス集計（失注・バラシ除外、面接日ベース）
    const [stat] = await pool.query(
      `SELECT p.sales_user_id, p.status, COUNT(*) AS cnt
       FROM projects p
       WHERE p.is_prospect = 0
         AND p.status NOT IN (${placeholders})
         ${interviewDateFilter}
       GROUP BY p.sales_user_id, p.status`,
      [...EXCLUDE_STATUSES, ...interviewDateParams]
    );

    // ユーザーIDごとに status -> count のマップを構築
    const userStatusMap = new Map(); // userId or 'unassigned' -> { status: count }
    let totalActive = 0;
    for (const r of stat) {
      const key = r.sales_user_id == null ? 'unassigned' : r.sales_user_id;
      if (!userStatusMap.has(key)) userStatusMap.set(key, {});
      userStatusMap.get(key)[r.status] = Number(r.cnt);
      totalActive += Number(r.cnt);
    }

    // 営業ごとの集計（無効ユーザーで担当0なら除外）
    const salesSummary = salesUsers
      .map(u => {
        const counts = userStatusMap.get(u.id) || {};
        const total = Object.values(counts).reduce((s, n) => s + n, 0);
        return {
          userId: u.id,
          name: u.name,
          isActive: !!u.is_active,
          total,
          statusCounts: counts,
        };
      })
      .filter(s => s.isActive || s.total > 0);

    // 未割当案件一覧（失注・バラシ除外、移行前案件除外、面接日未設定も含めて全件表示）
    // mail_replied / phone_confirmed が両方空 = 連絡待ち
    const [unassigned] = await pool.query(
      `SELECT p.id, p.job_number, p.status, p.created_at, p.naitei_date,
              p.interview_date, p.memo,
              p.mail_replied, p.phone_confirmed,
              (p.mail_replied IS NULL AND p.phone_confirmed IS NULL) AS is_pending_contact,
              COALESCE(c.company_name, p.legacy_company_name) AS company_name,
              ou.name AS owner_name
       FROM projects p
       LEFT JOIN companies c ON p.company_id = c.id
       LEFT JOIN users ou ON p.owner_user_id = ou.id
       WHERE p.is_prospect = 0
         AND p.is_legacy = 0
         AND p.sales_user_id IS NULL
         AND p.status NOT IN (${placeholders})
       ORDER BY p.created_at DESC`,
      EXCLUDE_STATUSES
    );

    const unassignedCounts = userStatusMap.get('unassigned') || {};
    const unassignedTotal = Object.values(unassignedCounts).reduce((s, n) => s + n, 0);

    return ApiResponse.success(res, {
      month: month || null,
      sales: salesSummary,
      unassigned: {
        total: unassignedTotal,
        statusCounts: unassignedCounts,
        projects: unassigned,
      },
      grandTotal: totalActive,
    });
  } catch (err) {
    next(err);
  }
};

/**
 * PUT /api/projects/:id/assign
 * 営業割り当て専用エンドポイント
 */
const assignSalesToProject = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { sales_user_id } = req.body;
    // null許容（未割当に戻す）
    if (sales_user_id != null && Number.isNaN(Number(sales_user_id))) {
      return ApiResponse.badRequest(res, 'sales_user_id が不正です');
    }
    await pool.execute(
      'UPDATE projects SET sales_user_id = ? WHERE id = ?',
      [sales_user_id || null, id]
    );
    return ApiResponse.success(res, null, '営業を割り当てました');
  } catch (err) {
    next(err);
  }
};

module.exports = { getProjects, getProjectById, updateProject, deleteProject, getCallLogs, getSalesUsers, getProjectHires, saveProjectHires, importLegacyProjects, promoteProject, createProjectManual, getAssignmentOverview, assignSalesToProject };
