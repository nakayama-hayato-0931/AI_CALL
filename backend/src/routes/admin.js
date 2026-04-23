/**
 * 管理者ルート
 * /api/admin
 */
const express = require('express');
const router = express.Router();
const {
  getUsers, createUser, updateUser, deleteUser,
  getAllOperatorPerformance,
  getCompanies, assignCompany, unassignCompany,
  getIndustryRegionRules, addIndustryRegionRule, deleteIndustryRegionRule,
  getExcludeWords, addExcludeWord, deleteExcludeWord,
  getTimeRules, addTimeRule, updateTimeRule, deleteTimeRule, aiSuggestTimeRules,
  applyRulesToExistingCompanies,
  restoreMylistExclusions,
  cleanupDatabase,
  getDatabaseStats,
  getCompaniesIndustryStats,
  bulkDeleteCompanies,
  getAutoPickupIndustries,
  setAutoPickupIndustries,
  getSpecialListBatches, getSpecialListBatchDetails, exportSpecialListBatch,
  saveKpiAdjustment,
} = require('../controllers/adminController');
const { getAllRequests, replyToRequest } = require('../controllers/requestController');
const {
  getScripts, createScript, updateScript, approveScript, rejectScript, deleteScript,
} = require('../controllers/scriptController');
const { authenticate, requireAdmin, requireManager, requireEditor } = require('../middlewares/auth');

router.use(authenticate);

// ユーザー管理 (adminのみ)
router.get('/users', requireAdmin, getUsers);
router.post('/users', requireAdmin, createUser);
router.put('/users/:id', requireAdmin, updateUser);
router.delete('/users/:id', requireAdmin, deleteUser);

// オペレーター成績 (admin + manager + consultant閲覧可)
router.get('/performance', requireManager, getAllOperatorPerformance);

// 架電リスト管理 (閲覧: manager+consultant、編集: editor)
router.get('/companies', requireManager, getCompanies);
router.post('/companies/assign', requireEditor, assignCompany);
router.delete('/companies/:companyId/assign/:userId', requireEditor, unassignCompany);

// 業種×地域ルール (閲覧: manager+consultant、編集: editor)
router.get('/industry-region-rules', requireManager, getIndustryRegionRules);
router.post('/industry-region-rules', requireEditor, addIndustryRegionRule);
router.delete('/industry-region-rules/:id', requireEditor, deleteIndustryRegionRule);

// 業種別NGワード (閲覧: manager+consultant、編集: editor)
router.get('/exclude-words', requireManager, getExcludeWords);
router.post('/exclude-words', requireEditor, addExcludeWord);
router.delete('/exclude-words/:id', requireEditor, deleteExcludeWord);

// 架電時間ルール (閲覧: manager+consultant、編集: editor)
router.get('/time-rules', requireManager, getTimeRules);
router.post('/time-rules', requireEditor, addTimeRule);
router.post('/time-rules/ai-suggest', requireEditor, aiSuggestTimeRules);
router.post('/apply-rules-to-existing', requireEditor, applyRulesToExistingCompanies);
router.post('/restore-mylist-exclusions', requireEditor, restoreMylistExclusions);
router.get('/database-stats', requireManager, getDatabaseStats);
router.get('/companies/industry-stats', requireManager, getCompaniesIndustryStats);
router.post('/companies/bulk-delete', requireEditor, bulkDeleteCompanies);
router.get('/auto-pickup-industries', requireManager, getAutoPickupIndustries);
router.put('/auto-pickup-industries', requireEditor, setAutoPickupIndustries);
router.post('/cleanup-database', requireEditor, cleanupDatabase);
router.put('/time-rules/:id', requireEditor, updateTimeRule);
router.delete('/time-rules/:id', requireEditor, deleteTimeRule);

// スクリプト管理 (閲覧: manager+consultant、編集: editor)
router.get('/scripts', requireManager, getScripts);
router.post('/scripts', requireEditor, createScript);
router.put('/scripts/:id', requireEditor, updateScript);
router.put('/scripts/:id/approve', requireEditor, approveScript);
router.put('/scripts/:id/reject', requireEditor, rejectScript);
router.delete('/scripts/:id', requireEditor, deleteScript);

// 申請管理 (閲覧: manager+consultant、返信: editor)
router.get('/requests', requireManager, getAllRequests);
router.put('/requests/:id', requireEditor, replyToRequest);

// KPI補正（管理者のみ）
router.put('/kpi-adjustment', requireAdmin, saveKpiAdjustment);

// 特別リスト進捗管理
router.get('/special-list-batches', requireManager, getSpecialListBatches);
router.get('/special-list-batches/:id/details', requireManager, getSpecialListBatchDetails);
router.get('/special-list-batches/:id/export', requireManager, exportSpecialListBatch);

module.exports = router;
