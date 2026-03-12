/**
 * グローバルエラーハンドリングミドルウェア
 * 予期しないエラーをキャッチし統一形式で返す
 */
const logger = require('../utils/logger');
const ApiResponse = require('../utils/apiResponse');

const errorHandler = (err, req, res, _next) => {
  // エラーログ記録
  logger.error('Unhandled Error:', {
    message: err.message,
    stack: err.stack,
    path: req.path,
    method: req.method,
  });

  // MySQLエラー
  if (err.code === 'ER_DUP_ENTRY') {
    return ApiResponse.badRequest(res, '重複データが存在します');
  }
  if (err.code === 'ER_NO_REFERENCED_ROW_2') {
    return ApiResponse.badRequest(res, '参照先データが存在しません');
  }

  // バリデーションエラー
  if (err.type === 'entity.parse.failed') {
    return ApiResponse.badRequest(res, 'リクエストボディの形式が不正です');
  }

  // 本番環境ではスタックトレースを返さない
  const details = process.env.NODE_ENV === 'production' ? null : err.stack;

  return ApiResponse.error(res, 'サーバー内部エラーが発生しました', 500, details);
};

module.exports = errorHandler;
