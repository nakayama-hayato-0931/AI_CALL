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
  getTimeRules, addTimeRule, updateTimeRule, deleteTimeRule,
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

module.exports = router;
