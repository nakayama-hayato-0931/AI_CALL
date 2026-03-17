/**
 * 認証ルート
 */
const express = require('express');
const router = express.Router();
const { login, getMe, getOperators } = require('../controllers/authController');
const { authenticate } = require('../middlewares/auth');

// POST /api/auth/login - ログイン
router.post('/login', login);

// GET /api/auth/operators - オペレーター一覧（ログイン画面用、認証不要）
router.get('/operators', getOperators);

// GET /api/auth/me - 現在のユーザー情報
router.get('/me', authenticate, getMe);

module.exports = router;
