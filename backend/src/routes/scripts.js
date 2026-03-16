/**
 * スクリプトルート（オペレーター用）
 * /api/scripts
 */
const express = require('express');
const router = express.Router();
const { getApprovedScripts } = require('../controllers/scriptController');
const { authenticate } = require('../middlewares/auth');

router.use(authenticate);

// approved のスクリプト一覧
router.get('/', getApprovedScripts);

module.exports = router;
