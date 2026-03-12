/**
 * AI通話評価スタンドアロンスクリプト
 * コマンドラインから直接通話テキストを評価できる
 *
 * 使い方:
 *   node ai/evaluate.js "通話テキスト" "オペレーター名"
 */
require('dotenv').config({ path: require('path').join(__dirname, '../backend/.env') });
const OpenAI = require('openai');

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const SYSTEM_PROMPT = `あなたは法人営業のコール品質評価AIです。
以下の通話を評価してください。

評価観点:
1. 第一声 (opening_score): 挨拶、名乗り、用件提示の適切さ
2. 明瞭さ (clarity_score): 話し方の明瞭さ、テンポ、聞き取りやすさ
3. ヒアリング (hearing_score): 相手のニーズを引き出す質問力
4. 切り返し (rebuttal_score): 反論・断りへの対応力
5. クロージング (closing_score): 次のアクション設定の適切さ

出力は必ず以下のJSON形式で返してください:
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

async function evaluate(transcript, operatorName = '') {
  if (!process.env.OPENAI_API_KEY) {
    console.error('エラー: OPENAI_API_KEY が設定されていません');
    console.error('backend/.env ファイルに OPENAI_API_KEY を設定してください');
    process.exit(1);
  }

  console.log('AI評価を実行中...\n');

  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4',
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        {
          role: 'user',
          content: `オペレーター: ${operatorName}\n\n通話内容:\n${transcript}`,
        },
      ],
      temperature: 0.3,
      max_tokens: 1500,
      response_format: { type: 'json_object' },
    });

    const result = JSON.parse(response.choices[0].message.content);

    console.log('=== AI通話評価結果 ===\n');
    console.log(`総合スコア: ${result.overall_score}/100`);
    console.log(`第一声:     ${result.opening_score}/100`);
    console.log(`明瞭さ:     ${result.clarity_score}/100`);
    console.log(`ヒアリング: ${result.hearing_score}/100`);
    console.log(`切り返し:   ${result.rebuttal_score}/100`);
    console.log(`クロージング: ${result.closing_score}/100`);
    console.log(`\n--- 通話要約 ---\n${result.summary}`);
    console.log(`\n--- 良かった点 ---\n${result.good_points}`);
    console.log(`\n--- 改善点 ---\n${result.improvement_points}`);
    console.log(`\n--- 次回改善 ---\n${result.next_improvement}`);

    return result;
  } catch (err) {
    console.error('AI評価エラー:', err.message);
    process.exit(1);
  }
}

// CLI実行
if (require.main === module) {
  const transcript = process.argv[2];
  const operatorName = process.argv[3] || '';

  if (!transcript) {
    console.log('使い方: node ai/evaluate.js "通話テキスト" "オペレーター名"');
    console.log('');
    console.log('例:');
    console.log('  node ai/evaluate.js "お世話になります。株式会社ABCの田中と申します..."');
    process.exit(0);
  }

  evaluate(transcript, operatorName);
}

module.exports = { evaluate };
