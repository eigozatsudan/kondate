// B-3 修正（C-1/I-1）: planner から開いた /generation の履歴エントリを覚える。
//
// GenerationPage は idle になると戻り先へ <Navigate replace> する。/planner から push で
// 開いた /generation の場合、結果（/menus/:id）から端末の戻るで /generation へ戻ると
// その entry が /planner に置き換わり、履歴に /planner が 2 つ並ぶ。次の戻るは同じ
// /planner へ戻るだけで画面が変わらない「空の戻る」になる。
// そこで planner が /generation へ push する直前に印を付け、GenerationPage が mount 時に
// 自分の location.key と結び付けて覚える。idle のときその entry なら置き換えではなく
// 1 つ戻る（直前の planner entry へ戻る）ことで、/planner の重複を作らない。
//
// sessionStorage はタブ単位で、location.key は再読み込み後も同じ履歴 entry では変わらない。
// 中身は固定の印と location.key だけ（個人情報は持たない）。prefix は kondate:generation:
// なのでログアウト時の掃除（auth-cleanup）の対象に入る。

const HANDOFF_KEY = "kondate:generation:planner-handoff:v1";
const ENTRY_KEY = "kondate:generation:planner-entry:v1";
// 印を付けてから /generation の mount までの猶予。leave flush を待つ経路もあるため少し長めにする。
// これより古い印は、遷移しなかった（flush 失敗など）残りとみなして使わない。
const HANDOFF_TTL_MS = 30_000;

/** planner が /generation へ push する直前に呼ぶ。 */
export function markGenerationOpenedFromPlanner(now: number = Date.now()): void {
  try {
    sessionStorage.setItem(HANDOFF_KEY, String(now));
  } catch {
    // 保存できないときは従来どおり置き換えで戻る
  }
}

/** GenerationPage の mount 時に呼ぶ。印があればこの entry を planner 由来として覚える。 */
export function claimGenerationPlannerEntry(locationKey: string, now: number = Date.now()): void {
  try {
    const marked = sessionStorage.getItem(HANDOFF_KEY);
    if (marked === null) return;
    sessionStorage.removeItem(HANDOFF_KEY);
    const markedAt = Number(marked);
    if (!Number.isFinite(markedAt) || now - markedAt < 0 || now - markedAt > HANDOFF_TTL_MS) {
      return;
    }
    sessionStorage.setItem(ENTRY_KEY, locationKey);
  } catch {
    // 読めないときは覚えない（従来どおり置き換え）
  }
}

/** この /generation entry が planner から push されたものか。 */
export function isGenerationPlannerEntry(locationKey: string): boolean {
  try {
    return sessionStorage.getItem(ENTRY_KEY) === locationKey;
  } catch {
    return false;
  }
}
