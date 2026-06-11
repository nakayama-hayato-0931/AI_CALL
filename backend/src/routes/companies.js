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
  unlockAllForSelf,
  lockCallTarget,
  unlockCallTarget,
  diagnoseCallList,
  diagnoseCompanyPickup,
  diagnoseCompanyCounts,
  diagnoseIndustryCounts,
  recomputeIndustryCategory,
  diagnosePrefecture,
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

// POST /api/companies/unlock-all - 自分のピックアップロックを一括解除
router.post('/unlock-all', unlockAllForSelf);

// GET /api/companies - 企業一覧
router.get('/', getCompanies);

// GET /api/companies/diagnose/counts - 件数内訳 (顧客マスタ vs 架電リストの差分原因可視化)
router.get('/diagnose/counts', diagnoseCompanyCounts);

// GET /api/companies/diagnose/industry?category=建設 - 業種別件数内訳と分類漏れ検出
router.get('/diagnose/industry', diagnoseIndustryCounts);

// POST /api/companies/diagnose/recompute-industry-category - industry_category 一括再計算
router.post('/diagnose/recompute-industry-category', recomputeIndustryCategory);

// GET /api/companies/diagnose/prefecture - ② 都道府県設定と region 分布の診断
router.get('/diagnose/prefecture', diagnosePrefecture);

// GET /api/companies/:id/pickup-diagnose - 該当企業の架電リスト非表示理由を診断
router.get('/:id/pickup-diagnose', diagnoseCompanyPickup);

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
