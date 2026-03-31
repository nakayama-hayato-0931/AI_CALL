/**
 * AI評価ルート
 */
const express = require('express');
const router = express.Router();
const {
  evaluate,
  getEvaluationByCallId,
  getEvaluationsByUserId,
  evaluateFromData,
  evaluateDailyBatch,
  getDailySummary,
  getLatestImprovement,
  getEvalLimit,
  getAllEvaluations,
  suggestScripts,
} = require('../controllers/aiController');
const { authenticate, requireManager, requireEditor } = require('../middlewares/auth');

router.use(authenticate);

// POST /api/ai/evaluate - AI通話評価実行（文字起こしベース）
router.post('/evaluate', evaluate);

// POST /api/ai/evaluate-from-data - CRMデータからAI評価
router.post('/evaluate-from-data', evaluateFromData);

// POST /api/ai/evaluate-daily - 日次一括AI評価
router.post('/evaluate-daily', evaluateDailyBatch);

// GET /api/ai/daily-summary?date=YYYY-MM-DD - 日次サマリー
router.get('/daily-summary', getDailySummary);

// GET /api/ai/eval-limit - 本日の残りAI評価回数
router.get('/eval-limit', getEvalLimit);

// GET /api/ai/latest-improvement - 直近の改善点
router.get('/latest-improvement', getLatestImprovement);

// GET /api/ai/admin/evaluations - 管理者: 全オペレーター評価一覧
router.get('/admin/evaluations', requireManager, getAllEvaluations);

// POST /api/ai/admin/evaluations/:id/suggest-scripts - 管理者: スクリプト提案生成
router.post('/admin/evaluations/:id/suggest-scripts', requireEditor, suggestScripts);

// GET /api/ai/evaluations/:callId - 通話のAI評価取得
router.get('/evaluations/:callId', getEvaluationByCallId);

// GET /api/ai/evaluations/user/:userId - ユーザーの評価履歴
router.get('/evaluations/user/:userId', getEvaluationsByUserId);

module.exports = router;
