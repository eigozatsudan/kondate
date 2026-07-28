/**
 * 旧 GenerationStatusPanel 向け sessionStorage 補助。
 * 緊急リンクは draft/menu の targetMode を直接見るようになり未使用。
 * キー掃除と import 互換のため残す（書き込みはしない）。
 */
const storageKey = "kondate:generation:targetMode";

export function clearGenerationTargetMode(): void {
  try {
    sessionStorage.removeItem(storageKey);
  } catch {
    // sessionStorage 拒否時は無視
  }
}
