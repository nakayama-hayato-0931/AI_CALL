/**
 * 通話コントローラー
 * 架電開始・終了・結果登録・スキップ・履歴取得
 */
const pool = require('../../config/database');
const ApiResponse = require('../utils/apiResponse');
const logger = require('../utils/logger');
const { findTranscript, findTranscriptsBatch, findDurationsBatch } = require('../services/googleSheetsService');
const faxCrmClient = require('../services/faxCrmClient');
const { invalidateCallListCache } = require('./companyController');

/**
 * POST /api/calls/start
 * 架電開始を記録（ロック所有を検証）
 */
const startCall = async (req, res, next) => {
  try {
    const { company_id, call_type } = req.body;
    const userId = req.user.id;
    const resolvedCallType = call_type || (req.user.role === 'sales' ? 'sales' : 'operator');

    if (!company_id) {
      return ApiResponse.badRequest(res, '企業IDは必須です');
    }

    // テストアカウント: DBに書き込まずダミーIDを返す
    if (req.user.isTestAccount) {
      logger.info(`[TEST] 架電開始(テスト): user=${userId}, company=${company_id}`);
      return ApiResponse.created(res, { callId: `test-${Date.now()}` }, '架電を開始しました（テストモード）');
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

    // 同一企業の未完了通話(result_code=NULL)があれば再利用して枠を重複させない。
    //   別企業の未完了は削除せず残し、架電結果ログから後で結果入力できるようにする。
    const [existingUnsaved] = await pool.execute(
      'SELECT id FROM calls WHERE user_id = ? AND company_id = ? AND result_code IS NULL ORDER BY id DESC LIMIT 1',
      [userId, company_id]
    );
    if (existingUnsaved.length > 0) {
      const reuseId = existingUnsaved[0].id;
      await pool.execute('UPDATE calls SET call_started_at = NOW() WHERE id = ?', [reuseId]);
      await pool.execute('UPDATE companies SET last_called_at = NOW(), locked_at = NOW() WHERE id = ?', [company_id]);
      logger.info(`架電開始(未完了枠を再利用): user=${userId}, company=${company_id}, call=${reuseId}`);
      return ApiResponse.created(res, { callId: reuseId }, '架電を開始しました');
    }

    let result;
    const workCategory = req.user?.workCategory || 'general';
    try {
      [result] = await pool.execute(
        `INSERT INTO calls (user_id, company_id, call_started_at, call_type, work_category)
         VALUES (?, ?, NOW(), ?, ?)`,
        [userId, company_id, resolvedCallType, workCategory]
      );
    } catch (insertErr) {
      // work_category または call_type カラムが無い場合のフォールバック
      logger.warn(`[startCall] work_category付きINSERT失敗、フォールバック: ${insertErr.code} ${insertErr.sqlMessage || insertErr.message}`);
      try {
        [result] = await pool.execute(
          `INSERT INTO calls (user_id, company_id, call_started_at) VALUES (?, ?, NOW())`,
          [userId, company_id]
        );
      } catch (insertErr2) {
        logger.error(`[startCall] INSERT calls フォールバックも失敗: ${insertErr2.code} ${insertErr2.sqlMessage || insertErr2.message}`);
        throw insertErr2;
      }
    }

    // 企業のlast_called_atを更新 & ロック時刻も更新（長時間通話対応）
    await pool.execute(
      'UPDATE companies SET last_called_at = NOW(), locked_at = NOW() WHERE id = ?',
      [company_id]
    );

    logger.info(`架電開始: user=${userId}, company=${company_id}, call=${result.insertId}`);

    return ApiResponse.created(res, { callId: result.insertId }, '架電を開始しました');
  } catch (err) {
    logger.error(`[startCall] エラー: code=${err.code} message=${err.message} sqlMessage=${err.sqlMessage} sql=${err.sql}`);
    return ApiResponse.error(res, `架電開始失敗: ${err.sqlMessage || err.message}`, 500);
  }
};

/**
 * PUT /api/calls/:id/end
 * 通話結果を登録（ロックも解除）
 */
const endCall = async (req, res, next) => {
  // テストアカウント: DBに書き込まずダミーレスポンスを返す
  if (req.user.isTestAccount) {
    const { result_code } = req.body;
    logger.info(`[TEST] 通話結果登録(テスト): call=${req.params.id}, result=${result_code}`);
    return ApiResponse.success(res, { callId: req.params.id, projectId: result_code === 'PROJECT' ? `test-proj-${Date.now()}` : null }, '通話結果を保存しました（テストモード）');
  }

  const { id } = req.params;
  const {
    result_code,
    memo,
    recall_at,
    is_effective_connection,
    is_person_in_charge,
    is_prospect,
    overwrite, // true なら同企業の既存レコードを上書き保存
    contact_person_name,
    contact_person_gender,
    contact_person_impression,
    contact_person_phone,
    ng_reason,
  } = req.body;

  // バリデーション
  const validCodes = ['NO_ANSWER', 'NG', 'RECALL', 'INTERESTED', 'PROJECT', 'SKIP'];
  if (!result_code || !validCodes.includes(result_code)) {
    return ApiResponse.badRequest(res, '有効な結果コードを指定してください');
  }
  if (result_code === 'RECALL' && !recall_at) {
    return ApiResponse.badRequest(res, 'リコールの場合はrecall_atが必須です');
  }
  if (result_code === 'NG' && !ng_reason) {
    return ApiResponse.badRequest(res, 'NGの場合はNG理由を選択してください');
  }

  try {
    // 重複チェック (PROJECT のみ)
    // 既存があり overwrite フラグが立っていない場合は 409 で問い合わせる。
    // RECALL は重複確認せず、既存 pending リコールがあれば更新する（下の付随処理を参照）。
    if (!overwrite && result_code === 'PROJECT') {
      // 通話から company_id を取得
      const [callPre] = await pool.execute(
        'SELECT company_id FROM calls WHERE id = ?', [id]
      );
      const companyId = callPre[0]?.company_id;
      if (companyId) {
        const [exists] = await pool.execute(
          `SELECT p.id, p.status, p.created_at, p.job_number,
                  COALESCE(c.company_name, p.legacy_company_name) AS company_name,
                  u.name AS owner_name
           FROM projects p
           LEFT JOIN companies c ON p.company_id = c.id
           LEFT JOIN users u ON p.owner_user_id = u.id
           WHERE p.company_id = ? AND p.is_legacy = 0
             AND (p.status IS NULL OR p.status NOT IN ('LOST','BARASHI'))
           ORDER BY p.created_at DESC LIMIT 1`,
          [companyId]
        );
        if (exists.length > 0) {
          return res.status(409).json({
            success: false,
            code: 'DUPLICATE_PROJECT',
            message: `この企業には既に案件があります（${exists[0].status || '未確定'}）。上書き保存しますか？`,
            existing: exists[0],
          });
        }
      }
    }

    // overwrite=true の場合は既存案件を無効化（RECALL は重複しないので対象外）
    if (overwrite && result_code === 'PROJECT') {
      const [callPre] = await pool.execute('SELECT company_id FROM calls WHERE id = ?', [id]);
      const companyId = callPre[0]?.company_id;
      if (companyId) {
        // 既存案件を LOST にして残す（履歴保持）。新しい案件は通常通り作成される。
        await pool.execute(
          `UPDATE projects SET status = 'LOST', memo = CONCAT(COALESCE(memo, ''), '\n[上書きにより無効化]')
           WHERE company_id = ? AND is_legacy = 0
             AND (status IS NULL OR status NOT IN ('LOST','BARASHI'))`,
          [companyId]
        );
      }
    }

    // ステップ1: 通話レコード更新（トランザクションなしでシンプルに）
    let updateResult;
    try {
      [updateResult] = await pool.execute(
        `UPDATE calls SET
          call_ended_at = NOW(),
          result_code = ?,
          memo = ?,
          recall_at = ?,
          is_effective_connection = ?,
          is_person_in_charge = ?,
          is_project_created = ?,
          contact_person_name = ?,
          contact_person_gender = ?,
          contact_person_impression = ?,
          contact_person_phone = ?,
          ng_reason = ?
         WHERE id = ?`,
        [
          result_code,
          memo || null,
          recall_at || null,
          is_effective_connection ? 1 : 0,
          is_person_in_charge ? 1 : 0,
          (result_code === 'PROJECT' && !is_prospect) ? 1 : 0,
          contact_person_name || null,
          contact_person_gender || null,
          contact_person_impression || null,
          contact_person_phone || null,
          result_code === 'NG' ? (ng_reason || null) : null,
          id,
        ]
      );
    } catch (colErr) {
      // 担当者情報カラムが無い場合のフォールバック
      logger.warn(`[endCall] contact_person columns missing? ${colErr.message}`);
      [updateResult] = await pool.execute(
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
          (result_code === 'PROJECT' && !is_prospect) ? 1 : 0,
          id,
        ]
      );
    }

    if (updateResult.affectedRows === 0) {
      return ApiResponse.notFound(res, '通話が見つかりません');
    }

    // 通話情報を取得
    const [callRows] = await pool.execute('SELECT * FROM calls WHERE id = ?', [id]);
    const call = callRows[0];
    if (!call) {
      return ApiResponse.notFound(res, '通話が見つかりません');
    }

    // ステップ2: 付随処理（失敗しても通話結果は保存済みなので致命的ではない）
    let projectId = null;
    const warnings = [];

    // RECALL: 既存の pending リコールがあれば更新（重複作成しない）、なければ新規作成
    if (result_code === 'RECALL') {
      try {
        const [upd] = await pool.execute(
          `UPDATE recall_tasks
             SET recall_at = ?, user_id = ?, call_id = ?
           WHERE company_id = ? AND status = 'pending'`,
          [recall_at, call.user_id, id, call.company_id]
        );
        if (upd.affectedRows === 0) {
          await pool.execute(
            `INSERT INTO recall_tasks (call_id, company_id, user_id, recall_at, status)
             VALUES (?, ?, ?, ?, 'pending')`,
            [id, call.company_id, call.user_id, recall_at]
          );
        } else {
          logger.info(`[endCall] リコール更新(重複作成回避): company=${call.company_id}, ${upd.affectedRows}件`);
        }
      } catch (e) {
        logger.error(`[endCall] recall_tasks保存エラー: ${e.message}`);
        warnings.push(`リコールタスク保存失敗: ${e.sqlMessage || e.message}`);
      }
    }

    // リコール自動完了: 不通(NO_ANSWER)・リコール(RECALL)以外の確定結果を入力したら、
    //   この企業の pending リコールを完了にする（架電済みとして消し込む）。
    if (['NG', 'INTERESTED', 'PROJECT'].includes(result_code)) {
      try {
        const [done] = await pool.execute(
          `UPDATE recall_tasks SET status = 'completed' WHERE company_id = ? AND status = 'pending'`,
          [call.company_id]
        );
        if (done.affectedRows > 0) {
          logger.info(`[endCall] リコール自動完了: company=${call.company_id}, ${done.affectedRows}件 (result=${result_code})`);
        }
      } catch (e) {
        logger.error(`[endCall] リコール自動完了エラー: ${e.message}`);
      }
    }

    // PROJECT: 案件レコード作成
    if (result_code === 'PROJECT') {
      try {
        // calls.work_category を継承 (集計を技人国/特定技能で分離するため)
        const callWorkCategory = call.work_category || 'general';
        let projectResult;
        try {
          [projectResult] = await pool.execute(
            `INSERT INTO projects (company_id, created_call_id, owner_user_id, status, is_prospect, call_type, work_category)
             VALUES (?, ?, ?, 'NEW', ?, ?, ?)`,
            [call.company_id, id, call.user_id, is_prospect ? 1 : 0, call.call_type || 'operator', callWorkCategory]
          );
        } catch (e) {
          logger.warn(`[endCall] projects work_category付きINSERT失敗、フォールバック: ${e.code} ${e.sqlMessage || e.message}`);
          [projectResult] = await pool.execute(
            `INSERT INTO projects (company_id, created_call_id, owner_user_id, status, is_prospect, call_type)
             VALUES (?, ?, ?, 'NEW', ?, ?)`,
            [call.company_id, id, call.user_id, is_prospect ? 1 : 0, call.call_type || 'operator']
          );
        }
        projectId = projectResult.insertId;
        // document_screening をデフォルトで 'not_required' に（失敗しても無視）
        try {
          await pool.execute(
            `UPDATE projects SET document_screening = 'not_required' WHERE id = ?`,
            [projectId]
          );
        } catch (e) { /* ENUM変更の場合は無視 */ }
      } catch (projErr) {
        logger.error(`[endCall] projects挿入エラー: code=${projErr.code} sqlMessage=${projErr.sqlMessage}`);
        warnings.push(`案件作成失敗: ${projErr.sqlMessage || projErr.message}`);
      }
    }

    // NO_ANSWER: 自動割り当て
    if (result_code === 'NO_ANSWER') {
      try {
        await pool.execute(
          'INSERT IGNORE INTO company_assignments (company_id, user_id, assigned_by, is_auto) VALUES (?, ?, ?, 1)',
          [call.company_id, call.user_id, call.user_id]
        );
      } catch (e) {
        logger.error(`[endCall] company_assignments挿入エラー: ${e.message}`);
      }
      // リコール由来の不通: 既存 pending リコールがあれば recall_at を1時間後に再設定。
      //   （通常の不通は companyController 側で2日後に再ピックアップ。リコールの不通のみ1時間後）
      try {
        const [bumped] = await pool.execute(
          `UPDATE recall_tasks
             SET recall_at = DATE_ADD(NOW(), INTERVAL 1 HOUR), call_id = ?
           WHERE company_id = ? AND status = 'pending'`,
          [id, call.company_id]
        );
        if (bumped.affectedRows > 0) {
          logger.info(`[endCall] リコール不通: recall_atを1時間後に再設定 company=${call.company_id}, ${bumped.affectedRows}件`);
        }
      } catch (e) {
        logger.error(`[endCall] リコール不通の再設定エラー: ${e.message}`);
      }
    }

    // ロック解除 + 最終架電結果キャッシュ更新（companies.last_call_result_code/user_id）
    // 相関サブクエリを回避するため getCallList が参照する。SKIPは保存しない。
    try {
      if (result_code === 'SKIP') {
        await pool.execute(
          'UPDATE companies SET locked_by_user_id = NULL, locked_at = NULL WHERE id = ?',
          [call.company_id]
        );
      } else {
        await pool.execute(
          'UPDATE companies SET locked_by_user_id = NULL, locked_at = NULL, last_call_result_code = ?, last_call_user_id = ? WHERE id = ?',
          [result_code, call.user_id, call.company_id]
        );
      }
    } catch (e) {
      logger.error(`[endCall] ロック解除エラー: ${e.message}`);
    }
    // 架電リストキャッシュ無効化（この企業が架電済みになり、他ユーザーのリストにも影響）
    invalidateCallListCache();

    logger.info(`通話結果登録: call=${id}, result=${result_code}${warnings.length ? `, warnings=${warnings.length}` : ''}`);

    // バックグラウンドで文字起こし取得
    if (call.phone_number && call.call_started_at && !call.transcript) {
      findTranscript(call.phone_number, call.call_started_at).then(async (transcript) => {
        if (transcript) {
          try {
            await pool.execute('UPDATE calls SET transcript = ? WHERE id = ?', [transcript, id]);
          } catch (e) { /* 無視 */ }
        }
      }).catch(() => {});
    }

    // fax-crm への通話結果通知 (非同期/失敗握りつぶし、本処理を阻害しない)
    if (faxCrmClient.isEnabled()) {
      faxCrmClient.notifyCallResult({
        callId: parseInt(id),
        companyId: call.company_id,
        resultCode: result_code,
        callStartedAt: call.call_started_at,
        operatorEmail: req.user?.email || null,
        memo,
      }).catch((e) => logger.warn(`[endCall] fax-crm 通知失敗(無視): ${e.message}`));
    }

    return ApiResponse.success(res, { callId: parseInt(id), projectId, warnings }, '通話結果を保存しました');
  } catch (err) {
    logger.error(`[endCall] エラー: code=${err.code} message=${err.message} sqlMessage=${err.sqlMessage} sql=${err.sql}`);
    return ApiResponse.error(res, `通話結果の保存に失敗: ${err.sqlMessage || err.message}`, 500);
  }
};

