/**
 * 共有 publish 前のサーバー関門向け denylist（版付き）。
 * 保証表現・PII っぽい残渣・明らかに有害な非食品指示を閉じたリストで拒否する。
 * 自由文ログは出さない。ヒット有無のみを関門へ返す。
 */

export const shareDenylistVersion = "2026-08-01.v2" as const;

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
  "自宅の",
  "本名",
  "ママの",
  "パパの",
  "おばあちゃんの",
  "おじいちゃんの",
] as const;

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
  for (const phrase of shareHarmfulInstructionPhrases) {
    if (trimmed.includes(phrase)) return true;
  }
  if (emailLikePattern.test(trimmed)) return true;
  if (phoneLikePattern.test(trimmed)) return true;
  return false;
}
