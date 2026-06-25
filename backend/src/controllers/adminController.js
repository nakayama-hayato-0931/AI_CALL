/**
 * 管理者コントローラー
 * ユーザー管理・オペレーター成績・架電リスト管理
 */
const bcrypt = require('bcrypt');
const pool = require('../../config/database');
const ApiResponse = require('../utils/apiResponse');
const logger = require('../utils/logger');
const { getDateRange } = require('../utils/periodHelper');

// ==================== ユーザー管理 ====================

/**
 * GET /api/admin/users
 * 全ユーザー一覧
 */
const getUsers = async (req, res, next) => {
  try {
    const [rows] = await pool.query(
      'SELECT id, name, email, role, is_active, is_test_account, operator_level, commute_type, commute_teiki_monthly, commute_daily_amount, target_work_hours, target_calls_per_h, target_effective_per_h, target_person_per_h, target_project_hours, created_at, updated_at FROM users ORDER BY created_at DESC'
    );
    return ApiResponse.success(res, rows);
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/admin/users
 * ユーザー追加
 */
const createUser = async (req, res, next) => {
  try {
    const { name, email, password, role } = req.body;

    const userRole = role || 'operator';
    const isOperator = userRole === 'operator' || userRole === 'intern';

    if (!name || !password) {
      return ApiResponse.badRequest(res, '名前・パスワードは必須です');
    }
    if (!isOperator && !email) {
      return ApiResponse.badRequest(res, 'オペレーター以外はメールアドレスが必須です');
    }

    const validRoles = ['admin', 'manager', 'operator', 'sales', 'consultant', 'intern'];
    if (role && !validRoles.includes(role)) {
      return ApiResponse.badRequest(res, `ロールは ${validRoles.join(', ')} のいずれかを指定してください`);
    }

    // メール重複チェック（メールが入力されている場合のみ）
    if (email) {
      const [existing] = await pool.execute(
        'SELECT id FROM users WHERE email = ?',
        [email]
      );
      if (existing.length > 0) {
        return ApiResponse.badRequest(res, 'このメールアドレスは既に登録されています');
      }
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const [result] = await pool.execute(
      'INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)',
      [name, email || null, passwordHash, userRole]
    );

    const newUserId = result.insertId;
    logger.info(`ユーザー作成: ${name} (role: ${userRole})`);

    // オペレーターなら研修進捗を初期化
    if (userRole === 'operator') {
      const trainingSteps = [
        [1, '座学研修/サービス理解'],
        [2, 'トークスクリプト読み込み'],
        [3, 'ロープレ'],
        [4, 'コールシステム説明'],
        [5, '架電開始'],
        [6, '改善点フィードバック'],
        [7, '面談実施'],
      ];
      for (const [stepNum, stepName] of trainingSteps) {
        try {
          await pool.execute(
            'INSERT IGNORE INTO operator_training (user_id, step_number, step_name) VALUES (?, ?, ?)',
            [newUserId, stepNum, stepName]
          );
        } catch (e) { /* skip if table doesn't exist yet */ }
      }
    }

    return ApiResponse.created(res, {
      id: newUserId,
      name,
      email: email || null,
      role: userRole,
      is_active: 1,
    }, 'ユーザーを作成しました');
  } catch (err) {
    next(err);
  }
};

/**
 * PUT /api/admin/users/:id
 * ユーザー編集
 */
const updateUser = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { name, email, password, role, is_active, is_test_account, operator_level, commute_type, commute_teiki_monthly, commute_daily_amount, target_work_hours, target_calls_per_h, target_effective_per_h, target_person_per_h, target_project_hours } = req.body;

    const [existing] = await pool.execute('SELECT id FROM users WHERE id = ?', [id]);
    if (existing.length === 0) {
      return ApiResponse.notFound(res, 'ユーザーが見つかりません');
    }

    // メール重複チェック（自分以外、空でない場合のみ）
    if (email) {
      const [dup] = await pool.execute(
        'SELECT id FROM users WHERE email = ? AND id != ?',
        [email, id]
      );
      if (dup.length > 0) {
        return ApiResponse.badRequest(res, 'このメールアドレスは既に使用されています');
      }
    }

    // email空文字の場合はNULLに変換
    if (email !== undefined && !email) {
      const [userRow] = await pool.execute('SELECT role FROM users WHERE id = ?', [id]);
      if (userRow.length > 0 && !['operator', 'intern'].includes(userRow[0].role)) {
        return ApiResponse.badRequest(res, 'オペレーター以外はメールアドレスが必須です');
      }
    }

    const updates = [];
    const params = [];

    if (name !== undefined) { updates.push('name = ?'); params.push(name); }
    if (email !== undefined) { updates.push('email = ?'); params.push(email || null); }
    if (role !== undefined) { updates.push('role = ?'); params.push(role); }
    if (is_active !== undefined) { updates.push('is_active = ?'); params.push(is_active); }
    if (is_test_account !== undefined) { updates.push('is_test_account = ?'); params.push(is_test_account ? 1 : 0); }
    if (operator_level !== undefined) { updates.push('operator_level = ?'); params.push(operator_level || null); }
    if (commute_type !== undefined) { updates.push('commute_type = ?'); params.push(commute_type || null); }
    if (commute_teiki_monthly !== undefined) { updates.push('commute_teiki_monthly = ?'); params.push(commute_teiki_monthly != null ? Number(commute_teiki_monthly) : null); }
    if (commute_daily_amount !== undefined) { updates.push('commute_daily_amount = ?'); params.push(commute_daily_amount != null ? Number(commute_daily_amount) : null); }
    if (target_work_hours !== undefined) { updates.push('target_work_hours = ?'); params.push(target_work_hours != null && target_work_hours !== '' ? Number(target_work_hours) : null); }
    if (target_calls_per_h !== undefined) { updates.push('target_calls_per_h = ?'); params.push(target_calls_per_h != null && target_calls_per_h !== '' ? Number(target_calls_per_h) : null); }
    if (target_effective_per_h !== undefined) { updates.push('target_effective_per_h = ?'); params.push(target_effective_per_h != null && target_effective_per_h !== '' ? Number(target_effective_per_h) : null); }
    if (target_person_per_h !== undefined) { updates.push('target_person_per_h = ?'); params.push(target_person_per_h != null && target_person_per_h !== '' ? Number(target_person_per_h) : null); }
    if (target_project_hours !== undefined) { updates.push('target_project_hours = ?'); params.push(target_project_hours != null && target_project_hours !== '' ? Number(target_project_hours) : null); }

    if (password) {
      const passwordHash = await bcrypt.hash(password, 10);
      updates.push('password_hash = ?');
      params.push(passwordHash);
    }

    if (updates.length === 0) {
      return ApiResponse.badRequest(res, '更新する項目がありません');
    }

    params.push(id);
    await pool.execute(
      `UPDATE users SET ${updates.join(', ')} WHERE id = ?`,
      params
    );

    logger.info(`ユーザー更新: ID ${id}`);
    return ApiResponse.success(res, null, 'ユーザーを更新しました');
  } catch (err) {
    next(err);
  }
};

/**
 * DELETE /api/admin/users/:id
 * ユーザー完全削除（関連データも削除）
 */
const deleteUser = async (req, res, next) => {
  try {
    const { id } = req.params;

    if (req.user.id === parseInt(id)) {
      return ApiResponse.badRequest(res, '自分自身を削除することはできません');
    }

    const [existing] = await pool.execute('SELECT id, name FROM users WHERE id = ?', [id]);
    if (existing.length === 0) {
      return ApiResponse.notFound(res, 'ユーザーが見つかりません');
    }

    const userName = existing[0].name;

    // トランザクション内で外部キーチェックを無効化して削除
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      await conn.execute('SET FOREIGN_KEY_CHECKS = 0');

      // 関連データを安全に削除
      const tables = [
        ['ai_evaluations', 'user_id'],
        ['status_sheets', 'user_id'],
        ['status_sheets', 'created_by'],
        ['work_hours', 'user_id'],
        ['recall_tasks', 'user_id'],
        ['feature_requests', 'user_id'],
        ['cost_records', 'user_id'],
        ['evaluation_batch_logs', 'user_id'],
        ['priority_assignments', 'user_id'],
      ];
      for (const [table, col] of tables) {
        try { await conn.execute(`DELETE FROM ${table} WHERE ${col} = ?`, [id]); } catch (e) { /* skip */ }
      }
      // calls, projectsはuser参照をNULLに
      try { await conn.execute('UPDATE calls SET user_id = NULL WHERE user_id = ?', [id]); } catch (e) { /* skip */ }
      try { await conn.execute('UPDATE projects SET owner_user_id = NULL WHERE owner_user_id = ?', [id]); } catch (e) { /* skip */ }
      try { await conn.execute('UPDATE companies SET locked_by_user_id = NULL WHERE locked_by_user_id = ?', [id]); } catch (e) { /* skip */ }
      // ユーザー本体を削除
      await conn.execute('DELETE FROM users WHERE id = ?', [id]);

      await conn.execute('SET FOREIGN_KEY_CHECKS = 1');
      await conn.commit();
    } catch (e) {
      await conn.execute('SET FOREIGN_KEY_CHECKS = 1');
      await conn.rollback();
      throw e;
    } finally {
      conn.release();
    }

    logger.info(`ユーザー完全削除: ID ${id} (${userName})`);
    return ApiResponse.success(res, null, `${userName}を完全に削除しました`);
  } catch (err) {
    next(err);
  }
};

// ==================== オペレーター成績 ====================

/**
 * GET /api/admin/performance
 * 全オペレーター成績
 * Query: period=daily|weekly|monthly|cumulative, date=YYYY-MM-DD
 */
const getAllOperatorPerformance = async (req, res, next) => {
  try {
    const { period = 'daily', date, call_type } = req.query;
    let dateFrom, dateTo;
    if ((period === 'cumulative' || period === 'custom') && req.query.date_from && req.query.date_to) {
      dateFrom = req.query.date_from;
      dateTo = req.query.date_to;
    } else {
      const range = getDateRange(period, date || new Date().toISOString().slice(0, 10));
      if (!range) {
        return ApiResponse.badRequest(res, 'periodはdaily, weekly, monthly, cumulativeのいずれかです');
      }
      dateFrom = range.dateFrom;
      dateTo = range.dateTo;
    }
    const targetRoles = call_type === 'sales' ? "'sales'" : "'operator','intern'";
    const callTypeFilter = call_type === 'sales' ? "AND c.call_type = 'sales'" : "AND c.call_type = 'operator'";
    // 業務カテゴリ (技人国/特定技能) フィルタ。LEFT JOIN の ON 句で適用するため SQL に直接埋め込む。
    const { buildWorkCategoryFilter } = require('../middlewares/auth');
    const wcFilter = buildWorkCategoryFilter(req, 'c.work_category');

    const [rows] = await pool.query(
      `SELECT
        u.id as user_id, u.name, u.role, u.operator_level, u.is_active,
        COUNT(DISTINCT c.company_id) as total_calls,
        CAST(SUM(CASE WHEN c.is_effective_connection = 1 THEN 1 ELSE 0 END) AS SIGNED) as effective_connections,
        CAST(SUM(CASE WHEN c.is_person_in_charge = 1 THEN 1 ELSE 0 END) AS SIGNED) as person_connections,
        CAST(SUM(CASE WHEN c.result_code = 'PROJECT' THEN 1 ELSE 0 END) AS SIGNED) as projects,
        CAST(SUM(CASE WHEN c.result_code = 'RECALL' THEN 1 ELSE 0 END) AS SIGNED) as recall_gained,
        CAST(SUM(CASE WHEN c.result_code = 'NG' THEN 1 ELSE 0 END) AS SIGNED) as ng_count,
        COALESCE(ROUND(AVG(ae.overall_score), 1), 0) as avg_ai_score,
        COALESCE(ROUND(AVG(ae.opening_score), 1), 0) as avg_opening,
        COALESCE(ROUND(AVG(ae.clarity_score), 1), 0) as avg_clarity,
        COALESCE(ROUND(AVG(ae.hearing_score), 1), 0) as avg_hearing,
        COALESCE(ROUND(AVG(ae.rebuttal_score), 1), 0) as avg_rebuttal,
        COALESCE(ROUND(AVG(ae.closing_score), 1), 0) as avg_closing
      FROM users u
      LEFT JOIN calls c ON c.user_id = u.id AND DATE(c.call_started_at) BETWEEN ? AND ? AND c.result_code != 'SKIP' ${callTypeFilter}${wcFilter.sql}
      LEFT JOIN ai_evaluations ae ON ae.call_id = c.id
      WHERE u.role IN (${targetRoles}) AND u.is_test_account = 0
      GROUP BY u.id, u.name, u.role, u.is_active
      ORDER BY u.id ASC`,
      [dateFrom, dateTo, ...wcFilter.params]
    );

    // 平均通話時間（秒）を一括取得（ai_evaluations を JOIN しない素の calls で算出）
    //   call_ended_at - call_started_at の平均。SKIP・未終了は除外。
    const avgDurMap = new Map();
    try {
      const ctFilter = call_type === 'sales' ? "AND call_type = 'sales'" : "AND call_type = 'operator'";
      const avgWcSql = wcFilter.sql.replace(/c\.work_category/g, 'work_category');
      // 実通話時間(actual_duration_seconds: スプレッドシートG/H由来)を優先し、
      // 未取得の通話は操作時刻差分にフォールバック
      const [avgRows] = await pool.query(
        `SELECT user_id, ROUND(AVG(COALESCE(actual_duration_seconds, TIMESTAMPDIFF(SECOND, call_started_at, call_ended_at)))) AS avg_sec
           FROM calls
          WHERE result_code IS NOT NULL AND result_code != 'SKIP'
            AND (actual_duration_seconds IS NOT NULL OR call_ended_at IS NOT NULL)
            AND DATE(call_started_at) BETWEEN ? AND ? ${ctFilter} ${avgWcSql}
          GROUP BY user_id`,
        [dateFrom, dateTo, ...wcFilter.params]
      );
      for (const r of avgRows) avgDurMap.set(r.user_id, Number(r.avg_sec) || 0);
    } catch (e) { /* ignore */ }

    // リコール消化数と稼働時間を各オペレーターに追加
    for (const op of rows) {
      op.avg_call_seconds = avgDurMap.get(op.user_id) || 0;
      try {
        const [recallRows] = await pool.query(
          `SELECT COUNT(*) as cnt FROM recall_tasks WHERE user_id = ? AND status = 'completed' AND DATE(updated_at) BETWEEN ? AND ?`,
          [op.user_id, dateFrom, dateTo]
        );
        op.recall_done = recallRows[0]?.cnt || 0;
      } catch (e) {
        op.recall_done = 0;
      }

      try {
        // 業務カテゴリ (技人国/特定技能) フィルタ — work_hours.work_category で絞る
        const whWcSql = wcFilter.sql.replace(/c\.work_category/g, 'work_category');
        const [whRows] = await pool.query(
          `SELECT
             SUM(
               TIMESTAMPDIFF(MINUTE, STR_TO_DATE(start_time, '%H:%i'), STR_TO_DATE(end_time, '%H:%i'))
               - COALESCE(break_minutes, 0)
             ) as total_minutes,
             COUNT(DISTINCT date) as work_days
           FROM work_hours
           WHERE user_id = ? AND date BETWEEN ? AND ?
             AND start_time IS NOT NULL AND end_time IS NOT NULL
             ${whWcSql}`,
          [op.user_id, dateFrom, dateTo, ...wcFilter.params]
        );
        op.work_minutes = whRows[0]?.total_minutes || 0;
        op.work_days = whRows[0]?.work_days || 0;
      } catch (e) {
        op.work_minutes = 0;
        op.work_days = 0;
      }

      // 案件数: projectsテーブルから直接カウント（手動追加案件も含む）
      try {
        const projCTFilter = call_type === 'sales' ? "AND p.call_type = 'sales'" : "AND p.call_type = 'operator'";
        // 業務カテゴリ (技人国/特定技能) フィルタ。getAllOperatorPerformance 冒頭で構築済みの wcFilter を流用。
        const [projRows] = await pool.query(
          `SELECT COUNT(*) as cnt FROM projects p
           WHERE p.owner_user_id = ? AND p.is_legacy = 0 AND p.is_prospect = 0
             AND DATE(p.created_at) BETWEEN ? AND ? ${projCTFilter}
             ${wcFilter.sql.replace(/c\.work_category/g, 'p.work_category')}`,
          [op.user_id, dateFrom, dateTo, ...wcFilter.params]
        );
        op.projects = Number(projRows[0]?.cnt) || 0;
      } catch (e) { /* keep calls-based count */ }

      // KPI補正値: 日別は上書き、月別/週別/累計は集計（合計）として加算
      // kpi_adjustments テーブルには work_category 区分がないため、 特定技能が
      // 明示指定された画面 (specific-skill 管理 / ?work_category=specific_skill) のみ
      // KPI 補正をスキップ。 技人国 (デフォルト/明示) と全体表示では補正を適用。
      const skipKpiAdjustment = req.query.work_category === 'specific_skill';
      if (skipKpiAdjustment) {
        // 特定技能絞込時のみスキップ
      } else
      try {
        const [adjRows] = await pool.query(
          'SELECT field, date, value FROM kpi_adjustments WHERE user_id = ? AND date BETWEEN ? AND ?',
          [op.user_id, dateFrom, dateTo]
        );
        const fieldMap = {
          'call_count': 'total_calls',
          'recall_gained': 'recall_gained',
          'recall_done': 'recall_done',
          'effective_count': 'effective_connections',
          'person_count': 'person_connections',
          'project_count': 'projects',
        };
        if (period === 'daily') {
          // 日別: 単一日の値をそのまま置き換え
          for (const adj of adjRows) {
            const key = fieldMap[adj.field];
            if (key) op[key] = Number(adj.value);
          }
        } else {
          // 月別/週別/累計: 補正がある日については補正値を使い、その他は実績の合計を使う
          // 実装: 各補正レコードについて、その日の実績値を引いて補正値を加算する
          for (const adj of adjRows) {
            const key = fieldMap[adj.field];
            if (!key) continue;
            // その日の実績値を取得
            let actualForDay = 0;
            try {
              if (adj.field === 'recall_done') {
                const [r] = await pool.query(
                  `SELECT COUNT(*) as cnt FROM recall_tasks WHERE user_id = ? AND status = 'completed' AND DATE(updated_at) = ?`,
                  [op.user_id, adj.date]
                );
                actualForDay = Number(r[0]?.cnt) || 0;
              } else if (adj.field === 'project_count') {
                const projCTFilter = call_type === 'sales' ? "AND p.call_type = 'sales'" : "AND p.call_type = 'operator'";
                const wcSql = wcFilter.sql.replace(/c\.work_category/g, 'p.work_category');
                const [r] = await pool.query(
                  `SELECT COUNT(*) as cnt FROM projects p
                   WHERE p.owner_user_id = ? AND p.is_legacy = 0 AND p.is_prospect = 0
                     AND DATE(p.created_at) = ? ${projCTFilter} ${wcSql}`,
                  [op.user_id, adj.date, ...wcFilter.params]
                );
                actualForDay = Number(r[0]?.cnt) || 0;
              } else {
                // calls系
                const colMap = {
                  'call_count': 'COUNT(*)',
                  'effective_count': "SUM(CASE WHEN is_effective_connection = 1 THEN 1 ELSE 0 END)",
                  'person_count': "SUM(CASE WHEN is_person_in_charge = 1 THEN 1 ELSE 0 END)",
                  'recall_gained': "SUM(CASE WHEN result_code = 'RECALL' THEN 1 ELSE 0 END)",
                };
                const expr = colMap[adj.field];
                if (expr) {
                  const ctf = call_type === 'sales' ? "AND call_type = 'sales'" : "AND call_type = 'operator'";
                  const wcSql = wcFilter.sql.replace(/c\.work_category/g, 'work_category');
                  const [r] = await pool.query(
                    `SELECT ${expr} as v FROM calls WHERE user_id = ? AND DATE(call_started_at) = ? AND result_code != 'SKIP' ${ctf} ${wcSql}`,
                    [op.user_id, adj.date, ...wcFilter.params]
                  );
                  actualForDay = Number(r[0]?.v) || 0;
                }
              }
            } catch (e) { /* ignore */ }
            op[key] = (Number(op[key]) || 0) - actualForDay + Number(adj.value);
          }
        }
      } catch (e) { /* ignore */ }
    }

    // 無効ユーザーは数値が1以上の時のみ含める
    const filteredRows = rows.filter(r => {
      if (r.is_active) return true;
      return (Number(r.total_calls) || 0) > 0 || (Number(r.projects) || 0) > 0
        || (Number(r.recall_gained) || 0) > 0 || (Number(r.recall_done) || 0) > 0
        || (Number(r.effective_connections) || 0) > 0;
    });

    return ApiResponse.success(res, {
      period,
      dateFrom,
      dateTo,
      operators: filteredRows,
    });
  } catch (err) {
    next(err);
  }
};