/**
 * DELETE /api/calls/:id/cancel
 * 結果未入力のまま架電終了 → callsレコードを削除
 */
const cancelCall = async (req, res, next) => {
  // テストアカウント: そもそもDBにデータがないので即成功
  if (req.user.isTestAccount) {
    return ApiResponse.success(res, null, '通話記録を取り消しました（テストモード）');
  }

  try {
    const { id } = req.params;
    const userId = req.user.id;

    // 自分の通話 & result_code が NULL のもののみ削除可能
    const [result] = await pool.execute(
      'DELETE FROM calls WHERE id = ? AND user_id = ? AND result_code IS NULL',
      [id, userId]
    );

    if (result.affectedRows === 0) {
      return ApiResponse.badRequest(res, '削除対象の通話が見つかりません');
    }

    logger.info(`架電取消: user=${userId}, call=${id}`);
    return ApiResponse.success(res, null, '通話記録を取り消しました');
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/calls/:id/cancel-beacon
 * ページ離脱時にsendBeaconで呼ばれる（認証ヘッダーなし）
 * result_code IS NULL のレコードのみ削除するため安全
 */
const cancelCallBeacon = async (req, res, next) => {
  try {
    const { id } = req.params;
    const [result] = await pool.execute(
      'DELETE FROM calls WHERE id = ? AND result_code IS NULL',
      [id]
    );
    if (result.affectedRows > 0) {
      logger.info(`架電取消(beacon): call=${id}`);
    }
    return res.status(200).json({ success: true });
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/calls/skip
 * 架電スキップ（通話せずに記録、ロック解除）
 */
const skipCall = async (req, res, next) => {
  // テストアカウント: DB書き込みスキップ
  if (req.user.isTestAccount) {
    logger.info(`[TEST] 架電スキップ(テスト): user=${req.user.id}, company=${req.body.company_id}`);
    return ApiResponse.success(res, null, 'スキップしました（テストモード）');
  }

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
    const { user_id, company_id, result_code, date_from, date_to, search, call_type } = req.query;

    // result_code 未入力(NULL)も表示する（架電したが結果未保存の枠）。SKIPのみ除外。
    let whereClauses = ["(c.result_code IS NULL OR c.result_code != 'SKIP')"];
    let params = [];

    // 架電種別フィルタ（営業/オペレーター分離）
    if (call_type) {
      whereClauses.push('c.call_type = ?');
      params.push(call_type);
    }

    if (user_id) {
      whereClauses.push('c.user_id = ?');
      params.push(user_id);
    }
    if (company_id) {
      whereClauses.push('c.company_id = ?');
      params.push(company_id);
    }
    if (result_code === '__none__') {
      whereClauses.push('c.result_code IS NULL');
    } else if (result_code) {
      whereClauses.push('c.result_code = ?');
      params.push(result_code);
    }
    if (date_from) {
      whereClauses.push('c.call_started_at >= ?');
      params.push(date_from);
    }
    if (date_to) {
      // date_toが日付のみ(YYYY-MM-DD)の場合、その日の23:59:59まで含む
      const dt = date_to.length === 10 ? `${date_to} 23:59:59` : date_to;
      whereClauses.push('c.call_started_at <= ?');
      params.push(dt);
    }
    if (search) {
      whereClauses.push('(co.company_name LIKE ? OR co.phone_number LIKE ? OR c.memo LIKE ?)');
      const s = `%${search}%`;
      params.push(s, s, s);
    }

    const whereStr = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

    // COUNT + 結果コード別集計を1クエリで（companiesは検索時のみJOIN）
    const needsCompanyJoin = !!search;
    const summarySql = needsCompanyJoin
      ? `SELECT c.result_code, COUNT(*) as cnt FROM calls c
         LEFT JOIN companies co ON c.company_id = co.id
         ${whereStr}
         GROUP BY c.result_code`
      : `SELECT c.result_code, COUNT(*) as cnt FROM calls c
         ${whereStr}
         GROUP BY c.result_code`;
    const [summaryRows] = await pool.execute(summarySql, params);
    const resultSummary = {};
    let totalCount = 0;
    for (const r of summaryRows) {
      if (r.result_code) resultSummary[r.result_code] = r.cnt;
      else resultSummary['__none__'] = r.cnt; // 結果未入力
      totalCount += r.cnt;
    }

    // 一覧用に必要な列だけ取得（transcriptは存在フラグのみ→展開時にlazy load）
    // ai_evaluationsのJOINは一覧では使わないので削除
    const [rows] = await pool.execute(
      `SELECT c.id, c.user_id, c.company_id, c.call_started_at, c.call_ended_at,
              c.result_code, c.is_effective_connection, c.is_person_in_charge,
              c.memo, c.call_type, c.transcript,
              u.name as operator_name, co.company_name, co.phone_number
       FROM calls c
       LEFT JOIN users u ON c.user_id = u.id
       LEFT JOIN companies co ON c.company_id = co.id
       ${whereStr}
       ORDER BY c.call_started_at DESC
       LIMIT ? OFFSET ?`,
      [...params, String(limit), String(offset)]
    );

    // 文字起こし未取得の通話分はGoogle Sheetsから取得（4秒タイムアウト）
    const missingIds = rows.filter(r => !r.transcript).map(r => r.id);
    if (missingIds.length > 0) {
      try {
        const [missingRows] = await pool.execute(
          `SELECT c.id, c.call_started_at, co.phone_number
           FROM calls c LEFT JOIN companies co ON c.company_id = co.id
           WHERE c.id IN (${missingIds.map(() => '?').join(',')})
             AND co.phone_number IS NOT NULL`,
          missingIds
        );
        if (missingRows.length > 0) {
          const transcriptMap = await Promise.race([
            findTranscriptsBatch(missingRows),
            new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 4000)),
          ]);
          // DB更新は背景で（レスポンスをブロックしない）
          if (transcriptMap.size > 0) {
            setImmediate(async () => {
              try {
                for (const [callId, transcript] of transcriptMap) {
                  await pool.execute('UPDATE calls SET transcript = ? WHERE id = ?', [transcript, callId]);
                }
                logger.info(`Transcript同期: ${transcriptMap.size}件保存`);
              } catch (e) { /* ignore */ }
            });
            // レスポンスのtranscriptに反映
            for (const row of rows) {
              const t = transcriptMap.get(row.id);
              if (t) row.transcript = t;
            }
          }
        }
      } catch (e) {
        if (e.message !== 'timeout') {
          logger.warn('Transcript取得エラー:', e.message);
        }
        // タイムアウト時はそのまま返す（次回リロードで取得済みになる）
      }
    }

    // 通話時間: スプレッドシートのG列(開始)/H列(終了)から算出して付与
    // （call_started_at/ended_at はオペレーターの操作時刻なので実通話時間と異なるため）
    try {
      const durationMap = await Promise.race([
        findDurationsBatch(rows),
        new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 4000)),
      ]);
      for (const row of rows) {
        const d = durationMap.get(row.id);
        if (d != null) row.sheet_duration_seconds = d;
      }
      // DBにも保存（ダッシュボードのオペレーター別平均通話時間の集計に使う）
      if (durationMap.size > 0) {
        setImmediate(async () => {
          try {
            for (const [callId, sec] of durationMap) {
              await pool.execute('UPDATE calls SET actual_duration_seconds = ? WHERE id = ?', [sec, callId]);
            }
          } catch (e) { /* ignore */ }
        });
      }
    } catch (e) {
      if (e.message !== 'timeout') logger.warn('通話時間取得エラー:', e.message);
    }

    return ApiResponse.success(res, {
      calls: rows,
      pagination: {
        page,
        limit,
        total: totalCount,
        totalPages: Math.ceil(totalCount / limit),
      },
      resultSummary,
    });
  } catch (err) {
    next(err);
  }
};

