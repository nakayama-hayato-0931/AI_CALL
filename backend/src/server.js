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
const jwt = require('jsonwebtoken');

/**
 * Authorization ヘッダから JWT を軽くデコードして isServiceAccount を判定。
 * rate-limit の skip 用なので失敗しても何もしない。
 */
function isServiceAccountReq(req) {
  try {
    const h = req.headers && req.headers.authorization;
    if (!h || !h.startsWith('Bearer ')) return false;
    const token = h.slice(7);
    // 署名検証あり（不正トークンに対する免除を防ぐ）
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    return !!decoded.isServiceAccount;
  } catch (_e) {
    return false;
  }
}
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
const integrationsRoutes = require('./routes/integrations');
const cpaV2Routes = require('./routes/cpa-v2');

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
  max: 3000, // 最大3000リクエスト/15分（1ユーザーが複数タブを開く+ポーリングを想定）
  message: { success: false, message: 'リクエスト回数の上限に達しました。しばらくお待ちください。' },
  // ヘルスチェック・ドロップダウン用エンドポイントなど高頻度アクセスをスキップ
  skip: (req) => {
    const p = req.path;
    if (p === '/auth/operators' || p === '/companies/operators' || p === '/calls/operators') return true;
    // fax-crm からの webhook はヘッダ認証付きなのでレート制限から除外
    if (p.startsWith('/integrations/faxcrm')) return true;
    // サービスアカウント（fax-crm 同期など）はレート制限から除外
    if (isServiceAccountReq(req)) return true;
    return false;
  },
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
app.use('/api/integrations', integrationsRoutes);
app.use('/api/cpa-v2', cpaV2Routes);

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

// 起動前に必ず完了させるべきマイグレーション（新カラム追加など）。
// これが完了しないうちにリクエストを受けると "Unknown column" エラーになる。
// cpa-v2 用テーブル作成 (起動時 idempotent)
// 既存実装に影響しない並行スキーマ。フロントでリンクを外せばロールバック可。
const ensureCpaV2Schema = async () => {
  try {
    await pool.execute(`CREATE TABLE IF NOT EXISTS sheets_config_v2 (
      id TINYINT NOT NULL PRIMARY KEY,
      projects_sheet_id   VARCHAR(120) DEFAULT NULL,
      projects_sheet_name VARCHAR(120) DEFAULT 'ビザ申請 進捗',
      projects_sheet_range VARCHAR(60) DEFAULT 'A1:CZ20000',
      projects_last_synced_at DATETIME DEFAULT NULL,
      projects_last_sync_status VARCHAR(20) DEFAULT NULL,
      projects_last_sync_message TEXT,
      jobs_sheet_id   VARCHAR(120) DEFAULT NULL,
      jobs_sheet_name VARCHAR(120) DEFAULT '求人情報',
      jobs_sheet_range VARCHAR(60) DEFAULT 'A1:BZ20000',
      jobs_last_synced_at DATETIME DEFAULT NULL,
      jobs_last_sync_status VARCHAR(20) DEFAULT NULL,
      jobs_last_sync_message TEXT,
      interviews_sheet_id   VARCHAR(120) DEFAULT NULL,
      interviews_sheet_name VARCHAR(120) DEFAULT '2024_面接内訳',
      interviews_sheet_range VARCHAR(60) DEFAULT 'A1:OZ20000',
      interviews_last_synced_at DATETIME DEFAULT NULL,
      interviews_last_sync_status VARCHAR(20) DEFAULT NULL,
      interviews_last_sync_message TEXT
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='cpa-v2: Google Sheets 連携設定'`);
    // デフォルト設定をseed (3シートのID事前投入)
    await pool.execute(`INSERT IGNORE INTO sheets_config_v2
      (id, projects_sheet_id, projects_sheet_name, projects_sheet_range,
       jobs_sheet_id, jobs_sheet_name, jobs_sheet_range,
       interviews_sheet_id, interviews_sheet_name, interviews_sheet_range)
      VALUES (1,
        '1wPH1sud7dAwJQihiR6qDrH-otJ3ygAgcCAg-e4ituvw', 'ビザ申請 進捗', 'A1:CZ20000',
        '1wPH1sud7dAwJQihiR6qDrH-otJ3ygAgcCAg-e4ituvw', '求人情報',     'A1:BZ20000',
        '1gHldK7GyXpP9WoeMDi0E5KV6Ql4Xlw1J0_7BrV8U0tA', '2024_面接内訳', 'A1:OZ20000')`);

    await pool.execute(`CREATE TABLE IF NOT EXISTS sales_projects_v2 (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      external_key VARCHAR(255) NOT NULL UNIQUE COMMENT '求人番号_登録番号',
      offer_date DATE DEFAULT NULL COMMENT 'A列: 内定日',
      acquired_date DATE DEFAULT NULL COMMENT 'BK列: 案件取得日',
      job_number VARCHAR(60) DEFAULT NULL,
      company_name VARCHAR(255) DEFAULT NULL,
      candidate_registration_no VARCHAR(60) DEFAULT NULL,
      sales_owner VARCHAR(120) DEFAULT NULL,
      industry VARCHAR(120) DEFAULT NULL,
      first_payment BIGINT NOT NULL DEFAULT 0,
      expected_revenue BIGINT NOT NULL DEFAULT 0,
      payment_actual BIGINT NOT NULL DEFAULT 0 COMMENT 'CC列: 入金実績',
      status_label VARCHAR(40) DEFAULT NULL,
      is_cancelled TINYINT(1) NOT NULL DEFAULT 0,
      is_declined  TINYINT(1) NOT NULL DEFAULT 0,
      source_row INT UNSIGNED DEFAULT NULL,
      synced_at DATETIME DEFAULT NULL,
      INDEX idx_acq (acquired_date),
      INDEX idx_off (offer_date),
      INDEX idx_jobname (job_number, company_name)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='cpa-v2: 売上案件 (架電バイト)'`);

    await pool.execute(`CREATE TABLE IF NOT EXISTS job_postings_v2 (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      external_key VARCHAR(255) NOT NULL UNIQUE,
      acquired_date DATE DEFAULT NULL,
      job_number VARCHAR(60) DEFAULT NULL,
      company_name VARCHAR(255) DEFAULT NULL,
      sales_owner VARCHAR(120) DEFAULT NULL,
      industry VARCHAR(120) DEFAULT NULL,
      source_kind VARCHAR(40) DEFAULT NULL,
      status_label VARCHAR(40) DEFAULT NULL,
      is_cancelled TINYINT(1) NOT NULL DEFAULT 0,
      source_row INT UNSIGNED DEFAULT NULL,
      synced_at DATETIME DEFAULT NULL,
      INDEX idx_acq (acquired_date),
      INDEX idx_kind (source_kind, acquired_date),
      INDEX idx_jobname (job_number, company_name)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='cpa-v2: 求人案件 (架電バイト)'`);

    await pool.execute(`CREATE TABLE IF NOT EXISTS interview_records_v2 (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      external_key VARCHAR(255) NOT NULL UNIQUE,
      interview_date DATE DEFAULT NULL,
      acquired_date DATE DEFAULT NULL,
      job_number VARCHAR(60) DEFAULT NULL,
      company_name VARCHAR(255) DEFAULT NULL,
      sales_owner VARCHAR(120) DEFAULT NULL,
      industry VARCHAR(120) DEFAULT NULL,
      interview_count INT NOT NULL DEFAULT 0,
      pass_count INT DEFAULT NULL COMMENT 'NQ列: NULL=空欄, 0=明示ゼロ',
      source_kind VARCHAR(40) DEFAULT NULL,
      source_row INT UNSIGNED DEFAULT NULL,
      synced_at DATETIME DEFAULT NULL,
      INDEX idx_iv (interview_date),
      INDEX idx_acq (acquired_date),
      INDEX idx_kind (source_kind, interview_date),
      INDEX idx_jobname (job_number, company_name)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='cpa-v2: 面接記録 (架電バイト)'`);

    logger.info('[Preflight] cpa-v2 schema ensured');
  } catch (e) {
    logger.warn(`[Preflight] cpa-v2 schema: ${e.message}`);
  }
};