// ==================== 架電リスト管理 ====================

/**
 * GET /api/admin/companies
 * 架電リスト一覧（割り当て状況含む）
 */
const getCompanies = async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, parseInt(req.query.limit) || 20);
    const offset = (page - 1) * limit;
    const { search, industry, category, actionable } = req.query;
    const includeExcluded = req.query.include_excluded === '1' || req.query.include_excluded === 'true';

    let whereClauses = [];
    if (!includeExcluded) whereClauses.push('co.exclusion_flag = 0');
    let params = [];

    if (search) {
      whereClauses.push('(co.company_name LIKE ? OR co.phone_number LIKE ?)');
      params.push(`%${search}%`, `%${search}%`);
    }
    if (industry) {
      whereClauses.push('co.industry = ?');
      params.push(industry);
    }
    // 大枠カテゴリフィルタ — industry_category カラムを使う (industry-stats と同じロジック)
    // 「その他」は NULL も含む。getCompaniesIndustryStats の `IFNULL(c.industry_category, 'その他')` と一致。
    if (category) {
      if (category === 'その他') {
        whereClauses.push(`(co.industry_category = 'その他' OR co.industry_category IS NULL)`);
      } else {
        whereClauses.push(`co.industry_category = ?`);
        params.push(category);
      }
    }
    // 未架電+不通のみフィルタ
    if (actionable === '1' || actionable === 'true') {
      whereClauses.push(`(co.last_called_at IS NULL OR (SELECT cl.result_code FROM calls cl WHERE cl.company_id = co.id ORDER BY cl.call_started_at DESC LIMIT 1) = 'NO_ANSWER')`);
    }

    // 地域(都道府県)フィルタ — 性能優先で 3 パターンのみ (中間一致は60万行で重いため除外)
    const { region } = req.query;
    if (region) {
      const short = String(region).replace(/(都|道|府|県)$/, '');
      whereClauses.push(`(
        co.region IN (?, ?)
        OR co.region LIKE CONCAT(?, '%')
        OR co.address LIKE CONCAT(?, '%')
      )`);
      params.push(region, short || region, short || region, region);
    }

    const whereStr = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

    const [countRows] = await pool.query(
      `SELECT COUNT(*) as total FROM companies co ${whereStr}`,
      params
    );

    const [rows] = await pool.query(
      `SELECT co.*,
        GROUP_CONCAT(DISTINCT CONCAT(u.id, ':', u.name) SEPARATOR ',') as assigned_operators
      FROM companies co
      LEFT JOIN company_assignments ca ON ca.company_id = co.id
      LEFT JOIN users u ON ca.user_id = u.id AND u.is_active = 1
      ${whereStr}
      GROUP BY co.id
      ORDER BY co.created_at DESC
      LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    // パース
    const companies = rows.map(r => ({
      ...r,
      assigned_operators: r.assigned_operators
        ? r.assigned_operators.split(',').map(s => {
            const [id, name] = s.split(':');
            return { id: parseInt(id), name };
          })
        : [],
    }));

    return ApiResponse.success(res, {
      companies,
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
 * POST /api/admin/companies/bulk-assign-special
 * 複数企業を「特別リスト」化して指定オペレーターに一括割り当て
 * Body: { company_ids: number[], user_id: number, filter?: { region, category, search } }
 *   filter が指定された場合 company_ids ではなくフィルタ条件にマッチする全企業を対象
 */
const bulkAssignSpecial = async (req, res, next) => {
  try {
    const { company_ids, user_id, filter } = req.body;
    const userIdNum = parseInt(user_id, 10);
    if (!userIdNum) return ApiResponse.badRequest(res, 'user_id が必要');

    // ユーザー存在チェック
    const [users] = await pool.query('SELECT id, name FROM users WHERE id = ? AND is_active = 1', [userIdNum]);
    if (users.length === 0) return ApiResponse.notFound(res, 'ユーザーが見つかりません (非アクティブを含む)');

    // 対象 company_id を決定
    let targetIds = [];
    if (Array.isArray(company_ids) && company_ids.length > 0) {
      targetIds = company_ids.map(x => parseInt(x, 10)).filter(x => x);
    } else if (filter && typeof filter === 'object') {
      // フィルタ条件で対象を抽出
      const whereParts = ['exclusion_flag = 0'];
      const fParams = [];
      // 複数都道府県対応 (regions=CSV) + 後方互換 (region=単一)
      let regList = [];
      if (filter.regions) {
        regList = String(filter.regions).split(',').map(s => s.trim()).filter(Boolean);
      } else if (filter.region) {
        regList = [String(filter.region).trim()].filter(Boolean);
      }
      if (regList.length > 0) {
        const orParts = [];
        for (const r of regList) {
          const short = r.replace(/(都|道|府|県)$/, '') || r;
          orParts.push(`(region IN (?, ?) OR region LIKE CONCAT(?, '%') OR address LIKE CONCAT(?, '%'))`);
          fParams.push(r, short, short, r);
        }
        whereParts.push(`(${orParts.join(' OR ')})`);
      }
      if (filter.industry_category) {
        whereParts.push('industry_category = ?');
        fParams.push(filter.industry_category);
      }
      if (filter.search) {
        whereParts.push('(company_name LIKE ? OR phone_number LIKE ?)');
        fParams.push(`%${filter.search}%`, `%${filter.search}%`);
      }
      const fLimit = Math.min(10000, parseInt(filter.limit, 10) || 1000);
      const [rows] = await pool.query(
        `SELECT id FROM companies WHERE ${whereParts.join(' AND ')} LIMIT ?`,
        [...fParams, fLimit]
      );
      targetIds = rows.map(r => r.id);
    }

    if (targetIds.length === 0) return ApiResponse.badRequest(res, '対象企業が0件です');

    // is_special を立てて、company_assignments に手動割り当て (is_auto=0) を作る
    const placeholders = targetIds.map(() => '?').join(',');
    await pool.execute(
      `UPDATE companies SET is_special = 1 WHERE id IN (${placeholders})`,
      targetIds
    );
    let assigned = 0;
    for (const cid of targetIds) {
      try {
        const [r] = await pool.execute(
          'INSERT IGNORE INTO company_assignments (company_id, user_id, assigned_by, is_auto) VALUES (?, ?, ?, 0)',
          [cid, userIdNum, req.user.id]
        );
        if (r.affectedRows > 0) assigned++;
      } catch (e) { /* dup */ }
    }
    logger.info(`[bulkAssignSpecial] target=${targetIds.length} → is_special set, assigned=${assigned} to user=${userIdNum}`);
    return ApiResponse.success(res, {
      target_count: targetIds.length,
      assigned,
      user: users[0],
    }, `${targetIds.length}社を特別リスト化し${assigned}件を ${users[0].name} に割り当てました`);
  } catch (err) {
    logger.error(`[bulkAssignSpecial] ${err.message}`);
    next(err);
  }
};

/**
 * POST /api/admin/companies/assign
 * 企業をOPに割り当て
 */
const assignCompany = async (req, res, next) => {
  try {
    const { company_id, user_id } = req.body;

    if (!company_id || !user_id) {
      return ApiResponse.badRequest(res, '企業IDとユーザーIDは必須です');
    }

    // ユーザーが存在しoperatorか確認
    const [userRows] = await pool.execute(
      'SELECT id, role FROM users WHERE id = ? AND is_active = 1',
      [user_id]
    );
    if (userRows.length === 0) {
      return ApiResponse.notFound(res, 'ユーザーが見つかりません');
    }

    try {
      await pool.execute(
        'INSERT INTO company_assignments (company_id, user_id, assigned_by) VALUES (?, ?, ?)',
        [company_id, user_id, req.user.id]
      );
    } catch (err) {
      if (err.code === 'ER_DUP_ENTRY') {
        return ApiResponse.badRequest(res, 'この企業は既にこのオペレーターに割り当て済みです');
      }
      throw err;
    }

    logger.info(`企業割り当て: company=${company_id} → user=${user_id}`);
    return ApiResponse.created(res, null, '割り当てを追加しました');
  } catch (err) {
    next(err);
  }
};

/**
 * DELETE /api/admin/companies/:companyId/assign/:userId
 * 割り当て解除（企業IDとユーザーIDのペアで削除）
 */
const unassignCompany = async (req, res, next) => {
  try {
    const { companyId, userId } = req.params;

    const [result] = await pool.execute(
      'DELETE FROM company_assignments WHERE company_id = ? AND user_id = ?',
      [companyId, userId]
    );

    if (result.affectedRows === 0) {
      return ApiResponse.notFound(res, '割り当てが見つかりません');
    }

    logger.info(`企業割り当て解除: company=${companyId}, user=${userId}`);
    return ApiResponse.success(res, null, '割り当てを解除しました');
  } catch (err) {
    next(err);
  }
};

// ==================== 業種×地域ルール ====================

/**
 * GET /api/admin/industry-region-rules
 * ルール一覧 + 選択肢（業種・地域のDISTINCT）
 */
const getIndustryRegionRules = async (req, res, next) => {
  try {
    const [rules] = await pool.query(
      'SELECT id, industry_name, region, created_at FROM industry_region_rules ORDER BY industry_name, region'
    );
    // 企業テーブルから業種・地域の選択肢を取得
    const [industries] = await pool.query(
      "SELECT DISTINCT industry FROM companies WHERE industry IS NOT NULL AND industry != '' ORDER BY industry"
    );
    const [regions] = await pool.query(
      "SELECT DISTINCT region FROM companies WHERE region IS NOT NULL AND region != '' ORDER BY region"
    );

    return ApiResponse.success(res, {
      rules,
      industries: industries.map(r => r.industry),
      regions: regions.map(r => r.region),
    });
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/admin/industry-region-rules
 * ルール追加
 */
const addIndustryRegionRule = async (req, res, next) => {
  try {
    const { industry_name, region } = req.body;
    if (!industry_name || !region) {
      return ApiResponse.badRequest(res, '業種と地域は必須です');
    }
    try {
      const [result] = await pool.execute(
        'INSERT INTO industry_region_rules (industry_name, region) VALUES (?, ?)',
        [industry_name, region]
      );
      logger.info(`エリアルール追加: ${industry_name} → ${region}`);
      return ApiResponse.created(res, { id: result.insertId, industry_name, region }, 'ルールを追加しました');
    } catch (err) {
      if (err.code === 'ER_DUP_ENTRY') {
        return ApiResponse.badRequest(res, 'このルールは既に登録されています');
      }
      throw err;
    }
  } catch (err) {
    next(err);
  }
};

/**
 * DELETE /api/admin/industry-region-rules/:id
 * ルール削除
 */
const deleteIndustryRegionRule = async (req, res, next) => {
  try {
    const { id } = req.params;
    const [result] = await pool.execute('DELETE FROM industry_region_rules WHERE id = ?', [id]);
    if (result.affectedRows === 0) {
      return ApiResponse.notFound(res, 'ルールが見つかりません');
    }
    logger.info(`エリアルール削除: ID ${id}`);
    return ApiResponse.success(res, null, 'ルールを削除しました');
  } catch (err) {
    next(err);
  }
};

// ==================== 業種別NGワード ====================

/**
 * GET /api/admin/exclude-words
 * NGワード一覧
 */
const getExcludeWords = async (req, res, next) => {
  try {
    const [rows] = await pool.query(
      'SELECT id, industry_name, keyword, created_at FROM industry_exclude_words ORDER BY industry_name, keyword'
    );
    return ApiResponse.success(res, rows);
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/admin/exclude-words
 * NGワード追加
 */
const addExcludeWord = async (req, res, next) => {
  try {
    const { keyword } = req.body;
    const industry_name = '*'; // 全業種共通
    if (!keyword) {
      return ApiResponse.badRequest(res, 'NGワードは必須です');
    }
    try {
      const [result] = await pool.execute(
        'INSERT INTO industry_exclude_words (industry_name, keyword) VALUES (?, ?)',
        [industry_name, keyword]
      );
      logger.info(`NGワード追加: ${industry_name} → ${keyword}`);
      return ApiResponse.created(res, { id: result.insertId, industry_name, keyword }, 'NGワードを追加しました');
    } catch (err) {
      if (err.code === 'ER_DUP_ENTRY') {
        return ApiResponse.badRequest(res, 'このNGワードは既に登録されています');
      }
      throw err;
    }
  } catch (err) {
    next(err);
  }
};

/**
 * DELETE /api/admin/exclude-words/:id
 * NGワード削除
 */
const deleteExcludeWord = async (req, res, next) => {
  try {
    const { id } = req.params;
    const [result] = await pool.execute('DELETE FROM industry_exclude_words WHERE id = ?', [id]);
    if (result.affectedRows === 0) {
      return ApiResponse.notFound(res, 'NGワードが見つかりません');
    }
    logger.info(`NGワード削除: ID ${id}`);
    return ApiResponse.success(res, null, 'NGワードを削除しました');
  } catch (err) {
    next(err);
  }
};

// ==================== 架電時間ルール ====================

/**
 * GET /api/admin/time-rules
 * 業種別ゴールデンタイムルール一覧
 */
const getTimeRules = async (req, res, next) => {
  try {
    const [rows] = await pool.query(
      'SELECT * FROM industry_time_rules ORDER BY industry_name, start_time'
    );
    return ApiResponse.success(res, rows);
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/admin/time-rules
 * ゴールデンタイムルール追加
 */
const addTimeRule = async (req, res, next) => {
  try {
    const { industry_name, start_time, end_time, priority_weight } = req.body;
    if (!industry_name || !start_time || !end_time) {
      return ApiResponse.badRequest(res, '業種・開始時間・終了時間は必須です');
    }
    const [result] = await pool.execute(
      'INSERT INTO industry_time_rules (industry_name, start_time, end_time, priority_weight) VALUES (?, ?, ?, ?)',
      [industry_name, start_time, end_time, priority_weight || 10]
    );
    logger.info(`架電時間ルール追加: ${industry_name} ${start_time}-${end_time} (weight:${priority_weight})`);
    return ApiResponse.success(res, { id: result.insertId }, '架電時間ルールを追加しました');
  } catch (err) {
    next(err);
  }
};

/**
 * PUT /api/admin/time-rules/:id
 * ゴールデンタイムルール更新
 */
const updateTimeRule = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { industry_name, start_time, end_time, priority_weight } = req.body;
    if (!industry_name || !start_time || !end_time) {
      return ApiResponse.badRequest(res, '業種・開始時間・終了時間は必須です');
    }
    const [result] = await pool.execute(
      'UPDATE industry_time_rules SET industry_name = ?, start_time = ?, end_time = ?, priority_weight = ? WHERE id = ?',
      [industry_name, start_time, end_time, priority_weight || 10, id]
    );
    if (result.affectedRows === 0) {
      return ApiResponse.notFound(res, 'ルールが見つかりません');
    }
    logger.info(`架電時間ルール更新: ID ${id} → ${industry_name} ${start_time}-${end_time} (weight: ${priority_weight})`);
    return ApiResponse.success(res, null, '架電時間ルールを更新しました');
  } catch (err) {
    next(err);
  }
};

/**
 * DELETE /api/admin/time-rules/:id
 * ゴールデンタイムルール削除
 */
const deleteTimeRule = async (req, res, next) => {
  try {
    const { id } = req.params;
    const [result] = await pool.execute('DELETE FROM industry_time_rules WHERE id = ?', [id]);
    if (result.affectedRows === 0) {
      return ApiResponse.notFound(res, 'ルールが見つかりません');
    }
    logger.info(`架電時間ルール削除: ID ${id}`);
    return ApiResponse.success(res, null, '架電時間ルールを削除しました');
  } catch (err) {
    next(err);
  }
};

// module.exports is at the end of the file after all function definitions

/**
 * GET /api/admin/special-list-batches
 * 特別リストバッチ一覧 + 架電進捗
 */
const getSpecialListBatches = async (req, res, next) => {
  try {
    const [batches] = await pool.query(
      `SELECT b.id, b.name, b.total_count, b.created_at, u.name as created_by_name,
        (SELECT COUNT(*) FROM companies c WHERE c.import_batch_id = b.id) as current_count,
        (SELECT COUNT(DISTINCT cl.company_id) FROM calls cl JOIN companies c2 ON cl.company_id = c2.id
         WHERE c2.import_batch_id = b.id AND cl.result_code IS NOT NULL AND cl.result_code != 'SKIP') as called_count,
        (SELECT COUNT(DISTINCT cl.company_id) FROM calls cl JOIN companies c2 ON cl.company_id = c2.id
         WHERE c2.import_batch_id = b.id AND cl.result_code = 'NO_ANSWER') as no_answer_count,
        (SELECT COUNT(DISTINCT cl.company_id) FROM calls cl JOIN companies c2 ON cl.company_id = c2.id
         WHERE c2.import_batch_id = b.id AND cl.result_code = 'NG') as ng_count,
        (SELECT COUNT(DISTINCT cl.company_id) FROM calls cl JOIN companies c2 ON cl.company_id = c2.id
         WHERE c2.import_batch_id = b.id AND cl.result_code = 'RECALL') as recall_count,
        (SELECT COUNT(DISTINCT cl.company_id) FROM calls cl JOIN companies c2 ON cl.company_id = c2.id
         WHERE c2.import_batch_id = b.id AND cl.result_code = 'INTERESTED') as interested_count,
        (SELECT COUNT(DISTINCT cl.company_id) FROM calls cl JOIN companies c2 ON cl.company_id = c2.id
         WHERE c2.import_batch_id = b.id AND cl.result_code = 'PROJECT') as project_count
       FROM import_batches b
       LEFT JOIN users u ON b.created_by = u.id
       WHERE b.list_type = 'special'
       ORDER BY b.created_at DESC`
    );
    return ApiResponse.success(res, batches);
  } catch (err) { next(err); }
};

/**
 * GET /api/admin/special-list-batches/:id/details
 * バッチ内の全企業 + 架電結果詳細
 */
const getSpecialListBatchDetails = async (req, res, next) => {
  try {
    const { id } = req.params;
    const [companies] = await pool.query(
      `SELECT c.id, c.company_name, c.phone_number, c.industry, c.region,
        (SELECT COUNT(*) FROM calls cl WHERE cl.company_id = c.id AND cl.result_code IS NOT NULL AND cl.result_code != 'SKIP') as call_count,
        (SELECT cl.result_code FROM calls cl WHERE cl.company_id = c.id AND cl.result_code IS NOT NULL ORDER BY cl.call_started_at DESC LIMIT 1) as last_result,
        (SELECT cl.call_started_at FROM calls cl WHERE cl.company_id = c.id AND cl.result_code IS NOT NULL ORDER BY cl.call_started_at DESC LIMIT 1) as last_called_at,
        (SELECT cl.memo FROM calls cl WHERE cl.company_id = c.id AND cl.result_code IS NOT NULL ORDER BY cl.call_started_at DESC LIMIT 1) as last_memo,
        (SELECT u.name FROM calls cl JOIN users u ON cl.user_id = u.id WHERE cl.company_id = c.id AND cl.result_code IS NOT NULL ORDER BY cl.call_started_at DESC LIMIT 1) as last_caller
       FROM companies c
       WHERE c.import_batch_id = ?
       ORDER BY c.id ASC`,
      [id]
    );
    return ApiResponse.success(res, companies);
  } catch (err) { next(err); }
};

/**
 * GET /api/admin/special-list-batches/:id/export
 * CSVエクスポート
 */
const exportSpecialListBatch = async (req, res, next) => {
  try {
    const { id } = req.params;
    const [batch] = await pool.query('SELECT name FROM import_batches WHERE id = ?', [id]);
    const [companies] = await pool.query(
      `SELECT c.company_name, c.phone_number, c.industry, c.region,
        (SELECT COUNT(*) FROM calls cl WHERE cl.company_id = c.id AND cl.result_code IS NOT NULL AND cl.result_code != 'SKIP') as call_count,
        (SELECT cl.result_code FROM calls cl WHERE cl.company_id = c.id AND cl.result_code IS NOT NULL ORDER BY cl.call_started_at DESC LIMIT 1) as last_result,
        (SELECT cl.call_started_at FROM calls cl WHERE cl.company_id = c.id AND cl.result_code IS NOT NULL ORDER BY cl.call_started_at DESC LIMIT 1) as last_called_at,
        (SELECT cl.memo FROM calls cl WHERE cl.company_id = c.id AND cl.result_code IS NOT NULL ORDER BY cl.call_started_at DESC LIMIT 1) as last_memo,
        (SELECT u.name FROM calls cl JOIN users u ON cl.user_id = u.id WHERE cl.company_id = c.id AND cl.result_code IS NOT NULL ORDER BY cl.call_started_at DESC LIMIT 1) as last_caller
       FROM companies c WHERE c.import_batch_id = ? ORDER BY c.id ASC`,
      [id]
    );

    const RESULT_LABELS = { NO_ANSWER: '不通', NG: 'NG', RECALL: 'リコール', INTERESTED: '興味あり', PROJECT: '案件化', SKIP: 'SKIP' };
    const header = '企業名,電話番号,業種,地域,架電回数,最終結果,最終架電日,架電者,メモ\n';
    const rows = companies.map(c =>
      [c.company_name, c.phone_number, c.industry || '', c.region || '', c.call_count,
       RESULT_LABELS[c.last_result] || c.last_result || '未架電', c.last_called_at || '', c.last_caller || '', (c.last_memo || '').replace(/[\n\r,]/g, ' ')
      ].map(v => `"${v}"`).join(',')
    ).join('\n');

    const bom = '\uFEFF';
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent((batch[0]?.name || 'export') + '.csv')}"`);
    res.send(bom + header + rows);
  } catch (err) { next(err); }
};

