/**
 * AI分析ルート
 * チーム分析・個人詳細・コーチング
 */
const express = require('express');
const router = express.Router();
const { getTeamAnalysis, getOperatorDetail, getOperatorCoaching } = require('../controllers/aiAnalysisController');
const { authenticate, requireManager } = require('../middlewares/auth');

router.use(authenticate);
router.use(requireManager);

// POST /api/ai/analysis/team - チーム全体AI分析
router.post('/team', getTeamAnalysis);

// GET /api/ai/analysis/operator/:userId - 個人オペレーター詳細データ
router.get('/operator/:userId', getOperatorDetail);

// POST /api/ai/analysis/operator/:userId/coaching - 個人AIコーチング生成
router.post('/operator/:userId/coaching', getOperatorCoaching);

module.exports = router;
