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

    // 業務カテゴリ: ヘッダー X-Work-Category (general/specific_skill)。
    // オペレーターのみログイン時に選択、それ以外は 'general' デフォルト。
    const rawCategory = req.headers['x-work-category'];
    const workCategory = rawCategory === 'specific_skill' ? 'specific_skill' : 'general';

    // リクエストにユーザー情報を付与
    req.user = {
      id: decoded.id,
      email: decoded.email,
      role: decoded.role,
      isTestAccount: !!decoded.isTestAccount,
      isServiceAccount: !!decoded.isServiceAccount,
      workCategory,
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
 * 管理者・マネージャー・コンサルタント権限チェック（閲覧系API用）
 */
const requireManager = (req, res, next) => {
  if (!['admin', 'manager', 'consultant'].includes(req.user.role)) {
    return ApiResponse.forbidden(res, '管理者またはマネージャー権限が必要です');
  }
  next();
};

/**
 * 管理者・マネージャー権限チェック（編集系API用 — コンサルタント不可）
 */
const requireEditor = (req, res, next) => {
  if (req.user.role !== 'admin' && req.user.role !== 'manager') {
    return ApiResponse.forbidden(res, '編集権限が必要です（読み取り専用アカウントでは実行できません）');
  }
  next();
};

/**
 * 業務カテゴリフィルタを構築するヘルパー。
 * - req.query.work_category が明示指定されていればそれを使う (管理者の特定技能管理画面など)
 * - そうでなければオペレーター/営業ロールは自身のログイン時選択を使う (req.user.workCategory)
 * - 管理者ロール(admin/manager/consultant)は明示指定がない限り全体表示 (フィルタなし)
 *
 * @param {object} req
 * @param {string} columnExpr - 例 'c.work_category' (SQL のカラム式)
 * @returns {{ sql: string, params: any[] }} - SQL片と params (' AND col=?'またはempty)
 */
const buildWorkCategoryFilter = (req, columnExpr = 'work_category') => {
  let value = null;
  if (req.query && req.query.work_category) {
    value = req.query.work_category;
  } else if (req.user) {
    const role = req.user.role;
    const isOperatorOrSales = ['operator', 'intern', 'sales'].includes(role);
    if (isOperatorOrSales) {
      value = req.user.workCategory || 'general';
    }
  }
  if (!value) return { sql: '', params: [] };
  return { sql: ` AND ${columnExpr} = ?`, params: [value] };
};

module.exports = { authenticate, requireAdmin, requireManager, requireEditor, buildWorkCategoryFilter };
