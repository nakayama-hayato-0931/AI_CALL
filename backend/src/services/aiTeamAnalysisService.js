/**
 * AI チーム分析・個人コーチングサービス
 * Anthropic Claude を使用してチーム全体・個人のパフォーマンスを分析
 */
const Anthropic = require('@anthropic-ai/sdk');
const logger = require('../utils/logger');

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const MODEL = 'claude-sonnet-4-6';

/**
 * Claude API 呼び出しヘルパー（aiEvaluationService と同パターン）
 */
const callClaude = async (systemPrompt, userContent, maxTokens = 2000, temperature = 0.4) => {
  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: maxTokens,
    temperature,
    system: systemPrompt,
    messages: [
      { role: 'user', content: userContent },
    ],
  });

  const text = response.content[0].text;
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error('AIの応答からJSONを抽出できませんでした');
  }
  try {
    return JSON.parse(jsonMatch[0]);
  } catch (parseErr) {
    // 不完全なJSON（トークン上限で途切れた場合）を修復試行
    let fixed = jsonMatch[0];
    // 未閉じの文字列を閉じる
    const openQuotes = (fixed.match(/"/g) || []).length;
    if (openQuotes % 2 !== 0) fixed += '"';
    // 未閉じの括弧を閉じる
    const openBrackets = (fixed.match(/\[/g) || []).length - (fixed.match(/\]/g) || []).length;
    for (let i = 0; i < openBrackets; i++) fixed += ']';
    const openBraces = (fixed.match(/\{/g) || []).length - (fixed.match(/\}/g) || []).length;
    for (let i = 0; i < openBraces; i++) fixed += '}';
    // 末尾のカンマを除去
    fixed = fixed.replace(/,\s*([\]}])/g, '$1');
    try {
      return JSON.parse(fixed);
    } catch {
      logger.error('JSON修復失敗:', fixed.slice(-200));
      throw new Error('AIの応答JSONが不完全です（トークン上限の可能性）');
    }
  }
};

/**
 * チーム全体のパフォーマンス分析
 * @param {object} teamData - { period, dateFrom, dateTo, operators[], totalStats }
 * @returns {object} AI分析結果
 */
