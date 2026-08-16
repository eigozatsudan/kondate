/**
 * 共有 publish 前のサーバー関門向け denylist（版付き）。
 * 保証表現・PII っぽい残渣・明らかに有害な非食品指示を閉じたリストで拒否する。
 * 自由文ログは出さない。ヒット有無のみを関門へ返す。
 *
 * AP5: 閉じた断片のみだと未収録の人名（例: 健太の〜）が OpenRouter / pool にすり抜け得る。
 * 本版は (1) 高頻度の和名 stem+助詞 (2) 敬称付き呼びかけ (3) 住所・郵便番号ヒューリスティック
 * を fail-closed で追加する。オープン集合の完全人名認識は製品再設計域のため residual。
 */

export const shareDenylistVersion = "2026-08-16.v8" as const;

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
  // AP12: 閉じた近傍。オープン言い換え集合にはしない
  "この献立は安全です",
  "誰でも食べて大丈夫",
] as const;

/**
 * AP4: 既収録の親族 stem。和名 stem と同じ助詞（は/を/に/が）と取り分けの「用」を閉じた行列で付ける。
 * 既存の「次男の」「ママ用」等リテラルは残す。四男以降・新規親族語・オープン NER は載せない。
 */
const sharePiiKinshipStems = [
  "弟",
  "姉",
  "兄",
  "妹",
  "息子",
  "娘",
  "長男",
  "長女",
  "次男",
  "次女",
  "三男",
  "三女",
  "祖母",
  "祖父",
  "子供",
  "こども",
  "ママ",
  "パパ",
  "母",
  "父",
  "おばあちゃん",
  "おじいちゃん",
] as const;

const kinshipParticleAndPurposeSuffixes = ["は", "を", "に", "が", "用"] as const;

const sharePiiKinshipParticleAndPurposePhrases = sharePiiKinshipStems.flatMap((stem) =>
  kinshipParticleAndPurposeSuffixes.map((suffix) => `${stem}${suffix}`),
);

/**
 * 人名っぽい・世帯固有の呼びかけ残渣。
 * ソースの個人名が ingredient.name や手順に残る経路を fail-closed する。
 */
export const sharePiiLiteralPhrases = [
  "太郎の",
  "太郎は",
  "太郎を",
  "太郎に",
  "太郎が",
  "花子の",
  "花子は",
  "花子を",
  "花子に",
  "花子が",
  "うちの子",
  "うちの残り",
  // 世帯・親族の残渣（部分一致。うちの* は「うちの」でも拾う）
  "うちの",
  "うちの冷蔵庫",
  "弟の",
  "姉の",
  "兄の",
  "妹の",
  "息子の",
  "娘の",
  // 出生順の閉じた行列（長/次/三 × 男/女）。四男以降やオープン NER は載せない
  "長男の",
  "長女の",
  "次男の",
  "次女の",
  "三男の",
  "三女の",
  "祖母の",
  "祖父の",
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
  // 助詞付きの短称。お母さん/お父さん は honorific で当たるが「母の特製」は当たらない
  "母の",
  "父の",
  "ママ用",
  "パパ用",
  "おばあちゃんの",
  "おじいちゃんの",
  // 年齢帯の世帯残渣（「1歳用」等）。一般の分量表現とは衝突しにくい
  "歳用",
  // AP4: 既収録親族の は/を/に/が/用。既存「次男の」「ママ用」は上に残す
  ...sharePiiKinshipParticleAndPurposePhrases,
] as const;

/**
 * AP5: 高頻度の和名 stem。助詞（の/は/を/に/が）と結合して検出する。
 * 網羅ではない。未収録名は honorific ヒューリスティックと AI Pass 指示で補完する residual。
 */
