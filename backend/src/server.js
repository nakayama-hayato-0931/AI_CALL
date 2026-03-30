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

// Railway等のリバースプロキシ対応（express-rate-limitに必要）
app.set('trust proxy', 1);

// ============================================
// ミドルウェア
// ============================================

// CORS設定（helmetより先に配置）
const allowedOrigins = (process.env.FRONTEND_URL || 'http://localhost:3000').split(',').map(s => s.trim());
app.use(cors({
  origin: function(origin, callback) {
    if (!origin) return callback(null, true);
    if (allowedOrigins.indexOf(origin) !== -1) return callback(null, true);
    if (origin.endsWith('.railway.app')) return callback(null, true);
    if (origin.startsWith('http://localhost:')) return callback(null, true);
    callback(new Error('CORS policy: Origin not allowed'));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

// セキュリティヘッダー（CORSの後に配置）
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' },
  crossOriginOpenerPolicy: false,
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
  // operator_levelにリーダー追加
  try { await pool.execute(`ALTER TABLE users MODIFY COLUMN operator_level ENUM('初級','中級','上級','リーダー') DEFAULT NULL`); } catch (e) {}
  // status_sheetsに公開フラグ + 面談関連カラム追加
  try { await pool.execute(`ALTER TABLE status_sheets ADD COLUMN is_published TINYINT(1) NOT NULL DEFAULT 0`); } catch (e) {}
  try { await pool.execute(`ALTER TABLE status_sheets ADD COLUMN needs_meeting TINYINT(1) NOT NULL DEFAULT 0`); } catch (e) {}
  try { await pool.execute(`ALTER TABLE status_sheets ADD COLUMN meeting_scheduled_date DATE DEFAULT NULL`); } catch (e) {}
  try { await pool.execute(`ALTER TABLE status_sheets ADD COLUMN meeting_completed TINYINT(1) NOT NULL DEFAULT 0`); } catch (e) {}
  try { await pool.execute(`ALTER TABLE status_sheets ADD COLUMN meeting_reason VARCHAR(255) DEFAULT NULL`); } catch (e) {}
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
    const [ops] = await pool.query("SELECT id FROM users WHERE role = 'operator' AND is_active = 1 AND is_test_account = 0");
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
  // memoカラムをTEXTに拡張
  try { await pool.execute(`ALTER TABLE projects MODIFY COLUMN memo TEXT`); } catch (e) {}
  // mail_sent, mail_replied, phone_confirmed をDATE型に変更
  // TINYINT→DATE変更は直接できないので、一旦VARCHAR経由
  try {
    // Check current column type
    const [cols] = await pool.query(`SHOW COLUMNS FROM projects WHERE Field IN ('mail_sent','mail_replied','phone_confirmed')`);
    const needsConversion = cols.some(c => c.Type && !c.Type.includes('date'));
    if (needsConversion) {
      // Step 1: convert to VARCHAR (preserves data)
      await pool.execute(`ALTER TABLE projects MODIFY COLUMN mail_sent VARCHAR(20) NULL DEFAULT NULL`);
      await pool.execute(`ALTER TABLE projects MODIFY COLUMN mail_replied VARCHAR(20) NULL DEFAULT NULL`);
      await pool.execute(`ALTER TABLE projects MODIFY COLUMN phone_confirmed VARCHAR(20) NULL DEFAULT NULL`);
      // Step 2: clear invalid values (0, 1, empty)
      await pool.execute(`UPDATE projects SET mail_sent = NULL WHERE mail_sent IN ('0', '1', '')`);
      await pool.execute(`UPDATE projects SET mail_replied = NULL WHERE mail_replied IN ('0', '1', '')`);
      await pool.execute(`UPDATE projects SET phone_confirmed = NULL WHERE phone_confirmed IN ('0', '1', '')`);
      // Step 3: convert to DATE
      await pool.execute(`ALTER TABLE projects MODIFY COLUMN mail_sent DATE NULL DEFAULT NULL`);
      await pool.execute(`ALTER TABLE projects MODIFY COLUMN mail_replied DATE NULL DEFAULT NULL`);
      await pool.execute(`ALTER TABLE projects MODIFY COLUMN phone_confirmed DATE NULL DEFAULT NULL`);
      logger.info('[Migration] mail_sent/mail_replied/phone_confirmed をDATE型に変更完了');
    }
  } catch (e) { logger.warn('[Migration] DATE変更:', e.message); }
  // 企業担当者・連絡先・ダッシュボード記入チェック
  try { await pool.execute(`ALTER TABLE projects ADD COLUMN contact_person VARCHAR(100) DEFAULT NULL`); } catch (e) {}
  try { await pool.execute(`ALTER TABLE projects ADD COLUMN contact_info VARCHAR(255) DEFAULT NULL`); } catch (e) {}
  try { await pool.execute(`ALTER TABLE projects ADD COLUMN dashboard_checked TINYINT(1) NOT NULL DEFAULT 0`); } catch (e) {}
  // 交通費カラム追加
  try { await pool.execute(`ALTER TABLE users ADD COLUMN commute_type ENUM('teiki','daily') DEFAULT NULL`); } catch (e) {}
  try { await pool.execute(`ALTER TABLE users ADD COLUMN commute_teiki_monthly INT UNSIGNED DEFAULT NULL`); } catch (e) {}
  try { await pool.execute(`ALTER TABLE users ADD COLUMN commute_daily_amount INT UNSIGNED DEFAULT NULL`); } catch (e) {}
  // 目標値カラム追加
  // past_cpa_dataに日付範囲カラム追加（週別対応）
  try { await pool.execute(`ALTER TABLE past_cpa_data ADD COLUMN date_from DATE DEFAULT NULL`); } catch (e) {}
  try { await pool.execute(`ALTER TABLE past_cpa_data ADD COLUMN date_to DATE DEFAULT NULL`); } catch (e) {}
  // UNIQUE KEY削除（月別と週別が同じyear-month-userで重複するため）
  try { await pool.execute(`ALTER TABLE past_cpa_data DROP INDEX uq_past_period_user`); } catch (e) {}
  try { await pool.execute(`ALTER TABLE users ADD COLUMN target_work_hours DECIMAL(4,1) DEFAULT NULL`); } catch (e) {}
  try { await pool.execute(`ALTER TABLE users ADD COLUMN target_calls_per_h DECIMAL(4,1) DEFAULT NULL`); } catch (e) {}
  try { await pool.execute(`ALTER TABLE users ADD COLUMN target_effective_per_h DECIMAL(4,1) DEFAULT NULL`); } catch (e) {}
  try { await pool.execute(`ALTER TABLE users ADD COLUMN target_person_per_h DECIMAL(4,1) DEFAULT NULL`); } catch (e) {}
  try { await pool.execute(`ALTER TABLE users ADD COLUMN target_project_hours DECIMAL(4,1) DEFAULT NULL`); } catch (e) {}
  // 過去CPAデータテーブル
  try {
    await pool.execute(`
      CREATE TABLE IF NOT EXISTS past_cpa_data (
        id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        period_label VARCHAR(50) NOT NULL,
        period_year INT NOT NULL,
        period_month INT NOT NULL,
        user_id INT UNSIGNED DEFAULT NULL,
        cost INT NOT NULL DEFAULT 0,
        call_count INT NOT NULL DEFAULT 0,
        project_count INT NOT NULL DEFAULT 0,
        interview_count INT NOT NULL DEFAULT 0,
        naitei_count INT NOT NULL DEFAULT 0,
        fugokaku_count INT NOT NULL DEFAULT 0,
        barashi_lost_count INT NOT NULL DEFAULT 0,
        initial_payment INT NOT NULL DEFAULT 0,
        expected_revenue INT NOT NULL DEFAULT 0,
        roas DECIMAL(6,4) DEFAULT NULL,
        UNIQUE KEY uq_past_period_user (period_year, period_month, user_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    logger.info('[Migration] past_cpa_data テーブル確認完了');
  } catch (e) { logger.warn('[Migration] past_cpa_data:', e.message); }
  // 過去案件質データテーブル
  try {
    await pool.execute(`
      CREATE TABLE IF NOT EXISTS past_quality_data (
        id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        period_label VARCHAR(50) NOT NULL,
        period_year INT NOT NULL,
        period_month INT NOT NULL,
        date_from DATE DEFAULT NULL,
        date_to DATE DEFAULT NULL,
        total_projects INT NOT NULL DEFAULT 0,
        lost INT NOT NULL DEFAULT 0,
        waiting_contact INT NOT NULL DEFAULT 0,
        interview_confirmed INT NOT NULL DEFAULT 0,
        interview_done INT NOT NULL DEFAULT 0,
        barashi INT NOT NULL DEFAULT 0,
        online_interview INT NOT NULL DEFAULT 0,
        no_screening INT NOT NULL DEFAULT 0,
        screening_failed INT NOT NULL DEFAULT 0,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    logger.info('[Migration] past_quality_data テーブル確認完了');
  } catch (e) { logger.warn('[Migration] past_quality_data:', e.message); }
  // callsテーブルのインデックス追加（パフォーマンス改善）
  try { await pool.execute('CREATE INDEX idx_calls_started_at ON calls(call_started_at)'); } catch (e) {}
  try { await pool.execute('CREATE INDEX idx_calls_user_started ON calls(user_id, call_started_at)'); } catch (e) {}
  try { await pool.execute('CREATE INDEX idx_calls_result_started ON calls(result_code, call_started_at)'); } catch (e) {}
  // system_settings テーブル（チーム目標値等）
  try {
    await pool.execute(`
      CREATE TABLE IF NOT EXISTS system_settings (
        setting_key VARCHAR(100) PRIMARY KEY,
        setting_value TEXT,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    // デフォルト値挿入
    await pool.execute(`INSERT IGNORE INTO system_settings (setting_key, setting_value) VALUES ('team_targets', '{"calls_per_h":20,"recall_per_h":3,"effective_per_h":3,"person_per_h":2,"project_hours":8,"conversion_rate":0.61}')`);
    logger.info('[Migration] system_settings テーブル確認完了');
  } catch (e) { logger.warn('[Migration] system_settings:', e.message); }
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
