/**
 * 業種テキスト → 業種カテゴリ の分類ロジック（単一の情報源 / single source of truth）
 * ============================================================================
 * ここが業種分類の唯一の定義。CSV インポート（挿入時の即時分類・一括 UPDATE）と、
 * 顧客マスタの「業種診断 → 再計算」の両方が、このモジュールから
 *   - classifyIndustryCategory() … JS 実装（1 行ずつ即分類する用）
 *   - buildIndustryCategoryCase() … SQL の CASE 式（一括 UPDATE / 集計用）
 * を取り出して使う。JS と SQL がこの 1 ファイルから生成されるので食い違わない。
 *
 * 【評価順（優先順位）について】
 * INDUSTRY_CATEGORY_RULES は上から順に評価し、最初にマッチしたカテゴリを採用する。
 *   - 先頭〜「小売」までの 8 カテゴリは、旧ロジック（8 業種）とキーワード・並び順が
 *     完全に同一。したがって旧ロジックで「その他」以外に分類されていた企業の結果は
 *     一切変わらない（＝再計算しても既存の建設/飲食/製造/小売…は動かない）。
 *   - 末尾に「運輸 / IT / 金融 / 不動産 / 美容 / サービス」を追加。これらのキーワードは
 *     上位 8 カテゴリのキーワードと重複しないため、旧「その他」だった企業だけが
 *     新カテゴリへ移る（単調な改善）。
 *   - 「サービス」は非常に広いキーワードなので必ず最後（その他の直前）に置き、
 *     具体的な業種（清掃・介護・運輸 等）が先に確定するようにしている。
 *
 * これにより、業種別ピックアップのドロップダウンが提示する 14 業種すべてが
 * industry_category に実際に書き込まれるようになり、「運輸/IT/金融/不動産/美容/
 * サービスを選ぶと 0 件」という不整合が解消する。
 */

const INDUSTRY_CATEGORY_RULES = [
  // --- 旧 8 業種（順序・キーワードとも従来と同一。既存分類を変えないため触らない） ---
  ['建設', ['建設', '建築', '工事', '土木', 'リフォーム', '電気工事', '管工事', '建材', '住宅', 'リノベ']],
  ['宿泊', ['宿泊', 'ホテル', '旅館', '民宿']],
  ['清掃', ['清掃', 'クリーニング', 'ビルメンテ', 'ビル管理', 'ハウスクリーニング']],
  ['介護', ['介護', 'デイサービス', '福祉', '老人ホーム', 'グループホーム']],
  ['飲食', ['飲食', 'グルメ', 'レストラン', '居酒屋', 'ラーメン', 'カフェ', '喫茶店', '寿司', '焼肉', '和食', '中華', '洋食', '食堂', 'ダイニング', 'そば', 'うどん', '菓子']],
  ['農業', ['農業', '農場', '農園', '畜産', '養鶏', '水産', '漁業', '林業', '農産']],
  ['製造', ['製造', 'メーカー', '加工', '工場', '金属', '部品', '機械', '化学', '食品', '飲料', '繊維', '衣料', '印刷', '木材', '木製', 'プラスチック', 'ゴム', '紙', 'パルプ', 'セメント', '窯業', '電子', '輸送機', '自動車', '電気機械']],
  ['小売', ['小売', '卸売', 'スーパー', 'コンビニ', 'ショッピング', '商社', '物販', '販売']],
  // --- 追加 6 業種（旧「その他」に沈んでいた企業を正しく拾う。キーワードは上位と非重複） ---
  ['運輸', ['運輸', '運送', '輸送', '物流', 'タクシー', '鉄道', '配送', '倉庫']],
  ['IT', ['情報通信', 'ソフトウェア', 'IT業', 'システム開発', 'システム', 'ソフト開発', 'ウェブ', 'アプリ開発']],
  ['金融', ['金融', '銀行', '信用金庫', '信用組合', '保険', '証券', 'リース', 'クレジット']],
  ['不動産', ['不動産', '賃貸', '仲介', 'マンション管理']],
  ['美容', ['美容', 'エステ', '理容', 'サロン', 'ネイル', 'まつげ', 'ヘアサロン']],
  ['サービス', ['サービス']], // 最も広いので必ず最後
];

// ピックアップ等で使う正規のカテゴリ名一覧（「その他」を除く）
const INDUSTRY_CATEGORY_NAMES = INDUSTRY_CATEGORY_RULES.map(([name]) => name);

/**
 * industry テキストから industry_category を判定する JS 実装。
 * 未入力（空 / null / undefined）のときは null を返す（＝カテゴリを付けない）。
 * 並び・キーワードは INDUSTRY_CATEGORY_RULES と完全同一（SQL CASE と同じ結果）。
 * @param {string|null|undefined} industry
 * @returns {string|null}
 */
const classifyIndustryCategory = (industry) => {
  if (!industry) return null;
  for (const [category, keywords] of INDUSTRY_CATEGORY_RULES) {
    for (const kw of keywords) {
      if (industry.indexOf(kw) !== -1) return category;
    }
  }
  return 'その他';
};

/**
 * INDUSTRY_CATEGORY_RULES から SQL の CASE 式を生成する。
 * @param {string} col 対象カラム名（既定 'industry'。集計側では 'c.industry' 等）
 * @returns {string} "CASE WHEN ... THEN ... ELSE 'その他' END"
 * キーワードは固定リストでシングルクォートを含まないため、そのまま埋め込んで安全。
 */
const buildIndustryCategoryCase = (col = 'industry') => {
  const whens = INDUSTRY_CATEGORY_RULES.map(([category, keywords]) => {
    const conds = keywords.map((kw) => `${col} LIKE '%${kw}%'`).join(' OR ');
    return `    WHEN ${conds} THEN '${category}'`;
  }).join('\n');
  return `\n  CASE\n${whens}\n    ELSE 'その他'\n  END\n`;
};

module.exports = {
  INDUSTRY_CATEGORY_RULES,
  INDUSTRY_CATEGORY_NAMES,
  classifyIndustryCategory,
  buildIndustryCategoryCase,
};
