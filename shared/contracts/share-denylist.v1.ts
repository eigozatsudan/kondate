/**
 * 共有 publish 前のサーバー関門向け denylist（版付き）。
 * 保証表現・PII っぽい残渣・明らかに有害な非食品指示を閉じたリストで拒否する。
 * 自由文ログは出さない。ヒット有無のみを関門へ返す。
 *
 * AP5: 閉じた断片のみだと未収録の人名（例: 健太の〜）が OpenRouter / pool にすり抜け得る。
 * 本版は (1) 高頻度の和名 stem+助詞 (2) 敬称付き呼びかけ (3) 住所・郵便番号ヒューリスティック
 * を fail-closed で追加する。オープン集合の完全人名認識は製品再設計域のため residual。
 */

export const shareDenylistVersion = "2026-08-07.v3" as const;

/**
 * 安全を保証する表現。共有プールでは安全を保証しない方針と矛盾するため拒否。
 * 完全一致ではなく部分一致（includes）で検出する。
 */
export const shareGuaranteePhrases = [
  "アレルギーでも安心",
  "アレルギー対応済み",
  "アレルギーフリー",
  "アレルゲンフリー",
  "アレルゲンゼロ",
  "完全に安全",
  "絶対安全",
  "安全性を保証",
  "安全を保証",
  "安心してお召し上がり",
  "安心してお召し上がりください",
  "誰でも食べられる",
  "誰でも安全",
] as const;

/**
 * 人名っぽい・世帯固有の呼びかけ残渣。
 * ソースの個人名が ingredient.name や手順に残る経路を fail-closed する。
 */
export const sharePiiLiteralPhrases = [
  "太郎の",
  "太郎は",
  "太郎を",
  "太郎に",
  "花子の",
  "花子は",
  "うちの子",
  "うちの残り",
  // 世帯・親族の残渣（部分一致。うちの* は「うちの」でも拾う）
  "うちの",
  "うちの冷蔵庫",
  "弟の",
  "姉の",
  "息子の",
  "娘の",
  "子供の",
  "こどもの",
  // 呼びかけ残渣（「ちゃんの」「くんの」は短く誤爆し得るが fail-closed 優先）
  "ちゃんの",
  "くんの",
  "さんの",
  "様の",
  "自宅の",
  "本名",
  "ママの",
  "パパの",
  "おばあちゃんの",
  "おじいちゃんの",
] as const;

/**
 * AP5: 高頻度の和名 stem。助詞（の/は/を/に/が）と結合して検出する。
 * 網羅ではない。未収録名は honorific ヒューリスティックと AI Pass 指示で補完する residual。
 */
export const sharePiiGivenNameStems = [
  // 2 文字以上のみ（1 文字 stem は食品・一般語と衝突しやすい）
  "健太",
  "翔太",
  "直樹",
  "大輔",
  "拓也",
  "達也",
  "雄太",
  "亮太",
  "悠真",
  "陽翔",
  "美咲",
  "陽子",
  "裕子",
  "真由",
  "恵子",
  "智子",
  "優子",
  "結衣",
  "陽葵",
  "さくら",
  "ゆい",
  "一郎",
  "次郎",
  "三郎",
] as const;

const givenNameParticleSuffixes = ["の", "は", "を", "に", "が"] as const;

/**
 * 明らかに非食品・有害な指示の断片。
 * 誤って一般化した手順に残った場合を拒否する（網羅ではなく初版の閉じた集合）。
 */
export const shareHarmfulInstructionPhrases = [
  "洗剤を入れる",
  "漂白剤を入れる",
  "農薬を",
  "薬品を混ぜ",
  "毒を",
] as const;

const emailLikePattern = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/iu;
const phoneLikePattern =
  /(?:0\d{1,4}[-(]?\d{1,4}[-)]?\d{3,4}|\+81[- ]?\d{1,4}[- ]?\d{1,4}[- ]?\d{3,4})/u;

/**
 * AP5: 1〜4 文字の和文 + 敬称（ちゃん/くん/さん/様）+ 任意の助詞。
 * 例: 「健太ちゃんの特製」「みさきさんの残り」。食品名への誤爆より fail-closed を優先。
 */
const personHonorificPattern = /[一-龯ぁ-んァ-ン]{1,4}(?:ちゃん|くん|さん|様)(?:の|は|を|に|が)?/u;

/** 郵便番号残渣（〒 付き / ハイフン有無） */
const postalCodePattern = /〒\s*\d{3}-?\d{4}|\b\d{3}-\d{4}\b/u;

/**
 * 都道府県 + 市区町村っぽい住所断片。
 * 献立自由文に生住所が残った経路を fail-closed。
 */
const japaneseAddressFragmentPattern =
  /[一-龯]{1,4}[都道府県][一-龯0-9０-９\-−ー\s]{0,24}[市区町村]/u;

/**
 * 単一テキストが denylist に触れるか。
 * 正規化はしない（保証表現は表記ゆれより明示フレーズを優先。PII は部分一致）。
 */
export function textHitsShareDenylist(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed === "") return false;

  for (const phrase of shareGuaranteePhrases) {
    if (trimmed.includes(phrase)) return true;
  }
  for (const phrase of sharePiiLiteralPhrases) {
    if (trimmed.includes(phrase)) return true;
  }
  // AP5: 未収録の「太郎」級すり抜けを抑える和名 stem + 助詞
  for (const stem of sharePiiGivenNameStems) {
    for (const particle of givenNameParticleSuffixes) {
      if (trimmed.includes(`${stem}${particle}`)) return true;
    }
  }
  for (const phrase of shareHarmfulInstructionPhrases) {
    if (trimmed.includes(phrase)) return true;
  }
  if (emailLikePattern.test(trimmed)) return true;
  if (phoneLikePattern.test(trimmed)) return true;
  if (personHonorificPattern.test(trimmed)) return true;
  if (postalCodePattern.test(trimmed)) return true;
  if (japaneseAddressFragmentPattern.test(trimmed)) return true;
  return false;
}
