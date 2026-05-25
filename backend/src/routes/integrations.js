/**
 * 外部システム連携 webhook ルート
 * /api/integrations/*
 *
 * 認証は各コントローラ内で X-Webhook-Secret ヘッダで実施するため、
 * 通常の JWT authenticate は適用しない。
 */
const express = require('express');
const router = express.Router();
const {
  receiveEvent, receiveEventsBulk, health,
} = require('../controllers/faxCrmWebhookController');

router.get('/faxcrm/health', health);
router.post('/faxcrm/event', receiveEvent);
router.post('/faxcrm/events', receiveEventsBulk);

module.exports = router;
