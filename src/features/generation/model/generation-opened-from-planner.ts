/**
 * planner が /generation を push するとき、その entry に付ける location.state。
 *
 * 「この /generation の 1 つ前の entry は /planner」という印を、sessionStorage などではなく
 * 履歴の entry そのものに持たせる。GenerationPage は idle になったとき、戻り先が素の /planner で
 * この印があれば、`<Navigate replace>` で /planner を 2 つ並べる代わりに 1 つ戻る
 * （生成・結果から戻ったあとの空の戻るを無くすため）。
 * - 印は entry ごとなので、別タブや古い印が別の遷移に紛れ込まない。
 * - URL に出ないので、共有や再読み込みで意味が変わらない（再読み込みでは entry の state が残る）。
 * - 印が無い /generation（直接開いた・再生成から来た）は従来どおり置き換える。
 */
export const GENERATION_OPENED_FROM_PLANNER_STATE = { generationOpenedFrom: "planner" } as const;

/** navigate(to, options) にそのまま渡す形 */
export const GENERATION_OPENED_FROM_PLANNER_NAVIGATE_OPTIONS = {
  state: GENERATION_OPENED_FROM_PLANNER_STATE,
} as const;

export function isGenerationOpenedFromPlanner(state: unknown): boolean {
  return (
    typeof state === "object" &&
    state !== null &&
    "generationOpenedFrom" in state &&
    state.generationOpenedFrom === GENERATION_OPENED_FROM_PLANNER_STATE.generationOpenedFrom
  );
}
