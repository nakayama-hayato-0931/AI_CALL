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
以下の架電データ（文字起こし・メタデータ・メモ）から、オペレーターの架電品質を評価してください。

評価は文字起こしの内容を最重要視してください。文字起こしから実際の会話内容を分析し、各スキルを具体的に評価してください。

【会社・サービス概要】
株式会社ヒトキワ（台東区浅草橋）。外国人向けの就業教育・ビジネスマナー訓練を行う教育事業。
企業への人材紹介は完全無料（紹介料・採用費用ゼロ）。生徒からの授業料で運営。
対象国籍: ベトナム、ネパール、ミャンマー、スリランカ、バングラデシュ、モンゴル等の東南アジア中心。
ビザ: 「技術・人文知識・国際業務」の就労ビザを申請。特定技能の場合は月3万円の管理費が発生。
面接: オンライン面接を推奨（応募数が増えるため）。

【架電フロー（マニュアル準拠）】
⓪ 受付突破: 「株式会社ヒトキワの○○です。ハローワークの○○業務に興味を持つ生徒がおり、応募条件をお伺いしたい」→担当者に繋いでもらう
① 重要説明（担当者接続後）: 無料で紹介可能であること、教育事業である説明、5分程度のヒアリング許可を得る
② 求人ヒアリング: 事業内容、正社員雇用可否、雇用期間、月給、賞与、勤務時間、残業、休日、勤務地住所、保険、交通費、応募資格（性別・国籍・免許・語学力）、採用人数
③ 面接調整: 5日後〜14日以内で面接日確定、メールアドレス取得、担当者名・連絡先取得

【評価観点（マニュアルに基づく）】
1. 第一声 (opening_score): 挨拶の明るさ・語尾上げ、名乗り、ハローワーク求人への言及、用件の明確さ、受付突破力
2. 明瞭さ (clarity_score): 元気の良さ、テンポ、聞き取りやすさ、お得感の伝達（採用コスト0の強調）
3. ヒアリング (hearing_score): 求人票の必要項目（給料・勤務時間・休日・応募資格等）を漏れなくヒアリングできているか、正社員雇用の確認
4. 切り返し (rebuttal_score): 「なぜ無料？」「ビザ下りない」「対面面接しか」「すぐ辞めない？」等の反論への対応力。マニュアルQ&Aに沿った回答ができているか
5. クロージング (closing_score): 面接日の具体的な日時提案（2択提示）、メールアドレス取得、担当者名取得、次のアクション明確化

【Q&A理解度の評価ポイント】
- 「なぜ無料？」→ 教育事業であり生徒の授業料で運営している旨を説明できているか
- 「日本語力は？」→ 業種に応じた回答（建築業は簡単なコミュニケーション、飲食等は日常会話レベル）
- 「ビザは下りるか？」→ 将来的な管理・マネジメント業務の説明ができているか
- 「住居は？」→ 本人が引っ越す旨、提携不動産のサポートがある旨
- 「どれくらいで働ける？」→ 国内1-3ヶ月、海外3-6ヶ月

結果コードも参考にしてください:
- PROJECT(案件化) → 高品質な架電 (80-100点)
- INTERESTED(興味あり) → 良好 (70-85点)
- RECALL(リコール) → 中程度、アポ獲得の可能性 (60-75点)
- NG → 文字起こし内容で具体的に判定 (40-65点)

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

    // 文字起こしデータ
    const transcriptText = callData.transcript ? `\n\n【文字起こし】\n${callData.transcript}` : '';

    const userContent = `【架電データ】
企業名: ${callData.company_name || '不明'}
業種: ${callData.industry || '不明'}
地域: ${callData.region || '不明'}
結果コード: ${callData.result_code || '不明'}
通話時間: ${durationSec !== null ? `${durationSec}秒` : '不明'}
有効接続: ${callData.is_effective_connection ? 'あり' : 'なし'}
担当者接続: ${callData.is_person_in_charge ? 'あり' : 'なし'}
メモ: ${callData.memo || '（なし）'}${sheetContext}${transcriptText}`;

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

/**
 * AI評価結果からアウト返し・Q&A候補を抽出する
 * @param {object} callData - 通話データ（company_name, industry, memo, result_code等）
 * @param {object} evaluation - AI評価結果（summary, good_points等）
 * @returns {Array} 提案リスト [{ type, category, trigger_text, response_text }]
 */
const extractScriptSuggestions = async (callData, evaluation) => {
  try {
    const systemPrompt = `あなたは法人営業のナレッジ管理AIです。
通話データとAI評価結果を分析し、他のオペレーターにも共有すべき優れたアウト返し（反論への切り返し）やQ&A（よくある質問への回答）を抽出してください。

【既知のQ&Aカテゴリ（マニュアル既存）】
- 会社概要: ヒトキワは外国人の教育事業、専門学校のイメージ
- 費用: 企業からの紹介料・採用費用ゼロ、生徒の授業料で運営
- 国籍: ベトナム、ネパール、ミャンマー、スリランカ、バングラデシュ等
- 日本語力: 業種により日常会話〜簡単なコミュニケーション
- ビザ: 技人国ビザ申請、提携行政書士がサポート、費用無料
- 特定技能: 月3万円の管理費、紹介料は無料
- 住居: 本人引越し、提携不動産でサポート
- 勤務開始: 国内1-3ヶ月、海外3-6ヶ月
- バックレ: 自己都合早期退職しないよう指導、受入終了届出の案内
- 宗教文化: 大きなカルチャーショックなし、食事制限への理解
- オンライン面接: 応募数が増える、遠方の応募者も含められる

上記は既にマニュアルに記載済みです。以下の条件を満たすものだけを提案してください:
- 上記マニュアル既存のQ&Aにはない新しいパターンである
- 通話メモや文字起こしに具体的なやり取りの記述がある
- 汎用的に使える切り返しや回答パターンである

出力は必ず以下のJSON形式のみで返してください:
{
  "suggestions": [
    {
      "type": "rebuttal または qa",
      "category": "カテゴリ名（断り対応、費用質問、会社概要、日本語力、ビザ、生活、など）",
      "trigger_text": "お客様の質問や反論（短く簡潔に）",
      "response_text": "オペレーターの回答や切り返し（そのまま使えるトーク）"
    }
  ]
}

提案がない場合は {"suggestions": []} を返してください。
最大3件まで提案してください。`;

    const userContent = `【通話データ】
企業名: ${callData.company_name || '不明'}
業種: ${callData.industry || '不明'}
結果コード: ${callData.result_code || '不明'}
メモ: ${callData.memo || '（なし）'}

【AI評価結果】
総合スコア: ${evaluation.overall_score || '-'}点
要約: ${evaluation.summary || '（なし）'}
良かった点: ${evaluation.good_points || '（なし）'}
改善点: ${evaluation.improvement_points || '（なし）'}`;

    const result = await callClaude(systemPrompt, userContent, 1500, 0.4);
    return result.suggestions || [];
  } catch (err) {
    logger.warn('スクリプト提案抽出エラー:', err.message);
    return [];
  }
};

module.exports = { evaluateCall, evaluateCallFromData, evaluateDailySummary, extractScriptSuggestions };