const evaluateTeamAnalysis = async (teamData) => {
  try {
    const systemPrompt = `あなたは法人営業チームのマネジメントコンサルタントAIです。
コールセンターチーム全体の架電パフォーマンスデータを分析し、マネージャー向けの総合レポートを作成してください。

【チーム目標値（1時間あたり）】
- コール数: 20件/h
- リコール取得: 3件/h
- リコール消化: 3件/h
- 有効接続: 3件/h
- 担当者接続: 2件/h
- アポ獲得効率: 8時間に1件（稼働8時間で1アポ）
- 案件化率目標: 0.61%（10月〜2月の平均実績がベンチマーク）

各オペレーターのデータに稼働時間が含まれている場合は、時間あたりの実績を目標値と比較して評価してください。
目標値に対する達成率も考慮してteam_scoreを算出してください。

出力は必ず以下のJSON形式のみで返してください（余計なテキストは不要）:
{
  "team_score": 75,
  "summary": "チーム全体の総評（3-4文）",
  "strengths": ["強み1", "強み2", "強み3"],
  "weaknesses": ["課題1", "課題2", "課題3"],
  "trends": "トレンド分析（2-3文）",
  "top_performers": ["活躍オペレーター名とその理由"],
  "needs_support": ["サポートが必要なオペレーター名とその理由"],
  "recommendations": ["具体的な改善アクション1", "具体的な改善アクション2", "具体的な改善アクション3"],
  "skill_breakdown": {
    "opening": { "avg": 75, "comment": "第一声の全体傾向" },
    "clarity": { "avg": 70, "comment": "明瞭さの全体傾向" },
    "hearing": { "avg": 72, "comment": "ヒアリングの全体傾向" },
    "rebuttal": { "avg": 65, "comment": "切り返しの全体傾向" },
    "closing": { "avg": 78, "comment": "クロージングの全体傾向" }
  }
}

team_scoreは0〜100の整数で、チーム全体のパフォーマンスを評価してください。
データが少ない場合でも、利用可能な情報から最善の分析を行ってください。`;

    const { period, dateFrom, dateTo, operators, totalStats } = teamData;
    const periodLabel = dateFrom === '2000-01-01' ? '全期間' : `${dateFrom} 〜 ${dateTo}`;

    const operatorDetails = operators.map(op => {
      const convRate = op.total_calls > 0 ? ((op.projects / op.total_calls) * 100).toFixed(1) : '0';
      const workHours = op.work_hours || 0;
      const perHour = workHours > 0 ? {
        calls: (op.total_calls / workHours).toFixed(1),
        effective: (op.effective_connections / workHours).toFixed(1),
        person: (op.person_connections / workHours).toFixed(1),
      } : null;
      let detail = `${op.name}:
  架電数: ${op.total_calls} / 有効接続: ${op.effective_connections} / 担当者接続: ${op.person_connections} / 案件: ${op.projects} (案件化率: ${convRate}%)`;
      if (perHour) {
        detail += `\n  稼働時間: ${workHours.toFixed(1)}h → コール${perHour.calls}件/h / 有効接続${perHour.effective}件/h / 担当接続${perHour.person}件/h`;
      }
      detail += `\n  AI平均スコア: ${op.avg_ai_score || '-'}
  スコア内訳: 第一声${op.avg_opening || '-'} / 明瞭さ${op.avg_clarity || '-'} / ヒアリング${op.avg_hearing || '-'} / 切り返し${op.avg_rebuttal || '-'} / クロージング${op.avg_closing || '-'}`;
      return detail;
    }).join('\n\n');

    const userContent = `【チーム架電パフォーマンス (${periodLabel})】

チーム全体統計:
- 総架電数: ${totalStats.totalCalls}件
- 有効接続: ${totalStats.effectiveConnections}件 (${totalStats.totalCalls > 0 ? ((totalStats.effectiveConnections / totalStats.totalCalls) * 100).toFixed(1) : 0}%)
- 担当者接続: ${totalStats.personConnections}件
- 案件獲得: ${totalStats.projects}件 (案件化率: ${totalStats.totalCalls > 0 ? ((totalStats.projects / totalStats.totalCalls) * 100).toFixed(1) : 0}%)
- オペレーター数: ${operators.length}名

【オペレーター別データ】
${operatorDetails}`;

    const result = await callClaude(systemPrompt, userContent);

    // team_score の範囲チェック
    if (typeof result.team_score !== 'number' || result.team_score < 0 || result.team_score > 100) {
      result.team_score = 0;
    }

    logger.info(`チーム分析完了: team_score=${result.team_score}, period=${period}`);
    return result;
  } catch (err) {
    logger.error('チーム分析エラー:', err);
    throw new Error(`チーム分析処理に失敗しました: ${err.message}`);
  }
};

/**
 * 個人オペレーターのコーチング生成
 * @param {object} operatorData - { name, period, dateFrom, dateTo, stats, evaluations[], scoreAvgs }
 * @returns {object} AIコーチング結果
 */
