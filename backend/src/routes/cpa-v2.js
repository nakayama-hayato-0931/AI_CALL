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
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const run = async (key, fn) => {
    try { results[key] = await fn(); }
    catch (e) { results[key] = { error: e.message, code: e.code, status: e.status || 500 }; }
  };
  try {
    // 各シート間に 2秒待機して per-user 60req/min レート制限を緩和
    if (which === 'projects'   || which === 'all') { await run('projects',   () => salesProj.syncFromSheets()); await sleep(2000); }
    if (which === 'jobs'       || which === 'all') { await run('jobs',       () => jobPost.syncFromSheets());   await sleep(2000); }
    if (which === 'interviews' || which === 'all') { await run('interviews', () => interview.syncFromSheets()); }
    return ApiResponse.success(res, results, '同期完了');
  } catch (err) {
    return ApiResponse.error(res, err.message, 500);
  }
});

// ----- 診断: 各シートの「source_kind 相当列」のユニーク値別件数 -----
// 'FAX受電'/'架電バイト' などが期待値。シートに架電バイト行が無いと keep=0 になる。
router.get('/probe', async (req, res) => {
  try {
    const { probeKindColumn } = require('../services/cpa-v2/_common');
    const [pcfg, jcfg, icfg] = await Promise.all([
      salesProj.getConfig(), jobPost.getConfig(), interview.getConfig(),
    ]);
    const out = {};
    out.projects = pcfg?.projects_sheet_id ? await probeKindColumn({
      spreadsheetId: pcfg.projects_sheet_id,
      sheetName: pcfg.projects_sheet_name || 'ビザ申請 進捗',
      rangePart: pcfg.projects_sheet_range || 'A1:CZ20000',
      colLetter: 'BE',
    }) : { ok: false, error: 'projects_sheet_id 未設定' };
    out.jobs = jcfg?.jobs_sheet_id ? await probeKindColumn({
      spreadsheetId: jcfg.jobs_sheet_id,
      sheetName: jcfg.jobs_sheet_name || '求人情報',
      rangePart: jcfg.jobs_sheet_range || 'A1:BZ20000',
      colLetter: 'H',
    }) : { ok: false, error: 'jobs_sheet_id 未設定' };
    out.interviews = icfg?.interviews_sheet_id ? await probeKindColumn({
      spreadsheetId: icfg.interviews_sheet_id,
      sheetName: icfg.interviews_sheet_name || '2024_面接内訳',
      rangePart: icfg.interviews_sheet_range || 'A1:OZ20000',
      colLetter: 'NR',
    }) : { ok: false, error: 'interviews_sheet_id 未設定' };
    // 最終 sync ステータスも併記
    out.lastSync = {
      projects:   { at: pcfg?.projects_last_synced_at,   status: pcfg?.projects_last_sync_status,   message: pcfg?.projects_last_sync_message },
      jobs:       { at: jcfg?.jobs_last_synced_at,       status: jcfg?.jobs_last_sync_status,       message: jcfg?.jobs_last_sync_message },
      interviews: { at: icfg?.interviews_last_synced_at, status: icfg?.interviews_last_sync_status, message: icfg?.interviews_last_sync_message },
    };
    out.expectedKeepValue = '架電バイト';
    out.serviceAccountEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || null;
    out.spreadsheetIds = {
      projects:   pcfg?.projects_sheet_id || null,
      jobs:       jcfg?.jobs_sheet_id || null,
      interviews: icfg?.interviews_sheet_id || null,
    };
    return ApiResponse.success(res, out);
  } catch (err) {
    logger.error(`[cpa-v2 probe] ${err.message}`);
    return ApiResponse.error(res, err.message, 500);
  }
});

module.exports = router;
