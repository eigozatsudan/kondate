import { PWA_INSTALL_TIP_DISMISSED_KEY } from "../../src/features/pwa/install-tip-storage";

// context 優先。ドキュメント作成前にキーを書く。page.evaluate(setItem) は正本にしない。
export async function seedPwaInstallTipDismissed(target: {
  // Playwright の addInitScript は Promise<Disposable> を返す。void 専用だと context が代入できない。
  addInitScript(script: (key: string) => void, arg: string): Promise<unknown>;
}): Promise<void> {
  await target.addInitScript((key) => {
    window.localStorage.setItem(key, "1");
  }, PWA_INSTALL_TIP_DISMISSED_KEY);
}