export const sharePiiGivenNameStems = [
  // 2 文字以上のみ（1 文字 stem は食品・一般語と衝突しやすい）
  "太郎",
  "花子",
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
 * AP2: suffix 無しの「太郎ハンバーグ」「花子と一緒に」を拾う。
 * 食品複合（桃太郎トマト等）は先に除いてから部分一致する。
 */
export const sharePiiGivenNameBareStems = ["太郎", "花子"] as const;

const givenNameFoodCompounds = ["桃太郎", "金太郎", "浦島太郎"] as const;

/**
 * 明らかに非食品・有害な指示の断片。
 * 誤って一般化した手順に残った場合を拒否する（網羅ではなく初版の閉じた集合）。
 */
export const shareHarmfulInstructionPhrases = [
  "洗剤を入れる",
  "漂白剤を入れる",
  "漂白剤を使う",
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
 * 照合前畳み。針の文言は変えず、haystack だけ NFKC + 書式制御除去する。
 * ゼロ幅空白で「太郎の」を分断したり、全角＠で email 針をすり抜ける経路を閉じる。
 * AP2: 空白・読点・中点で「健太 の」「弟・の」「090 1234 5678」を分ける経路を閉じる。
 * カタカナ折りはしない（針は明示フレーズの部分一致のまま）。
 */
function foldShareDenylistHaystack(text: string): string {
  return text
    .normalize("NFKC")
    .replace(/\p{Cf}/gu, "")
    .replace(/[\s、，・]+/gu, "")
    .trim();
}

/**
 * AP-R3: 閉じた針だけ（正規表現・オープン NER は見ない）。
 * フィールドを順に採用 / スキップした連結に針が含まれるか。
 */
function listClosedShareDenylistNeedles(): readonly string[] {
  const needles: string[] = [
    ...shareGuaranteePhrases,
    ...sharePiiLiteralPhrases,
    ...shareHarmfulInstructionPhrases,
    ...sharePiiGivenNameBareStems,
  ];
  for (const stem of sharePiiGivenNameStems) {
    for (const particle of givenNameParticleSuffixes) {
      needles.push(`${stem}${particle}`);
    }
  }
  return needles;
}

/**
 * 順序付きフィールド部分列の連結が needle を含むか。
 * 間フィールドは飛ばせる。フィールド内は通常の部分一致（途中開始・余剰末尾可）。
 */
function orderedFieldSubsequenceContains(fields: readonly string[], needle: string): boolean {
  if (needle === "") return false;
  let states = new Set<number>([0]);
  for (const field of fields) {
    if (field.includes(needle)) return true;
    const next = new Set(states);
    for (const progress of states) {
      if (progress === 0) {
        for (let index = 0; index < field.length; index += 1) {
          const suffix = field.slice(index);
          if (suffix.startsWith(needle)) return true;
          if (needle.startsWith(suffix)) {
            next.add(suffix.length);
          }
        }
      } else {
        const remaining = needle.slice(progress);
        if (field.startsWith(remaining)) return true;
        if (remaining.startsWith(field)) {
          next.add(progress + field.length);
        }
      }
    }
    states = next;
  }
  return false;
}

function stripGivenNameFoodCompounds(text: string): string {
  let next = text;
  for (const compound of givenNameFoodCompounds) {
    next = next.split(compound).join("");
  }
  return next;
}

/**
 * AP-R3: 3 フィールド以上に分け、間に別テキストを置いても閉じた針を拾う。
 * 正規表現針は見ない。オープン NER にはしない。
 */
export function textsHitClosedShareDenylistPhrases(texts: readonly string[]): boolean {
  const folded = texts.map(foldShareDenylistHaystack).filter((text) => text !== "");
  if (folded.length === 0) return false;
  const bareStemNeedles = new Set<string>(sharePiiGivenNameBareStems);
  for (const needle of listClosedShareDenylistNeedles()) {
    const haystacks = bareStemNeedles.has(needle)
      ? folded.map(stripGivenNameFoodCompounds).filter((text) => text !== "")
      : folded;
    if (orderedFieldSubsequenceContains(haystacks, needle)) return true;
  }
  return false;
}

/**
 * 単一テキストが denylist に触れるか。
 * haystack のみ NFKC + Cf 除去 + 空白/読点/中点削除。針は緩めない。
 */
export function textHitsShareDenylist(text: string): boolean {
  const trimmed = foldShareDenylistHaystack(text);
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
  // AP2: suffix 無し。食品複合を除いた残りに stem があればヒット
  let bareHaystack = trimmed;
  for (const compound of givenNameFoodCompounds) {
    bareHaystack = bareHaystack.split(compound).join("");
  }
  for (const stem of sharePiiGivenNameBareStems) {
    if (bareHaystack.includes(stem)) return true;
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
