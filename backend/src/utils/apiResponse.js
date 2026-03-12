/**
 * APIレスポンス形式統一ヘルパー
 * すべてのAPIレスポンスを { success, data, message, error } 形式で返す
 */

class ApiResponse {
  /**
   * 成功レスポンス
   */
  static success(res, data = null, message = 'Success', statusCode = 200) {
    return res.status(statusCode).json({
      success: true,
      data,
      message,
      error: null,
    });
  }

  /**
   * 作成成功レスポンス (201)
   */
  static created(res, data = null, message = 'Created') {
    return ApiResponse.success(res, data, message, 201);
  }

  /**
   * エラーレスポンス
   */
  static error(res, message = 'Internal Server Error', statusCode = 500, details = null) {
    return res.status(statusCode).json({
      success: false,
      data: null,
      message,
      error: details,
    });
  }

  /**
   * バリデーションエラー (400)
   */
  static badRequest(res, message = 'Bad Request', details = null) {
    return ApiResponse.error(res, message, 400, details);
  }

  /**
   * 認証エラー (401)
   */
  static unauthorized(res, message = 'Unauthorized') {
    return ApiResponse.error(res, message, 401);
  }

  /**
   * 権限エラー (403)
   */
  static forbidden(res, message = 'Forbidden') {
    return ApiResponse.error(res, message, 403);
  }

  /**
   * Not Found (404)
   */
  static notFound(res, message = 'Not Found') {
    return ApiResponse.error(res, message, 404);
  }
}

module.exports = ApiResponse;