/**
 * PUT /api/admin/kpi-adjustment
 * KPI補正値を保存（管理者のみ）
 * { user_id, date, field, value }
 * value = 最終的な目標値（差分ではなく絶対値）
 */
const saveKpiAdjustment = async (req, res, next) => {
  try {
    const { user_id, date, field, value } = req.body;
    const validFields = [
      'call_count', 'recall_gained', 'recall_done', 'effective_count', 'person_count', 'project_count',
      // 案件質向上フィールド
      'q_lost', 'q_waiting_contact', 'q_interview_set', 'q_interview_done', 'q_barashi',
      'q_online_interview', 'q_no_screening', 'q_screening_failed',
    ];
    if (!user_id || !date || !field || !validFields.includes(field)) {
      return ApiResponse.badRequest(res, 'user_id, date, field（有効なフィールド名）は必須です');
    }
    await pool.execute(
      `INSERT INTO kpi_adjustments (user_id, date, field, value, updated_by)
       VALUES (?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE value = VALUES(value), updated_by = VALUES(updated_by)`,
      [user_id, date, field, parseInt(value) || 0, req.user.id]
    );
    logger.info(`KPI補正: user=${user_id}, date=${date}, ${field}=${value}, by=${req.user.id}`);
    return ApiResponse.success(res, null, 'KPIを更新しました');
  } catch (err) { next(err); }
};

/**
 * POST /api/admin/time-rules/ai-suggest
 * AIによるゴールデンタイム自動設定
 * 過去の架電接続データを業種×時間帯で分析し、最適なルールを生成
 */
const aiSuggestTimeRules = async (req, res, next) => {
  try {
    const { apply, industries } = req.body; // true: 即適用 / industries: 対象業種の配列

    // 対象業種が未指定または空ならエラー
    if (!Array.isArray(industries) || industries.length === 0) {
      return ApiResponse.badRequest(res, '対象業種を1つ以上指定してください');
    }

    // 過去の架電データを業種×時間帯で集計（直近3ヶ月、指定業種のみ）
    const placeholders = industries.map(() => '?').join(',');
    const [stats] = await pool.query(`
      SELECT
        co.industry,
        HOUR(c.call_started_at) as call_hour,
        COUNT(*) as total_calls,
        SUM(CASE WHEN c.result_code NOT IN ('NO_ANSWER','SKIP') THEN 1 ELSE 0 END) as connected_calls,
        SUM(c.is_effective_connection) as effective_calls,
        SUM(c.is_person_in_charge) as person_in_charge_calls,
        SUM(CASE WHEN c.result_code IN ('INTERESTED','PROJECT') THEN 1 ELSE 0 END) as positive_results
      FROM calls c
      JOIN companies co ON c.company_id = co.id
      WHERE c.call_started_at >= DATE_SUB(DATE_ADD(UTC_TIMESTAMP(), INTERVAL 9 HOUR), INTERVAL 3 MONTH)
        AND c.result_code IS NOT NULL
        AND c.result_code != 'SKIP'
        AND co.industry IN (${placeholders})
      GROUP BY co.industry, HOUR(c.call_started_at)
      HAVING total_calls >= 3
      ORDER BY co.industry, call_hour
    `, industries);

    if (stats.length === 0) {
      return ApiResponse.badRequest(res, '分析に必要な架電データが不足しています（直近3ヶ月で業種別3件以上必要）');
    }

    // 業種ごとにデータを整理
    const industryData = {};
    for (const row of stats) {
      if (!industryData[row.industry]) industryData[row.industry] = [];
      industryData[row.industry].push({
        hour: row.call_hour,
        totalCalls: Number(row.total_calls),
        connectedCalls: Number(row.connected_calls),
        effectiveCalls: Number(row.effective_calls),
        personInCharge: Number(row.person_in_charge_calls),
        positiveResults: Number(row.positive_results),
        connectionRate: row.total_calls > 0 ? Math.round(Number(row.connected_calls) / Number(row.total_calls) * 100) : 0,
        effectiveRate: row.total_calls > 0 ? Math.round(Number(row.effective_calls) / Number(row.total_calls) * 100) : 0,
      });
    }

    // AI分析用プロンプト作成
    const Anthropic = require('@anthropic-ai/sdk');
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    const dataText = Object.entries(industryData).map(([industry, hours]) => {
      const hourLines = hours.map(h =>
        `  ${h.hour}時台: 架電${h.totalCalls}件, 接続${h.connectedCalls}件(${h.connectionRate}%), 有効接続${h.effectiveCalls}件(${h.effectiveRate}%), 担当者接続${h.personInCharge}件, 案件化${h.positiveResults}件`
      ).join('\n');
      return `【${industry}】\n${hourLines}`;
    }).join('\n\n');

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 2000,
      temperature: 0.2,
      system: `あなたは法人営業のコールセンター最適化AIです。
業種別・時間帯別の架電データを分析し、ゴールデンタイム（優先的に架電すべき時間帯）を提案してください。

以下の基準で判断してください：
- 接続率（電話がつながる率）が高い時間帯
- 有効接続率（担当者・決裁者につながる率）が高い時間帯
- 案件化率（INTERESTED/PROJECT）が高い時間帯
- データ量が少ない時間帯は信頼度を下げる

各業種について、最大2つの時間帯（ゴールデンタイム）を提案してください。
1時間〜2時間の範囲で設定し、優先度(priority_weight)は5〜30で設定してください。

必ず以下のJSON形式で返答してください：
{
  "rules": [
    {
      "industry_name": "業種名",
      "start_time": "HH:MM",
      "end_time": "HH:MM",
      "priority_weight": 数値,
      "reason": "この時間帯を推奨する理由（1行）"
    }
  ],
  "analysis_summary": "全体分析の要約（2-3行）"
}`,
      messages: [{ role: 'user', content: `以下の架電データを分析し、業種別のゴールデンタイムを提案してください。\n\n${dataText}` }],
    });

    const text = response.content[0].text;
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return ApiResponse.error(res, 'AI分析結果の解析に失敗しました', 500);
    }
    const aiResult = JSON.parse(jsonMatch[0]);

    // 適用モード: 指定業種の既存ルールのみ削除して新ルールを挿入
    if (apply) {
      await pool.execute(
        `DELETE FROM industry_time_rules WHERE industry_name IN (${placeholders})`,
        industries
      );
      for (const rule of aiResult.rules) {
        // AI返却のルールが指定業種のものかチェック
        if (!industries.includes(rule.industry_name)) continue;
        await pool.execute(
          'INSERT INTO industry_time_rules (industry_name, start_time, end_time, priority_weight) VALUES (?, ?, ?, ?)',
          [rule.industry_name, rule.start_time, rule.end_time, rule.priority_weight || 10]
        );
      }
      logger.info(`AI ゴールデンタイム自動設定: 業種=${industries.join(',')} ${aiResult.rules.length}件 by user=${req.user.id}`);
    }

    return ApiResponse.success(res, {
      rules: aiResult.rules,
      summary: aiResult.analysis_summary,
      rawData: industryData,
      applied: !!apply,
    });
  } catch (err) {
    logger.error(`AI ゴールデンタイム分析エラー: ${err.message}`);
    next(err);
  }
};

/**
 * POST /api/admin/apply-rules-to-existing
 * 現在の業種地域ルール・NGワード・NG/既存案件リストを既存の企業（特別リスト除く）に
 * 適用し、該当する企業を exclusion_flag=1 に更新
 */
/**
 * POST /api/admin/restore-mylist-exclusions
 * 自分リスト（imported_by_user_id IS NOT NULL）で誤って除外された企業を復旧
 */
const restoreMylistExclusions = async (req, res, next) => {
  try {
    // NGリスト・既存案件リストに一致する企業は残す（本来除外されるべき）
    const [r] = await pool.query(`
      UPDATE companies
      SET exclusion_flag = 0
      WHERE imported_by_user_id IS NOT NULL
        AND exclusion_flag = 1
        AND phone_number NOT IN (SELECT phone_number FROM exclusion_lists WHERE phone_number IS NOT NULL AND phone_number != '')
        AND company_name NOT IN (SELECT company_name FROM exclusion_lists WHERE company_name IS NOT NULL AND company_name != '')
    `);
    logger.info(`[RestoreMyList] ${r.affectedRows}件の自分リストを復旧`);
    return ApiResponse.success(res, { restored: r.affectedRows }, `${r.affectedRows}件の自分リストを復旧しました`);
  } catch (err) {
    logger.error(`[RestoreMyList] error: ${err.message}`);
    return ApiResponse.error(res, err.message, 500);
  }
};

