/**
 * companyUpsert.js
 * 「重複登録時の肉付け + 追加ユーザー割り当て」 を一手に引き受けるヘルパー。
 *
 * 背景・要望:
 *   架電リスト、 特別リストに重複番号 (= 既存 companies と phone_number が一致する番号) を
 *   登録しようとした場合、 従来は SELECT 先行判定で「既に登録済み」 とスキップ / エラーにしていた。
 *   ユーザー要望: 元のデータに肉付けする形 (既に情報が入っている項目は上書き) で
 *   元データを修正し、 追加したユーザーに割り当てる (company_assignments に追加する)。
 *
 * 動作:
 *   - INSERT ... ON DUPLICATE KEY UPDATE を companies に対して発行。
 *   - 衝突時は MASTER_COLS の各列について、 新値が NULL / 空文字なら既存値維持、
 *     値があれば上書き (NULLIF(VALUES(col),'') + COALESCE)。
 *   - 衝突 / 非衝突どちらでも返り値の id を取得 (LAST_INSERT_ID(id) トリック)。
 *   - 追加後、 company_assignments に呼び出し元 (operator) または指定ユーザーを
 *     INSERT IGNORE で追加 (is_auto=0、 手動割り当て扱い)。
 *
 * 注意 (UNIQUE INDEX 未追加環境での挙動):
 *   companies.phone_number に UNIQUE INDEX がまだ無い環境 (Phase 2 で追加予定) では、
 *   ON DUPLICATE KEY UPDATE は PRIMARY KEY (id) の衝突時のみ発動する。
 *   id は AUTO_INCREMENT なので衝突せず、 結果として通常 INSERT と同じ挙動になる。
 *   = UNIQUE INDEX 追加前は旧挙動と同じ (新規 INSERT)。 追加後に肉付けロジックが発動。
 *   呼び出し側で SELECT 先行重複判定を撤去する場合も、 この性質を踏まえれば
 *   緊急停止策として動作する。
 */

// 肉付け対象カラム (新値が空でなければ上書き、 空 / NULL なら既存値維持)。
// companies テーブル実存カラムのうち、 「インポート / 手動登録時に肉付けする意味があるもの」 のみ。
// 除外: id, created_at, updated_at, last_called_at, last_call_*,
//       priority_score, exclusion_flag, locked_*, last_synced_*,
//       priority_expires_at, is_blacklisted, blacklisted_reason (運用フラグ系),
//       is_sales_list, is_special (リスト種別はカラム値で別管理),
//       imported_by_user_id, imported_at, import_batch_id (取込メタ、 既存値温存)
const MASTER_COLS = [
  'company_name',
  'industry',
  'job_type',
  'comment',
  'data_source',
  'region',
  'address',
  'fax_number',
  'prefecture',
  'city',
  'postal_code',
  'url',
  'employee_count',
  'representative',
  'note',
  'source_file',
  'external_faxcrm_id',
  'industry_category',
];

/**
 * company_assignments に手動割り当てを追加する。
 * - operator / 管理者 / マネージャー どのロールでも、 ctx.assignToUserId か ctx.userId を割り当てる。
 * - sales (営業) ロールはそもそも company_assignments を持たない運用のためスキップ。
 * - ON DUPLICATE KEY UPDATE: 重複時は何もしない (sort_order を上書きしない)。
 * - 新規 INSERT 時は user_id 単位で MAX(sort_order)+1 を採番。
 *   特別リストの並び順機能 (sort_order) で「追加順」 をデフォルトの並び順として保持する。
 */
