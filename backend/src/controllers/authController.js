/**
 * 認証コントローラー
 * ログイン・ユーザー情報取得
 */
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const pool = require('../../config/database');
const ApiResponse = require('../utils/apiResponse');
const logger = require('../utils/logger');

/**
 * POST /api/auth/login
 * ログイン処理
 */
const login = async (req, res, next) => {
  try {
    const { email, user_id, password } = req.body;

    if (!password || (!email && !user_id)) {
      return ApiResponse.badRequest(res, '認証情報とパスワードを入力してください');
    }

    let rows;
    if (user_id) {
      // オペレーター: user_id + password でログイン
      [rows] = await pool.execute(
        'SELECT id, name, email, password_hash, role, is_test_account FROM users WHERE id = ? AND is_active = 1',
        [user_id]
      );
    } else {
      // その他: email + password でログイン
      [rows] = await pool.execute(
        'SELECT id, name, email, password_hash, role, is_test_account FROM users WHERE email = ? AND is_active = 1',
        [email]
      );
    }

    if (rows.length === 0) {
      return ApiResponse.unauthorized(res, '認証情報またはパスワードが正しくありません');
    }

    const user = rows[0];

    // パスワード検証
    const isMatch = await bcrypt.compare(password, user.password_hash);
    if (!isMatch) {
      return ApiResponse.unauthorized(res, '認証情報またはパスワードが正しくありません');
    }

    // JWTトークン発行
    const token = jwt.sign(
      { id: user.id, email: user.email, role: user.role, isTestAccount: !!user.is_test_account },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '24h' }
    );

    logger.info(`ログイン成功: ${user.email}`);

    // 目標値とランクも含める
    const [fullUser] = await pool.execute(
      'SELECT operator_level, target_work_hours, target_calls_per_h, target_effective_per_h, target_person_per_h, target_project_hours FROM users WHERE id = ?',
      [user.id]
    );
    const extra = fullUser[0] || {};

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
    next(err);
  }
};

/**
 * GET /api/auth/me
 * 現在のユーザー情報取得
 */
const getMe = async (req, res, next) => {
  try {
    const [rows] = await pool.execute(
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
 * オペレーター一覧取得（ログイン画面用、認証不要）
 */
// オペレーター一覧キャッシュ (5分)
// ログイン画面用なので変更頻度が低く、DB が詰まっていても即応答するためメモリキャッシュ。
let _operatorsCache = { at: 0, rows: null };
const OPERATORS_CACHE_TTL_MS = 5 * 60 * 1000;
const getOperators = async (req, res, next) => {
  try {
    if (_operatorsCache.rows && (Date.now() - _operatorsCache.at) < OPERATORS_CACHE_TTL_MS) {
      return ApiResponse.success(res, _operatorsCache.rows);
    }
    // DB へのクエリ自体は 3秒で切る。詰まっていたら古いキャッシュを使う。
    const queryPromise = pool.execute(
      "SELECT id, name FROM users WHERE role IN ('operator', 'intern') AND is_active = 1 AND is_test_account = 0 ORDER BY name ASC"
    );
    const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('DB timeout 3s')), 3000));
    try {
      const [rows] = await Promise.race([queryPromise, timeoutPromise]);
      _operatorsCache = { at: Date.now(), rows };
      return ApiResponse.success(res, rows);
    } catch (e) {
      // 古いキャッシュがあれば fallback として返す
      if (_operatorsCache.rows) {
        return ApiResponse.success(res, _operatorsCache.rows);
      }
      throw e;
    }
  } catch (err) {
    next(err);
  }
};

module.exports = { login, getMe, getOperators };
