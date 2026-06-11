/**
 * 認証コントローラー (シンプル版・再構築)
 * ログイン・ユーザー情報取得・オペレーター一覧
 */
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const pool = require('../../config/database');
const ApiResponse = require('../utils/apiResponse');
const logger = require('../utils/logger');

/**
 * POST /api/auth/login
 */
const login = async (req, res, next) => {
  try {
    const { email, user_id, password } = req.body;
    if (!password || (!email && !user_id)) {
      return ApiResponse.badRequest(res, '認証情報とパスワードを入力してください');
    }

    let rows;
    if (user_id) {
      [rows] = await pool.query(
        'SELECT id, name, email, password_hash, role, is_test_account FROM users WHERE id = ? AND is_active = 1',
        [user_id]
      );
    } else {
      [rows] = await pool.query(
        'SELECT id, name, email, password_hash, role, is_test_account FROM users WHERE email = ? AND is_active = 1',
        [email]
      );
    }

    if (rows.length === 0) {
      return ApiResponse.unauthorized(res, '認証情報またはパスワードが正しくありません');
    }
    const user = rows[0];

    const isMatch = await bcrypt.compare(password, user.password_hash);
    if (!isMatch) {
      return ApiResponse.unauthorized(res, '認証情報またはパスワードが正しくありません');
    }

    const token = jwt.sign(
      { id: user.id, email: user.email, role: user.role, isTestAccount: !!user.is_test_account },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '24h' }
    );

    logger.info(`ログイン成功: ${user.email}`);

    // 目標値とランクも含める (1回で取れない場合は無視して空オブジェクト)
    let extra = {};
    try {
      const [fullUser] = await pool.query(
        'SELECT operator_level, target_work_hours, target_calls_per_h, target_effective_per_h, target_person_per_h, target_project_hours FROM users WHERE id = ?',
        [user.id]
      );
      extra = fullUser[0] || {};
    } catch (e) { /* ignore */ }

    return ApiResponse.success(res, {
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        is_test_account: !!user.is_test_account,
        operator_level: extra.operator_level,
        target_work_hours: extra.target_work_hours,
        target_calls_per_h: extra.target_calls_per_h,
        target_effective_per_h: extra.target_effective_per_h,
        target_person_per_h: extra.target_person_per_h,
        target_project_hours: extra.target_project_hours,
      },
    }, 'ログインに成功しました');
  } catch (err) {
    logger.error(`[login] ${err.code || ''} ${err.message}`);
    next(err);
  }
};

/**
 * GET /api/auth/me
 */
const getMe = async (req, res, next) => {
  try {
    const [rows] = await pool.query(
      'SELECT id, name, email, role, is_test_account, target_work_hours, target_calls_per_h, target_effective_per_h, target_person_per_h, target_project_hours, created_at FROM users WHERE id = ?',
      [req.user.id]
    );
    if (rows.length === 0) {
      return ApiResponse.notFound(res, 'ユーザーが見つかりません');
    }
    return ApiResponse.success(res, rows[0]);
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/auth/operators
 * オペレーター一覧 (ログイン画面用、認証不要)
 *
 * 5分メモリキャッシュ。 DB が遅くてもログイン画面は壊さない。
 */
let _operatorsCache = { at: 0, rows: null };
const OPERATORS_CACHE_TTL_MS = 5 * 60 * 1000;

const getOperators = async (req, res, next) => {
  // キャッシュ有効ならそれを返す (5分)
  if (_operatorsCache.rows && (Date.now() - _operatorsCache.at) < OPERATORS_CACHE_TTL_MS) {
    return ApiResponse.success(res, _operatorsCache.rows);
  }
  // 3秒で諦める。 DB が詰まっていてもログイン画面を 500 で壊さない。
  let timer;
  const queryP = pool.query(
    "SELECT id, name FROM users WHERE role IN ('operator', 'intern') AND is_active = 1 AND is_test_account = 0 ORDER BY name ASC"
  );
  const timeoutP = new Promise((resolve) => {
    timer = setTimeout(() => resolve('__TIMEOUT__'), 3000);
  });
  try {
    const result = await Promise.race([queryP, timeoutP]);
    if (timer) clearTimeout(timer);
    if (result === '__TIMEOUT__') {
      logger.warn('[getOperators] 3秒タイムアウト、空配列を返す (DB詰まり)');
      // 旧キャッシュがあればそれ、 無ければ空配列。 next(err) は呼ばない (500回避)。
      const fallback = _operatorsCache.rows || [];
      return ApiResponse.success(res, fallback);
    }
    const rows = result[0];
    _operatorsCache = { at: Date.now(), rows };
    return ApiResponse.success(res, rows);
  } catch (err) {
    if (timer) clearTimeout(timer);
    logger.error(`[getOperators] ${err.code || ''} ${err.message}`);
    return ApiResponse.success(res, _operatorsCache.rows || []);
  }
};

module.exports = { login, getMe, getOperators };