const criticalPreflight = async () => {
  logger.info('[Preflight] start: checking companies schema...');
  // 先にカラム有無を確認
  let hasResultCol = false, hasUserCol = false;
  try {
    const [r1] = await pool.query("SHOW COLUMNS FROM companies LIKE 'last_call_result_code'");
    hasResultCol = r1.length > 0;
    const [r2] = await pool.query("SHOW COLUMNS FROM companies LIKE 'last_call_user_id'");
    hasUserCol = r2.length > 0;
    logger.info(`[Preflight] 既存カラム: result_code=${hasResultCol}, user_id=${hasUserCol}`);
  } catch (e) {
    logger.error(`[Preflight] SHOW COLUMNS失敗: ${e.message}`);
  }
  if (!hasResultCol) {
    try {
      await pool.execute(`ALTER TABLE companies ADD COLUMN last_call_result_code VARCHAR(20) DEFAULT NULL`);
      logger.info('[Preflight] last_call_result_code 追加完了');
    } catch (e) { logger.error(`[Preflight] add last_call_result_code FAILED: ${e.code} ${e.message}`); }
  }
  if (!hasUserCol) {
    try {
      await pool.execute(`ALTER TABLE companies ADD COLUMN last_call_user_id INT UNSIGNED DEFAULT NULL`);
      logger.info('[Preflight] last_call_user_id 追加完了');
    } catch (e) { logger.error(`[Preflight] add last_call_user_id FAILED: ${e.code} ${e.message}`); }
  }
  try { await pool.execute('CREATE INDEX idx_companies_last_call_result ON companies(last_call_result_code, last_called_at)'); } catch (e) {}
  // 最終確認
  try {
    const [r] = await pool.query("SHOW COLUMNS FROM companies LIKE 'last_call_result_code'");
    logger.info(`[Preflight] DONE: last_call_result_code = ${r.length > 0 ? 'OK' : 'MISSING'}`);
  } catch (e) {}
  // cpa-v2 テーブル群も必ず先に作る (新ルートが Unknown table で落ちないように)
  await ensureCpaV2Schema();
};

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
  try { await pool.execute(`ALTER TABLE projects ADD COLUMN contact_phone VARCHAR(50) DEFAULT NULL`); } catch (e) {}
  try { await pool.execute(`ALTER TABLE projects ADD COLUMN contact_email VARCHAR(255) DEFAULT NULL`); } catch (e) {}
  try { await pool.execute(`ALTER TABLE projects ADD COLUMN naitei_date DATE DEFAULT NULL`); } catch (e) {}
  try { await pool.execute(`ALTER TABLE projects ADD COLUMN interview_attendees INT UNSIGNED DEFAULT NULL`); } catch (e) {}
  // 書類選考あり 詳細: ①募集開始日 ②企業に履歴書送付日（③面接日は interview_date を流用）
  try { await pool.execute(`ALTER TABLE projects ADD COLUMN recruitment_start_date DATE DEFAULT NULL`); } catch (e) {}
  try { await pool.execute(`ALTER TABLE projects ADD COLUMN resume_sent_date DATE DEFAULT NULL`); } catch (e) {}
  // 既存の書類選考未入力(NULL)案件を「なし」に一括更新
  try {
    const [r] = await pool.execute(`UPDATE projects SET document_screening = 'not_required' WHERE document_screening IS NULL OR document_screening = ''`);
    if (r.affectedRows > 0) logger.info(`[Migration] 書類選考未入力${r.affectedRows}件を「なし」に更新`);
  } catch (e) { logger.warn('[Migration] document_screening default:', e.message); }
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
  // callsテーブルにcall_typeカラム追加（存在しなければ）
  try { await pool.execute(`ALTER TABLE calls ADD COLUMN call_type ENUM('operator','sales') DEFAULT 'operator'`); } catch (e) {}
  try { await pool.execute(`ALTER TABLE calls ADD COLUMN transcript TEXT DEFAULT NULL`); } catch (e) {}
  // 担当者情報（リコール選択時 or 担当者接続チェック時に保存。全項目任意）
  try { await pool.execute(`ALTER TABLE calls ADD COLUMN contact_person_name VARCHAR(100) DEFAULT NULL`); } catch (e) {}
  try { await pool.execute(`ALTER TABLE calls ADD COLUMN contact_person_gender VARCHAR(10) DEFAULT NULL`); } catch (e) {}
  try { await pool.execute(`ALTER TABLE calls ADD COLUMN contact_person_impression TEXT DEFAULT NULL`); } catch (e) {}
  try { await pool.execute(`ALTER TABLE calls ADD COLUMN contact_person_phone VARCHAR(30) DEFAULT NULL`); } catch (e) {}
  // NG理由（result_code='NG' のとき選択）
  try { await pool.execute(`ALTER TABLE calls ADD COLUMN ng_reason VARCHAR(100) DEFAULT NULL`); } catch (e) {}
  // スプレッドシート(G/H列)由来の実通話時間（秒）。架電結果ログ表示時に取得・保存し、ダッシュボード集計に使う
  try { await pool.execute(`ALTER TABLE calls ADD COLUMN actual_duration_seconds INT DEFAULT NULL`); } catch (e) {}
  // callsテーブルのインデックス追加（パフォーマンス改善）
  try { await pool.execute('CREATE INDEX idx_calls_started_at ON calls(call_started_at)'); } catch (e) {}
  try { await pool.execute('CREATE INDEX idx_calls_user_started ON calls(user_id, call_started_at)'); } catch (e) {}
  try { await pool.execute('CREATE INDEX idx_calls_result_started ON calls(result_code, call_started_at)'); } catch (e) {}
  // 自動ピックアップのlockFilter内NOT EXISTS高速化
  try { await pool.execute('CREATE INDEX idx_calls_company_result_started ON calls(company_id, result_code, call_started_at)'); } catch (e) {}
  // companiesの頻用フィルタ用インデックス
  try { await pool.execute('CREATE INDEX idx_companies_exc_spec ON companies(exclusion_flag, is_special)'); } catch (e) {}
  try { await pool.execute('CREATE INDEX idx_companies_locked ON companies(locked_by_user_id, locked_at)'); } catch (e) {}
  try { await pool.execute('CREATE INDEX idx_companies_last_called ON companies(last_called_at)'); } catch (e) {}
  try { await pool.execute('CREATE INDEX idx_companies_industry ON companies(industry)'); } catch (e) {}
  try { await pool.execute('CREATE INDEX idx_companies_imported ON companies(imported_by_user_id)'); } catch (e) {}
  try { await pool.execute('CREATE INDEX idx_companies_sales ON companies(is_sales_list, exclusion_flag, is_special)'); } catch (e) {}
  try { await pool.execute('CREATE INDEX idx_companies_region ON companies(region)'); } catch (e) {}
  try { await pool.execute('CREATE INDEX idx_calls_user_result ON calls(user_id, result_code, call_started_at)'); } catch (e) {}
  // 架電リスト高速化(営業含む) - is_sales_list × 直近架電
  try { await pool.execute('CREATE INDEX idx_companies_sales_lastcalled ON companies(is_sales_list, exclusion_flag, is_special, last_called_at)'); } catch (e) {}
  // recall_tasks pending サブクエリ高速化
  try { await pool.execute('CREATE INDEX idx_recall_tasks_status_company ON recall_tasks(status, company_id)'); } catch (e) {}

  // companies.region を address 先頭から都道府県名で正規化（毎回実行・冪等）
  // 既に正しい値なら何もしない（同値UPDATE）
  // 表記揺れ（"東京" → "東京都"）も含めて統一する
  try {
    const prefs = ['北海道','青森県','岩手県','宮城県','秋田県','山形県','福島県','茨城県','栃木県','群馬県','埼玉県','千葉県','東京都','神奈川県','新潟県','富山県','石川県','福井県','山梨県','長野県','岐阜県','静岡県','愛知県','三重県','滋賀県','京都府','大阪府','兵庫県','奈良県','和歌山県','鳥取県','島根県','岡山県','広島県','山口県','徳島県','香川県','愛媛県','高知県','福岡県','佐賀県','長崎県','熊本県','大分県','宮崎県','鹿児島県','沖縄県'];
    const shortMap = {
      '北海道': '北海道', '青森': '青森県', '岩手': '岩手県', '宮城': '宮城県', '秋田': '秋田県',
      '山形': '山形県', '福島': '福島県', '茨城': '茨城県', '栃木': '栃木県', '群馬': '群馬県',
      '埼玉': '埼玉県', '千葉': '千葉県', '東京': '東京都', '神奈川': '神奈川県', '新潟': '新潟県',
      '富山': '富山県', '石川': '石川県', '福井': '福井県', '山梨': '山梨県', '長野': '長野県',
      '岐阜': '岐阜県', '静岡': '静岡県', '愛知': '愛知県', '三重': '三重県', '滋賀': '滋賀県',
      '京都': '京都府', '大阪': '大阪府', '兵庫': '兵庫県', '奈良': '奈良県', '和歌山': '和歌山県',
      '鳥取': '鳥取県', '島根': '島根県', '岡山': '岡山県', '広島': '広島県', '山口': '山口県',
      '徳島': '徳島県', '香川': '香川県', '愛媛': '愛媛県', '高知': '高知県', '福岡': '福岡県',
      '佐賀': '佐賀県', '長崎': '長崎県', '熊本': '熊本県', '大分': '大分県', '宮崎': '宮崎県',
      '鹿児島': '鹿児島県', '沖縄': '沖縄県',
    };
    let backfilled = 0;
    // 1) 空regionをaddress先頭から埋める
    for (const p of prefs) {
      const [r] = await pool.execute(
        `UPDATE companies SET region = ?
         WHERE (region IS NULL OR region = '')
           AND address LIKE CONCAT(?, '%')`,
        [p, p]
      );
      backfilled += r.affectedRows || 0;
    }
    // 2) 短縮形 region を正規化（"東京" → "東京都"）
    for (const [short, full] of Object.entries(shortMap)) {
      if (short === full) continue;
      const [r] = await pool.execute(
        `UPDATE companies SET region = ? WHERE region = ?`,
        [full, short]
      );
      backfilled += r.affectedRows || 0;
    }
    if (backfilled > 0) {
      logger.info(`[Migration] companies.region normalize: ${backfilled}件`);
    }
  } catch (e) {
    logger.warn(`region backfill skipped: ${e.message}`);
  }
  try { await pool.execute('CREATE INDEX idx_assignments_user ON company_assignments(user_id, company_id)'); } catch (e) {}
  // NOT EXISTS の company_id = c.id 検索を高速化
  try { await pool.execute('CREATE INDEX idx_assignments_company ON company_assignments(company_id, user_id)'); } catch (e) {}
  // is_auto: 自動割り当て(NO_ANSWER 経由など)か手動割り当てかを区別。
  // Tier 0(assigned)/assignBypassWrap/assignmentFilterSQL は is_auto=0 (手動) のみ対象。
  try { await pool.execute('ALTER TABLE company_assignments ADD COLUMN is_auto TINYINT(1) NOT NULL DEFAULT 0'); } catch (e) {}

  // ※ 上記カラム追加とインデックスは起動時 criticalPreflight() で先行実行済み
  // バックフィル: 既存データに対し1回だけ実行（非同期＋チャンク化）。
  // 起動完了をブロックしない・他リクエストを長時間待たせない設計。
  // 完了は system_settings.last_call_result_backfilled フラグで管理。
  setImmediate(async () => {
    try {
      const [flag] = await pool.query("SELECT setting_value FROM system_settings WHERE setting_key = 'last_call_result_backfilled'");
      if (flag.length > 0) return;
      logger.info('[Migration] last_call_result_code バックフィル開始(非同期/チャンク)...');
      const t0 = Date.now();
      // 各 company_id の最終 result_code/user_id を持つ集計を取得（calls側で集計）
      const [latestRows] = await pool.query(`
        SELECT cl.company_id, cl.result_code, cl.user_id
        FROM calls cl
        INNER JOIN (
          SELECT company_id, MAX(call_started_at) AS latest
          FROM calls
          WHERE result_code IS NOT NULL
          GROUP BY company_id
        ) m ON m.company_id = cl.company_id AND m.latest = cl.call_started_at
      `);
      logger.info(`[Migration] 集計完了: ${latestRows.length}件 → チャンクUPDATE開始`);
      const CHUNK = 500;
      let done = 0;
      for (let i = 0; i < latestRows.length; i += CHUNK) {
        const batch = latestRows.slice(i, i + CHUNK);
        // 同時更新を抑えるため軽い直列処理
        for (const r of batch) {
          try {
            await pool.execute(
              'UPDATE companies SET last_call_result_code = ?, last_call_user_id = ? WHERE id = ?',
              [r.result_code, r.user_id, r.company_id]
            );
          } catch (e) { /* 個別失敗は無視 */ }
        }
        done += batch.length;
        if (done % 5000 === 0) {
          logger.info(`[Migration] バックフィル進捗: ${done}/${latestRows.length}`);
          // 他リクエストにCPUを譲る
          await new Promise(resolve => setTimeout(resolve, 50));
        }
      }
      await pool.execute("INSERT INTO system_settings (setting_key, setting_value) VALUES ('last_call_result_backfilled', ?)",
        [JSON.stringify({ affected: done, ms: Date.now() - t0, at: new Date().toISOString() })]);
      logger.info(`[Migration] last_call_result_code バックフィル完了: ${done}行 (${Date.now() - t0}ms)`);
    } catch (e) { logger.warn(`[Migration] last_call_result_code backfill: ${e.message}`); }
  });
  try { await pool.execute('CREATE INDEX idx_recall_tasks_status ON recall_tasks(status, company_id)'); } catch (e) {}

  // companies に industry_category カラム追加 + 事前計算
  try {
    await pool.execute(`ALTER TABLE companies ADD COLUMN industry_category VARCHAR(20) DEFAULT NULL`);
  } catch (e) {}
  // FAX CRM 同期日時カラム
  try { await pool.execute(`ALTER TABLE companies ADD COLUMN last_synced_to_faxcrm_at DATETIME NULL`); } catch (e) {}
  try { await pool.execute(`ALTER TABLE companies ADD COLUMN last_synced_from_faxcrm_at DATETIME NULL`); } catch (e) {}
  // FAX番号カラム（電話番号とは別管理）
  try { await pool.execute(`ALTER TABLE companies ADD COLUMN fax_number VARCHAR(50) DEFAULT NULL`); } catch (e) {}
  // NGリスト除外理由（exclusion_flag=1 にした理由のメモ）
  try { await pool.execute(`ALTER TABLE companies ADD COLUMN exclusion_reason VARCHAR(255) DEFAULT NULL`); } catch (e) {}

  // ============================================================
  // Phase 1: 統合顧客マスタ準備 (UNIFIED_CUSTOMER_SCHEMA.md)
  //   方針: callcenter MySQL を共有DBに採択 (2026-06-01)
  //   - companies に fax-crm 由来カラムを追加（読み書きはまだ無し、スキーマ準備のみ）
  //   - fax_customer_ext テーブル新設（fax-crm 固有カラム置き場）
  // ============================================================
  // 1) companies に fax-crm 互換カラムを追加
  try { await pool.execute(`ALTER TABLE companies ADD COLUMN prefecture VARCHAR(20) DEFAULT NULL COMMENT 'fax-crm互換: 都道府県 (region は広域)'`); } catch (e) {}
  try { await pool.execute(`ALTER TABLE companies ADD COLUMN city VARCHAR(100) DEFAULT NULL COMMENT 'fax-crm互換: 市区町村'`); } catch (e) {}
  try { await pool.execute(`ALTER TABLE companies ADD COLUMN postal_code VARCHAR(10) DEFAULT NULL COMMENT 'fax-crm互換: 郵便番号'`); } catch (e) {}
  try { await pool.execute(`ALTER TABLE companies ADD COLUMN url VARCHAR(500) DEFAULT NULL COMMENT 'fax-crm互換: 会社URL'`); } catch (e) {}
  try { await pool.execute(`ALTER TABLE companies ADD COLUMN employee_count INT DEFAULT NULL COMMENT 'fax-crm互換: 従業員数'`); } catch (e) {}
  try { await pool.execute(`ALTER TABLE companies ADD COLUMN representative VARCHAR(100) DEFAULT NULL COMMENT 'fax-crm互換: 代表者名'`); } catch (e) {}
  try { await pool.execute(`ALTER TABLE companies ADD COLUMN note TEXT DEFAULT NULL COMMENT 'fax-crm互換: 補足メモ (comment とは別)'`); } catch (e) {}
  try { await pool.execute(`ALTER TABLE companies ADD COLUMN is_blacklisted TINYINT(1) NOT NULL DEFAULT 0 COMMENT 'fax-crm互換: ブラックリスト (exclusion_flag とは別軸)'`); } catch (e) {}
  try { await pool.execute(`ALTER TABLE companies ADD COLUMN blacklisted_reason VARCHAR(255) DEFAULT NULL COMMENT 'fax-crm互換: ブラックリスト理由'`); } catch (e) {}
  try { await pool.execute(`ALTER TABLE companies ADD COLUMN source_file VARCHAR(255) DEFAULT NULL COMMENT 'fax-crm互換: 取込元ファイル名'`); } catch (e) {}
  try { await pool.execute(`ALTER TABLE companies ADD COLUMN imported_at DATETIME DEFAULT NULL COMMENT 'fax-crm互換: 取込日時'`); } catch (e) {}
  try { await pool.execute(`ALTER TABLE companies ADD COLUMN external_faxcrm_id BIGINT UNSIGNED DEFAULT NULL COMMENT 'fax-crm 側 customers.id への逆参照'`); } catch (e) {}
  try { await pool.execute(`CREATE UNIQUE INDEX uk_companies_external_faxcrm ON companies(external_faxcrm_id)`); } catch (e) {}
  try { await pool.execute(`CREATE INDEX idx_companies_prefecture ON companies(prefecture)`); } catch (e) {}
  try { await pool.execute(`CREATE INDEX idx_companies_blacklisted ON companies(is_blacklisted)`); } catch (e) {}

  // 2) fax-crm 固有カラム (FAX送信集計の最新値など。companies と 1:1)
  try {
    await pool.execute(`CREATE TABLE IF NOT EXISTS fax_customer_ext (
      company_id           INT UNSIGNED NOT NULL PRIMARY KEY COMMENT 'companies.id への外部キー (1:1)',
      send_count           INT          NOT NULL DEFAULT 0   COMMENT 'FAX送信回数累計',
      last_sent_at         DATETIME     DEFAULT NULL          COMMENT '最終FAX送信日時',
      last_pc_number       VARCHAR(20)  DEFAULT NULL          COMMENT '最終送信PC番号',
      last_result          VARCHAR(40)  DEFAULT NULL          COMMENT '最終FAX結果ラベル',
      response_count       INT          NOT NULL DEFAULT 0   COMMENT '応答(受電報告)回数',
      created_at           DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at           DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      CONSTRAINT fk_fcc_ext_company FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE,
      INDEX idx_fcc_ext_last_sent (last_sent_at)
    ) ENGINE=InnoDB COMMENT='fax-crm 固有カラム (companies との 1:1 拡張)'`);
  } catch (e) { logger.warn(`[Migration] fax_customer_ext CREATE: ${e.message}`); }
  try {
    await pool.execute('CREATE INDEX idx_companies_category ON companies(industry_category)');
  } catch (e) {}
  // industry_category 一括再計算（v2: 製造/加工キーワードを広めに）
  try {
    const [flag] = await pool.query(
      "SELECT setting_value FROM system_settings WHERE setting_key = 'industry_category_v3_applied'"
    );
    if (flag.length === 0) {
      logger.info(`[Migration] industry_category v2 一括再計算開始`);
      await pool.execute(`
        UPDATE companies SET industry_category = CASE
          WHEN industry LIKE '%製造%' OR industry LIKE '%メーカー%' OR industry LIKE '%加工%' THEN '製造'
          WHEN industry LIKE '%小売%' OR industry LIKE '%卸売%' OR industry LIKE '%スーパー%' OR industry LIKE '%コンビニ%' OR industry LIKE '%ショッピング%' OR industry LIKE '%商社%' OR industry LIKE '%物販%' THEN '小売'
          WHEN industry LIKE '%建設%' OR industry LIKE '%工事%' OR industry LIKE '%建築%' OR industry LIKE '%土木%' OR industry LIKE '%リフォーム%' THEN '建設'
          WHEN industry LIKE '%宿泊%' OR industry LIKE '%ホテル%' OR industry LIKE '%旅館%' OR industry LIKE '%民宿%' THEN '宿泊'
          WHEN industry LIKE '%農業%' OR industry LIKE '%農産%' OR industry LIKE '%畜産%' OR industry LIKE '%水産%' OR industry LIKE '%漁業%' OR industry LIKE '%林業%' THEN '農業'
          WHEN industry LIKE '%介護%' OR industry LIKE '%医療%' OR industry LIKE '%福祉%' OR industry LIKE '%病院%' OR industry LIKE '%クリニック%' OR industry LIKE '%歯科%' THEN '介護'
          WHEN industry LIKE '%運輸%' OR industry LIKE '%運送%' OR industry LIKE '%輸送%' OR industry LIKE '%物流%' OR industry LIKE '%タクシー%' OR industry LIKE '%鉄道%' OR industry LIKE '%配送%' THEN '運輸'
          WHEN industry LIKE '%情報通信%' OR industry LIKE '%ソフトウェア%' OR industry LIKE '%IT業%' OR industry LIKE '%システム%' THEN 'IT'
          WHEN industry LIKE '%金融%' OR industry LIKE '%銀行%' OR industry LIKE '%保険%' OR industry LIKE '%証券%' THEN '金融'
          WHEN industry LIKE '%不動産%' THEN '不動産'
          WHEN industry LIKE '%美容%' OR industry LIKE '%エステ%' OR industry LIKE '%理容%' OR industry LIKE '%サロン%' THEN '美容'
          WHEN industry LIKE '%清掃%' OR industry LIKE '%クリーニング%' OR industry LIKE '%ビルメンテ%' OR industry LIKE '%ビル管理%' OR industry LIKE '%ハウスクリーニング%' THEN '清掃'
          WHEN industry LIKE '%飲食店%' OR industry LIKE '%グルメ%' OR industry LIKE '%レストラン%' OR industry LIKE '%居酒屋%' OR industry LIKE '%ラーメン%' OR industry LIKE '%カフェ%' OR industry LIKE '%喫茶店%' OR industry LIKE '%寿司%' OR industry LIKE '%焼肉%' OR industry LIKE '%和食%' OR industry LIKE '%中華%' OR industry LIKE '%洋食%' OR industry LIKE '%食堂%' OR industry LIKE '%ダイニング%' OR industry LIKE '%そば%' OR industry LIKE '%うどん%' OR industry LIKE '%菓子%' THEN '飲食'
          WHEN industry LIKE '%サービス%' THEN 'サービス'
          ELSE 'その他'
        END
        WHERE industry IS NOT NULL AND industry != ''
      `);
      await pool.execute(
        "INSERT INTO system_settings (setting_key, setting_value) VALUES ('industry_category_v3_applied', 'true')"
      );
      logger.info(`[Migration] industry_category v2 再計算完了`);
    }
  } catch (e) { logger.warn('[Migration] industry_category:', e.message); }
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

  // === 一度だけ実行: Book1.xlsx 由来の過去CPAデータ投入（コストは保持） ===
  try {
    const [flagRows] = await pool.execute(
      "SELECT setting_value FROM system_settings WHERE setting_key = 'past_cpa_seed_applied_v2'"
    );
    if (flagRows.length === 0) {
      const fs = require('fs');
      const path = require('path');
      const seedPath = path.join(__dirname, 'data/past-cpa-seed.json');
      if (fs.existsSync(seedPath)) {
        const records = JSON.parse(fs.readFileSync(seedPath, 'utf-8'));
        const [users] = await pool.execute(
          "SELECT id, name FROM users WHERE role IN ('operator','intern','sales','manager','admin')"
        );
        const nameMap = new Map();
        users.forEach(u => {
          const clean = u.name.replace(/\s+/g, '');
          nameMap.set(clean, u.id);
          // 姓の2文字で登録（先着優先）
          const surname = clean.slice(0, 2);
          if (!nameMap.has(surname)) nameMap.set(surname, u.id);
          const surname3 = clean.slice(0, 3);
          if (!nameMap.has(surname3)) nameMap.set(surname3, u.id);
        });

        let updated = 0, inserted = 0, skipped = 0;
        const skippedNames = new Set();
        for (const r of records) {
          let userId = 0;
          if (r.name) {
            const cleanName = r.name.replace(/\s+/g, '').replace(/\(.*?\)|（.*?）/g, '');
            const matched = nameMap.get(cleanName) || nameMap.get(cleanName.slice(0, 3)) || nameMap.get(cleanName.slice(0, 2));
            if (!matched) {
              skipped++; skippedNames.add(r.name); continue;
            }
            userId = matched;
          }
          const dateFromCond = r.date_from ? 'date_from = ?' : 'date_from IS NULL';
          const selectParams = r.date_from
            ? [r.year, r.month, userId, r.date_from]
            : [r.year, r.month, userId];
          const [existing] = await pool.execute(
            `SELECT id FROM past_cpa_data WHERE period_year = ? AND period_month = ? AND user_id = ? AND ${dateFromCond}`,
            selectParams
          );
          if (existing.length > 0) {
            await pool.execute(
              `UPDATE past_cpa_data SET period_label=?, call_count=?, project_count=?, interview_count=?,
                naitei_count=?, fugokaku_count=?, barashi_lost_count=?, initial_payment=?, expected_revenue=?
                WHERE id=?`,
              [r.period_label, r.call_count, r.project_count, r.interview_count,
               r.naitei_count, r.fugokaku_count, r.barashi_lost_count,
               r.initial_payment, r.expected_revenue, existing[0].id]
            );
            updated++;
          } else {
            await pool.execute(
              `INSERT INTO past_cpa_data (period_label, period_year, period_month, user_id, cost,
                call_count, project_count, interview_count, naitei_count, fugokaku_count,
                barashi_lost_count, initial_payment, expected_revenue, date_from, date_to)
               VALUES (?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              [r.period_label, r.year, r.month, userId,
               r.call_count, r.project_count, r.interview_count, r.naitei_count,
               r.fugokaku_count, r.barashi_lost_count, r.initial_payment, r.expected_revenue,
               r.date_from, r.date_to]
            );
            inserted++;
          }
        }
        // === 過去案件質データ投入 ===
        const qSeedPath = path.join(__dirname, 'data/past-quality-seed.json');
        let qUpdated = 0, qInserted = 0;
        if (fs.existsSync(qSeedPath)) {
          // past_quality_data に user_id カラム追加（存在しなければ）
          try { await pool.execute(`ALTER TABLE past_quality_data ADD COLUMN user_id INT UNSIGNED DEFAULT NULL`); } catch (e) {}
          const qRecords = JSON.parse(fs.readFileSync(qSeedPath, 'utf-8'));
          for (const r of qRecords) {
            let userId = null;
            if (r.name) {
              const cleanName = r.name.replace(/\s+/g, '').replace(/\(.*?\)|（.*?）/g, '');
              userId = nameMap.get(cleanName) || nameMap.get(cleanName.slice(0, 3)) || nameMap.get(cleanName.slice(0, 2)) || null;
              if (!userId) continue;
            }
            const userIdCond = userId === null ? 'user_id IS NULL' : 'user_id = ?';
            const dateFromCond = r.date_from ? 'date_from = ?' : 'date_from IS NULL';
            const selParams = [r.year, r.month];
            if (userId !== null) selParams.push(userId);
            if (r.date_from) selParams.push(r.date_from);
            const [existing] = await pool.execute(
              `SELECT id FROM past_quality_data WHERE period_year = ? AND period_month = ? AND ${userIdCond} AND ${dateFromCond}`,
              selParams
            );
            if (existing.length > 0) {
              await pool.execute(
                `UPDATE past_quality_data SET period_label=?, total_projects=?, lost=?, waiting_contact=?,
                  interview_confirmed=?, interview_done=?, barashi=?, online_interview=?, no_screening=?, screening_failed=?
                  WHERE id=?`,
                [r.period_label, r.total_projects, r.lost, r.waiting_contact,
                 r.interview_confirmed, r.interview_done, r.barashi, r.online_interview,
                 r.no_screening, r.screening_failed, existing[0].id]
              );
              qUpdated++;
            } else {
              await pool.execute(
                `INSERT INTO past_quality_data (period_label, period_year, period_month, user_id, date_from, date_to,
                  total_projects, lost, waiting_contact, interview_confirmed, interview_done,
                  barashi, online_interview, no_screening, screening_failed)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [r.period_label, r.year, r.month, userId, r.date_from, r.date_to,
                 r.total_projects, r.lost, r.waiting_contact, r.interview_confirmed, r.interview_done,
                 r.barashi, r.online_interview, r.no_screening, r.screening_failed]
              );
              qInserted++;
            }
          }
        }

        await pool.execute(
          "INSERT INTO system_settings (setting_key, setting_value) VALUES ('past_cpa_seed_applied_v2', ?)",
          [JSON.stringify({ cpa: {updated, inserted, skipped, skippedNames: [...skippedNames]}, quality: {updated: qUpdated, inserted: qInserted}, at: new Date().toISOString() })]
        );
        logger.info(`[Migration] past_cpa_seed v2: CPA updated=${updated}/inserted=${inserted}/skipped=${skipped}, Quality updated=${qUpdated}/inserted=${qInserted}`);
      }
    }
  } catch (e) { logger.warn('[Migration] past_cpa_seed v2:', e.message); }
};
// 起動シーケンス:
//   1. criticalPreflight() を await（新カラム追加など、ないとリクエスト処理が500になる項目）
//   2. listen() で受付開始
//   3. runMigrations() は非同期に走らせ続ける（重い処理が含まれるため起動を待たせない）
let server;
(async () => {
  try {
    await criticalPreflight();
  } catch (e) {
    logger.error(`[Preflight] FAILED: ${e.message}`);
    // それでも起動は試みる（既存のリクエストは旧スキーマで動く可能性あり）
  }
  server = app.listen(PORT, () => {
    logger.info(`=================================`);
    logger.info(`AIコールセンターCRM API起動`);
    logger.info(`ポート: ${PORT}`);
    logger.info(`環境: ${process.env.NODE_ENV || 'development'}`);
    logger.info(`=================================`);
  });
  if (server) {
    server.requestTimeout = 0;
    server.headersTimeout = 60 * 60 * 1000;
    server.keepAliveTimeout = 65 * 1000;
    try { server.setTimeout(0); } catch (e) {}
  }
  // 残りの重いマイグレーション・region正規化・seed投入などは非同期で実行
  runMigrations().catch(e => logger.error(`[Migration] background failed: ${e.message}`));
})();

module.exports = app;
