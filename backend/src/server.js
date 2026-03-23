/**
 * AIコールセンターCRM バックエンドサーバー
 * Express + MySQL
 */
require('dotenv').config();

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const path = require('path');

const logger = require('./utils/logger');
const errorHandler = require('./middlewares/errorHandler');

// ルート
const authRoutes = require('./routes/auth');
const companyRoutes = require('./routes/companies');
const callRoutes = require('./routes/calls');
const dashboardRoutes = require('./routes/dashboard');
const recallRoutes = require('./routes/recalls');
const projectRoutes = require('./routes/projects');
const aiRoutes = require('./routes/ai');
const aiAnalysisRoutes = require('./routes/aiAnalysis');
const csvRoutes = require('./routes/csv');
const logRoutes = require('./routes/logs');
const adminRoutes = require('./routes/admin');
const requestRoutes = require('./routes/requests');
const scriptRoutes = require('./routes/scripts');
const analyticsRoutes = require('./routes/analytics');

const app = express();
const PORT = process.env.PORT || 3001;

// ============================================
// ミドルウェア
// ============================================

// セキュリティヘッダー
app.use(helmet());

// CORS設定
const allowedOrigins = (process.env.FRONTEND_URL || 'http://localhost:3000').split(',').map(s => s.trim());
app.use(cors({
  origin: function(origin, callback) {
    // サーバー間通信（originなし）は許可
    if (!origin) return callback(null, true);
    if (allowedOrigins.indexOf(origin) !== -1) {
      return callback(null, true);
    }
    callback(new Error('CORS policy: Origin not allowed'));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

// リクエストレートリミット
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15分
  max: 500, // 最大500リクエスト
  message: { success: false, message: 'リクエスト回数の上限に達しました。しばらくお待ちください。' },
});
app.use('/api/', limiter);

// ログインエンドポイントはより厳しいレートリミット
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { success: false, message: 'ログイン試行回数の上限に達しました。15分後に再試行してください。' },
});
app.use('/api/auth/login', loginLimiter);

// ボディパーサー
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// HTTPアクセスログ
app.use(morgan('combined', {
  stream: { write: (msg) => logger.info(msg.trim()) },
}));

// ============================================
// APIルート
// ============================================
app.use('/api/auth', authRoutes);
app.use('/api/companies', companyRoutes);
app.use('/api/calls', callRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/recalls', recallRoutes);
app.use('/api/projects', projectRoutes);
app.use('/api/ai', aiRoutes);
app.use('/api/ai/analysis', aiAnalysisRoutes);
app.use('/api/csv', csvRoutes);
app.use('/api/logs', logRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/requests', requestRoutes);
app.use('/api/scripts', scriptRoutes);
app.use('/api/analytics', analyticsRoutes);

// ヘルスチェック
app.get('/api/health', (req, res) => {
  res.json({ success: true, message: 'OK', timestamp: new Date().toISOString() });
});

// uploadsディレクトリ作成
const uploadsDir = path.join(__dirname, '../uploads');
const fs = require('fs');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// logsディレクトリ作成
const logsDir = path.join(__dirname, '../logs');
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

// ============================================
// エラーハンドリング
// ============================================

// 404ハンドラー
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: `エンドポイントが見つかりません: ${req.method} ${req.path}`,
  });
});

// グローバルエラーハンドラー
app.use(errorHandler);

