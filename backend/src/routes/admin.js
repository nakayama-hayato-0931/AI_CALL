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

// 申請管理 (admin + manager)
router.get('/requests', requireManager, getAllRequests);
router.put('/requests/:id', requireManager, replyToRequest);

module.exports = router;