const applyRulesToExistingCompanies = async (req, res, next) => {
  const startTime = Date.now();
  const errors = [];
  let byExclusionList = 0, ngMatched = 0, byRegionRule = 0;
  let ngKeywordsUsed = [];

  // 一致するIDを取得して、IDリストでUPDATE（大量UPDATEのロック/タイムアウト回避）
  const updateByIds = async (ids) => {
    const CHUNK = 500;
    let total = 0;
    for (let i = 0; i < ids.length; i += CHUNK) {
      const chunk = ids.slice(i, i + CHUNK);
      const placeholders = chunk.map(() => '?').join(',');
      const [r] = await pool.query(
        `UPDATE companies SET exclusion_flag = 1 WHERE id IN (${placeholders}) AND exclusion_flag = 0`,
        chunk
      );
      total += r.affectedRows;
    }
    return total;
  };

  // 共通条件: 特別リスト（is_special）と自分リスト（imported_by_user_id）は対象外
  const baseCond = `(IFNULL(is_special, 0) = 0) AND exclusion_flag = 0 AND imported_by_user_id IS NULL`;

  // 1. NGリスト/既存案件リストに一致
  try {
    logger.info('[ApplyRules] Step1: exclusion_list開始');
    const [rows] = await pool.query(
      `SELECT id FROM companies
       WHERE ${baseCond}
         AND (
           phone_number IN (SELECT phone_number FROM exclusion_lists WHERE phone_number IS NOT NULL AND phone_number != '')
           OR company_name IN (SELECT company_name FROM exclusion_lists WHERE company_name IS NOT NULL AND company_name != '')
         )`
    );
    logger.info(`[ApplyRules] Step1: 対象${rows.length}件`);
    byExclusionList = await updateByIds(rows.map(r => r.id));
    logger.info(`[ApplyRules] Step1完了: ${byExclusionList}件更新 (${Date.now()-startTime}ms)`);
  } catch (e) {
    logger.error(`[ApplyRules] Step1エラー: ${e.message}\n${e.stack}`);
    errors.push(`NGリスト判定: ${e.message}`);
  }

  // 2. NGワード
  const ngKeywordStats = [];
  try {
    logger.info('[ApplyRules] Step2: NGワード開始');
    const [ngWords] = await pool.query('SELECT keyword FROM industry_exclude_words');
    ngKeywordsUsed = ngWords.map(w => (w.keyword || '').trim()).filter(k => k);
    logger.info(`[ApplyRules] Step2: NGワード${ngKeywordsUsed.length}件`);

    // 既存除外数を事前確認
    const [stats] = await pool.query(
      `SELECT
        SUM(CASE WHEN exclusion_flag = 1 THEN 1 ELSE 0 END) as already_excluded,
        SUM(CASE WHEN exclusion_flag = 0 AND IFNULL(is_special,0) = 0 THEN 1 ELSE 0 END) as eligible
       FROM companies`
    );
    logger.info(`[ApplyRules] 既除外=${stats[0].already_excluded}, 対象候補=${stats[0].eligible}`);

    for (const kw of ngKeywordsUsed) {
      try {
        // 全体一致件数（既除外含む）
        const [allMatchR] = await pool.query(
          `SELECT COUNT(*) as cnt FROM companies
           WHERE (company_name LIKE ? OR industry LIKE ? OR job_type LIKE ? OR comment LIKE ?)`,
          [`%${kw}%`, `%${kw}%`, `%${kw}%`, `%${kw}%`]
        );
        // 未除外かつ自分リスト/特別リスト以外
        const [rows] = await pool.query(
          `SELECT id FROM companies
           WHERE ${baseCond}
             AND (company_name LIKE ? OR industry LIKE ? OR job_type LIKE ? OR comment LIKE ?)`,
          [`%${kw}%`, `%${kw}%`, `%${kw}%`, `%${kw}%`]
        );
        const n = await updateByIds(rows.map(r => r.id));
        const s = { keyword: kw, totalMatch: Number(allMatchR[0].cnt), updated: n };
        ngKeywordStats.push(s);
        logger.info(`[ApplyRules] NGワード「${kw}」: 全体一致${s.totalMatch}件 / 対象${rows.length}件 / 更新${n}件`);
        ngMatched += n;
      } catch (e) {
        logger.error(`[ApplyRules] NGワード「${kw}」エラー: ${e.message}`);
        errors.push(`NGワード「${kw}」: ${e.message}`);
      }
    }
    logger.info(`[ApplyRules] Step2完了: ${ngMatched}件 (${Date.now()-startTime}ms)`);
  } catch (e) {
    logger.error(`[ApplyRules] Step2エラー: ${e.message}\n${e.stack}`);
    errors.push(`NGワード: ${e.message}`);
  }

  // 3. 業種地域ルール
  try {
    logger.info('[ApplyRules] Step3: 業種地域ルール開始');
    const [ruleCount] = await pool.query('SELECT COUNT(*) as cnt FROM industry_region_rules');
    if (Number(ruleCount[0].cnt) > 0) {
      const [rows] = await pool.query(
        `SELECT id FROM companies
         WHERE ${baseCond}
           AND NOT EXISTS (
             SELECT 1 FROM industry_region_rules irr
             WHERE companies.industry LIKE CONCAT('%', irr.industry_name, '%')
               AND companies.address LIKE CONCAT(irr.region, '%')
           )`
      );
      byRegionRule = await updateByIds(rows.map(r => r.id));
    }
    logger.info(`[ApplyRules] Step3完了: ${byRegionRule}件 (${Date.now()-startTime}ms)`);
  } catch (e) {
    logger.error(`[ApplyRules] Step3エラー: ${e.message}\n${e.stack}`);
    errors.push(`業種地域ルール: ${e.message}`);
  }

  const excludedCount = byExclusionList + ngMatched + byRegionRule;
  logger.info(`[ApplyRules] 全完了: total=${excludedCount}, errors=${errors.length}, ${Date.now()-startTime}ms`);
  // 除外フラグのカウント（適用後状態）
  let flagStats = null;
  try {
    const [s] = await pool.query(
      `SELECT
        SUM(CASE WHEN exclusion_flag = 1 THEN 1 ELSE 0 END) as excluded,
        SUM(CASE WHEN exclusion_flag = 0 THEN 1 ELSE 0 END) as active,
        COUNT(*) as total
       FROM companies WHERE IFNULL(is_special,0) = 0`
    );
    flagStats = {
      excluded: Number(s[0].excluded),
      active: Number(s[0].active),
      total: Number(s[0].total),
    };
  } catch (e) { /* skip */ }

  return ApiResponse.success(res, {
    total: excludedCount,
    byExclusionList,
    byNgWord: ngMatched,
    byRegionRule,
    ngKeywordsUsed,
    ngKeywordStats,
    flagStats,
    errors,
    elapsedMs: Date.now() - startTime,
  }, errors.length > 0 ? `${excludedCount}件除外（${errors.length}件エラー発生）` : `${excludedCount}件の企業を除外しました`);
};

/**
 * POST /api/admin/work-category-swap
 * 指定オペレーターの指定期間内のデータ (calls / projects / work_hours) の
 * work_category を一括変更する。 dry_run=true なら影響件数のみ返し、 実 UPDATE はしない。
 * Body: { user_id, date_from, date_to, from, to, dry_run }
 */
const swapWorkCategory = async (req, res) => {
  const { user_id, date_from, date_to, from, to, dry_run } = req.body || {};
  if (!user_id || !date_from || !date_to || !from || !to) {
    return ApiResponse.badRequest(res, 'user_id, date_from, date_to, from, to は必須です');
  }
  const VALID = ['general', 'specific_skill'];
  if (!VALID.includes(from) || !VALID.includes(to)) {
    return ApiResponse.badRequest(res, 'from / to は general または specific_skill のみ');
  }
  if (from === to) {
    return ApiResponse.badRequest(res, 'from と to が同じです');
  }
  const isDryRun = !!dry_run;
  try {
    // ユーザー存在確認
    const [userRows] = await pool.query('SELECT id, name FROM users WHERE id = ? LIMIT 1', [user_id]);
    if (userRows.length === 0) return ApiResponse.notFound(res, 'オペレーターが見つかりません');
    const userName = userRows[0].name;

    // 影響対象を SELECT で件数確認
    const targets = [
      { table: 'calls',      user_col: 'user_id',       date_col: 'DATE(call_started_at)' },
      { table: 'projects',   user_col: 'owner_user_id', date_col: 'DATE(created_at)' },
      { table: 'work_hours', user_col: 'user_id',       date_col: 'date' },
    ];
    const counts = {};
    for (const t of targets) {
      const [r] = await pool.query(
        `SELECT COUNT(*) AS cnt FROM ${t.table} WHERE ${t.user_col} = ? AND ${t.date_col} BETWEEN ? AND ? AND work_category = ?`,
        [user_id, date_from, date_to, from]
      );
      counts[t.table] = Number(r[0].cnt) || 0;
    }
    const totalAffected = Object.values(counts).reduce((s, n) => s + n, 0);
    if (isDryRun) {
      return ApiResponse.success(res, {
        dryRun: true, userName, from, to, dateFrom: date_from, dateTo: date_to, counts, totalAffected,
      }, `${totalAffected}件が対象 (dry-run)`);
    }

    // 実行: 各テーブルで UPDATE
    const updated = {};
    for (const t of targets) {
      const [r] = await pool.execute(
        `UPDATE ${t.table} SET work_category = ? WHERE ${t.user_col} = ? AND ${t.date_col} BETWEEN ? AND ? AND work_category = ?`,
        [to, user_id, date_from, date_to, from]
      );
      updated[t.table] = r.affectedRows || 0;
    }
    const totalUpdated = Object.values(updated).reduce((s, n) => s + n, 0);
    logger.info(`[swapWorkCategory] user=${user_id}(${userName}) ${date_from}〜${date_to} ${from}→${to} updated=${JSON.stringify(updated)}`);
    return ApiResponse.success(res, {
      dryRun: false, userName, from, to, dateFrom: date_from, dateTo: date_to, updated, totalUpdated,
    }, `${totalUpdated}件のレコードを ${from} → ${to} に振替えました`);
  } catch (err) {
    logger.error(`[swapWorkCategory] ${err.code || ''} ${err.message}`);
    return ApiResponse.error(res, `振替に失敗しました: ${err.sqlMessage || err.message}`, 500, {
      code: err.code, sqlMessage: err.sqlMessage, sql: (err.sql || '').slice(0, 300),
    });
  }
};

/**
 * GET /api/admin/ng-detail
 * 指定オペレーター・期間・業務カテゴリの NG 架電一覧を返す。
 * Query: user_id, date_from, date_to, work_category(任意)
 * 列: 架電日時 / 企業名 / 業種 / 都道府県 (region or address先頭) / NG理由
 */
const getNgDetail = async (req, res) => {
  try {
    const { user_id, date_from, date_to, work_category } = req.query;
    if (!user_id || !date_from || !date_to) {
      return ApiResponse.badRequest(res, 'user_id, date_from, date_to は必須です');
    }
    const where = [
      'c.user_id = ?',
      'c.result_code = ?',
      'DATE(c.call_started_at) BETWEEN ? AND ?',
    ];
    const params = [user_id, 'NG', date_from, date_to];
    if (work_category && work_category !== 'all') {
      where.push('c.work_category = ?');
      params.push(work_category);
    }
    const [rows] = await pool.query(
      `SELECT c.id, c.call_started_at, c.ng_reason,
              comp.company_name, comp.industry, comp.region, comp.prefecture, comp.address,
              u.name AS operator_name
       FROM calls c
       LEFT JOIN companies comp ON c.company_id = comp.id
       LEFT JOIN users u ON c.user_id = u.id
       WHERE ${where.join(' AND ')}
       ORDER BY c.call_started_at DESC
       LIMIT 1000`,
      params
    );
    return ApiResponse.success(res, {
      userId: Number(user_id), operatorName: rows[0]?.operator_name || null,
      dateFrom: date_from, dateTo: date_to, workCategory: work_category || null,
      total: rows.length,
      rows: rows.map(r => ({
        id: r.id,
        calledAt: r.call_started_at,
        companyName: r.company_name,
        industry: r.industry,
        region: r.region,
        prefecture: r.prefecture,
        address: r.address,
        ngReason: r.ng_reason,
      })),
    });
  } catch (err) {
    logger.error(`[getNgDetail] ${err.code || ''} ${err.message}`);
    return ApiResponse.error(res, `NG内訳の取得に失敗: ${err.sqlMessage || err.message}`, 500);
  }
};

/**
 * GET /api/admin/transcript-diag
 * 文字起こしキャッシュの状態を返す。 ?refresh=1 でキャッシュをクリア + 再構築。
 * ?phone=XXX で特定電話番号の Sheets 上のレコードを確認可能。
 */
const getTranscriptDiag = async (req, res) => {
  try {
    const { getTranscriptCacheStatus, clearTranscriptCache, getTranscriptIndex } = require('../services/googleSheetsService');
    const result = {};
    // refresh=1 ならキャッシュをクリア
    if (req.query.refresh === '1') {
      clearTranscriptCache();
      result.cacheCleared = true;
    }
    // 初期 cache 状態
    result.cacheBefore = getTranscriptCacheStatus();
    // index を取得 (キャッシュが空なら再構築)
    let index = null;
    let buildMs = null;
    try {
      const t0 = Date.now();
      index = await getTranscriptIndex();
      buildMs = Date.now() - t0;
    } catch (e) {
      result.indexError = `${e.code || ''} ${e.message}`;
    }
    result.indexBuildMs = buildMs;
    result.cacheAfter = getTranscriptCacheStatus();
    // 任意の電話番号で照会
    if (req.query.phone && index) {
      const norm = String(req.query.phone).replace(/[-\s()+]/g, '');
      const entries = index.get(norm);
      if (entries) {
        result.phoneLookup = {
          phone: norm,
          entryCount: entries.length,
          entries: entries.slice(0, 10).map(e => ({
            time: e.time ? new Date(e.time).toISOString() : null,
            transcriptLength: (e.transcript || '').length,
            transcriptPreview: (e.transcript || '').slice(0, 80),
            durationSec: e.durationSec,
          })),
        };
      } else {
        result.phoneLookup = { phone: norm, found: false, message: 'この電話番号のレコードがSheetsにありません' };
      }
    }
    // 空 transcript の件数 + Sheets 上の最新時刻
    if (index) {
      let totalEntries = 0;
      let emptyTranscriptEntries = 0;
      let latestSheetsTimeMs = 0;
      let latestNonEmptySheetsTimeMs = 0;
      for (const entries of index.values()) {
        for (const e of entries) {
          totalEntries++;
          if (!e.transcript || e.transcript.length === 0) {
            emptyTranscriptEntries++;
          } else if (e.time && e.time > latestNonEmptySheetsTimeMs) {
            latestNonEmptySheetsTimeMs = e.time;
          }
          if (e.time && e.time > latestSheetsTimeMs) latestSheetsTimeMs = e.time;
        }
      }
      result.totalEntries = totalEntries;
      result.emptyTranscriptEntries = emptyTranscriptEntries;
      result.emptyRatio = totalEntries > 0 ? (emptyTranscriptEntries / totalEntries * 100).toFixed(1) + '%' : '0%';
      result.latestSheetsEntryTime = latestSheetsTimeMs ? new Date(latestSheetsTimeMs).toISOString() : null;
      result.latestNonEmptyTranscriptTime = latestNonEmptySheetsTimeMs ? new Date(latestNonEmptySheetsTimeMs).toISOString() : null;
    }

    // DB の calls と照合: 「最後に文字起こしが取れた架電」 を見つける。
    // 直近 200 件を新しい順に走査して transcript が見つかった最新を報告。
    // タイムゾーン補正の基準点になる。
    try {
      const [recentCalls] = await pool.query(
        `SELECT id, user_id, phone_number, call_started_at
         FROM calls
         WHERE phone_number IS NOT NULL AND call_started_at IS NOT NULL
         ORDER BY call_started_at DESC
         LIMIT 200`
      );
      let lastMatched = null;
      const noMatchTopRecent = [];
      if (index) {
        const normPhone = (p) => String(p || '').replace(/[-\s()+]/g, '');
        const toMs = (s) => {
          const str = String(s);
          return (str.includes('T') || str.includes('Z'))
            ? new Date(s).getTime()
            : new Date(str.replace(' ', 'T') + '+09:00').getTime();
        };
        for (const c of recentCalls) {
          const entries = index.get(normPhone(c.phone_number));
          if (!entries) {
            if (noMatchTopRecent.length < 5) noMatchTopRecent.push({ id: c.id, call_started_at: c.call_started_at, phone: c.phone_number, reason: 'phoneNotInSheets' });
            continue;
          }
          const callMs = toMs(c.call_started_at);
          const matched = entries.find(e => e.transcript && e.time && Math.abs(callMs - e.time) <= 5 * 60 * 1000);
          if (matched) {
            if (!lastMatched) {
              lastMatched = {
                callId: c.id,
                callStartedAt: c.call_started_at,
                phone: c.phone_number,
                sheetsTime: new Date(matched.time).toISOString(),
                timeDiffSec: Math.round((matched.time - callMs) / 1000),
                transcriptPreview: matched.transcript.slice(0, 80),
              };
            }
          } else {
            if (noMatchTopRecent.length < 5) {
              const closestEntry = entries.reduce((best, e) => {
                if (!e.time) return best;
                const diff = Math.abs(callMs - e.time);
                return !best || diff < best.diff ? { diff, entry: e } : best;
              }, null);
              noMatchTopRecent.push({
                id: c.id,
                call_started_at: c.call_started_at,
                phone: c.phone_number,
                reason: 'timeMismatch',
                closestSheetTime: closestEntry?.entry?.time ? new Date(closestEntry.entry.time).toISOString() : null,
                diffSec: closestEntry ? Math.round(closestEntry.diff / 1000) : null,
                transcriptEmpty: !(closestEntry?.entry?.transcript),
              });
            }
          }
        }
      }
      result.lastSuccessfulTranscript = lastMatched;
      result.recentFailedSamples = noMatchTopRecent;
      result.scannedCalls = recentCalls.length;
    } catch (e) {
      result.callsScanError = e.message;
    }

    return ApiResponse.success(res, result);
  } catch (err) {
    logger.error(`[getTranscriptDiag] ${err.code || ''} ${err.message}`);
    return ApiResponse.error(res, `Transcript診断失敗: ${err.message}`, 500);
  }
};

module.exports = {
  swapWorkCategory,
  getNgDetail,
  getTranscriptDiag,
  getUsers, createUser, updateUser, deleteUser,
  getAllOperatorPerformance,
  getCompanies, assignCompany, unassignCompany, bulkAssignSpecial,
  getIndustryRegionRules, addIndustryRegionRule, deleteIndustryRegionRule,
  getExcludeWords, addExcludeWord, deleteExcludeWord,
  getTimeRules, addTimeRule, updateTimeRule, deleteTimeRule, aiSuggestTimeRules,
  getSpecialListBatches, getSpecialListBatchDetails, exportSpecialListBatch,
  saveKpiAdjustment,
  applyRulesToExistingCompanies,
  restoreMylistExclusions,
  cleanupDatabase,
  getDatabaseStats,
  getCompaniesIndustryStats,
  bulkDeleteCompanies,
  getAutoPickupIndustries,
  setAutoPickupIndustries,
  getAutoPickupPrefectures,
  setAutoPickupPrefectures,
  getIncentiveData,
  getAllRecalls,
  updateRecallTask,
  deleteRecallTask,
  reassignRecallTask,
  getCustomerMasterList,
  getCustomerMasterDetail,
  syncCustomerToFaxCrm,
  syncCustomerFromFaxCrm,
  bulkSyncCustomers,
  updateCustomerMaster,
  importMissingFromFaxCrm,
  diagnoseProjectCount,
  diagnoseVisaPayment,
  backfillRecruitmentStartDate,
  backfillJobNumbers,
};

/**
 * POST /api/admin/backfill-job-numbers
 * 求人番号が未入力の案件について、自動取得して埋める。
 * ソース優先順:
 *   1. 同じ company_id の他案件で求人番号があるもの(最新)
 *   2. job_postings_v2 (架電バイト求人情報シート) から company_name でマッチ
 * 対象: is_legacy=0 AND is_prospect=0 AND (job_number IS NULL OR job_number='')
 */