const evaluateOperatorCoaching = async (operatorData) => {
  try {
    const systemPrompt = `あなたは法人営業のパーソナルコーチングAIです。
個別オペレーターの架電データを分析し、成長のための具体的なアドバイスを提供してください。

【目標値（1時間あたり）】
- コール数: 20件/h
- リコール取得: 3件/h
- リコール消化: 3件/h
- 有効接続: 3件/h
- 担当者接続: 2件/h
- アポ獲得効率: 8時間に1件（稼働8時間で1アポ）
- 案件化率目標: 0.61%（10月〜2月の平均実績がベンチマーク）

稼働時間データがある場合は、時間あたりの実績を目標値と比較し、具体的な達成率を示してください。

出力は必ず以下のJSON形式のみで返してください（余計なテキストは不要）:
{
  "coaching_score": 75,
  "summary": "このオペレーターの総合評価（3-4文）",
  "strengths": ["強み1（具体例付き）", "強み2（具体例付き）"],
  "weaknesses": ["課題1（具体例付き）", "課題2（具体例付き）"],
  "action_items": ["明日から実践できるアクション1", "今週中に取り組むアクション2", "中長期で意識するポイント"],
  "skill_advice": {
    "opening": "第一声の具体的アドバイス",
    "clarity": "明瞭さの具体的アドバイス",
    "hearing": "ヒアリングの具体的アドバイス",
    "rebuttal": "切り返しの具体的アドバイス",
    "closing": "クロージングの具体的アドバイス"
  }
}

coaching_scoreは0〜100の整数で、目標値に対する達成度を考慮して評価してください。`;

    const { name, dateFrom, dateTo, workHours, stats, evaluations, scoreAvgs } = operatorData;
    const periodLabel = dateFrom === '2000-01-01' ? '全期間' : `${dateFrom} 〜 ${dateTo}`;
    const convRate = stats.totalCalls > 0 ? ((stats.projects / stats.totalCalls) * 100).toFixed(1) : '0';

    // 時間あたり実績
    const wh = workHours || 0;
    let perHourText = '';
    if (wh > 0) {
      perHourText = `\n\n時間あたり実績（稼働${wh.toFixed(1)}h）:
- コール数: ${(stats.totalCalls / wh).toFixed(1)}件/h （目標: 20件/h）
- 有効接続: ${(stats.effectiveConnections / wh).toFixed(1)}件/h （目標: 3件/h）
- 担当接続: ${(stats.personConnections / wh).toFixed(1)}件/h （目標: 2件/h）
- アポ効率: ${stats.projects > 0 ? (wh / stats.projects).toFixed(1) + '時間/件' : 'アポなし'} （目標: 8時間/件）`;
    }

    // 直近の評価サマリー（最大10件）
    const evalSummaries = evaluations.slice(0, 10).map((e, i) =>
      `${i + 1}. ${e.company_name || '企業'}: ${e.result_code} / スコア${e.overall_score}点 / ${e.summary || '(要約なし)'}`
    ).join('\n');

    const userContent = `【オペレーター個人分析 (${periodLabel})】

名前: ${name}

架電統計:
- 総架電数: ${stats.totalCalls}件
- 有効接続: ${stats.effectiveConnections}件
- 担当者接続: ${stats.personConnections}件
- 案件獲得: ${stats.projects}件 (案件化率: ${convRate}%)${perHourText}

スコア平均:
- 総合: ${scoreAvgs.overall}
- 第一声: ${scoreAvgs.opening}
- 明瞭さ: ${scoreAvgs.clarity}
- ヒアリング: ${scoreAvgs.hearing}
- 切り返し: ${scoreAvgs.rebuttal}
- クロージング: ${scoreAvgs.closing}

【直近の架電評価】
${evalSummaries || '（評価データなし）'}`;

    const result = await callClaude(systemPrompt, userContent, 1500, 0.4);

    if (typeof result.coaching_score !== 'number' || result.coaching_score < 0 || result.coaching_score > 100) {
      result.coaching_score = 0;
    }

    logger.info(`個人コーチング生成完了: name=${name}, coaching_score=${result.coaching_score}`);
    return result;
  } catch (err) {
    logger.error('個人コーチング生成エラー:', err);
    throw new Error(`個人コーチング生成に失敗しました: ${err.message}`);
  }
};

/**
 * オペレーター育成ステータスシート生成
 * @param {object} operatorData - { name, dateFrom, dateTo, workHours, stats, evaluations[], scoreAvgs }
 * @returns {object} ステータスシート
 */
