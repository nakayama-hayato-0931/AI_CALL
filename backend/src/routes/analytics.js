/**
 * CPA・案件質分析ルート
 */
const express = require('express');
const router = express.Router();
const multer = require('multer');
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });
const { getCpaMetrics, getQualityMetrics, getOperators, importCostCsv, importCostPdf, getCpaAll, getQualityAll } = require('../controllers/analyticsController');
const { authenticate, requireManager } = require('../middlewares/auth');

router.use(authenticate);
router.use(requireManager);

router.get('/cpa', getCpaMetrics);
router.get('/quality', getQualityMetrics);
router.get('/cpa-all', getCpaAll);
router.get('/quality-all', getQualityAll);
router.get('/operators', getOperators);
router.post('/import-cost-csv', upload.single('file'), importCostCsv);
router.post('/import-cost-pdf', upload.single('file'), importCostPdf);

// 過去CPAデータ投入
router.post('/import-past-cpa', async (req, res) => {
  try {
    const pool = require('../../config/database');
    const { records } = req.body;
    if (!records || !Array.isArray(records)) return res.status(400).json({ success: false, message: 'records array required' });
    // 古いデータをクリアして再インポート
    await pool.execute('DELETE FROM past_cpa_data');
    let inserted = 0;
    for (const r of records) {
      await pool.execute(
        `INSERT INTO past_cpa_data (period_label, period_year, period_month, user_id, cost, call_count, project_count, interview_count, naitei_count, fugokaku_count, barashi_lost_count, initial_payment, expected_revenue, roas, date_from, date_to)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [r.label, r.year, r.month, r.user_id != null ? r.user_id : 0, r.cost, r.calls, r.projects, r.interviews, r.naitei, r.fugokaku, r.barashi, r.ip, r.er, r.roas || 0, r.date_from || null, r.date_to || null]
      );
      inserted++;
    }
    res.json({ success: true, data: { inserted } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
