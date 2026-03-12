/**
 * 案件ルート
 */
const express = require('express');
const router = express.Router();
const { getProjects, getProjectById, updateProject } = require('../controllers/projectController');
const { authenticate } = require('../middlewares/auth');

router.use(authenticate);

// GET /api/projects - 案件一覧
router.get('/', getProjects);

// GET /api/projects/:id - 案件詳細
router.get('/:id', getProjectById);

// PUT /api/projects/:id - 案件更新
router.put('/:id', updateProject);

module.exports = router;
