/**
 * AI分析ルート
 * チーム分析・個人詳細・コーチング
 */
const express = require('express');
const router = express.Router();
const { getTeamAnalysis, getOperatorDetail, getOperatorCoaching, generateStatusSheets, generateSingleStatusSheet, getStatusSheets, getStatusSheet, updateStatusSheet, getTrainingProgress, updateTrainingStep, getMyStatusSheet, getPublishedStatusSheets, togglePublish, updateMeeting, autoSetMeetingFlags } = require('../controllers/aiAnalysisController');
const { authenticate, requireManager } = require('../middlewares/auth');

router.use(authenticate);

// オペレーター/リーダー用（認証のみ、マネージャー権限不要）
router.get('/my-status-sheet', getMyStatusSheet);          // 自分のシート閲覧
router.get('/published-status-sheets', getPublishedStatusSheets); // リーダー用：公開シート一覧

// 以下はマネージャー以上のみ
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
router.put('/status-sheets/:id/publish', togglePublish);               // 公開/非公開切替
router.put('/status-sheets/:id/meeting', updateMeeting);              // 面談情報更新
router.post('/status-sheets/auto-meeting-flags', autoSetMeetingFlags); // AI評価で要面談自動判定

// 研修進捗
router.get('/training/:userId', getTrainingProgress);                  // 研修進捗取得
router.put('/training/:userId/:stepNumber', updateTrainingStep);       // 研修ステップ更新

// チーム目標値
const pool = require('../../config/database');
const ApiResponse = require('../utils/apiResponse');

router.get('/team-targets', async (req, res) => {
  try {
    const [rows] = await pool.query("SELECT setting_value FROM system_settings WHERE setting_key = 'team_targets'");
    if (rows.length > 0) {
      return ApiResponse.success(res, JSON.parse(rows[0].setting_value));
    }
    return ApiResponse.success(res, { calls_per_h: 20, recall_per_h: 3, effective_per_h: 3, person_per_h: 2, project_hours: 8, conversion_rate: 0.61 });
  } catch (e) { return res.status(500).json({ success: false, message: e.message }); }
});

router.put('/team-targets', async (req, res) => {
  try {
    const value = JSON.stringify(req.body);
    await pool.execute("INSERT INTO system_settings (setting_key, setting_value) VALUES ('team_targets', ?) ON DUPLICATE KEY UPDATE setting_value = ?", [value, value]);
    return ApiResponse.success(res, req.body, 'チーム目標値を更新しました');
  } catch (e) { return res.status(500).json({ success: false, message: e.message }); }
});

module.exports = router;
