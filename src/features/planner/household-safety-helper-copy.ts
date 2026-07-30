/**
 * household 確認・constraint_conflict で共有する固定補助文。
 * 選択メンバーのみが安全条件の正本であること（未選択家族は効かない）を時制中立で示す。
 * CurrentSafetySummary 本体には埋め込まず、呼び出し側で sibling として配置する。
 */
export const HOUSEHOLD_SELECTED_SAFETY_HELPER_COPY =
  "献立には今回選んだ家族の条件だけが使われます。" as const;