/**
 * PUT /api/calls/:id/update
 * 自分の通話のステータス・メモを更新
 */
const updateCall = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { result_code, memo, is_effective_connection, is_person_in_charge } = req.body;
    const userId = req.user.id;

    // 自分の通話のみ編集可能
    const [rows] = await pool.execute('SELECT id, user_id FROM calls WHERE id = ?', [id]);
    if (rows.length === 0) {
      return ApiResponse.notFound(res, '通話が見つかりません');
    }
    // 本人、または admin/manager は他人の通話も編集可能（未入力ログの代理入力用）
    const isManager = ['admin', 'manager'].includes(req.user.role);
    if (rows[0].user_id !== userId && !isManager) {
      return ApiResponse.forbidden(res, '自分の通話のみ編集できます');
    }

    const updates = [];
    const params = [];
    if (result_code !== undefined) {
      const validCodes = ['NO_ANSWER', 'NG', 'RECALL', 'INTERESTED', 'PROJECT', 'SKIP'];
      if (!validCodes.includes(result_code)) {
        return ApiResponse.badRequest(res, '有効な結果コードを指定してください');
      }
      updates.push('result_code = ?');
      params.push(result_code);
    }
    if (memo !== undefined) {
      updates.push('memo = ?');
      params.push(memo || null);
    }
    if (is_effective_connection !== undefined) {
      updates.push('is_effective_connection = ?');
      params.push(is_effective_connection ? 1 : 0);
    }
    if (is_person_in_charge !== undefined) {
      updates.push('is_person_in_charge = ?');
      params.push(is_person_in_charge ? 1 : 0);
    }

    if (updates.length === 0) {
      return ApiResponse.badRequest(res, '更新する項目がありません');
    }

    params.push(id);
    await pool.execute(`UPDATE calls SET ${updates.join(', ')} WHERE id = ?`, params);

    return ApiResponse.success(res, null, '通話情報を更新しました');
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/calls/operators
 * オペレーター一覧（フィルター用）
 */
