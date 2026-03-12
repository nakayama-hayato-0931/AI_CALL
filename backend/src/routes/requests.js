/**
 * 申請ルート（オペレーター用）
 * /api/requests
 */
const express = require('express');
const router = express.Router();
const { createRequest, getMyRequests } = require('../controllers/requestController');
const { authenticate } = require('../middlewares/auth');

router.use(authenticate);

// 自分の申請一覧
router.get('/', getMyRequests);

// 新規申請
router.post('/', createRequest);

module.exports = router;
