/**
 * CPA・案件質分析ルート
 */
const express = require('express');
const router = express.Router();
const multer = require('multer');
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });
const { getCpaMetrics, getQualityMetrics, getOperators, importCostCsv, importCostPdf, importStampCsv, getCpaAll, getQualityAll, getSalesPerformance, getSalesDetail } = require('../controllers/analyticsController');
const { authenticate, requireManager, requireEditor } = require('../middlewares/auth');
const pool = require('../../config/database');

router.use(authenticate);

// 営業売上一覧は営業ユーザーもアクセス可能（requireManagerの前に定義）
router.get('/sales-performance', (req, res, next) => {
  if (!['admin', 'manager', 'consultant', 'sales'].includes(req.user.role)) {
    return res.status(403).json({ success: false, message: '権限がありません' });
  }
  next();
}, getSalesPerformance);

router.get('/sales-detail', (req, res, next) => {
  if (!['admin', 'manager', 'consultant', 'sales'].includes(req.user.role)) {
    return res.status(403).json({ success: false, message: '権限がありません' });
  }
  next();
}, getSalesDetail);

router.use(requireManager);

router.get('/cpa', getCpaMetrics);
router.get('/quality', getQualityMetrics);
router.get('/cpa-all', getCpaAll);
router.get('/quality-all', getQualityAll);
router.get('/operators', getOperators);
router.post('/import-cost-csv', requireEditor, upload.single('file'), importCostCsv);
router.post('/import-cost-pdf', requireEditor, upload.single('file'), importCostPdf);
router.post('/import-stamp-csv', requireEditor, upload.single('file'), importStampCsv);

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

// POST /api/analytics/import-past-quality - 過去案件質データインポート
router.post('/import-past-quality', requireManager, async (req, res) => {
  try {
    const { records } = req.body;
    if (!records || !records.length) return res.status(400).json({ success: false, message: 'No records' });
    await pool.execute('DELETE FROM past_quality_data');
    let inserted = 0;
    for (const r of records) {
      await pool.execute(
        `INSERT INTO past_quality_data (period_label, period_year, period_month, date_from, date_to, total_projects, lost, waiting_contact, interview_confirmed, interview_done, barashi, online_interview, no_screening, screening_failed) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [r.label, r.year, r.month, r.date_from || null, r.date_to || null, r.total || 0, r.lost || 0, r.waiting_contact || 0, r.interview_confirmed || 0, r.interview_done || 0, r.barashi || 0, r.online_interview || 0, r.no_screening || 0, r.screening_failed || 0]
      );
      inserted++;
    }
    res.json({ success: true, data: { inserted } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST /api/analytics/seed-past-cpa-from-xlsx - xlsxデータで過去CPAデータを一括更新（コスト保持）
router.post('/seed-past-cpa-from-xlsx', requireManager, async (req, res) => {
  try {
    const fs = require('fs');
    const path = require('path');
    const seedPath = path.join(__dirname, '../data/past-cpa-seed.json');
    if (!fs.existsSync(seedPath)) {
      return res.status(404).json({ success: false, message: 'seed data not found' });
    }
    const records = JSON.parse(fs.readFileSync(seedPath, 'utf-8'));

    // ユーザー名→user_idマッピング（スペース除去で照合）
    const [users] = await pool.execute("SELECT id, name FROM users WHERE role IN ('operator','intern','sales','manager','admin')");
    const nameMap = new Map();
    users.forEach(u => {
      nameMap.set(u.name.trim(), u.id);
      nameMap.set(u.name.replace(/\s+/g, ''), u.id);
      // 姓のみでも照合（例: "中田倫哉" → "中田"）
      const lastName = u.name.replace(/\s+/g, '').slice(0, 2);
      if (!nameMap.has(lastName)) nameMap.set(lastName, u.id);
    });

    let updated = 0, inserted = 0, skipped = 0;
    const skippedNames = new Set();

    for (const r of records) {
      let userId = 0; // 全体は user_id=0
      if (r.name) {
        const cleanName = r.name.replace(/\s+/g, '').replace(/\(.*\)|（.*）/g, '');
        const matchedId = nameMap.get(cleanName) || nameMap.get(cleanName.slice(0, 2));
        if (!matchedId) {
          skipped++;
          skippedNames.add(r.name);
          continue;
        }
        userId = matchedId;
      }

      // 既存レコードを検索（date_from で週別/月別を区別）
      const dateFromCond = r.date_from ? 'date_from = ?' : 'date_from IS NULL';
      const selectParams = r.date_from
        ? [r.year, r.month, userId, r.date_from]
        : [r.year, r.month, userId];
      const [existing] = await pool.execute(
        `SELECT id, cost FROM past_cpa_data WHERE period_year = ? AND period_month = ? AND user_id = ? AND ${dateFromCond}`,
        selectParams
      );

      if (existing.length > 0) {
        // UPDATE: コスト以外のフィールドを更新
        await pool.execute(
          `UPDATE past_cpa_data SET
            period_label = ?, call_count = ?, project_count = ?, interview_count = ?,
            naitei_count = ?, fugokaku_count = ?, barashi_lost_count = ?,
            initial_payment = ?, expected_revenue = ?
           WHERE id = ?`,
          [r.period_label, r.call_count, r.project_count, r.interview_count,
           r.naitei_count, r.fugokaku_count, r.barashi_lost_count,
           r.initial_payment, r.expected_revenue, existing[0].id]
        );
        updated++;
      } else {
        // INSERT: cost=0 で挿入
        await pool.execute(
          `INSERT INTO past_cpa_data (period_label, period_year, period_month, user_id, cost,
            call_count, project_count, interview_count, naitei_count, fugokaku_count,
            barashi_lost_count, initial_payment, expected_revenue, date_from, date_to)
           VALUES (?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [r.period_label, r.year, r.month, userId,
           r.call_count, r.project_count, r.interview_count, r.naitei_count,
           r.fugokaku_count, r.barashi_lost_count, r.initial_payment, r.expected_revenue,
           r.date_from, r.date_to]
        );
        inserted++;
      }
    }

    res.json({
      success: true,
      data: {
        total: records.length,
        updated, inserted, skipped,
        skippedNames: [...skippedNames]
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message, stack: err.stack });
  }
});

// PUT /api/analytics/update-past-cpa - 過去CPAデータ個別更新
router.put('/update-past-cpa', requireManager, async (req, res) => {
  try {
    const { label, updates } = req.body;
    if (!label || !updates) return res.status(400).json({ success: false, message: 'label and updates required' });
    const sets = [];
    const params = [];
    for (const [key, val] of Object.entries(updates)) {
      sets.push(`${key} = ?`);
      params.push(val);
    }
    params.push(label);
    await pool.execute(`UPDATE past_cpa_data SET ${sets.join(', ')} WHERE period_label = ?`, params);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
