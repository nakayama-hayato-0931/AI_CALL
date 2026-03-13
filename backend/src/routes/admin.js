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
} = require('../controllers/adminController');
const { getAllRequests, replyToRequest } = require('../controllers/requestController');
const { authenticate, requireAdmin, requireManager } = require('../middlewares/auth');

router.use(authenticate);

// ユーザー管理 (adminのみ)
router.get('/users', requireAdmin, getUsers);
router.post('/users', requireAdmin, createUser);
router.put('/users/:id', requireAdmin, updateUser);
router.delete('/users/:id', requireAdmin, deleteUser);

// オペレーター成績 (admin + manager)
router.get('/performance', requireManager, getAllOperatorPerformance);

// 架電リスト管理 (admin + manager)
router.get('/companies', requireManager, getCompanies);
router.post('/companies/assign', requireManager, assignCompany);
router.delete('/companies/:companyId/assign/:userId', requireManager, unassignCompany);

// 業種×地域ルール (admin + manager)
router.get('/industry-region-rules', requireManager, getIndustryRegionRules);
router.post('/industry-region-rules', requireManager, addIndustryRegionRule);
router.delete('/industry-region-rules/:id', requireManager, deleteIndustryRegionRule);

// 業種別NGワード (admin + manager)
router.get('/exclude-words', requireManager, getExcludeWords);
router.post('/exclude-words', requireManager, addExcludeWord);
router.delete('/exclude-words/:id', requireManager, deleteExcludeWord);

// 申請管理 (admin + manager)
router.get('/requests', requireManager, getAllRequests);
router.put('/requests/:id', requireManager, replyToRequest);

module.exports = router;
