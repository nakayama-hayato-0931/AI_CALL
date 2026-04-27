/**
 * 通話ルート
 */
const express = require('express');
const router = express.Router();
const { startCall, endCall, cancelCall, cancelCallBeacon, skipCall, getCalls, updateCall, getOperators, refreshTranscript, refreshTranscriptsBulk, getCallTranscript } = require('../controllers/callController');
const { authenticate } = require('../middlewares/auth');

// POST /api/calls/:id/cancel-beacon - ページ離脱時のbeacon用（認証不要）
// 注意: 数字のみマッチさせて他のPOSTルートと競合しないようにする
router.post('/:id(\\d+)/cancel-beacon', cancelCallBeacon);

router.use(authenticate);

// 固定パスのルートを先に定義（:idパラメータより前）
// GET /api/calls - 通話履歴一覧
router.get('/', getCalls);

// GET /api/calls/operators - オペレーター一覧（フィルター用）
router.get('/operators', getOperators);

// POST /api/calls/start - 架電開始
router.post('/start', startCall);

// POST /api/calls/skip - 架電スキップ
router.post('/skip', skipCall);

// POST /api/calls/refresh-transcripts-bulk - 文字起こし一括取得
router.post('/refresh-transcripts-bulk', refreshTranscriptsBulk);

// パラメータ付きルート（:id）
// PUT /api/calls/:id/update - 通話ステータス・メモ更新
router.put('/:id/update', updateCall);

// PUT /api/calls/:id/end - 通話結果登録
router.put('/:id/end', endCall);

// DELETE /api/calls/:id/cancel - 結果未入力の通話を取消
router.delete('/:id/cancel', cancelCall);

// POST /api/calls/:id/refresh-transcript - 文字起こし手動再取得（個別）
router.post('/:id/refresh-transcript', refreshTranscript);

// GET /api/calls/:id/transcript - 文字起こし本文取得（lazy load）
router.get('/:id/transcript', getCallTranscript);

module.exports = router;
