/**
 * CSVインポートルート
 */
const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const { importCompanies, importExclusionList } = require('../controllers/csvController');
const { authenticate, requireManager } = require('../middlewares/auth');

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

// POST /api/csv/import - 架電リストインポート (マネージャー以上)
router.post('/import', requireManager, upload.single('file'), importCompanies);

// POST /api/csv/import-exclusion?list_type=ng|existing_project - 除外リストインポート (マネージャー以上)
router.post('/import-exclusion', requireManager, upload.single('file'), importExclusionList);

module.exports = router;
