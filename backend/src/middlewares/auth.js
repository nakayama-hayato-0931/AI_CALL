/**
 * JWT認証ミドルウェア
 * AuthorizationヘッダーのBearerトークンを検証
 */
const jwt = require('jsonwebtoken');
const ApiResponse = require('../utils/apiResponse');
const logger = require('../utils/logger');

/**
 * 認証必須ミドルウェア
 */
const authenticate = (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return ApiResponse.unauthorized(res, '認証トークンが必要です');
    }

    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // リクエストにユーザー情報を付与
    req.user = {
      id: decoded.id,
      email: decoded.email,
      role: decoded.role,
    };

    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return ApiResponse.unauthorized(res, 'トークンの有効期限が切れています');
    }
    if (err.name === 'JsonWebTokenError') {
      return ApiResponse.unauthorized(res, '無効なトークンです');
    }
    logger.error('認証エラー:', err);
    return ApiResponse.error(res, '認証処理でエラーが発生しました');
  }
};

/**
 * 管理者権限チェック
 */
const requireAdmin = (req, res, next) => {
  if (req.user.role !== 'admin') {
    return ApiResponse.forbidden(res, '管理者権限が必要です');
  }
  next();
};

/**
 * 管理者またはマネージャー権限チェック
 */
const requireManager = (req, res, next) => {
  if (req.user.role !== 'admin' && req.user.role !== 'manager') {
    return ApiResponse.forbidden(res, '管理者またはマネージャー権限が必要です');
  }
  next();
};

module.exports = { authenticate, requireAdmin, requireManager };
