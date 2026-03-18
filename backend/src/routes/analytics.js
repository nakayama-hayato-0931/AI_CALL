/**
 * CPA・案件質分析ルート
 */
const express = require('express');
const router = express.Router();
const multer = require('multer');
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });
const { getCpaMetrics, getQualityMetrics, getOperators, importCostCsv } = require('../controllers/analyticsController');
const { authenticate, requireManager } = require('../middlewares/auth');

router.use(authenticate);
router.use(requireManager);

router.get('/cpa', getCpaMetrics);
router.get('/quality', getQualityMetrics);
router.get('/operators', getOperators);
router.post('/import-cost-csv', upload.single('file'), importCostCsv);

module.exports = router;