// ============================================
// サーバー起動
// ============================================
// 自動マイグレーション
const pool = require('../config/database');
const runMigrations = async () => {
  try {
    await pool.execute(`
      CREATE TABLE IF NOT EXISTS status_sheets (
        id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        user_id INT UNSIGNED NOT NULL,
        period_from DATE NOT NULL,
        period_to DATE NOT NULL,
        current_status JSON NOT NULL,
        training_plan JSON NOT NULL,
        next_steps JSON NOT NULL,
        created_by INT UNSIGNED NOT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_ss_user (user_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    logger.info('[Migration] status_sheets テーブル確認完了');
  } catch (err) {
    logger.warn('[Migration] status_sheets:', err.message);
  }
  // usersテーブルにoperator_levelカラム追加
  try {
    await pool.execute(`ALTER TABLE users ADD COLUMN operator_level ENUM('初級','中級','上級') DEFAULT NULL`);
    logger.info('[Migration] users.operator_level カラム追加完了');
  } catch (err) {
    // カラムが既に存在する場合はスキップ
    if (!err.message.includes('Duplicate column')) logger.warn('[Migration] operator_level:', err.message);
  }
  // 研修進捗テーブル
  try {
    await pool.execute(`
      CREATE TABLE IF NOT EXISTS operator_training (
        id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        user_id INT UNSIGNED NOT NULL,
        step_number TINYINT UNSIGNED NOT NULL,
        step_name VARCHAR(100) NOT NULL,
        trainer_name VARCHAR(100) DEFAULT NULL,
        is_completed TINYINT(1) NOT NULL DEFAULT 0,
        completed_at DATETIME DEFAULT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uq_training_user_step (user_id, step_number),
        CONSTRAINT fk_training_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    logger.info('[Migration] operator_training テーブル確認完了');
  } catch (err) {
    logger.warn('[Migration] operator_training:', err.message);
  }
  // 既存オペレーターの研修進捗を初期化
  try {
    const [ops] = await pool.query("SELECT id FROM users WHERE role = 'operator' AND is_active = 1");
    const steps = [
      [1, '座学研修/サービス理解'], [2, 'トークスクリプト読み込み'], [3, 'ロープレ'],
      [4, 'コールシステム説明'], [5, '架電開始'], [6, '改善点フィードバック'], [7, '面談実施'],
    ];
    for (const op of ops) {
      for (const [num, name] of steps) {
        try { await pool.execute('INSERT IGNORE INTO operator_training (user_id, step_number, step_name) VALUES (?, ?, ?)', [op.id, num, name]); } catch(e) {}
      }
    }
    logger.info('[Migration] 既存オペレーター研修進捗 初期化完了');
  } catch (err) { logger.warn('[Migration] 研修進捗初期化:', err.message); }
  // operator_trainingにtraining_dateカラム追加
  try {
    await pool.execute(`ALTER TABLE operator_training ADD COLUMN training_date DATE DEFAULT NULL`);
  } catch (e) {}
  // status_sheetsにtargets/scenarioカラム追加
  try {
    await pool.execute(`ALTER TABLE status_sheets ADD COLUMN targets JSON DEFAULT NULL`);
  } catch (e) {}
  try {
    await pool.execute(`ALTER TABLE status_sheets ADD COLUMN scenario JSON DEFAULT NULL`);
  } catch (e) {}
  // projectsのcompany_idをNULL許可に（移行前案件用）
  try { await pool.execute(`ALTER TABLE projects MODIFY COLUMN company_id INT UNSIGNED DEFAULT NULL`); } catch (e) {}
  // owner_user_idもNULL許可
  try { await pool.execute(`ALTER TABLE projects MODIFY COLUMN owner_user_id INT UNSIGNED DEFAULT NULL`); } catch (e) {}
  // projectsにis_legacy + legacy用カラム追加
  try { await pool.execute(`ALTER TABLE projects ADD COLUMN is_legacy TINYINT(1) NOT NULL DEFAULT 0`); } catch (e) {}
  try { await pool.execute(`ALTER TABLE projects ADD COLUMN legacy_company_name VARCHAR(255) DEFAULT NULL`); } catch (e) {}
  try { await pool.execute(`ALTER TABLE projects ADD COLUMN legacy_phone VARCHAR(50) DEFAULT NULL`); } catch (e) {}
  try { await pool.execute(`ALTER TABLE projects ADD COLUMN legacy_date DATE DEFAULT NULL`); } catch (e) {}
  try { await pool.execute(`ALTER TABLE projects ADD COLUMN legacy_operator_name VARCHAR(100) DEFAULT NULL`); } catch (e) {}
  try { await pool.execute(`ALTER TABLE projects ADD COLUMN legacy_sales_name VARCHAR(100) DEFAULT NULL`); } catch (e) {}
  // projectsにチェックボックスカラム追加
  try { await pool.execute(`ALTER TABLE projects ADD COLUMN log_confirmed TINYINT(1) NOT NULL DEFAULT 0`); } catch (e) {}
  try { await pool.execute(`ALTER TABLE projects ADD COLUMN job_posted TINYINT(1) NOT NULL DEFAULT 0`); } catch (e) {}
  try { await pool.execute(`ALTER TABLE projects ADD COLUMN pre_confirmed TINYINT(1) NOT NULL DEFAULT 0`); } catch (e) {}
  // 企業担当者・連絡先・ダッシュボード記入チェック
  try { await pool.execute(`ALTER TABLE projects ADD COLUMN contact_person VARCHAR(100) DEFAULT NULL`); } catch (e) {}
  try { await pool.execute(`ALTER TABLE projects ADD COLUMN contact_info VARCHAR(255) DEFAULT NULL`); } catch (e) {}
  try { await pool.execute(`ALTER TABLE projects ADD COLUMN dashboard_checked TINYINT(1) NOT NULL DEFAULT 0`); } catch (e) {}
};
runMigrations();

app.listen(PORT, () => {
  logger.info(`=================================`);
  logger.info(`AIコールセンターCRM API起動`);
  logger.info(`ポート: ${PORT}`);
  logger.info(`環境: ${process.env.NODE_ENV || 'development'}`);
  logger.info(`=================================`);
});

module.exports = app;
