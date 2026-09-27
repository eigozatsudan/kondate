/**
 * 手間軸（effortPreference=easy）の prompt 専用ヒント。
 * fail-open・prompt 専用。fingerprint / quota / 検証には載せない。
 * novelty-hints.ts と同型。日次（生成・再生成）と週献立で共用する。
 */
import type { EffortPreference } from "../../../shared/contracts/planner.js";

export const EFFORT_HINTS_ENABLED = true as const;
export const EFFORT_SYSTEM_MARKER = "【手間】" as const;

/** 避ける料理の列挙。日次の段落と週献立の 1 文で共用し、両者の範囲を揃える */
const EFFORT_AVOID_EXAMPLES =
  "揚げ物（揚げ焼きを含む）、蒸し物、長時間の煮込み、オーブン料理、" +
  "生地や衣から作る料理、包む・巻く・詰めるなどの成形工程が多い料理";

/** system 文の手間段落。先頭マーカーでテスト・運用識別する */
export const EFFORT_PARAGRAPH =
  EFFORT_SYSTEM_MARKER +
  "preferences.effortPreferenceがeasyのため、主菜・副菜・汁物・主食のすべてで手間のかかる料理を避けてください。" +
  `避ける例: ${EFFORT_AVOID_EXAMPLES}。` +
  "料理の選択では本段落が【家庭キッチン】より優先します。" +
  "蒸し物は、ふた付きフライパンや電子レンジで蒸す手順に置き換えるのではなく、蒸し物そのものを選ばないでください。" +
  "【ひねり】で別の加熱法や組み合わせを選ぶ場合も、避ける例の調理法は選ばないでください。" +
  "焼く・炒める・短時間で煮る・和える・電子レンジで済む料理に寄せてください。" +
  "preferences.mainIngredients、使い切りに選ばれた食材、memoの指示は本段落より優先します。" +
  "それらの食材は必ず使い、そのうえで手順が簡単な料理にしてください。" +
  "安全条件・アレルギー、安全のための下処理（十分な加熱など）が常に優先です。" +
  "寄せきれなくてもoutcome=successで構いません。手間の方針だけではconstraint_conflictにしないでください。";

/** 週献立の system 文へ足す 1 文。週献立の出力は主菜だけなので主菜に限る */
export const WEEKLY_EFFORT_SENTENCE =
  "preferences.effortPreferenceがeasyのため、7日分の主菜で手間のかかる料理を避けてください。" +
  `避ける例: ${EFFORT_AVOID_EXAMPLES}。` +
  "安全条件・アレルギーと十分な加熱が常に優先です。" +
  "寄せきれなくても7日分の出力を続けてください。";

/**
 * easy かつ kill-switch on のときだけ段落と payload 値を載せる。
 * flag は呼び出し側が import した EFFORT_HINTS_ENABLED を渡す（taste-hints の isTasteHintsEnabled と同型）。
 * このモジュール内で定数を直接読むと、*-off テストの vi.mock が効かない。
 * `true as const` を条件へ直接置くと lint が死枝扱いするため boolean 引数で広げる意味もある。
 */
export function shouldIncludeEffortHints(
  flag: boolean,
  effortPreference: EffortPreference | null,
): boolean {
  return flag && effortPreference === "easy";
}
