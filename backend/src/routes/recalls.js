/**
 * リコールルート
 */
const express = require('express');
const router = express.Router();
const { getRecalls, completeRecall, cancelRecall } = require('../controllers/recallController');
const { authenticate } = require('../middlewares/auth');

router.use(authenticate);

// GET /api/recalls - リコールタスク一覧
router.get('/', getRecalls);

// PUT /api/recalls/:id/complete - リコール完了
router.put('/:id/complete', completeRecall);

// PUT /api/recalls/:id/cancel - リコールキャンセル
router.put('/:id/cancel', cancelRecall);

module.exports = router;
