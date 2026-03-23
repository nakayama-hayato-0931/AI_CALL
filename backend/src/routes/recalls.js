/**
 * リコールルート
 */
const express = require('express');
const router = express.Router();
const { getRecalls, completeRecall, cancelRecall, rescheduleRecall } = require('../controllers/recallController');
const { authenticate } = require('../middlewares/auth');

router.use(authenticate);

// GET /api/recalls - リコールタスク一覧
router.get('/', getRecalls);

// PUT /api/recalls/:id/complete - リコール完了
router.put('/:id/complete', completeRecall);

// PUT /api/recalls/:id/cancel - リコールキャンセル
router.put('/:id/cancel', cancelRecall);

// PUT /api/recalls/:id/reschedule - リコール日時変更
router.put('/:id/reschedule', rescheduleRecall);

module.exports = router;
