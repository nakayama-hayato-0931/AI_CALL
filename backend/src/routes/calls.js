/**
 * 通話ルート
 */
const express = require('express');
const router = express.Router();
const { startCall, endCall, skipCall, getCalls } = require('../controllers/callController');
const { authenticate } = require('../middlewares/auth');

router.use(authenticate);

// GET /api/calls - 通話履歴一覧
router.get('/', getCalls);

// POST /api/calls/start - 架電開始
router.post('/start', startCall);

// POST /api/calls/skip - 架電スキップ
router.post('/skip', skipCall);

// PUT /api/calls/:id/end - 通話結果登録
router.put('/:id/end', endCall);

module.exports = router;