async function backfillJobNumbers(req, res, next) {
  try {
    // 1) 求人番号未入力の対象案件を取得
    const [targets] = await pool.query(
      `SELECT p.id, p.company_id, COALESCE(c.company_name, p.legacy_company_name) AS company_name
         FROM projects p
         LEFT JOIN companies c ON p.company_id = c.id
        WHERE p.is_legacy = 0 AND p.is_prospect = 0
          AND (p.job_number IS NULL OR p.job_number = '')`
    );
    if (targets.length === 0) {
      return ApiResponse.success(res, { scanned: 0, updated: 0, bySource: { same_company: 0, job_postings_v2: 0 } }, '未入力案件なし');
    }

    // 2) job_postings_v2 をメモリにロード (company_name 完全一致 + 正規化マッチ用)
    //    取得失敗時は空マップ → 同 company_id ソースのみで補完
    const v2Map = new Map();        // company_name(原文) → job_number(最新)
    const v2MapNorm = new Map();    // 正規化後 → job_number
    const normalize = (s) => String(s || '')
      .trim()
      .replace(/\s+/g, '')
      .replace(/[（(]株[)）]|株式会社/g, '')
      .replace(/[（(]有[)）]|有限会社/g, '')
      .replace(/[（(]合[)）]|合同会社/g, '')
      .replace(/[\s　・]/g, '')
      .toLowerCase();
    try {
      const [v2Rows] = await pool.query(
        `SELECT job_number, company_name, acquired_date
           FROM job_postings_v2
          WHERE job_number IS NOT NULL AND job_number != ''
            AND company_name IS NOT NULL AND company_name != ''
          ORDER BY acquired_date DESC, id DESC`
      );
      for (const r of v2Rows) {
        if (!v2Map.has(r.company_name)) v2Map.set(r.company_name, r.job_number);
        const n = normalize(r.company_name);
        if (n && !v2MapNorm.has(n)) v2MapNorm.set(n, r.job_number);
      }
      logger.info(`[backfillJobNumbers] job_postings_v2 loaded: ${v2Rows.length}行 / unique=${v2Map.size}`);
    } catch (e) {
      logger.warn(`[backfillJobNumbers] job_postings_v2 取得失敗(同company_idのみで実行): ${e.message}`);
    }

    let updated = 0;
    const bySource = { same_company: 0, job_postings_v2: 0 };
    for (const t of targets) {
      let foundJobNumber = null;
      let source = null;
      // 1) 同じ company_id の他案件から最新の求人番号
      if (t.company_id) {
        const [rows] = await pool.query(
          `SELECT job_number FROM projects
            WHERE company_id = ? AND id != ?
              AND job_number IS NOT NULL AND job_number != ''
            ORDER BY created_at DESC LIMIT 1`,
          [t.company_id, t.id]
        );
        if (rows.length > 0) { foundJobNumber = rows[0].job_number; source = 'same_company'; }
      }
      // 2) job_postings_v2 から company_name (完全一致 → 正規化) でマッチ
      if (!foundJobNumber && t.company_name) {
        const exact = v2Map.get(t.company_name);
        if (exact) { foundJobNumber = exact; source = 'job_postings_v2'; }
        else {
          const n = normalize(t.company_name);
          if (n && v2MapNorm.has(n)) { foundJobNumber = v2MapNorm.get(n); source = 'job_postings_v2'; }
        }
      }
      if (foundJobNumber) {
        await pool.execute(
          `UPDATE projects SET job_number = ? WHERE id = ? AND (job_number IS NULL OR job_number = '')`,
          [foundJobNumber, t.id]
        );
        updated++;
        bySource[source] = (bySource[source] || 0) + 1;
      }
    }
    logger.info(`[backfillJobNumbers] scanned=${targets.length}, updated=${updated}, same_company=${bySource.same_company}, job_postings_v2=${bySource.job_postings_v2}`);
    return ApiResponse.success(res, { scanned: targets.length, updated, bySource },
      `${updated}件 / ${targets.length}件中 を自動取得しました (同社案件:${bySource.same_company} / 求人情報シート:${bySource.job_postings_v2})`);
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/admin/backfill-recruitment-start-date
 * 募集開始日(recruitment_start_date)を案件獲得日(DATE(created_at))で一括補完。
 * 条件:
 *   - DATE(created_at) >= '2026-04-01'
 *   - document_screening = 'required' (書類選考あり)
 *   - status = 'BOSHUCHU' (募集中)
 *   - recruitment_start_date IS NULL
 *   - is_legacy = 0
 * 今後はステータスを募集中に変えた日に自動入力 (frontend admin/projects.js で実装済み)。
 */
async function backfillRecruitmentStartDate(req, res, next) {
  try {
    const [result] = await pool.execute(
      `UPDATE projects
         SET recruitment_start_date = DATE(created_at)
       WHERE is_legacy = 0
         AND DATE(created_at) >= '2026-04-01'
         AND document_screening = 'required'
         AND status = 'BOSHUCHU'
         AND recruitment_start_date IS NULL`
    );
    logger.info(`[backfillRecruitmentStartDate] updated=${result.affectedRows}`);
    return ApiResponse.success(res, { updated: result.affectedRows }, `${result.affectedRows}件の募集開始日を案件獲得日で補完しました`);
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/admin/diagnose-projects?date_from=&date_to=
 * ダッシュボードと案件管理の案件数差分をユーザー別に診断する。
 * ダッシュボード: call_type を必ず絞る（operator/sales）
 * 案件管理: call_type 未指定なら絞らない
 * → 差分は call_type=NULL（古い案件）/ 別 call_type の案件が原因の可能性が高い。
 */
async function diagnoseProjectCount(req, res, next) {
  try {
    const { date_from, date_to } = req.query;
    if (!date_from || !date_to) {
      return ApiResponse.badRequest(res, 'date_from と date_to が必要です');
    }
    // 案件管理ベース（call_type フィルタなし）
    const [projAll] = await pool.query(
      `SELECT p.owner_user_id, p.call_type, COUNT(*) as cnt
       FROM projects p
       WHERE p.is_legacy = 0 AND p.is_prospect = 0
         AND p.created_at >= ? AND p.created_at <= ?
       GROUP BY p.owner_user_id, p.call_type`,
      [date_from, `${date_to} 23:59:59`]
    );
    // ダッシュボードベース（call_type='operator' で絞る）
    const [dashOp] = await pool.query(
      `SELECT p.owner_user_id, COUNT(*) as cnt
       FROM projects p
       WHERE p.is_legacy = 0 AND p.is_prospect = 0
         AND DATE(p.created_at) BETWEEN ? AND ?
         AND p.call_type = 'operator'
       GROUP BY p.owner_user_id`,
      [date_from, date_to]
    );
    // sales 集計も併記
    const [dashSales] = await pool.query(
      `SELECT p.owner_user_id, COUNT(*) as cnt
       FROM projects p
       WHERE p.is_legacy = 0 AND p.is_prospect = 0
         AND DATE(p.created_at) BETWEEN ? AND ?
         AND p.call_type = 'sales'
       GROUP BY p.owner_user_id`,
      [date_from, date_to]
    );
    // ユーザー名解決
    const [users] = await pool.query(
      "SELECT id, name, role FROM users"
    );
    const userMap = new Map(users.map(u => [u.id, u]));

    // ユーザー別に集計
    const byUser = new Map();
    const ensure = (uid) => {
      const k = uid == null ? 0 : uid;
      if (!byUser.has(k)) byUser.set(k, {
        userId: k, name: userMap.get(k)?.name || (k === 0 ? '(オーナー未設定)' : `id=${k}`),
        role: userMap.get(k)?.role || '-',
        projectsTotal: 0, callTypeBreakdown: { operator: 0, sales: 0, null: 0, other: 0 },
        dashboardOperator: 0, dashboardSales: 0,
        diffVsOperatorDash: 0,
      });
      return byUser.get(k);
    };

    for (const r of projAll) {
      const row = ensure(r.owner_user_id);
      row.projectsTotal += Number(r.cnt);
      const ct = r.call_type;
      if (ct === 'operator') row.callTypeBreakdown.operator += Number(r.cnt);
      else if (ct === 'sales') row.callTypeBreakdown.sales += Number(r.cnt);
      else if (ct == null) row.callTypeBreakdown.null += Number(r.cnt);
      else row.callTypeBreakdown.other += Number(r.cnt);
    }
    for (const r of dashOp) ensure(r.owner_user_id).dashboardOperator = Number(r.cnt);
    for (const r of dashSales) ensure(r.owner_user_id).dashboardSales = Number(r.cnt);

    // 差分計算: 案件管理(全call_type) vs ダッシュボードoperator分
    const rows = [];
    for (const v of byUser.values()) {
      v.diffVsOperatorDash = v.projectsTotal - v.dashboardOperator;
      rows.push(v);
    }
    rows.sort((a, b) => b.diffVsOperatorDash - a.diffVsOperatorDash);

    // 合計
    const totalProjects = rows.reduce((s, r) => s + r.projectsTotal, 0);
    const totalDashOp = rows.reduce((s, r) => s + r.dashboardOperator, 0);
    const totalDashSales = rows.reduce((s, r) => s + r.dashboardSales, 0);

    return ApiResponse.success(res, {
      dateFrom: date_from, dateTo: date_to,
      totals: {
        projectsManagementTotal: totalProjects,
        dashboardOperatorTotal: totalDashOp,
        dashboardSalesTotal: totalDashSales,
        diff: totalProjects - totalDashOp,
      },
      byUser: rows,
      note: 'ダッシュボードは call_type=operator(or sales) で絞り、案件管理は call_type フィルタなし。差分は call_type=null/sales の案件が原因。',
    });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/admin/diagnose-visa-payment?date_from=&date_to=
 * CPAの入金実績が反映されない原因を切り分ける診断ツール。
 * 1. ビザシートが読めているか（権限/ID）
 * 2. 該当期間の内定者登録番号がシートに存在するか（マッチ結果）
 * を user 別に表示。
 */
async function diagnoseVisaPayment(req, res, next) {
  try {
    const { date_from, date_to } = req.query;
    if (!date_from || !date_to) return ApiResponse.badRequest(res, 'date_from と date_to が必要です');
    const { getVisaPaymentMap, lookupVisaPayment, probeVisaSheet } = require('../services/googleSheetsService');

    // ① シート読み取り状態
    const sheetStatus = await probeVisaSheet();
    // ② マップ取得
    const visaMap = await getVisaPaymentMap();
    const mapSize = visaMap ? visaMap.size : 0;

    // ③ 該当期間の内定者一覧
    const [hires] = await pool.query(
      `SELECT p.owner_user_id, ph.registration_number AS reg, ph.initial_payment, u.name
       FROM project_hires ph
       JOIN projects p ON ph.project_id = p.id
       LEFT JOIN users u ON p.owner_user_id = u.id
       WHERE p.is_legacy = 0 AND ph.is_cancelled = 0
         AND p.naitei_date BETWEEN ? AND ?
         AND ph.registration_number IS NOT NULL AND ph.registration_number != ''`,
      [date_from, date_to]
    );

    const sampleSheetRegs = (sheetStatus.sample || []).map(s => s.reg);
    // ④ マッチ結果
    const rows = [];
    let matchedCount = 0, unmatchedCount = 0, matchedYen = 0;
    for (const h of hires) {
      const tokens = String(h.reg || '').split(/[,、,\s/／]+/).map(s => s.trim()).filter(Boolean);
      const perToken = tokens.map(t => ({ token: t, yen: lookupVisaPayment(visaMap, t) }));
      const yen = perToken.reduce((s, x) => s + x.yen, 0);
      if (yen > 0) { matchedCount++; matchedYen += yen; } else { unmatchedCount++; }
      rows.push({
        owner_user_id: h.owner_user_id, name: h.name, reg: h.reg,
        tokens: perToken, totalYen: yen, matched: yen > 0,
        dbInitialPayment: Number(h.initial_payment) || 0,
      });
    }
    rows.sort((a, b) => Number(a.matched) - Number(b.matched));

    return ApiResponse.success(res, {
      dateFrom: date_from, dateTo: date_to,
      sheet: sheetStatus,
      mapSize,
      summary: {
        targetHires: hires.length,
        matched: matchedCount,
        unmatched: unmatchedCount,
        totalMatchedYen: matchedYen,
      },
      sampleSheetRegs,
      hires: rows,
      hint: sheetStatus.ok
        ? (mapSize === 0 ? 'シートは読めているが登録番号 0件。シートのG列が空 or 別のシート構造の可能性。'
          : unmatchedCount > 0 ? '登録番号がシートと一致していない可能性。サンプル登録番号とDBの登録番号を比較してください。'
          : 'すべてマッチ。入金実績は計上されているはず。')
        : `シート読み取り失敗: ${sheetStatus.error}。サービスアカウント ${sheetStatus.serviceAccountEmail} にシートを共有してください。`,
    });
  } catch (err) {
    next(err);
  }
}

const faxCrmClient = require('../services/faxCrmClient');

/**
 * GET /api/admin/customer-master
 * 顧客マスタ一覧（companies + 集計）
 * Query: search, has_calls, has_ng, has_project
 */
async function getCustomerMasterList(req, res, next) {
  try {
    const {
      search = '',
      limit = 50,
      page = 1,
      result,
      ng_reason,
      user_id,
      industry,
      date_from,
      date_to,
      show_excluded,
    } = req.query;
    const params = [];
    const lim = Math.min(200, Math.max(10, parseInt(limit, 10) || 50));
    const pg = Math.max(1, parseInt(page, 10) || 1);
    const offset = (pg - 1) * lim;

    // 直近の架電条件で絞る場合のサブクエリ条件
    const callConds = [];
    if (result) { callConds.push('cl.result_code = ?'); params.push(result); }
    // NG理由フィルタ: result='NG' とセット運用が前提だが、 単独で来ても result_code='NG' に強制する
    if (ng_reason) {
      callConds.push('cl.ng_reason = ?');
      params.push(ng_reason);
      if (!result) { callConds.push("cl.result_code = 'NG'"); }
    }
    if (user_id) { callConds.push('cl.user_id = ?'); params.push(user_id); }
    if (date_from) { callConds.push('DATE(cl.call_started_at) >= ?'); params.push(date_from); }
    if (date_to) { callConds.push('DATE(cl.call_started_at) <= ?'); params.push(date_to); }
    const callWhereSub = callConds.length
      ? `AND ${callConds.join(' AND ')}`
      : '';

    // show_excluded='1' なら NGリストを含めて取得、'only' なら NG リストのみ
    let where;
    if (show_excluded === 'only') where = 'c.exclusion_flag = 1';
    else if (show_excluded === '1') where = '1=1';
    else where = 'c.exclusion_flag = 0';
    if (search) {
      where += " AND (c.company_name LIKE ? OR c.phone_number LIKE ?)";
      const s = `%${search}%`;
      params.push(s, s);
    }
    if (industry) {
      where += " AND (c.industry LIKE ? OR c.industry_category = ?)";
      const s = `%${industry}%`;
      params.push(s, industry);
    }
    // 地域(都道府県)フィルタ — 複数選択対応 (regions=CSV) + 後方互換 (region=単一)
    // 各県について region IN (full, short) OR address LIKE (full%, short%) を OR で連結
    const regionsParam = req.query.regions;
    const regionParam = req.query.region;
    let regionList = [];
    if (regionsParam) {
      regionList = String(regionsParam).split(',').map(s => s.trim()).filter(Boolean);
    } else if (regionParam) {
      regionList = [String(regionParam).trim()].filter(Boolean);
    }
    if (regionList.length > 0) {
      const orParts = [];
      for (const r of regionList) {
        const short = r.replace(/(都|道|府|県)$/, '') || r;
        orParts.push(`(c.region IN (?, ?) OR c.region LIKE CONCAT(?, '%') OR c.address LIKE CONCAT(?, '%'))`);
        params.push(r, short, short, r);
      }
      where += ` AND (${orParts.join(' OR ')})`;
    }
    // 結果/担当/期間のいずれかが指定された場合は、その条件に一致する架電が
    // 1件以上ある企業のみに絞り込む
    if (callConds.length > 0) {
      where += ` AND EXISTS (SELECT 1 FROM calls cl WHERE cl.company_id = c.id AND cl.result_code IS NOT NULL AND cl.result_code != 'SKIP' ${callWhereSub})`;
    }

    const [rows] = await pool.query(
      `SELECT c.id, c.company_name, c.phone_number, c.fax_number, c.industry, c.region, c.address, c.industry_category,
              c.created_at, c.last_called_at,
              c.last_synced_to_faxcrm_at, c.last_synced_from_faxcrm_at,
              c.exclusion_flag, c.exclusion_reason,
              (SELECT COUNT(*) FROM calls cl WHERE cl.company_id = c.id AND cl.result_code IS NOT NULL AND cl.result_code != 'SKIP') AS call_count,
              (SELECT COUNT(*) FROM calls cl WHERE cl.company_id = c.id AND cl.result_code = 'NG') AS ng_count,
              (SELECT COUNT(*) FROM calls cl WHERE cl.company_id = c.id AND cl.result_code = 'PROJECT') AS project_count,
              (SELECT cl.result_code FROM calls cl WHERE cl.company_id = c.id AND cl.result_code IS NOT NULL AND cl.result_code != 'SKIP' ORDER BY cl.call_started_at DESC LIMIT 1) AS last_result,
              (SELECT cl.call_started_at FROM calls cl WHERE cl.company_id = c.id AND cl.result_code IS NOT NULL AND cl.result_code != 'SKIP' ORDER BY cl.call_started_at DESC LIMIT 1) AS last_call_at,
              (SELECT cl.ng_reason FROM calls cl WHERE cl.company_id = c.id AND cl.result_code = 'NG' ORDER BY cl.call_started_at DESC LIMIT 1) AS last_ng_reason,
              (SELECT COUNT(*) FROM company_actions ca WHERE ca.company_id = c.id) AS manual_action_count
       FROM companies c
       WHERE ${where}
       ORDER BY GREATEST(
                  COALESCE((SELECT cl.call_started_at FROM calls cl WHERE cl.company_id = c.id AND cl.result_code IS NOT NULL ORDER BY cl.call_started_at DESC LIMIT 1), '1900-01-01'),
                  COALESCE((SELECT ca.action_date FROM company_actions ca WHERE ca.company_id = c.id ORDER BY ca.action_date DESC LIMIT 1), '1900-01-01'),
                  COALESCE(c.last_synced_to_faxcrm_at, '1900-01-01'),
                  COALESCE(c.last_synced_from_faxcrm_at, '1900-01-01'),
                  COALESCE(c.created_at, '1900-01-01')
                ) DESC, c.id DESC
       LIMIT ${lim} OFFSET ${offset}`,
      params
    );

    // 総件数（同じ where 条件で COUNT）
    const [cnt] = await pool.query(
      `SELECT COUNT(*) AS total FROM companies c WHERE ${where}`,
      params
    );
    const total = cnt[0]?.total || 0;

    return ApiResponse.success(res, {
      customers: rows,
      total,
      page: pg,
      limit: lim,
      totalPages: Math.max(1, Math.ceil(total / lim)),
      faxCrmEnabled: faxCrmClient.isEnabled(),
    });
  } catch (err) {
    logger.error(`[getCustomerMasterList] ${err.message}`);
    return ApiResponse.error(res, err.message, 500);
  }
}

/**
 * GET /api/admin/customer-master/:id
 * 顧客詳細（架電履歴 + 手動アクション + FAX CRM の履歴）
 */
async function getCustomerMasterDetail(req, res, next) {
  try {
    const { id } = req.params;
    const [companies] = await pool.execute(
      `SELECT * FROM companies WHERE id = ?`, [id]
    );
    if (companies.length === 0) {
      return ApiResponse.notFound(res, '顧客が見つかりません');
    }
    const company = companies[0];

    // 架電履歴
    const [calls] = await pool.query(
      `SELECT cl.id, cl.call_started_at, cl.call_ended_at, cl.result_code, cl.memo,
              cl.is_effective_connection, cl.is_person_in_charge,
              cl.contact_person_name, cl.contact_person_gender, cl.contact_person_phone, cl.contact_person_impression,
              cl.ng_reason,
              cl.call_type,
              cl.transcript,
              u.name AS operator_name
       FROM calls cl
       LEFT JOIN users u ON cl.user_id = u.id
       WHERE cl.company_id = ? AND cl.result_code IS NOT NULL AND cl.result_code != 'SKIP'
       ORDER BY cl.call_started_at DESC LIMIT 200`,
      [id]
    );

    // 手動アクション
    const [manualActions] = await pool.query(
      `SELECT a.id, a.action_date, a.action_type, a.result, a.memo, a.created_at,
              u.name AS user_name
       FROM company_actions a
       LEFT JOIN users u ON a.user_id = u.id
       WHERE a.company_id = ?
       ORDER BY a.action_date DESC, a.id DESC LIMIT 200`,
      [id]
    );

    // NG 理由集計
    const [ngBreakdown] = await pool.query(
      `SELECT ng_reason, COUNT(*) AS cnt
       FROM calls
       WHERE company_id = ? AND result_code = 'NG' AND ng_reason IS NOT NULL
       GROUP BY ng_reason ORDER BY cnt DESC`,
      [id]
    );

    // 案件（面接情報含む）
    const [projects] = await pool.query(
      `SELECT p.id, p.status, p.created_at, p.naitei_date, p.job_number,
              p.interview_date, p.interview_type, p.interview_attendees, p.document_screening,
              u.name AS owner_name, su.name AS sales_name
       FROM projects p
       LEFT JOIN users u ON p.owner_user_id = u.id
       LEFT JOIN users su ON p.sales_user_id = su.id
       WHERE p.company_id = ? AND p.is_legacy = 0
       ORDER BY p.created_at DESC`,
      [id]
    );

    // 各案件の合格者（内定者）情報を取得して紐付け
    if (projects.length > 0) {
      const projIds = projects.map(p => p.id);
      try {
        const [hires] = await pool.query(
          `SELECT id, project_id, registration_number, course, initial_payment, expected_revenue, is_cancelled
             FROM project_hires
            WHERE project_id IN (${projIds.map(() => '?').join(',')})
            ORDER BY id ASC`,
          projIds
        );
        const byProject = new Map();
        for (const h of hires) {
          if (!byProject.has(h.project_id)) byProject.set(h.project_id, []);
          byProject.get(h.project_id).push(h);
        }
        for (const p of projects) {
          p.hires = byProject.get(p.id) || [];
        }
      } catch (e) {
        // project_hires が無い場合などは空配列
        for (const p of projects) p.hires = [];
      }
    }

    // FAX CRM から FAX 履歴を取得（任意。失敗してもエラーにしない）
    let faxHistory = [];
    let faxCrmStatus = 'disabled';
    if (faxCrmClient.isEnabled()) {
      try {
        const r = await faxCrmClient.getFaxHistory(id);
        if (r.ok) {
          faxHistory = r.events || [];
          faxCrmStatus = 'ok';
        } else {
          faxCrmStatus = `error:${r.status || r.error || 'unknown'}`;
        }
      } catch (e) {
        faxCrmStatus = `error:${e.message}`;
      }
    }

    // 時系列タイムライン（架電 + 手動アクション + FAX を統合）
    const timeline = [];
    for (const c of calls) {
      timeline.push({
        kind: 'call',
        at: c.call_started_at,
        operator_name: c.operator_name,
        result_code: c.result_code,
        ng_reason: c.ng_reason,
        memo: c.memo,
        contact_person_name: c.contact_person_name,
        contact_person_gender: c.contact_person_gender,
        contact_person_phone: c.contact_person_phone,
        contact_person_impression: c.contact_person_impression,
        call_type: c.call_type,
        transcript: c.transcript,
        ref_id: c.id,
      });
    }
    for (const a of manualActions) {
      timeline.push({
        kind: 'manual',
        at: a.action_date || a.created_at,
        operator_name: a.user_name,
        action_type: a.action_type,
        result: a.result,
        memo: a.memo,
        ref_id: a.id,
      });
    }
    for (const f of faxHistory) {
      timeline.push({
        kind: 'fax',
        at: f.occurred_at || f.created_at,
        operator_name: f.operator_name,
        event_type: f.event_type,
        result_label: f.result_label,
        memo: f.memo,
        channel: f.channel,
        ref_id: f.id,
      });
    }
    timeline.sort((x, y) => {
      const tx = x.at ? new Date(x.at).getTime() : 0;
      const ty = y.at ? new Date(y.at).getTime() : 0;
      return ty - tx;
    });

    // 担当者情報集約（架電履歴から重複排除）
    const cpMap = new Map();
    for (const c of calls) {
      if (!c.contact_person_name && !c.contact_person_phone) continue;
      const key = `${(c.contact_person_name || '').trim()}|${(c.contact_person_phone || '').trim()}`;
      if (cpMap.has(key)) {
        const ex = cpMap.get(key);
        // 印象などは新しい方を残す（callsはDESCで先頭が最新）
        if (!ex.last_at || new Date(c.call_started_at) > new Date(ex.last_at)) {
          ex.last_at = c.call_started_at;
          if (c.contact_person_impression) ex.impression = c.contact_person_impression;
          if (c.contact_person_gender) ex.gender = c.contact_person_gender;
        }
      } else {
        cpMap.set(key, {
          name: c.contact_person_name || null,
          phone: c.contact_person_phone || null,
          gender: c.contact_person_gender || null,
          impression: c.contact_person_impression || null,
          last_at: c.call_started_at,
        });
      }
    }
    const contactPersons = Array.from(cpMap.values())
      .sort((a, b) => new Date(b.last_at || 0) - new Date(a.last_at || 0));

    return ApiResponse.success(res, {
      company,
      calls,
      manualActions,
      ngBreakdown,
      projects,
      faxHistory,
      faxCrmStatus,
      timeline,
      contactPersons,
    });
  } catch (err) {
    logger.error(`[getCustomerMasterDetail] ${err.message}`);
    return ApiResponse.error(res, err.message, 500);
  }
}

/**
 * PATCH /api/admin/customer-master/:id
 * 顧客の基本情報を更新（現状は fax_number / phone_number / company_name / address のみ）
 */
async function updateCustomerMaster(req, res) {
  try {
    const { id } = req.params;
    const { fax_number, phone_number, company_name, address,
            exclusion_flag, exclusion_reason } = req.body || {};
    const sets = [];
    const params = [];
    if (fax_number !== undefined)      { sets.push('fax_number = ?');       params.push(fax_number || null); }
    if (phone_number !== undefined)    { sets.push('phone_number = ?');     params.push(phone_number || null); }
    if (company_name !== undefined)    { sets.push('company_name = ?');     params.push(company_name || null); }
    if (address !== undefined)         { sets.push('address = ?');          params.push(address || null); }
    if (exclusion_flag !== undefined)  { sets.push('exclusion_flag = ?');   params.push(exclusion_flag ? 1 : 0); }
    if (exclusion_reason !== undefined){ sets.push('exclusion_reason = ?'); params.push(exclusion_reason || null); }
    if (sets.length === 0) return ApiResponse.error(res, '更新項目が指定されていません', 400);
    params.push(id);
    const [r] = await pool.execute(
      `UPDATE companies SET ${sets.join(', ')} WHERE id = ?`,
      params
    );
    if (r.affectedRows === 0) return ApiResponse.notFound(res, '顧客が見つかりません');
    // Phase 2: fax-crm DB にシャドー書き込み (fire-and-forget)
    try { require('../services/faxCrmDbWriter').shadowUpsertById(id); } catch (_e) {}
    return ApiResponse.success(res, { id: Number(id) }, '更新しました');
  } catch (err) {
    logger.error(`[updateCustomerMaster] ${err.message}`);
    return ApiResponse.error(res, err.message, 500);
  }
}

/**
 * 内部: 1社分 push（callcenter → fax-crm）
 */
async function _pushOneToFaxCrm(id) {
  const [companies] = await pool.execute(`SELECT * FROM companies WHERE id = ?`, [id]);
  if (companies.length === 0) return { ok: false, error: 'not_found' };
  const company = companies[0];

  const [calls] = await pool.query(
    `SELECT cl.id, cl.call_started_at, cl.result_code, cl.memo, cl.ng_reason,
            cl.contact_person_name, cl.contact_person_phone,
            u.email AS operator_email, u.name AS operator_name
     FROM calls cl
     LEFT JOIN users u ON cl.user_id = u.id
     WHERE cl.company_id = ? AND cl.result_code IS NOT NULL
     ORDER BY cl.call_started_at DESC LIMIT 100`,
    [id]
  );

  let pushed = 0;
  let failed = 0;
  for (const c of calls) {
    const r = await faxCrmClient.notifyCallResult({
      callId: `cc-${c.id}`,
      companyId: id,
      resultCode: c.result_code,
      callStartedAt: c.call_started_at,
      operatorEmail: c.operator_email || c.operator_name,
      memo: c.memo,
    });
    if (r.ok) pushed++; else failed++;
  }

  const meta = await faxCrmClient.postContactEvent({
    lookup: { external_callcenter_id: id },
    channel: 'sync',
    event_type: 'sync_push',
    occurred_at: new Date().toISOString(),
    source_system: 'callcenter-ai',
    source_event_id: `sync-${id}-${Date.now()}`,
    memo: `company sync: ${company.company_name}`,
    company_name: company.company_name,
    phone_number: company.phone_number,
    fax_number: company.fax_number,
    industry: company.industry,
    region: company.region,
    address: company.address,
  });

  await pool.execute(`UPDATE companies SET last_synced_to_faxcrm_at = DATE_ADD(UTC_TIMESTAMP(), INTERVAL 9 HOUR) WHERE id = ?`, [id]);

  return { ok: true, pushed, failed, meta_ok: !!meta.ok };
}

/**
 * 内部: 1社分 pull（fax-crm → callcenter）
 */
async function _pullOneFromFaxCrm(id) {
  const [companies] = await pool.execute(`SELECT id FROM companies WHERE id = ?`, [id]);
  if (companies.length === 0) return { ok: false, error: 'not_found' };

  const r = await faxCrmClient.getFaxHistory(id);
  if (!r.ok) return { ok: false, error: r.error || r.status || 'unknown' };
  const events = r.events || [];

  let inserted = 0;
  let skipped = 0;
  for (const ev of events) {
    const tag = `[fax-crm:${ev.id || ev.source_event_id || ''}]`;
    const [exist] = await pool.query(
      `SELECT id FROM company_actions WHERE company_id = ? AND memo LIKE ? LIMIT 1`,
      [id, `%${tag}%`]
    );
    if (exist.length > 0) { skipped++; continue; }
    const actionDate = ev.occurred_at ? new Date(ev.occurred_at) : new Date();
    const actionType = ev.channel === 'fax' ? 'FAX' : (ev.channel || 'OTHER').toUpperCase();
    const result = ev.event_type || ev.result_label || null;
    const memo = `${tag} ${ev.memo || ''}`.trim();
    await pool.query(
      `INSERT INTO company_actions (company_id, user_id, action_date, action_type, result, memo, created_at)
       VALUES (?, NULL, ?, ?, ?, ?, DATE_ADD(UTC_TIMESTAMP(), INTERVAL 9 HOUR))`,
      [id, actionDate, actionType, result, memo]
    );
    inserted++;
  }

  await pool.execute(`UPDATE companies SET last_synced_from_faxcrm_at = DATE_ADD(UTC_TIMESTAMP(), INTERVAL 9 HOUR) WHERE id = ?`, [id]);

  return { ok: true, fetched: events.length, inserted, skipped };
}

async function syncCustomerToFaxCrm(req, res) {
  try {
    if (!faxCrmClient.isEnabled()) {
      return ApiResponse.error(res, 'FAX CRM 連携が無効です（FAX_CRM_API_URL 未設定）', 400);
    }
    const r = await _pushOneToFaxCrm(req.params.id);
    if (!r.ok) return ApiResponse.error(res, r.error, 502);
    return ApiResponse.success(res, r, `${r.pushed}件の架電履歴を FAX CRM に送信しました`);
  } catch (err) {
    logger.error(`[syncCustomerToFaxCrm] ${err.message}`);
    return ApiResponse.error(res, err.message, 500);
  }
}

async function syncCustomerFromFaxCrm(req, res) {
  try {
    if (!faxCrmClient.isEnabled()) {
      return ApiResponse.error(res, 'FAX CRM 連携が無効です（FAX_CRM_API_URL 未設定）', 400);
    }
    const r = await _pullOneFromFaxCrm(req.params.id);
    if (!r.ok) return ApiResponse.error(res, r.error, 502);
    return ApiResponse.success(res, r, `${r.inserted}件の FAX 履歴を取込しました（既存スキップ: ${r.skipped}件）`);
  } catch (err) {
    logger.error(`[syncCustomerFromFaxCrm] ${err.message}`);
    return ApiResponse.error(res, err.message, 500);
  }
}

/**
 * POST /api/admin/customer-master/import-missing-from-faxcrm
 * fax-crm に存在するが callcenter に未連携の顧客を一括取込
 * (fax-crm 側の /api/customers/sync/push?unlinked_only=1&limit=0 を呼ぶプロキシ)
 */
async function importMissingFromFaxCrm(req, res) {
  try {
    if (!faxCrmClient.isEnabled()) {
      return ApiResponse.error(res, 'FAX CRM 連携が無効です（FAX_CRM_API_URL 未設定）', 400);
    }
    const r = await faxCrmClient.triggerFaxCrmSyncPush({ unlinkedOnly: true, limit: 0 });
    if (!r.ok) {
      return ApiResponse.error(res, `fax-crm 取込失敗: ${r.error || r.status || 'unknown'}`, 502);
    }
    const stats = r.body?.data || r.body || {};
    return ApiResponse.success(res, stats,
      `未連携取込 完了: ${stats.created || 0}件作成 / ${stats.updated || 0}件更新 / ${stats.errors || 0}件エラー`);
  } catch (err) {
    logger.error(`[importMissingFromFaxCrm] ${err.message}`);
    return ApiResponse.error(res, err.message, 500);
  }
}

/**
 * POST /api/admin/customer-master/bulk-sync
 * body: {
 *   direction: 'push'|'pull'|'both',
 *   ids?: [int],          // 明示指定 (任意)
 *   filters?: {           // フィルタ指定 (任意, ids 指定時より優先度低)
 *     search, result, user_id, industry, date_from, date_to, show_excluded
 *   },
 *   apply_to_all?: true,  // ids 未指定 + filters あり時は filter にマッチする全社を対象
 * }
 */
async function bulkSyncCustomers(req, res) {
  try {
    if (!faxCrmClient.isEnabled()) {
      return ApiResponse.error(res, 'FAX CRM 連携が無効です（FAX_CRM_API_URL 未設定）', 400);
    }
    const { ids, direction = 'both', filters, apply_to_all } = req.body || {};
    let target = [];
    if (Array.isArray(ids) && ids.length > 0) {
      // 明示指定: 上限 10000
      target = ids.slice(0, 10000);
    } else if (apply_to_all || filters) {
      // フィルタ指定: getCustomerMasterList と同じ条件で id 一覧を作る
      const f = filters || {};
      const params = [];
      const callConds = [];
      if (f.result)   { callConds.push('cl.result_code = ?'); params.push(f.result); }
      // NG理由フィルタ: ng_reason 単独で来た場合は result_code='NG' を強制
      if (f.ng_reason) {
        callConds.push('cl.ng_reason = ?');
        params.push(f.ng_reason);
        if (!f.result) { callConds.push("cl.result_code = 'NG'"); }
      }
      if (f.user_id)  { callConds.push('cl.user_id = ?'); params.push(f.user_id); }
      if (f.date_from){ callConds.push('DATE(cl.call_started_at) >= ?'); params.push(f.date_from); }
      if (f.date_to)  { callConds.push('DATE(cl.call_started_at) <= ?'); params.push(f.date_to); }
      const callWhereSub = callConds.length ? `AND ${callConds.join(' AND ')}` : '';
      let where;
      if (f.show_excluded === 'only')      where = 'c.exclusion_flag = 1';
      else if (f.show_excluded === '1')    where = '1=1';
      else                                  where = 'c.exclusion_flag = 0';
      if (f.search) {
        where += ' AND (c.company_name LIKE ? OR c.phone_number LIKE ?)';
        const s = `%${f.search}%`;
        params.push(s, s);
      }
      if (f.industry) {
        where += ' AND (c.industry LIKE ? OR c.industry_category = ?)';
        params.push(`%${f.industry}%`, f.industry);
      }
      if (callConds.length > 0) {
        where += ` AND EXISTS (SELECT 1 FROM calls cl WHERE cl.company_id = c.id AND cl.result_code IS NOT NULL AND cl.result_code != 'SKIP' ${callWhereSub})`;
      }
      const [rows] = await pool.query(
        `SELECT c.id FROM companies c WHERE ${where} ORDER BY c.id ASC LIMIT 50000`,
        params
      );
      target = rows.map(r => r.id);
    } else {
      return ApiResponse.error(res, 'ids または filters を指定してください', 400);
    }
    if (target.length === 0) {
      return ApiResponse.error(res, '対象の顧客がありません', 400);
    }

    let pushedTotal = 0, pulledTotal = 0;
    let okCount = 0, failCount = 0;
    const failures = [];
    for (const id of target) {
      try {
        if (direction === 'push' || direction === 'both') {
          const r = await _pushOneToFaxCrm(id);
          if (r.ok) pushedTotal += (r.pushed || 0);
          else { failCount++; if (failures.length < 10) failures.push({ id, stage: 'push', error: r.error }); continue; }
        }
        if (direction === 'pull' || direction === 'both') {
          const r = await _pullOneFromFaxCrm(id);
          if (r.ok) pulledTotal += (r.inserted || 0);
          else { failCount++; if (failures.length < 10) failures.push({ id, stage: 'pull', error: r.error }); continue; }
        }
        okCount++;
      } catch (e) {
        failCount++;
        if (failures.length < 10) failures.push({ id, error: e.message });
      }
    }

    return ApiResponse.success(res, {
      target_count: target.length, ok: okCount, fail: failCount,
      pushed_events: pushedTotal, pulled_events: pulledTotal,
      failures,
    }, `一括同期 完了: 成功${okCount}/${target.length}社（送信${pushedTotal}件・取込${pulledTotal}件）`);
  } catch (err) {
    logger.error(`[bulkSyncCustomers] ${err.message}`);
    return ApiResponse.error(res, err.message, 500);
  }
}

/**
 * GET /api/admin/recalls
 * リコール一覧（管理者画面用）
 * Query: status (pending/done/cancelled/overdue/all), user_id, date_from, date_to
 */
async function getAllRecalls(req, res, next) {
  try {
    const { status, user_id, date_from, date_to } = req.query;
    const conditions = [];
    const params = [];
    if (status && status !== 'all') {
      if (status === 'overdue') {
        conditions.push("rt.status = 'pending' AND rt.recall_at < DATE_ADD(UTC_TIMESTAMP(), INTERVAL 9 HOUR)");
      } else {
        conditions.push('rt.status = ?');
        params.push(status);
      }
    }
    if (user_id) {
      conditions.push('rt.user_id = ?');
      params.push(user_id);
    }
    if (date_from) {
      conditions.push('DATE(rt.recall_at) >= ?');
      params.push(date_from);
    }
    if (date_to) {
      conditions.push('DATE(rt.recall_at) <= ?');
      params.push(date_to);
    }
    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    // 無効ユーザーのリコールは除外
    const activeUserClause = 'u.is_active = 1';
    const fullWhere = whereClause
      ? `${whereClause} AND ${activeUserClause}`
      : `WHERE ${activeUserClause}`;
    const [rows] = await pool.query(
      `SELECT rt.id, rt.company_id, rt.call_id, rt.user_id, rt.recall_at, rt.status, rt.created_at,
              COALESCE(c.company_name, '(不明)') AS company_name,
              c.phone_number, c.industry, c.address, c.region,
              u.name AS user_name,
              (SELECT cl.memo FROM calls cl WHERE cl.id = rt.call_id) AS last_memo,
              (SELECT cl.result_code FROM calls cl WHERE cl.id = rt.call_id) AS last_result,
              (TIMESTAMPDIFF(MINUTE, rt.recall_at, DATE_ADD(UTC_TIMESTAMP(), INTERVAL 9 HOUR))) AS overdue_minutes
       FROM recall_tasks rt
       LEFT JOIN companies c ON rt.company_id = c.id
       INNER JOIN users u ON rt.user_id = u.id
       ${fullWhere}
       ORDER BY
         CASE WHEN rt.status = 'pending' AND rt.recall_at < DATE_ADD(UTC_TIMESTAMP(), INTERVAL 9 HOUR) THEN 0
              WHEN rt.status = 'pending' THEN 1
              ELSE 2 END,
         rt.recall_at ASC
       LIMIT 1000`,
      params
    );

    // サマリ情報（無効ユーザーのリコールは除外）
    const [summary] = await pool.query(
      `SELECT
         COUNT(*) AS total,
         SUM(CASE WHEN rt.status = 'pending' AND rt.recall_at < DATE_ADD(UTC_TIMESTAMP(), INTERVAL 9 HOUR) THEN 1 ELSE 0 END) AS overdue_count,
         SUM(CASE WHEN rt.status = 'pending' AND rt.recall_at >= DATE_ADD(UTC_TIMESTAMP(), INTERVAL 9 HOUR) THEN 1 ELSE 0 END) AS upcoming_count,
         SUM(CASE WHEN rt.status = 'done' THEN 1 ELSE 0 END) AS done_count,
         SUM(CASE WHEN rt.status = 'cancelled' THEN 1 ELSE 0 END) AS cancelled_count
       FROM recall_tasks rt
       INNER JOIN users u ON rt.user_id = u.id
       WHERE u.is_active = 1`
    );

    // オペレーター別カウント（有効なオペレーターのみ）
    const [byUser] = await pool.query(
      `SELECT u.id AS user_id, u.name AS user_name,
              SUM(CASE WHEN rt.status = 'pending' AND rt.recall_at < DATE_ADD(UTC_TIMESTAMP(), INTERVAL 9 HOUR) THEN 1 ELSE 0 END) AS overdue_count,
              SUM(CASE WHEN rt.status = 'pending' AND rt.recall_at >= DATE_ADD(UTC_TIMESTAMP(), INTERVAL 9 HOUR) THEN 1 ELSE 0 END) AS upcoming_count,
              SUM(CASE WHEN rt.status = 'pending' THEN 1 ELSE 0 END) AS pending_count
       FROM users u
       LEFT JOIN recall_tasks rt ON rt.user_id = u.id
       WHERE u.role IN ('operator','intern') AND u.is_test_account = 0 AND u.is_active = 1
       GROUP BY u.id, u.name
       HAVING pending_count > 0 OR overdue_count > 0 OR upcoming_count > 0
       ORDER BY overdue_count DESC, pending_count DESC, u.name`
    );

    return ApiResponse.success(res, {
      recalls: rows,
      summary: summary[0],
      byUser,
    });
  } catch (err) {
    logger.error(`[getAllRecalls] ${err.message}`);
    return ApiResponse.error(res, err.message, 500);
  }
}

/**
 * PUT /api/admin/recalls/:id
 * リコールタスクのステータス・日時更新
 */
async function updateRecallTask(req, res, next) {
  try {
    const { id } = req.params;
    const { status, recall_at } = req.body;
    const updates = [];
    const params = [];
    if (status !== undefined) {
      const valid = ['pending', 'done', 'cancelled'];
      if (!valid.includes(status)) return ApiResponse.badRequest(res, '無効なステータス');
      updates.push('status = ?');
      params.push(status);
    }
    if (recall_at !== undefined) {
      updates.push('recall_at = ?');
      params.push(recall_at || null);
    }
    if (updates.length === 0) return ApiResponse.badRequest(res, '更新項目なし');
    params.push(id);
    await pool.execute(`UPDATE recall_tasks SET ${updates.join(', ')} WHERE id = ?`, params);
    return ApiResponse.success(res, null, '更新しました');
  } catch (err) {
    logger.error(`[updateRecallTask] ${err.message}`);
    return ApiResponse.error(res, err.message, 500);
  }
}

/**
 * DELETE /api/admin/recalls/:id
 */
async function deleteRecallTask(req, res, next) {
  try {
    const { id } = req.params;
    await pool.execute('DELETE FROM recall_tasks WHERE id = ?', [id]);
    return ApiResponse.success(res, null, '削除しました');
  } catch (err) {
    return ApiResponse.error(res, err.message, 500);
  }
}

/**
 * PUT /api/admin/recalls/:id/reassign
 * 別オペレーターに割り当て直し
 */
async function reassignRecallTask(req, res, next) {
  try {
    const { id } = req.params;
    const { user_id } = req.body;
    if (!user_id) return ApiResponse.badRequest(res, 'user_id 必須');
    await pool.execute('UPDATE recall_tasks SET user_id = ? WHERE id = ?', [user_id, id]);
    return ApiResponse.success(res, null, '担当変更しました');
  } catch (err) {
    return ApiResponse.error(res, err.message, 500);
  }
}

/**
 * GET /api/admin/incentive?month=YYYY-MM
 * 内定日ベースのインセンティブ集計（月別）
 * サマリ: 内定社数合計 / 初回入金合計 / 見込入金合計 / コスト / ROAS
 * オペレーター別内訳 + 案件一覧
 */
async function getIncentiveData(req, res, next) {
  try {
    const HOURLY_RATE = 1500;
    const INTERN_HOURLY_RATE = 1250;
    // 業務カテゴリ (技人国/特定技能) フィルタ
    const { buildWorkCategoryFilter } = require('../middlewares/auth');
    const wcFilter = buildWorkCategoryFilter(req, 'p.work_category');

    const now = new Date();
    const defaultMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const month = (req.query.month || defaultMonth).slice(0, 7);
    const [yStr, mStr] = month.split('-');
    const y = parseInt(yStr, 10);
    const m = parseInt(mStr, 10);
    if (!y || !m || m < 1 || m > 12) {
      return ApiResponse.error(res, 'Invalid month', 400);
    }
    const lastDay = new Date(y, m, 0).getDate();
    const dateFrom = `${month}-01`;
    const dateTo = `${month}-${String(lastDay).padStart(2, '0')}`;

    // オペレーター一覧
    const [users] = await pool.query(
      `SELECT u.id, u.name, u.role, u.is_active, u.commute_type, u.commute_teiki_monthly, u.commute_daily_amount
       FROM users u
       WHERE u.role IN ('operator','intern') AND u.is_test_account = 0
       ORDER BY u.id ASC`
    );

    // 内定案件（指定月の offer_date、sales_projects_v2='架電バイト' から取得）
    // - hire_count: 同一求人番号の行数 (= 合格人数)
    // - owner_user_id: 求人番号で callcenter.projects→owner_user_id を解決 (LIMIT 1)
    // - 取消/辞退も内定社1としてカウント(売上は0で記録、CPAv2と同じ仕様)
    let projects = [];
    try {
      // 業務カテゴリで絞るときは projects テーブルの work_category を引き当てる EXISTS を付与。
      // sales_projects_v2 には work_category カラムが無いため、job_number 経由で projects と紐付ける。
      const wcExistsClause = wcFilter.sql
        ? `AND EXISTS (SELECT 1 FROM projects p2 WHERE p2.job_number = sp.job_number AND p2.is_legacy = 0 ${wcFilter.sql.replace(/p\.work_category/g, 'p2.work_category')})`
        : '';
      const [rows] = await pool.query(
        `SELECT
           sp.id AS project_id,
           sp.job_number,
           sp.offer_date AS naitei_date,
           sp.acquired_date AS acquired_at,
           sp.company_name,
           sp.sales_owner AS sales_name,
           sp.first_payment AS initial_payment,
           sp.expected_revenue,
           sp.payment_actual,
           sp.is_cancelled,
           sp.is_declined,
           (SELECT u.id FROM projects p JOIN users u ON u.id = p.owner_user_id
             WHERE p.job_number = sp.job_number AND p.is_legacy = 0 AND p.owner_user_id IS NOT NULL
             ORDER BY p.created_at DESC LIMIT 1) AS owner_user_id
         FROM sales_projects_v2 sp
         WHERE sp.offer_date BETWEEN ? AND ?
         ${wcExistsClause}
         ORDER BY sp.offer_date DESC`,
        [dateFrom, dateTo, ...wcFilter.params]
      );
      projects = rows;
    } catch (e) {
      logger.warn(`[getIncentiveData] v2 fetch failed (fallback to v1): ${e.message}`);
      // v2テーブル無しなら旧ロジックにフォールバック
      const [rows] = await pool.query(
        `SELECT
           p.id AS project_id,
           p.owner_user_id,
           p.job_number,
           p.naitei_date,
           p.created_at AS acquired_at,
           COALESCE(c.company_name, p.legacy_company_name) AS company_name,
           su.name AS sales_name,
           (SELECT COUNT(*) FROM project_hires ph WHERE ph.project_id = p.id AND ph.is_cancelled = 0) AS hire_count,
           (SELECT COALESCE(SUM(ph.initial_payment), 0) FROM project_hires ph WHERE ph.project_id = p.id AND ph.is_cancelled = 0) AS initial_payment,
           (SELECT COALESCE(SUM(ph.expected_revenue), 0) FROM project_hires ph WHERE ph.project_id = p.id AND ph.is_cancelled = 0) AS expected_revenue
         FROM projects p
         LEFT JOIN companies c ON p.company_id = c.id
         LEFT JOIN users su ON p.sales_user_id = su.id
         WHERE p.is_prospect = 0
           AND p.status = 'NAITEI'
           AND p.naitei_date BETWEEN ? AND ?
           ${wcFilter.sql}
         ORDER BY p.naitei_date DESC`,
        [dateFrom, dateTo, ...wcFilter.params]
      );
      projects = rows;
    }
    // 求人番号(または会社名)ごとに hire_count を求める (同一企業=1社)
    const hireCountByJob = new Map();
    for (const p of projects) {
      const k = (p.job_number && String(p.job_number).trim()) || p.company_name || '?';
      hireCountByJob.set(k, (hireCountByJob.get(k) || 0) + 1);
    }
    // 各行に hire_count をセット (求人ごとの行数=合格人数)
    for (const p of projects) {
      if (p.hire_count != null) continue; // v1 fallback ならすでに入っている
      const k = (p.job_number && String(p.job_number).trim()) || p.company_name || '?';
      p.hire_count = hireCountByJob.get(k) || 1;
    }

    // コスト計算（cost_records）
    const [costRows] = await pool.query(
      `SELECT cr.user_id,
        COALESCE(SUM(TIMESTAMPDIFF(MINUTE, CONCAT(cr.date,' ',cr.start_time), CONCAT(cr.date,' ',cr.end_time)) - COALESCE(cr.break_minutes,0)), 0) AS total_minutes,
        COUNT(DISTINCT cr.date) AS work_days
       FROM cost_records cr
       WHERE cr.date BETWEEN ? AND ?
       GROUP BY cr.user_id`,
      [dateFrom, dateTo]
    );
    const costMap = new Map();
    for (const r of costRows) {
      const u = users.find(uu => uu.id === r.user_id);
      if (!u) continue;
      const isIntern = u.role === 'intern';
      const rate = isIntern ? INTERN_HOURLY_RATE : HOURLY_RATE;
      const totalMinutes = Number(r.total_minutes) || 0;
      const labor = Math.round(totalMinutes / 60 * rate);
      let commute = 0;
      if (u.commute_type === 'teiki') {
        const days = lastDay; // 月額を月日数按分（ここでは該当月まるごと）
        commute = Math.round((u.commute_teiki_monthly || 0) / 30 * days);
      } else if (u.commute_type === 'daily') {
        commute = (u.commute_daily_amount || 0) * Number(r.work_days || 0);
      }
      const total = labor + commute;
      costMap.set(r.user_id, isIntern ? Math.round(total / 2) : total);
    }

    // オペレーター別集計
    const operatorMap = new Map();
    for (const u of users) {
      operatorMap.set(u.id, {
        userId: u.id,
        name: u.name,
        role: u.role,
        isActive: !!u.is_active,
        naiteiCount: 0,
        hireTotal: 0,
        initialPayment: 0,
        expectedRevenue: 0,
        cost: costMap.get(u.id) || 0,
        projects: [],
      });
    }

    // v2 (sales_projects_v2) は同一求人番号が複数行 = 1社で複数内定者。ユニーク社数で集計。
    // v1 fallback では 1 project = 1社のためそのまま row 数 = 社数。
    const isV2Mode = projects.length > 0 && Object.prototype.hasOwnProperty.call(projects[0], 'payment_actual');
    const seenByOpJobKey = new Map(); // op.userId → Set<jobKey>
    for (const p of projects) {
      const op = operatorMap.get(p.owner_user_id);
      if (!op) continue;
      const jobKey = (p.job_number && String(p.job_number).trim()) || p.company_name || `__pid_${p.project_id}`;
      let setForOp = seenByOpJobKey.get(op.userId);
      if (!setForOp) { setForOp = new Set(); seenByOpJobKey.set(op.userId, setForOp); }
      const isNewCompany = !setForOp.has(jobKey);
      setForOp.add(jobKey);

      const ip = Number(p.initial_payment) || 0;
      const er = Number(p.expected_revenue) || 0;
      const ap = Number(p.payment_actual) || 0;
      // 人数: v2 では 1行=1人、v1 では project_hires.COUNT(*)
      const hc = isV2Mode ? 1 : (Number(p.hire_count) || 0);
      if (isNewCompany) op.naiteiCount++;
      op.hireTotal += hc;
      op.initialPayment += ip;
      op.expectedRevenue += er;
      op.actualPayment = (op.actualPayment || 0) + ap;
      op.projects.push({
        projectId: p.project_id,
        jobNumber: p.job_number,
        companyName: p.company_name,
        naiteiDate: p.naitei_date instanceof Date ? p.naitei_date.toISOString().slice(0, 10) : p.naitei_date,
        acquiredDate: p.acquired_at instanceof Date ? p.acquired_at.toISOString().slice(0, 10) : (p.acquired_at ? String(p.acquired_at).slice(0, 10) : null),
        salesName: p.sales_name,
        hireCount: hc,
        initialPayment: ip,
        expectedRevenue: er,
        paymentActual: ap,
        isCancelled: !!p.is_cancelled,
        isDeclined: !!p.is_declined,
      });
    }

    // オペレーター毎に ROAS 計算
    for (const op of operatorMap.values()) {
      op.roas = op.cost > 0 ? Math.round(op.initialPayment / op.cost * 10000) / 100 : 0;
    }

    const operators = [...operatorMap.values()]
      .filter(op => op.isActive || op.naiteiCount > 0 || op.cost > 0)
      .sort((a, b) => {
        if (a.role === 'intern' && b.role !== 'intern') return 1;
        if (a.role !== 'intern' && b.role === 'intern') return -1;
        return b.naiteiCount - a.naiteiCount;
      });

    // チーム全体サマリ
    const summary = {
      naiteiCount: operators.reduce((s, o) => s + o.naiteiCount, 0),
      hireTotal: operators.reduce((s, o) => s + o.hireTotal, 0),
      initialPayment: operators.reduce((s, o) => s + o.initialPayment, 0),
      expectedRevenue: operators.reduce((s, o) => s + o.expectedRevenue, 0),
      actualPayment: operators.reduce((s, o) => s + (o.actualPayment || 0), 0),
      cost: operators.reduce((s, o) => s + o.cost, 0),
    };
    summary.roas = summary.cost > 0 ? Math.round(summary.initialPayment / summary.cost * 10000) / 100 : 0;
    summary.actualRoas = summary.cost > 0 ? Math.round(summary.actualPayment / summary.cost * 10000) / 100 : 0;

    return ApiResponse.success(res, {
      month,
      dateFrom,
      dateTo,
      summary,
      operators,
    });
  } catch (err) {
    logger.error(`[getIncentiveData] ${err.message}`);
    return ApiResponse.error(res, err.message, 500);
  }
}

/**
 * GET /api/admin/auto-pickup-industries
 * 自動ピックアップ対象業種マップ（system_settings）を返す
 */
async function getAutoPickupIndustries(req, res, next) {
  try {
    const [rows] = await pool.execute(
      "SELECT setting_value FROM system_settings WHERE setting_key = 'auto_pickup_industries'"
    );
    let map = {};
    if (rows.length > 0) {
      try { map = JSON.parse(rows[0].setting_value); } catch (e) {}
    }
    return ApiResponse.success(res, { industries: map });
  } catch (err) {
    return ApiResponse.error(res, err.message, 500);
  }
}

/**
 * PUT /api/admin/auto-pickup-industries
 * body: { industries: { 飲食: true, 製造: false, ... } }
 */
async function setAutoPickupIndustries(req, res, next) {
  try {
    const { industries } = req.body || {};
    if (!industries || typeof industries !== 'object') {
      return ApiResponse.badRequest(res, 'industries オブジェクトが必要です');
    }
    await pool.execute(
      `INSERT INTO system_settings (setting_key, setting_value) VALUES ('auto_pickup_industries', ?)
       ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)`,
      [JSON.stringify(industries)]
    );
    logger.info(`自動ピックアップ業種更新: ${JSON.stringify(industries)}`);
    return ApiResponse.success(res, { industries });
  } catch (err) {
    return ApiResponse.error(res, err.message, 500);
  }
}

/**
 * GET /api/admin/auto-pickup-prefectures
 * 自動ピックアップ対象都道府県マップ（system_settings）を返す
 */
async function getAutoPickupPrefectures(req, res, next) {
  try {
    const [rows] = await pool.execute(
      "SELECT setting_value FROM system_settings WHERE setting_key = 'auto_pickup_prefectures'"
    );
    let map = {};
    if (rows.length > 0) {
      try { map = JSON.parse(rows[0].setting_value); } catch (e) {}
    }
    return ApiResponse.success(res, { prefectures: map });
  } catch (err) {
    return ApiResponse.error(res, err.message, 500);
  }
}

/**
 * PUT /api/admin/auto-pickup-prefectures
 * body: { prefectures: { 東京都: true, 大阪府: false, ... } }
 */
async function setAutoPickupPrefectures(req, res, next) {
  try {
    const { prefectures } = req.body || {};
    if (!prefectures || typeof prefectures !== 'object') {
      return ApiResponse.badRequest(res, 'prefectures オブジェクトが必要です');
    }
    await pool.execute(
      `INSERT INTO system_settings (setting_key, setting_value) VALUES ('auto_pickup_prefectures', ?)
       ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)`,
      [JSON.stringify(prefectures)]
    );
    logger.info(`自動ピックアップ都道府県更新: ${JSON.stringify(prefectures)}`);
    return ApiResponse.success(res, { prefectures });
  } catch (err) {
    return ApiResponse.error(res, err.message, 500);
  }
}

/**
 * POST /api/admin/companies/bulk-delete
 * body: { ids: [1,2,3] }
 * 選択された企業を exclusion_flag=1 で除外（物理削除ではなくフラグ除外）
 */
async function bulkDeleteCompanies(req, res, next) {
  try {
    const { ids, physical } = req.body || {};
    if (!Array.isArray(ids) || ids.length === 0) {
      return ApiResponse.badRequest(res, 'ids配列が必要です');
    }
    // 500件ずつチャンクで処理
    let affected = 0;
    for (let i = 0; i < ids.length; i += 500) {
      const chunk = ids.slice(i, i + 500);
      const placeholders = chunk.map(() => '?').join(',');
      if (physical === true) {
        // 物理削除（関連データのカスケード問題あり得るので基本使わない）
        const [r] = await pool.query(
          `DELETE FROM companies WHERE id IN (${placeholders})`, chunk
        );
        affected += r.affectedRows;
      } else {
        const [r] = await pool.query(
          `UPDATE companies SET exclusion_flag = 1 WHERE id IN (${placeholders})`, chunk
        );
        affected += r.affectedRows;
      }
    }
    logger.info(`[bulkDeleteCompanies] ${affected}件 by user=${req.user.id}`);
    return ApiResponse.success(res, { affected }, `${affected}件を除外しました`);
  } catch (err) {
    logger.error(`[bulkDeleteCompanies] ${err.message}`);
    return ApiResponse.error(res, err.message, 500);
  }
}

/**
 * GET /api/admin/companies/industry-stats
 * 業種別の件数統計
 * ?actionable=1 で「未架電 + 最終結果が不通」の件数を返却
 */
async function getCompaniesIndustryStats(req, res, next) {
  try {
    const actionableOnly = req.query.actionable === '1' || req.query.actionable === 'true';

    // 大枠カテゴリ判定（キーワード部分一致、上から順に判定）
    // 優先度: 製造・小売・建設 を先に判定することで
    // 「食料品製造業」「飲食料品小売業」等の複合業種を正しく分類
    const CATEGORIES = [
      { name: '製造', keywords: ['製造業', 'メーカー', '加工業'] },
      { name: '小売', keywords: ['小売', '卸売', 'スーパー', 'コンビニ', 'ショッピング', '商社', '販売', '物販'] },
      { name: '建設', keywords: ['建設', '工事', '建築', '土木', '左官', '設備工事', 'リフォーム'] },
      { name: '宿泊', keywords: ['宿泊', 'ホテル', '旅館', '民宿'] },
      { name: '農業', keywords: ['農業', '農産', '畜産', '水産', '漁業', '林業'] },
      { name: '介護', keywords: ['介護', '医療', '福祉', '病院', 'クリニック', '歯科', 'デイサービス'] },
      { name: '運輸', keywords: ['運輸', '運送', '輸送', '物流', 'タクシー', '鉄道', '配送'] },
      { name: 'IT', keywords: ['情報通信', 'ソフトウェア', 'IT業', 'インターネット', 'システム', 'プログラミング', 'Web'] },
      { name: '金融', keywords: ['金融', '銀行', '保険', '証券'] },
      { name: '不動産', keywords: ['不動産'] },
      { name: '美容', keywords: ['美容', 'エステ', '理容', 'サロン', 'ネイル'] },
      // 飲食は最後の方に（複合語「飲食料品」を先に小売で拾わせるため）
      { name: '飲食', keywords: ['飲食店', 'グルメ', 'レストラン', '居酒屋', 'ラーメン', 'カフェ', '喫茶店', '寿司', '焼肉', '和食', '中華', '洋食', '食堂', 'バー', 'ダイニング', 'すき焼き', 'そば', 'うどん', '菓子'] },
      { name: 'サービス', keywords: ['サービス'] },
    ];

    const categorize = (industry) => {
      if (!industry) return 'その他';
      for (const c of CATEGORIES) {
        if (c.keywords.some(kw => industry.includes(kw))) return c.name;
      }
      return 'その他';
    };

    // 事前計算済み industry_category カラムを使って高速集計
    let rows;
    if (actionableOnly) {
      [rows] = await pool.query(`
        SELECT IFNULL(c.industry_category, 'その他') AS category, COUNT(*) AS cnt
        FROM companies c
        WHERE c.exclusion_flag = 0 AND IFNULL(c.is_special, 0) = 0
          AND (
            c.last_called_at IS NULL
            OR (
              SELECT cl.result_code FROM calls cl
              WHERE cl.company_id = c.id
              ORDER BY cl.call_started_at DESC LIMIT 1
            ) = 'NO_ANSWER'
          )
        GROUP BY IFNULL(c.industry_category, 'その他')
      `);
    } else {
      [rows] = await pool.query(`
        SELECT IFNULL(c.industry_category, 'その他') AS category, COUNT(*) AS cnt
        FROM companies c
        WHERE c.exclusion_flag = 0 AND IFNULL(c.is_special, 0) = 0
        GROUP BY IFNULL(c.industry_category, 'その他')
      `);
    }

    const categoryMap = new Map();
    for (const r of rows) {
      categoryMap.set(r.category, Number(r.cnt));
    }

    // 表示順（飲食・小売を先頭に、その他は最後）
    const displayOrder = ['飲食', '小売', '製造', '建設', '宿泊', '農業', '介護', '運輸', 'IT', '金融', '不動産', '美容', 'サービス', 'その他'];
    const industries = displayOrder
      .filter(name => categoryMap.has(name))
      .map(name => ({ industry: name, count: categoryMap.get(name) }));

    const total = industries.reduce((s, r) => s + r.count, 0);
    return ApiResponse.success(res, {
      total,
      actionable: actionableOnly,
      industries,
    });
  } catch (err) {
    logger.error(`[industry-stats] ${err.message}`);
    return ApiResponse.error(res, err.message, 500);
  }
}

/**
 * GET /api/admin/database-stats
 * 各テーブルの行数・サイズを返却（MySQL情報）
 */
async function getDatabaseStats(req, res, next) {
  try {
    // SHOW TABLE STATUS を使う（Railway で information_schema 権限制限対応）
    const [tables] = await pool.query('SHOW TABLE STATUS');
    const formatted = tables.map(t => ({
      name: t.Name,
      rows: Number(t.Rows || 0),
      size_mb: Number(((t.Data_length || 0) + (t.Index_length || 0)) / 1024 / 1024).toFixed(2) * 1,
      data_mb: Number((t.Data_length || 0) / 1024 / 1024).toFixed(2) * 1,
      index_mb: Number((t.Index_length || 0) / 1024 / 1024).toFixed(2) * 1,
      data_free_mb: Number((t.Data_free || 0) / 1024 / 1024).toFixed(2) * 1,
    })).sort((a, b) => b.size_mb - a.size_mb);

    // 全体のカウント/サイズも取得
    let totals;
    try {
      const [r] = await pool.query('SELECT COUNT(*) as c FROM calls');
      totals = { calls_count: Number(r[0].c) };
    } catch (e) { totals = null; }

    return ApiResponse.success(res, { tables: formatted, totals });
  } catch (err) {
    logger.error(`[database-stats] ${err.code} ${err.message} ${err.sqlMessage}`);
    return ApiResponse.error(res, `DB容量取得失敗: ${err.sqlMessage || err.message}`, 500);
  }
}

/**
 * POST /api/admin/cleanup-database
 * 不要データをクリーンアップしてストレージを解放
 * body: { drop_transcripts_days?: 30, drop_skip_days?: 30, drop_stale_calls?: true }
 */
async function cleanupDatabase(req, res, next) {
  // デフォルト: SKIP/PROJECT/INTERESTED/文字起こしは保持
  // aggressive=true で全NO_ANSWER削除などより積極的に
  const aggressive = req.body?.aggressive === true;
  const {
    drop_transcripts_days = 0,
    drop_skip_days = 0,
    drop_stale_calls = true,
    drop_no_answer_days = aggressive ? 2 : 7,   // aggressive: 2日でも再ピックアップ可になる最短
    drop_ng_days = aggressive ? 90 : 120,       // aggressive: 90日（NG最短）
    drop_recall_days = aggressive ? 7 : 30,     // aggressive: 7日
  } = req.body || {};
  const results = {};
  try {
    // 1. 古い文字起こしをNULLに（明示的に指定時のみ）
    if (drop_transcripts_days > 0) {
      try {
        const [r] = await pool.execute(
          `UPDATE calls SET transcript = NULL
           WHERE transcript IS NOT NULL
             AND call_started_at < DATE_SUB(DATE_ADD(UTC_TIMESTAMP(), INTERVAL 9 HOUR), INTERVAL ? DAY)`,
          [drop_transcripts_days]
        );
        results.transcriptsCleared = r.affectedRows;
      } catch (e) { results.transcriptsError = e.message; }
    }

    // 2. 古い SKIP 結果を削除（デフォルト無効: 再ピックアップ防止のため保持）
    if (drop_skip_days > 0) {
      try {
        const [r] = await pool.execute(
          `DELETE FROM calls
           WHERE result_code = 'SKIP'
             AND call_started_at < DATE_SUB(DATE_ADD(UTC_TIMESTAMP(), INTERVAL 9 HOUR), INTERVAL ? DAY)`,
          [drop_skip_days]
        );
        results.skipCallsDeleted = r.affectedRows;
      } catch (e) { results.skipError = e.message; }
    }

    // 3. 未完了通話（result_code IS NULL）で24時間以上経過したものを削除
    if (drop_stale_calls) {
      try {
        const [r] = await pool.execute(
          `DELETE FROM calls
           WHERE result_code IS NULL
             AND call_started_at < DATE_SUB(DATE_ADD(UTC_TIMESTAMP(), INTERVAL 9 HOUR), INTERVAL 1 DAY)`
        );
        results.staleCallsDeleted = r.affectedRows;
      } catch (e) { results.staleError = e.message; }
    }

    // 4. 古い NO_ANSWER 削除（同企業に新しいNO_ANSWERがあれば古いのは不要）
    if (drop_no_answer_days > 0) {
      try {
        const [r] = await pool.execute(
          `DELETE FROM calls
           WHERE result_code = 'NO_ANSWER'
             AND call_started_at < DATE_SUB(DATE_ADD(UTC_TIMESTAMP(), INTERVAL 9 HOUR), INTERVAL ? DAY)`,
          [drop_no_answer_days]
        );
        results.noAnswerDeleted = r.affectedRows;
      } catch (e) { results.noAnswerError = e.message; }
    }

    // 5. 古い NG 削除（NG再ピックアップは90日後 → 120日以上のNGは不要）
    if (drop_ng_days > 0) {
      try {
        const [r] = await pool.execute(
          `DELETE FROM calls
           WHERE result_code = 'NG'
             AND call_started_at < DATE_SUB(DATE_ADD(UTC_TIMESTAMP(), INTERVAL 9 HOUR), INTERVAL ? DAY)`,
          [drop_ng_days]
        );
        results.ngDeleted = r.affectedRows;
      } catch (e) { results.ngError = e.message; }
    }

    // 6. 古い RECALL 削除（recall_tasksで管理されているので古いcalls.RECALLは不要）
    if (drop_recall_days > 0) {
      try {
        const [r] = await pool.execute(
          `DELETE FROM calls
           WHERE result_code = 'RECALL'
             AND call_started_at < DATE_SUB(DATE_ADD(UTC_TIMESTAMP(), INTERVAL 9 HOUR), INTERVAL ? DAY)`,
          [drop_recall_days]
        );
        results.recallDeleted = r.affectedRows;
      } catch (e) { results.recallError = e.message; }
    }

    // 4. OPTIMIZE TABLE でディスク領域を解放（InnoDBではALTER TABLE ... FORCEに相当）
    try {
      const [r] = await pool.query('OPTIMIZE TABLE calls');
      results.optimized = true;
      results.optimizeMsg = r && r[0] ? `${r[0].Table}: ${r[0].Op} ${r[0].Msg_type} ${r[0].Msg_text}` : 'done';
    } catch (e) { results.optimizeError = e.message; }

    // 5. ALTER TABLE ENGINE = InnoDB で強制的に領域再構築（OPTIMIZEが効かない場合の代替）
    try {
      await pool.query('ALTER TABLE calls ENGINE = InnoDB');
      results.altered = true;
    } catch (e) { results.alterError = e.message; }

    logger.info(`[Cleanup] ${JSON.stringify(results)}`);
    return ApiResponse.success(res, results, 'クリーンアップ完了');
  } catch (err) {
    return ApiResponse.error(res, err.message, 500);
  }
}
