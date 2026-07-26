import type { TargetMode } from "@shared/contracts/planner";

/** 生成画面の RecoveryLinks 用。pending wire に targetMode が無いための短寿命補助。 */
const storageKey = "kondate:generation:targetMode";

export function saveGenerationTargetMode(mode: TargetMode): void {
  try {
    sessionStorage.setItem(storageKey, mode);
  } catch {
    // sessionStorage 拒否時は panel が mode 無しで緊急リンクを出す（fail-open UI）
  }
}

export function readGenerationTargetMode(): TargetMode | undefined {
  try {
    const value = sessionStorage.getItem(storageKey);
    if (value === "idea" || value === "household") return value;
    return undefined;
  } catch {
    return undefined;
  }
}
