/**
 * AI通話評価サービス
 * Anthropic Claude Sonnet 4.6を使用して通話の品質を自動評価する
 */
const Anthropic = require('@anthropic-ai/sdk');
const logger = require('../utils/logger');

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const MODEL = 'claude-sonnet-4-6';

/**
 * Claude APIを呼び出してJSON応答を取得するヘルパー
 */
const callClaude = async (systemPrompt, userContent, maxTokens = 1500, temperature = 0.3) => {
  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: maxTokens,
    temperature,
    system: systemPrompt,
    messages: [
      { role: 'user', content: userContent },
    ],
  });

  // 応答テキストからJSONを抽出してパース
  const text = response.content[0].text;
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error('AIの応答からJSONを抽出できませんでした');
  }
  return JSON.parse(jsonMatch[0]);
};

/**
 * 通話テキストをAIで評価する
 * @param {string} transcript - 通話の文字起こしテキスト
 * @param {string} operatorName - オペレーター名
 * @returns {object} 評価結果
 */
const evaluateCall = async (transcript, operatorName = '') => {
  try {
    const systemPrompt = `あなたは法人営業のコール品質評価AIです。
以下の通話を評価してください。

評価観点:
1. 第一声 (opening_score): 挨拶、名乗り、用件提示の適切さ
2. 明瞭さ (clarity_score): 話し方の明瞭さ、テンポ、聞き取りやすさ
3. ヒアリング (hearing_score): 相手のニーズを引き出す質問力
4. 切り返し (rebuttal_score): 反論・断りへの対応力
5. クロージング (closing_score): 次のアクション設定の適切さ

出力は必ず以下のJSON形式のみで返してください（余計なテキストは不要）:
{
  "overall_score": 75,
  "opening_score": 80,
  "clarity_score": 70,
  "hearing_score": 75,
  "rebuttal_score": 65,
  "closing_score": 80,
  "summary": "通話の要約（2-3文）",
  "good_points": "良かった点（箇条書き）",
  "improvement_points": "改善点（箇条書き）",
  "next_improvement": "次回の具体的な改善アクション"
}

各スコアは0〜100の整数で評価してください。`;

    const evaluation = await callClaude(
      systemPrompt,
      `オペレーター: ${operatorName}\n\n通話内容:\n${transcript}`,
    );

    // スコアの範囲チェック
    const scoreFields = [
      'overall_score', 'opening_score', 'clarity_score',
      'hearing_score', 'rebuttal_score', 'closing_score',
    ];
    for (const field of scoreFields) {
      if (typeof evaluation[field] !== 'number' || evaluation[field] < 0 || evaluation[field] > 100) {
        evaluation[field] = 0;
      }
    }

    logger.info(`AI評価完了: overall_score=${evaluation.overall_score}`);
    return evaluation;
  } catch (err) {
    logger.error('AI評価エラー:', err);
    throw new Error(`AI評価処理に失敗しました: ${err.message}`);
  }
};

/**
 * CRMデータ + Google Sheetsログから通話を評価する
 * @param {object} callData - CRM DBからの通話データ
 * @param {Array} sheetLogs - Google Sheetsから取得した関連ログ
 * @returns {object} 評価結果
 */
