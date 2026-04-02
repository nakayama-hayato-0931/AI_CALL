/**
 * 案件ルート
 */
const express = require('express');
const router = express.Router();
const { getProjects, getProjectById, updateProject, deleteProject, getCallLogs, getSalesUsers, getProjectHires, saveProjectHires, importLegacyProjects, promoteProject, createProjectManual } = require('../controllers/projectController');
const { authenticate, requireManager, requireEditor } = require('../middlewares/auth');
const multer = require('multer');
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

router.use(authenticate);

// GET /api/projects - 案件一覧
router.get('/', getProjects);

// POST /api/projects/manual - 手動案件作成
router.post('/manual', createProjectManual);

// POST /api/projects/import-legacy - 移行前案件インポート
router.post('/import-legacy', requireEditor, upload.single('file'), importLegacyProjects);

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

// PUT /api/projects/:id/promote - 見込案件を正式案件に昇格
router.put('/:id/promote', promoteProject);

// PUT /api/projects/:id - 案件更新
router.put('/:id', updateProject);

// DELETE /api/projects/:id - 案件削除（管理者のみ）
router.delete('/:id', requireEditor, deleteProject);

module.exports = router;