async function addManualAssignment(conn, companyId, userId, byUserId, role) {
  if (!companyId || !userId) return;
  if (role === 'sales') return;
  try {
    // user_id ごとの次の sort_order を採番 (新規 INSERT 用)
    const [maxRows] = await conn.query(
      'SELECT COALESCE(MAX(sort_order), 0) AS max_so FROM company_assignments WHERE user_id = ?',
      [userId]
    );
    const nextSortOrder = (maxRows[0]?.max_so || 0) + 1;
    // 既存行があれば触らない (sort_order を上書きしない、 詰めない)。
    // 新規 INSERT 時のみ sort_order = MAX+1。
    await conn.query(
      `INSERT INTO company_assignments (company_id, user_id, assigned_by, is_auto, sort_order)
       VALUES (?, ?, ?, 0, ?)
       ON DUPLICATE KEY UPDATE id = id`,
      [companyId, userId, byUserId || userId, nextSortOrder]
    );
  } catch (e) {
    throw e;
  }
}

/**
 * 1 件分の INSERT ... ON DUPLICATE KEY UPDATE を発行。
 * @returns {{ id: number, isNew: boolean }}
 *   isNew=true: 純粋に新規 INSERT された
 *   isNew=false: 既存行を肉付け UPDATE した (= 重複登録時)
 */
async function upsertRow(conn, f, ctx) {
  // INSERT 時に渡す全カラム (MASTER_COLS + メタ列)
  const cols = [
    'phone_number',
    ...MASTER_COLS,
    'imported_by_user_id',
    'imported_at',
    'is_sales_list',
    'is_special',
  ];
  const importedAt = new Date();
  const vals = [
    f.phone_number,
    ...MASTER_COLS.map((c) => (f[c] === undefined ? null : f[c])),
    ctx.userId ?? null,
    importedAt,
    ctx.isSalesList ? 1 : 0,
    ctx.isSpecial ? 1 : 0,
  ];

  // 肉付け SET 句: 新値が空文字 / NULL なら既存値、 そうでなければ新値で上書き
  const setClause = MASTER_COLS.map(
    (c) => `${c} = COALESCE(NULLIF(VALUES(${c}), ''), ${c})`
  ).join(',\n  ');

  // LAST_INSERT_ID(id) トリックで衝突時も既存 id を取得
  const sql = `INSERT INTO companies (${cols.join(', ')})
               VALUES (${cols.map(() => '?').join(', ')})
               ON DUPLICATE KEY UPDATE
                 ${setClause},
                 updated_at = CURRENT_TIMESTAMP,
                 id = LAST_INSERT_ID(id)`;

  const [r] = await conn.query(sql, vals);
  // mysql2: 新規 INSERT 時 affectedRows=1, ON DUPLICATE による UPDATE 発動時 affectedRows=2,
  //   既存行と全カラム同値 (UPDATE 不要) で affectedRows=0
  const isNew = r.affectedRows === 1;
  return { id: r.insertId, isNew };
}

/**
 * 電話番号ベースで companies を upsert し、 追加ユーザーへの割り当てもまとめて行う。
 * @param {import('mysql2/promise').PoolConnection|import('mysql2/promise').Pool} conn
 * @param {object} fields - companies に書き込む列 (phone_number は必須、 他は任意)
 * @param {object} ctx
 * @param {number|null} ctx.userId - 操作者 ID (imported_by_user_id にも記録)
 * @param {string|null} ctx.role - 'admin' | 'manager' | 'operator' | 'sales'
 * @param {number|null} [ctx.assignToUserId] - 割当先 (省略時は ctx.userId)
 * @param {boolean} [ctx.isSalesList=false] - 営業リスト扱い
 * @param {boolean} [ctx.isSpecial=false] - 特別リスト扱い
 * @returns {{ companyId: number, isNew: boolean }}
 */
async function upsertCompanyByPhone(conn, fields, ctx) {
  if (!fields || !fields.phone_number) {
    throw new Error('upsertCompanyByPhone: phone_number is required');
  }
  const { id: companyId, isNew } = await upsertRow(conn, fields, ctx || {});
  const assignTo = (ctx && ctx.assignToUserId) || (ctx && ctx.userId) || null;
  await addManualAssignment(conn, companyId, assignTo, ctx && ctx.userId, ctx && ctx.role);
  return { companyId, isNew };
}

module.exports = {
  upsertCompanyByPhone,
  addManualAssignment,
  MASTER_COLS,
};