const evaluateCallFromData = async (callData, sheetLogs = []) => {
  try {
    // 通話時間（秒）を計算
    let durationSec = null;
    if (callData.call_started_at && callData.call_ended_at) {
      durationSec = Math.round(
        (new Date(callData.call_ended_at) - new Date(callData.call_started_at)) / 1000
      );
    }

    // Google Sheetsのログ情報をテキスト化
    let sheetContext = '';
    if (sheetLogs.length > 0) {
      sheetContext = '\n\n【スプレッドシートの通話記録】\n';
      sheetLogs.forEach((log, i) => {
        sheetContext += `--- 記録${i + 1} ---\n`;
        Object.entries(log).forEach(([key, val]) => {
          if (val) sheetContext += `${key}: ${val}\n`;
        });
      });
    }

    const systemPrompt = `あなたは法人営業のコール品質評価AIです。
以下の架電データ（メタデータ・メモ・通話ログ）から、オペレーターの架電品質を評価してください。

評価観点:
1. 第一声 (opening_score): 挨拶、名乗り、用件提示の適切さ
2. 明瞭さ (clarity_score): コミュニケーションの質、相手への伝わりやすさ
3. ヒアリング (hearing_score): 相手のニーズを引き出す質問力
4. 切り返し (rebuttal_score): 反論・断りへの対応力
5. クロージング (closing_score): 次のアクション設定の適切さ

結果コードからの推定ガイドライン:
- PROJECT(案件化) → 高品質な架電 (80-100点)
- INTERESTED(興味あり) → 良好 (70-85点)
- RECALL(リコール) → 中程度、アポ獲得の可能性 (60-75点)
- NG → メモ内容次第で判定 (40-65点)
- NO_ANSWER(不通) → オペレーター責任外、中立評価 (~50点)
- SKIP → 評価対象外

メモや通話ログの詳細がある場合は、それに基づいてより正確に評価してください。
メモが空の場合は結果コードと通話時間から推定してください。

出力は必ず以下のJSON形式のみで返してください（余計なテキストは不要）:
{
  "overall_score": 75,
  "opening_score": 80,
  "clarity_score": 70,
  "hearing_score": 75,
  "rebuttal_score": 65,
  "closing_score": 80,
  "summary": "通話の要約（2-3文）",
  "good_points": "良かった点（箇条書き）",
  "improvement_points": "改善点（箇条書き）",
  "next_improvement": "次回の具体的な改善アクション（1つ）"
}`;

    const userContent = `【架電データ】
企業名: ${callData.company_name || '不明'}
業種: ${callData.industry || '不明'}
地域: ${callData.region || '不明'}
結果コード: ${callData.result_code || '不明'}
通話時間: ${durationSec !== null ? `${durationSec}秒` : '不明'}
有効接続: ${callData.is_effective_connection ? 'あり' : 'なし'}
担当者接続: ${callData.is_person_in_charge ? 'あり' : 'なし'}
メモ: ${callData.memo || '（なし）'}${sheetContext}`;

    const evaluation = await callClaude(systemPrompt, userContent);

    // スコアの範囲チェック
    const scoreFields = [
      'overall_score', 'opening_score', 'clarity_score',
      'hearing_score', 'rebuttal_score', 'closing_score',
    ];
    for (const field of scoreFields) {
      if (typeof evaluation[field] !== 'number' || evaluation[field] < 0 || evaluation[field] > 100) {
        evaluation[field] = 0;
      }
    }

    logger.info(`AI評価完了(データベース): overall_score=${evaluation.overall_score}, company=${callData.company_name}`);
    return evaluation;
  } catch (err) {
    logger.error('AI評価エラー(データベース):', err);
    throw new Error(`AI評価処理に失敗しました: ${err.message}`);
  }
};

/**
 * 日次サマリーをAIで生成する
 * @param {Array} evaluations - 個別評価結果の配列
 * @param {object} stats - 集計データ { totalCalls, effectiveConnections, projects, avgScore }
 * @returns {object} 日次サマリー
 */
const evaluateDailySummary = async (evaluations, stats) => {
  try {
    const systemPrompt = `あなたは法人営業チームのコーチングAIです。
オペレーターの1日の架電結果を総合的に評価し、フィードバックを提供してください。

出力は必ず以下のJSON形式のみで返してください（余計なテキストは不要）:
{
  "daily_score": 75,
  "daily_summary": "本日の架電活動の総評（2-3文）",
  "daily_good_points": "本日良かった点（箇条書き、2-3点）",
  "daily_improvement_points": "本日の改善点（箇条書き、2-3点）",
  "advice": "明日に向けた具体的なアドバイス（1-2文）"
}`;

    // 個別評価のサマリーをまとめる
    const evalSummaries = evaluations.map((e, i) =>
      `${i + 1}. ${e.company_name || '企業'}: ${e.result_code} / スコア${e.overall_score}点 / ${e.summary || ''}`
    ).join('\n');

    const userContent = `【本日の架電集計】
総架電数: ${stats.totalCalls}件
有効接続: ${stats.effectiveConnections}件
案件化: ${stats.projects}件
平均AIスコア: ${stats.avgScore}点

【個別架電サマリー】
${evalSummaries}`;

    const summary = await callClaude(systemPrompt, userContent, 1000, 0.4);

    if (typeof summary.daily_score !== 'number' || summary.daily_score < 0 || summary.daily_score > 100) {
      summary.daily_score = 0;
    }

    logger.info(`日次サマリー生成完了: daily_score=${summary.daily_score}`);
    return summary;
  } catch (err) {
    logger.error('日次サマリー生成エラー:', err);
    throw new Error(`日次サマリー生成に失敗しました: ${err.message}`);
  }
};

module.exports = { evaluateCall, evaluateCallFromData, evaluateDailySummary };
