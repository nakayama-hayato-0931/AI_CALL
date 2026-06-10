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
  getAutoPickupPrefectures,
  setAutoPickupPrefectures,
  getSpecialListBatches, getSpecialListBatchDetails, exportSpecialListBatch,
  saveKpiAdjustment,
  getIncentiveData,
  getAllRecalls,
  updateRecallTask,
  deleteRecallTask,
  reassignRecallTask,
  getCustomerMasterList,
  getCustomerMasterDetail,
  syncCustomerToFaxCrm,
  syncCustomerFromFaxCrm,
  bulkSyncCustomers,
  updateCustomerMaster,
  importMissingFromFaxCrm,
  diagnoseProjectCount,
  diagnoseVisaPayment,
  backfillRecruitmentStartDate,
  backfillJobNumbers,
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
// 営業ロールは call_type=sales のとき自身のチーム閲覧可
router.get('/performance', (req, res, next) => {
  if (['admin', 'manager', 'consultant'].includes(req.user.role)) return next();
  if (req.user.role === 'sales' && req.query.call_type === 'sales') return next();
  return res.status(403).json({ success: false, message: '権限がありません' });
}, getAllOperatorPerformance);

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
router.get('/auto-pickup-prefectures', requireManager, getAutoPickupPrefectures);
router.put('/auto-pickup-prefectures', requireEditor, setAutoPickupPrefectures);
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

// インセンティブ管理 (内定日ベース集計)
router.get('/incentive', requireManager, getIncentiveData);

// リコール管理（管理者用一括ビュー）
router.get('/recalls', requireManager, getAllRecalls);
router.put('/recalls/:id', requireEditor, updateRecallTask);
router.delete('/recalls/:id', requireEditor, deleteRecallTask);
router.put('/recalls/:id/reassign', requireEditor, reassignRecallTask);

// 顧客マスタ（架電履歴 + 手動アクション + FAX CRM 統合表示）
router.get('/customer-master', requireManager, getCustomerMasterList);
router.get('/customer-master/:id', requireManager, getCustomerMasterDetail);
router.patch('/customer-master/:id', requireEditor, updateCustomerMaster);
router.post('/customer-master/:id/sync-to-faxcrm', requireEditor, syncCustomerToFaxCrm);
router.post('/customer-master/:id/sync-from-faxcrm', requireEditor, syncCustomerFromFaxCrm);
router.post('/customer-master/bulk-sync', requireEditor, bulkSyncCustomers);

// fax-crm DB シャドー接続確認 (Phase 2)
router.get('/customer-master/faxcrm-shadow-status', requireManager, async (req, res) => {
  try {
    const faxDb = require('../../config/faxCrmDb');
    const writer = require('../controllers/../services/faxCrmDbWriter');
    const status = await faxDb.ping();
    return res.json({ success: true, data: { ...status, writer_enabled: writer.isEnabled() } });
  } catch (e) {
    return res.status(500).json({ success: false, message: e.message });
  }
});
router.post('/customer-master/import-missing-from-faxcrm', requireEditor, importMissingFromFaxCrm);

// ダッシュボードと案件管理の案件数差分診断（管理者）
router.get('/diagnose-projects', requireManager, diagnoseProjectCount);

// CPA入金実績の診断（ビザシート読み取り + 登録番号マッチ結果）
router.get('/diagnose-visa-payment', requireManager, diagnoseVisaPayment);

// 募集開始日の一括補完 (書類選考あり&募集中&未入力 → 案件獲得日と同日)
router.post('/backfill-recruitment-start-date', requireEditor, backfillRecruitmentStartDate);

// 求人番号の自動取得 (未入力案件 → 同企業の他案件の求人番号をコピー)
router.post('/backfill-job-numbers', requireEditor, backfillJobNumbers);

module.exports = router;
