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
  getIndustryRegions,
  lockCallTarget,
  unlockCallTarget,
  diagnoseCallList,
  getCompanyActions,
  createCompanyAction,
  updateCompanyAction,
  deleteCompanyAction,
} = require('../controllers/companyController');
const { authenticate } = require('../middlewares/auth');

// すべて認証必須
router.use(authenticate);

// GET /api/companies/call-list - 架電候補リスト
router.get('/call-list', getCallList);

// GET /api/companies/call-list/diagnose - フィルタ毎の件数を返す診断用
router.get('/call-list/diagnose', diagnoseCallList);

// GET /api/companies/call-list/next - 次の架電先取得 (1件)
router.get('/call-list/next', getNextCallTarget);

// GET /api/companies/industry-regions?industry=飲食 - 業種別ピックアップ用の選択可能地域
router.get('/industry-regions', getIndustryRegions);

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

// アクション履歴
router.get('/:id/actions', getCompanyActions);
router.post('/:id/actions', createCompanyAction);
router.put('/:id/actions/:actionId', updateCompanyAction);
router.delete('/:id/actions/:actionId', deleteCompanyAction);

// POST /api/companies/:id/unlock - ロック解除
router.post('/:id/unlock', unlockCallTarget);

module.exports = router;