const evaluateStatusSheet = async (operatorData) => {
  try {
    const { name, level, dateFrom, dateTo, workHours, stats, evaluations, scoreAvgs } = operatorData;
    const levelLabel = level || '未設定';

    const systemPrompt = `あなたは法人営業コールセンターの育成担当マネージャーAIです。
個別オペレーターのパフォーマンスデータとAI評価結果を分析し、育成ステータスシートを作成してください。

【チーム目標値（1時間あたり）】
- コール数: 20件/h
- 有効接続: 3件/h
- 担当者接続: 2件/h
- アポ獲得効率: 8時間に1件
- 案件化率目標: 0.61%

【このオペレーターのランク: ${levelLabel}】
ランクに応じた改善案を提示してください:
- 初級: 基礎的なトークスクリプトの習得、受付突破の基本パターン、架電数を増やす工夫
- 中級: 担当者接続後のヒアリング力強化、切り返しパターンの引き出し増加、案件化率向上
- 上級: 高難度業種への対応力、後輩への指導ポイント、チーム貢献

【重要な制約】
- ロープレ（ロールプレイング練習）は提案しないでください。実施環境がありません。
- 改善は全てOJT（実際の架電業務の中での改善）で行います。
- 「次の架電で〜を試す」「今日の架電から〜を意識する」「実際の通話で〜を実践する」のように、実務の中で取り組めるアクションにしてください。

出力は必ず以下のJSON形式のみで返してください（余計なテキストは不要）:
{
  "current_status": {
    "summary": "現在の育成状況の総括（2-3文）",
    "can_do": ["できていること1（具体的な根拠付き）", "できていること2", "できていること3"],
    "improvements": ["改善が必要な点1（具体的な根拠付き）", "改善が必要な点2", "改善が必要な点3"]
  },
  "training_plan": {
    "short_term": {
      "period": "今週〜来週",
      "goals": ["短期目標1", "短期目標2"],
      "methods": ["OJTで実践できる方法1", "OJTで実践できる方法2"]
    },
    "mid_term": {
      "period": "1ヶ月以内",
      "goals": ["中期目標1", "中期目標2"],
      "methods": ["OJTで実践できる方法1", "OJTで実践できる方法2"]
    },
    "long_term": {
      "period": "3ヶ月以内",
      "goals": ["長期目標1", "長期目標2"],
      "methods": ["OJTで実践できる方法1", "OJTで実践できる方法2"]
    }
  },
  "targets": {
    "org_targets": {
      "calls_per_h": "組織全体の時間あたりコール数目標（数値）",
      "effective_per_h": "有効接続/h目標（数値）",
      "person_per_h": "担当接続/h目標（数値）",
      "hours_per_project": "案件1件あたり所要時間目標（数値）",
      "target_cpa": "目標CPA（円、数値）"
    },
    "individual_targets": {
      "calls_per_h": "この人の時間あたりコール数目標（数値、実績とランクに基づいて設定）",
      "effective_per_h": "有効接続/h目標（数値）",
      "person_per_h": "担当接続/h目標（数値）",
      "hours_per_project": "案件1件あたり所要時間目標（数値）",
      "target_cpa": "個別目標CPA（円、数値）",
      "rationale": "この目標を設定した根拠（1文）"
    }
  },
  "scenario": {
    "current_cpa": "現在のCPA（円、数値 or null）",
    "target_cpa": "目標CPA（円、数値）",
    "steps": [
      {
        "metric": "改善する指標名（例：コール数/h）",
        "current": "現在値",
        "target": "目標値",
        "impact": "この改善でCPAがどれくらい下がるか"
      }
    ],
    "summary": "改善シナリオの要約（2-3文。どの数値をどう改善すればCPAがいくらになるか）"
  },
  "next_steps": [
    {
      "action": "実際の架電で取り組むこと",
      "reason": "なぜこれをやるべきか",
      "deadline": "いつまでに",
      "success_criteria": "達成基準"
    },
    {
      "action": "実際の架電で取り組むこと2",
      "reason": "なぜこれをやるべきか",
      "deadline": "いつまでに",
      "success_criteria": "達成基準"
    },
    {
      "action": "実際の架電で取り組むこと3",
      "reason": "なぜこれをやるべきか",
      "deadline": "いつまでに",
      "success_criteria": "達成基準"
    }
  ]
}

【目標値設定のルール】
- 組織全体目標: チーム全体の実績を踏まえた現実的な目標
- 個別目標: このオペレーターのランクと実績に基づいて個別設定。初級は低めから、上級は高い水準
- CPA = 時給1,500円 x 案件1件あたり所要時間

【改善シナリオのルール】
- 現在の数値からどの指標をいくつ改善するとCPAがいくらになるかを具体的に示す
- 最大3ステップの改善段階を示す

ネクストステップはOJTで実践できる具体的なアクションにしてください。
抽象的な「頑張る」「意識する」やロープレは禁止です。`;
    const periodLabel = dateFrom === '2000-01-01' ? '全期間' : `${dateFrom} 〜 ${dateTo}`;
    const convRate = stats.totalCalls > 0 ? ((stats.projects / stats.totalCalls) * 100).toFixed(1) : '0';

    const wh = workHours || 0;
    let perHourText = '';
    if (wh > 0) {
      perHourText = `\n\n時間あたり実績（稼働${wh.toFixed(1)}h）:
- コール数: ${(stats.totalCalls / wh).toFixed(1)}件/h （目標: 20件/h）
- 有効接続: ${(stats.effectiveConnections / wh).toFixed(1)}件/h （目標: 3件/h）
- 担当接続: ${(stats.personConnections / wh).toFixed(1)}件/h （目標: 2件/h）
- アポ効率: ${stats.projects > 0 ? (wh / stats.projects).toFixed(1) + '時間/件' : 'アポなし'} （目標: 8時間/件）`;
    }

    // 良い例（PROJECT）と悪い例（NG高スコア）を分離
    const goodEvals = evaluations.filter(e => e.result_code === 'PROJECT');
    const badEvals = evaluations.filter(e => e.result_code === 'NG');

    const formatEval = (e, i) =>
      `${i + 1}. ${e.company_name || '企業'}: スコア${e.overall_score}点\n   要約: ${e.summary || '-'}\n   良い点: ${e.good_points || '-'}\n   改善点: ${e.improvement_points || '-'}`;

    const goodSection = goodEvals.length > 0
      ? `【成功事例（案件化できた通話）直近2週間・最大5件】\n${goodEvals.map(formatEval).join('\n\n')}`
      : '【成功事例】なし';

    const badSection = badEvals.length > 0
      ? `【改善事例（NGだがスコアが高い＝会話はできたが案件化できなかった通話）直近2週間・最大5件】\n${badEvals.map(formatEval).join('\n\n')}`
      : '【改善事例】なし';

    const userContent = `【オペレーター育成ステータスシート作成依頼 (${periodLabel})】

名前: ${name}

架電統計:
- 総架電数: ${stats.totalCalls}件
- 有効接続: ${stats.effectiveConnections}件
- 担当者接続: ${stats.personConnections}件
- 案件獲得: ${stats.projects}件 (案件化率: ${convRate}%)${perHourText}

スコア平均:
- 総合: ${scoreAvgs.overall}
- 第一声: ${scoreAvgs.opening}
- 明瞭さ: ${scoreAvgs.clarity}
- ヒアリング: ${scoreAvgs.hearing}
- 切り返し: ${scoreAvgs.rebuttal}
- クロージング: ${scoreAvgs.closing}

${goodSection}

${badSection}

上記の成功事例と改善事例を比較し、何が案件化の決め手になっているか、何が不足しているかを分析してください。`;

    const result = await callClaude(systemPrompt, userContent, 4096, 0.3);

    logger.info(`ステータスシート生成完了: name=${name}`);
    return result;
  } catch (err) {
    logger.error('ステータスシート生成エラー:', err);
    throw new Error(`ステータスシート生成に失敗しました: ${err.message}`);
  }
};

module.exports = { evaluateTeamAnalysis, evaluateOperatorCoaching, evaluateStatusSheet };
