/**
 * 企業ルート
 */
const express = require('express');
const router = express.Router();
const {
  getCompanies,
  getCompanyById,
  createCompany,
  updateCompany,
  getNextCallTarget,
  getCallList,
  lockCallTarget,
  unlockCallTarget,
} = require('../controllers/companyController');
const { authenticate } = require('../middlewares/auth');

// すべて認証必須
router.use(authenticate);

// GET /api/companies/call-list - 架電候補リスト (10件)
router.get('/call-list', getCallList);

// GET /api/companies/call-list/next - 次の架電先取得 (1件)
router.get('/call-list/next', getNextCallTarget);

// GET /api/companies - 企業一覧
router.get('/', getCompanies);

// GET /api/companies/:id - 企業詳細
router.get('/:id', getCompanyById);

// POST /api/companies - 企業作成
router.post('/', createCompany);

// PUT /api/companies/:id - 企業更新
router.put('/:id', updateCompany);

// POST /api/companies/:id/lock - ロック取得
router.post('/:id/lock', lockCallTarget);

// POST /api/companies/:id/unlock - ロック解除
router.post('/:id/unlock', unlockCallTarget);

module.exports = router;
