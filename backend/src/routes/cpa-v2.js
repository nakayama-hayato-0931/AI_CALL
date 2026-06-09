/**
 * cpa-v2 ルート (fax-crm 互換の CPA を callcenter 側に並行実装)
 *   - 既存 /api/analytics には一切影響しない
 *   - フロントから不要になればこのルート登録を server.js から外すだけで戻せる
 */
const express = require('express');
const router = express.Router();
const { authenticate, requireManager } = require('../middlewares/auth');
const ApiResponse = require('../utils/apiResponse');
const logger = require('../utils/logger');

const salesProj = require('../services/cpa-v2/salesProjectService');
const jobPost   = require('../services/cpa-v2/jobPostingService');
const interview = require('../services/cpa-v2/interviewService');
const cpa       = require('../services/cpa-v2/cpaService');

router.use(authenticate);
router.use(requireManager);

// ----- 月別 KPI -----
router.get('/monthly', async (req, res) => {
  try {
    const basis  = req.query.basis === 'offer' ? 'offer' : 'acquired';
    const months = Number(req.query.months) || 24;
    const data = await cpa.getMonthly({ basis, months });
    return ApiResponse.success(res, { basis, months, rows: data });
  } catch (err) {
    logger.error(`[cpa-v2 monthly] ${err.message}`);
    return ApiResponse.error(res, err.message, err.status || 500);
  }
});

// ----- 内定社内訳 (画像の詳細モーダル用) -----
router.get('/offers', async (req, res) => {
  try {
    const month  = req.query.month;
    const basis  = req.query.basis === 'offer' ? 'offer' : 'acquired';
    const limit  = Number(req.query.limit) || 500;
    if (!month) return ApiResponse.badRequest(res, 'month=YYYY-MM-01 が必要です');
    const rows = await salesProj.list({ month, basis, status: 'all', limit });
    return ApiResponse.success(res, { month, basis, rows });
  } catch (err) {
    logger.error(`[cpa-v2 offers] ${err.message}`);
    return ApiResponse.error(res, err.message, err.status || 500);
  }
});

// ----- 面接内訳 (kind=all | rejects) -----
router.get('/interviews', async (req, res) => {
  try {
    const month  = req.query.month;
    const basis  = req.query.basis === 'offer' ? 'offer' : 'acquired';
    const kind   = req.query.kind === 'rejects' ? 'rejects' : 'all';
    const limit  = Number(req.query.limit) || 1000;
    if (!month) return ApiResponse.badRequest(res, 'month=YYYY-MM-01 が必要です');
    const rows = await interview.list({ month, basis, kind, limit });
    // 内定はあるが面接記録に無い企業 (UNION 加算分) もモーダル表示に必要
    const offerOnly = kind === 'all' ? await interview.listOfferOnly({ month, basis, limit }) : [];
    return ApiResponse.success(res, { month, basis, kind, rows, offerOnly });
  } catch (err) {
    logger.error(`[cpa-v2 interviews] ${err.message}`);
    return ApiResponse.error(res, err.message, err.status || 500);
  }
});

// ----- 案件 (バラシ含む) -----
router.get('/jobs', async (req, res) => {
  try {
    const month  = req.query.month;
    const filter = req.query.filter === 'cancelled' ? 'cancelled' : 'all';
    const limit  = Number(req.query.limit) || 2000;
    if (!month) return ApiResponse.badRequest(res, 'month=YYYY-MM-01 が必要です');
    const rows = await jobPost.list({ month, filter, limit });
    return ApiResponse.success(res, { month, filter, rows });
  } catch (err) {
    logger.error(`[cpa-v2 jobs] ${err.message}`);
    return ApiResponse.error(res, err.message, err.status || 500);
  }
});

// ----- シート設定 (3 シート分まとめて取得・保存) -----
router.get('/config', async (req, res) => {
  try {
    const [proj, job, iv] = await Promise.all([
      salesProj.getConfig(), jobPost.getConfig(), interview.getConfig(),
    ]);
    return ApiResponse.success(res, { projects: proj, jobs: job, interviews: iv });
  } catch (err) {
    return ApiResponse.error(res, err.message, 500);
  }
});

router.put('/config', async (req, res) => {
  try {
    const { projects, jobs, interviews } = req.body || {};
    if (projects)   await salesProj.updateConfig(projects);
    if (jobs)       await jobPost.updateConfig(jobs);
    if (interviews) await interview.updateConfig(interviews);
    const [proj, job, iv] = await Promise.all([
      salesProj.getConfig(), jobPost.getConfig(), interview.getConfig(),
    ]);
    return ApiResponse.success(res, { projects: proj, jobs: job, interviews: iv });
  } catch (err) {
    return ApiResponse.error(res, err.message, err.status || 500);
  }
});

// ----- シート同期 (3 シートまとめて or 個別) -----
router.post('/sync', async (req, res) => {
  const which = req.query.which || 'all'; // 'all' | 'projects' | 'jobs' | 'interviews'
  const results = {};
  const run = async (key, fn) => {
    try { results[key] = await fn(); }
    catch (e) { results[key] = { error: e.message, code: e.code, status: e.status || 500 }; }
  };
  try {
    if (which === 'projects' || which === 'all') await run('projects',  () => salesProj.syncFromSheets());
    if (which === 'jobs'     || which === 'all') await run('jobs',      () => jobPost.syncFromSheets());
    if (which === 'interviews'|| which === 'all') await run('interviews', () => interview.syncFromSheets());
    return ApiResponse.success(res, results, '同期完了');
  } catch (err) {
    return ApiResponse.error(res, err.message, 500);
  }
});

module.exports = router;
