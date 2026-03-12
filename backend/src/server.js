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
const csvRoutes = require('./routes/csv');
const logRoutes = require('./routes/logs');
const adminRoutes = require('./routes/admin');
const requestRoutes = require('./routes/requests');

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
app.use('/api/csv', csvRoutes);
app.use('/api/logs', logRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/requests', requestRoutes);

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
app.listen(PORT, () => {
  logger.info(`=================================`);
  logger.info(`AIコールセンターCRM API起動`);
  logger.info(`ポート: ${PORT}`);
  logger.info(`環境: ${process.env.NODE_ENV || 'development'}`);
  logger.info(`=================================`);
});

module.exports = app;
