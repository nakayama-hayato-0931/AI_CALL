/**
 * 案件ルート
 */
const express = require('express');
const router = express.Router();
const { getProjects, getProjectById, updateProject, getCallLogs, getSalesUsers, getProjectHires, saveProjectHires } = require('../controllers/projectController');
const { authenticate } = require('../middlewares/auth');

router.use(authenticate);

// GET /api/projects - 案件一覧
router.get('/', getProjects);

// GET /api/projects/sales-users - 営業ユーザー一覧
router.get('/sales-users', getSalesUsers);

// GET /api/projects/:id - 案件詳細
router.get('/:id', getProjectById);

// GET /api/projects/:id/call-logs - 案件の全通話ログ
router.get('/:id/call-logs', getCallLogs);

// GET /api/projects/:id/hires - 内定者情報取得
router.get('/:id/hires', getProjectHires);

// PUT /api/projects/:id/hires - 内定者情報保存
router.put('/:id/hires', saveProjectHires);

// PUT /api/projects/:id - 案件更新
router.put('/:id', updateProject);

module.exports = router;
