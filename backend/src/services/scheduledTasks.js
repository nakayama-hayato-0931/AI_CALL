/**
 * 定時バッチタスク (node-cron)
 *
 * - 毎日 12:00 / 17:00 / 21:00 JST に
 *   「文字起こし一括取得」 (refreshTranscriptsBulk) と
 *   「通話時間一括取得」 (backfillDurations) を当日分に対して実行する。
 *
 * 設計メモ:
 * - 対象期間は当日 (JST) のみに限定。 過去全期間スキャンは Google Sheets API への
 *   負荷とレスポンス時間を考慮して避ける (フロントから手動で全期間実行は引き続き可能)。
 * - 失敗してもプロセスは死なせない (logger.error で記録)。
 * - 多重起動防止: 各ジョブ内で実行中フラグを立て、 同じジョブが重複して走らないようにする。
 * - timezone: 'Asia/Tokyo' を明示。 Railway は通常 UTC で動くため必須。
 */

const cron = require('node-cron');
const logger = require('../utils/logger');
const {
  _refreshTranscriptsBulkInternal,
  _backfillDurationsInternal,
} = require('../controllers/callController');

// JST の YYYY-MM-DD を返す (UTC_TIMESTAMP() + 9h と同じ考え方)
function todayJst() {
  const jstMs = Date.now() + 9 * 60 * 60 * 1000;
  return new Date(jstMs).toISOString().slice(0, 10);
}

let running = false;

async function runDailyBulkFetch(triggerLabel) {
  if (running) {
    logger.warn(`[scheduler] ${triggerLabel} スキップ: 前回ジョブが実行中`);
    return;
  }
  running = true;
  const startedAt = Date.now();
  const today = todayJst();
  logger.info(`[scheduler] ${triggerLabel} 開始 (date=${today})`);
  try {
    try {
      const t = await _refreshTranscriptsBulkInternal({ date_from: today, date_to: today });
      logger.info(`[scheduler] ${triggerLabel} 文字起こし: ${t.found}/${t.total}件${t.error ? ' (sheets error)' : ''}`);
    } catch (e) {
      logger.error(`[scheduler] ${triggerLabel} 文字起こしエラー: ${e.message}`);
    }
    try {
      const d = await _backfillDurationsInternal({ date_from: today, date_to: today });
      logger.info(`[scheduler] ${triggerLabel} 通話時間: ${d.updated}/${d.target}件${d.error ? ' (sheets error)' : ''}`);
    } catch (e) {
      logger.error(`[scheduler] ${triggerLabel} 通話時間エラー: ${e.message}`);
    }
  } finally {
    running = false;
    logger.info(`[scheduler] ${triggerLabel} 完了 (elapsed ${Math.round((Date.now() - startedAt) / 1000)}s)`);
  }
}

function startScheduledTasks() {
  if (process.env.DISABLE_SCHEDULED_TASKS === '1') {
    logger.info('[scheduler] DISABLE_SCHEDULED_TASKS=1 によりスキップ');
    return;
  }
  const tz = { timezone: 'Asia/Tokyo' };
  cron.schedule('0 12 * * *', () => runDailyBulkFetch('12:00 JST'), tz);
  cron.schedule('0 17 * * *', () => runDailyBulkFetch('17:00 JST'), tz);
  cron.schedule('0 21 * * *', () => runDailyBulkFetch('21:00 JST'), tz);
  logger.info('[scheduler] 文字起こし+通話時間 一括取得: 毎日 12:00/17:00/21:00 JST に実行');
}

module.exports = { startScheduledTasks, runDailyBulkFetch };
