// owned 掃除対象にしない。ログアウト後も同じ端末では再案内しない
export const PWA_INSTALL_TIP_DISMISSED_KEY = "kondate:preferences:pwa-install-tip-dismissed";

export function readInstallTipDismissed(storage: Pick<Storage, "getItem">): boolean {
  return storage.getItem(PWA_INSTALL_TIP_DISMISSED_KEY) === "1";
}

export function writeInstallTipDismissed(storage: Pick<Storage, "setItem">): boolean {
  try {
    storage.setItem(PWA_INSTALL_TIP_DISMISSED_KEY, "1");
    return true;
  } catch {
    // 書き込み失敗は呼び出し側がメモリ上 dismissed とみなせるよう false を返す
    return false;
  }
}
