/**
 * CSVインポートルート
 */
const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const { importCompanies, importExclusionList, getExclusionStats, manualAddCompany, manualAddExclusion, importSpecialList, manualAddSpecial } = require('../controllers/csvController');
const { authenticate, requireManager, requireEditor } = require('../middlewares/auth');

// Multer設定: CSV / XLS / XLSX ファイル許可
const ALLOWED_EXTENSIONS = ['.csv', '.xls', '.xlsx'];
const upload = multer({
  dest: path.join(__dirname, '../../uploads/'),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB上限
  },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (ALLOWED_EXTENSIONS.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error('CSV・XLS・XLSXファイルのみアップロードできます'));
    }
  },
});

router.use(authenticate);

// POST /api/csv/import - 架電リストインポート (オペレーターも自作リスト用に許可)
router.post('/import', upload.single('file'), importCompanies);

// POST /api/csv/import-exclusion?list_type=ng|existing_project - 除外リストインポート (マネージャー以上)
router.post('/import-exclusion', requireEditor, upload.single('file'), importExclusionList);

// GET /api/csv/exclusion-stats - 除外リスト統計（件数・最終更新日）
router.get('/exclusion-stats', getExclusionStats);

// POST /api/csv/manual-company - 架電リスト手動登録
router.post('/manual-company', manualAddCompany);

// POST /api/csv/manual-exclusion - NG/既存案件リスト手動登録 (マネージャー以上)
router.post('/manual-exclusion', requireEditor, manualAddExclusion);

// POST /api/csv/import-special - 特別リストインポート (マネージャー以上)
router.post('/import-special', requireEditor, upload.single('file'), importSpecialList);

// POST /api/csv/manual-special - 特別リスト手動登録 (全ユーザー: 失注・バラシ案件の再架電用)
router.post('/manual-special', manualAddSpecial);

module.exports = router;
