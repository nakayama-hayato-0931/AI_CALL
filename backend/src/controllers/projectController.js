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

    // my_only=1 で自分の案件のみフィルタ (全ロール共通)
    const { my_only } = req.query;
    if (my_only === '1') {
      whereClauses.push('p.owner_user_id = ?');
      params.push(req.user.id);
    } else if (owner_user_id) {
      whereClauses.push('p.owner_user_id = ?');
      params.push(owner_user_id);
    }

    if (sales_user_id) {
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

    // 既存legacy案件を削除（再インポート用）
    await pool.execute('DELETE FROM projects WHERE is_legacy = 1');

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
      const mailSent = parseBool(row['メール\n送付']);
      const mailReplied = parseBool(row['メール\n返信']);
      const phoneDone = parseBool(row['電話確認']);
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
      const memo = memoParts.length > 0 ? memoParts.join('\n') : null;

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

module.exports = { getProjects, getProjectById, updateProject, getCallLogs, getSalesUsers, getProjectHires, saveProjectHires, importLegacyProjects };
