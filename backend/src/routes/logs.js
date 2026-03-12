/**
 * 通話ログルート
 */
const express = require('express');
const router = express.Router();
const { searchLogs, getDailyCalls } = require('../controllers/logController');
const { authenticate } = require('../middlewares/auth');

router.use(authenticate);

// GET /api/logs/daily?date=YYYY-MM-DD - 日次架電一覧
router.get('/daily', getDailyCalls);

// GET /api/logs/search?phone=xxx - 通話ログ検索
router.get('/search', searchLogs);

module.exports = router;
