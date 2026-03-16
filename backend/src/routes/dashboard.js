/**
 * ダッシュボードルート
 */
const express = require('express');
const router = express.Router();
const {
  getDailyStats,
  getHourlyCalls,
  getIndustryConversion,
  getHourlyIndustryConnections,
  getWorkHours,
  saveWorkHours,
} = require('../controllers/dashboardController');
const { authenticate } = require('../middlewares/auth');

router.use(authenticate);

// GET /api/dashboard/stats - 日次KPI
router.get('/stats', getDailyStats);

// GET /api/dashboard/hourly-calls - 時間帯別コール数
router.get('/hourly-calls', getHourlyCalls);

// GET /api/dashboard/industry-conversion - 業種別案件化率
router.get('/industry-conversion', getIndustryConversion);

// GET /api/dashboard/hourly-industry-connections - 時間帯×業種別接続数
router.get('/hourly-industry-connections', getHourlyIndustryConnections);

// GET /api/dashboard/work-hours - 稼働時間取得
router.get('/work-hours', getWorkHours);

// POST /api/dashboard/work-hours - 稼働時間保存
router.post('/work-hours', saveWorkHours);

module.exports = router;
