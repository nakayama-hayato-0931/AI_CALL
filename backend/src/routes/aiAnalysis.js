/**
 * AI分析ルート
 * チーム分析・個人詳細・コーチング
 */
const express = require('express');
const router = express.Router();
const { getTeamAnalysis, getOperatorDetail, getOperatorCoaching, generateStatusSheets, generateSingleStatusSheet, getStatusSheets, getStatusSheet, updateStatusSheet, getTrainingProgress, updateTrainingStep } = require('../controllers/aiAnalysisController');
const { authenticate, requireManager } = require('../middlewares/auth');

router.use(authenticate);
router.use(requireManager);

// POST /api/ai/analysis/team - チーム全体AI分析
router.post('/team', getTeamAnalysis);

// GET /api/ai/analysis/operator/:userId - 個人オペレーター詳細データ
router.get('/operator/:userId', getOperatorDetail);

// POST /api/ai/analysis/operator/:userId/coaching - 個人AIコーチング生成
router.post('/operator/:userId/coaching', getOperatorCoaching);

// ステータスシート
router.post('/status-sheets', generateStatusSheets);                    // 全オペレーター一括生成
router.post('/status-sheets/:userId/generate', generateSingleStatusSheet); // 個別生成
router.get('/status-sheets', getStatusSheets);                         // 保存済み一覧取得
router.get('/status-sheets/:userId', getStatusSheet);                  // 個別取得
router.put('/status-sheets/:id', updateStatusSheet);                   // 手動編集

// 研修進捗
router.get('/training/:userId', getTrainingProgress);                  // 研修進捗取得
router.put('/training/:userId/:stepNumber', updateTrainingStep);       // 研修ステップ更新

module.exports = router;
