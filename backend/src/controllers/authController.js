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
    const { email, password } = req.body;

    if (!email || !password) {
      return ApiResponse.badRequest(res, 'メールアドレスとパスワードを入力してください');
    }

    // プリペアドステートメントでSQLインジェクション対策
    const [rows] = await pool.execute(
      'SELECT id, name, email, password_hash, role FROM users WHERE email = ? AND is_active = 1',
      [email]
    );

    if (rows.length === 0) {
      return ApiResponse.unauthorized(res, 'メールアドレスまたはパスワードが正しくありません');
    }

    const user = rows[0];

    // パスワード検証
    const isMatch = await bcrypt.compare(password, user.password_hash);
    if (!isMatch) {
      return ApiResponse.unauthorized(res, 'メールアドレスまたはパスワードが正しくありません');
    }

    // JWTトークン発行
    const token = jwt.sign(
      { id: user.id, email: user.email, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '24h' }
    );

    logger.info(`ログイン成功: ${user.email}`);

    return ApiResponse.success(res, {
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
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
      'SELECT id, name, email, role, created_at FROM users WHERE id = ?',
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

module.exports = { login, getMe };