const getOperators = async (req, res, next) => {
  try {
    const [rows] = await pool.execute(
      "SELECT id, name FROM users WHERE role = 'operator' AND is_active = 1 AND is_test_account = 0 ORDER BY name"
    );
    return ApiResponse.success(res, rows);
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/calls/:id/refresh-transcript
 * 手動で文字起こしをGoogle Sheetsから再取得
 */
const refreshTranscript = async (req, res, next) => {
  try {
    const { id } = req.params;
    const [rows] = await pool.execute(
      `SELECT c.id, c.call_started_at, co.phone_number
       FROM calls c LEFT JOIN companies co ON c.company_id = co.id
       WHERE c.id = ?`,
      [id]
    );
    if (rows.length === 0) return ApiResponse.notFound(res, '通話が見つかりません');

    const call = rows[0];
    if (!call.phone_number || !call.call_started_at) {
      return ApiResponse.badRequest(res, '電話番号または通話開始時間がありません');
    }

    const transcript = await findTranscript(call.phone_number, call.call_started_at);
    if (transcript) {
      await pool.execute('UPDATE calls SET transcript = ? WHERE id = ?', [transcript, id]);
      logger.info(`文字起こし手動取得成功: call=${id}`);
      return ApiResponse.success(res, { transcript, found: true }, '文字起こしを取得しました');
    } else {
      return ApiResponse.success(res, { found: false }, '文字起こしが見つかりませんでした');
    }
  } catch (err) {
    logger.error('文字起こし手動取得エラー:', err.message);
    next(err);
  }
};

/**
 * POST /api/calls/refresh-transcripts-bulk
 * 文字起こし未取得の通話を一括でGoogle Sheetsから取得
 */
const refreshTranscriptsBulk = async (req, res, next) => {
  try {
    const { date_from, date_to, user_id } = req.body;
    let whereClauses = ["c.result_code IS NOT NULL", "c.result_code != 'SKIP'", "(c.transcript IS NULL OR c.transcript = '')"];
    let params = [];
    if (date_from) { whereClauses.push('DATE(c.call_started_at) >= ?'); params.push(date_from); }
    if (date_to) { whereClauses.push('DATE(c.call_started_at) <= ?'); params.push(date_to); }
    if (user_id) { whereClauses.push('c.user_id = ?'); params.push(user_id); }

    const [rows] = await pool.query(
      `SELECT c.id, c.call_started_at, co.phone_number
       FROM calls c LEFT JOIN companies co ON c.company_id = co.id
       WHERE ${whereClauses.join(' AND ')}
       ORDER BY c.call_started_at DESC LIMIT 200`,
      params
    );

    if (rows.length === 0) {
      return ApiResponse.success(res, { found: 0, total: 0 }, '未取得の通話はありません');
    }

    const eligible = rows.filter(r => r.phone_number && r.call_started_at);
    let transcriptMap;
    try {
      transcriptMap = await findTranscriptsBatch(eligible);
    } catch (gsErr) {
      logger.error(`文字起こしシート取得エラー: ${gsErr.message}`);
      return ApiResponse.success(res, { found: 0, total: eligible.length, error: gsErr.message }, 'Google Sheetsへのアクセスに失敗しました');
    }
    const found = transcriptMap.size;
    // バッチ更新（並列5件ずつ）
    const entries = Array.from(transcriptMap.entries());
    for (let i = 0; i < entries.length; i += 5) {
      const batch = entries.slice(i, i + 5);
      await Promise.all(batch.map(([callId, transcript]) =>
        pool.execute('UPDATE calls SET transcript = ? WHERE id = ?', [transcript, callId]).catch(e => {
          logger.error(`文字起こし保存エラー call=${callId}: ${e.message}`);
        })
      ));
    }

    logger.info(`文字起こし一括取得: ${found}/${eligible.length}件`);
    return ApiResponse.success(res, { found, total: eligible.length }, `${found}件の文字起こしを取得しました`);
  } catch (err) {
    logger.error(`文字起こし一括取得エラー: code=${err.code} message=${err.message}`);
    return ApiResponse.error(res, `一括取得失敗: ${err.sqlMessage || err.message}`, 500);
  }
};

/**
 * POST /api/calls/backfill-durations
 * 過去通話の actual_duration_seconds をスプレッドシート(G/H列)から一括取得・保存
 * （ダッシュボードのオペレーター別平均通話時間を実通話時間に揃えるための一回実行用）
 * body: { date_from?, date_to?, user_id? } 未指定なら全期間・全員
 */
const backfillDurations = async (req, res, next) => {
  try {
    const { date_from, date_to, user_id } = req.body || {};
    const whereClauses = ["c.result_code IS NOT NULL", "c.result_code != 'SKIP'", "c.actual_duration_seconds IS NULL"];
    const params = [];
    if (date_from) { whereClauses.push('DATE(c.call_started_at) >= ?'); params.push(date_from); }
    if (date_to) { whereClauses.push('DATE(c.call_started_at) <= ?'); params.push(date_to); }
    if (user_id) { whereClauses.push('c.user_id = ?'); params.push(user_id); }

    const [rows] = await pool.query(
      `SELECT c.id, c.call_started_at, co.phone_number
       FROM calls c LEFT JOIN companies co ON c.company_id = co.id
       WHERE ${whereClauses.join(' AND ')} AND co.phone_number IS NOT NULL`,
      params
    );
    if (rows.length === 0) {
      return ApiResponse.success(res, { target: 0, updated: 0 }, '対象の通話がありません（全て取得済み）');
    }

    let durationMap;
    try {
      durationMap = await findDurationsBatch(rows);
    } catch (gsErr) {
      logger.error(`通話時間シート取得エラー: ${gsErr.message}`);
      return ApiResponse.error(res, `Google Sheetsへのアクセスに失敗: ${gsErr.message}`, 502);
    }

    let updated = 0;
    const entries = Array.from(durationMap.entries());
    for (let i = 0; i < entries.length; i += 10) {
      const batch = entries.slice(i, i + 10);
      await Promise.all(batch.map(([id, sec]) =>
        pool.execute('UPDATE calls SET actual_duration_seconds = ? WHERE id = ?', [sec, id]).catch(() => {})
      ));
      updated += batch.length;
    }
    logger.info(`通話時間一括取得: ${updated}/${rows.length}件保存`);
    return ApiResponse.success(res, { target: rows.length, updated }, `${updated}件の実通話時間を保存しました（対象 ${rows.length}件）`);
  } catch (err) {
    logger.error(`通話時間一括取得エラー: ${err.message}`);
    return ApiResponse.error(res, `一括取得失敗: ${err.sqlMessage || err.message}`, 500);
  }
};

/**
 * POST /api/calls/bulk-cancel-unsaved
 * 結果未入力(result_code IS NULL)の通話ログを一括削除（admin/manager のみ）
 * body: { date_from?, date_to?, user_id? } 未指定なら全期間・全員
 */
const bulkCancelUnsaved = async (req, res, next) => {
  try {
    if (!['admin', 'manager'].includes(req.user.role)) {
      return ApiResponse.forbidden(res, '管理者・マネージャー権限が必要です');
    }
    const { date_from, date_to, user_id } = req.body || {};
    const where = ['result_code IS NULL'];
    const params = [];
    if (date_from) { where.push('DATE(call_started_at) >= ?'); params.push(date_from); }
    if (date_to) { where.push('DATE(call_started_at) <= ?'); params.push(date_to); }
    if (user_id) { where.push('user_id = ?'); params.push(user_id); }
    const [r] = await pool.execute(`DELETE FROM calls WHERE ${where.join(' AND ')}`, params);
    logger.info(`未入力ログ一括削除: ${r.affectedRows}件 (by user=${req.user.id})`);
    return ApiResponse.success(res, { deleted: r.affectedRows }, `${r.affectedRows}件の未入力ログを削除しました`);
  } catch (err) {
    logger.error(`[bulkCancelUnsaved] ${err.message}`);
    return ApiResponse.error(res, err.message, 500);
  }
};

/**
 * GET /api/calls/:id/transcript
 * 文字起こしテキストを取得（展開時にlazy load）
 */
const getCallTranscript = async (req, res, next) => {
  try {
    const { id } = req.params;
    const [rows] = await pool.execute('SELECT transcript FROM calls WHERE id = ? LIMIT 1', [id]);
    if (rows.length === 0) return ApiResponse.notFound(res, '通話が見つかりません');
    return ApiResponse.success(res, { transcript: rows[0].transcript || '' });
  } catch (err) {
    next(err);
  }
};

module.exports = { startCall, endCall, cancelCall, cancelCallBeacon, skipCall, getCalls, updateCall, getOperators, refreshTranscript, refreshTranscriptsBulk, backfillDurations, bulkCancelUnsaved, getCallTranscript };
