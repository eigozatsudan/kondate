import type { InstallSurface } from "./install-surface";

// AppShell 配下の本体画面のみ。設定は常設節があるので exact に含めない。
const EXACT_INSTALL_TIP_PATHS = new Set([
  "/planner",
  "/generation",
  "/pantry",
  "/history",
  "/shopping",
  "/plus",
]);

function isInstallTipPath(pathname: string): boolean {
  if (EXACT_INSTALL_TIP_PATHS.has(pathname)) return true;
  // /emergency-menus は exact も子 path も出す。/menus と /history は子だけ
  return (
    pathname.startsWith("/menus/") ||
    pathname.startsWith("/history/") ||
    pathname.startsWith("/emergency-menus")
  );
}

export function shouldShowInstallTip(input: {
  hasSession: boolean;
  pathname: string;
  surface: InstallSurface;
  standalone: boolean;
  dismissed: boolean;
  safariStepsOk: boolean;
}): boolean {
  // iOS 非 Safari もカードを出す。Safari 3 手順は出さず generic 本文（presentation）。
  // safariStepsOk は手順可否だけで、surface ゲートには使わない。
  const surfaceOk = input.surface === "android" || input.surface === "ios";
  return (
    input.hasSession &&
    !input.standalone &&
    !input.dismissed &&
    surfaceOk &&
    isInstallTipPath(input.pathname)
  );
}
