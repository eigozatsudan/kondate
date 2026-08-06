import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { NavLink, Outlet, useLocation } from "react-router";
import { useAuth } from "@/features/auth/use-auth";
import {
  householdSafetyChangedEvent,
  invalidateHouseholdSafetyQueries,
  isHouseholdSafetyRevisionStorageKey,
} from "@/features/household/household-queries";

/** パスから配色セクションを決める。ルーティング定義は変えずに面の色だけを切り替える。 */
function sectionForPath(pathname: string): string {
  if (pathname === "/planner" || pathname === "/generation" || pathname.startsWith("/menus/")) {
    return "planner";
  }
  if (pathname === "/pantry") return "pantry";
  if (pathname === "/history" || pathname.startsWith("/history/")) return "history";
  if (pathname === "/shopping") return "shopping";
  if (pathname === "/settings") return "settings";
  // Plus LP は下タブ非掲載の専用 section（settings に流用しない・R-A2）
  if (pathname === "/plus") return "plus";
  // SHELL-M1: 緊急献立は planner 系統の chrome（生成失敗からの主要導線）
  if (pathname === "/emergency-menus" || pathname.startsWith("/emergency-menus/")) {
    return "planner";
  }
  return "other";
}

/** デスクトップ上部バーとナビで共有する表示名。e2e のナビラベル文字列は items 側を正とする。 */
const sectionTitles: Record<string, string> = {
  planner: "献立",
  pantry: "冷蔵庫",
  history: "履歴",
  shopping: "買い物",
  settings: "設定",
  plus: "Plus",
  other: "こんだて日和",
};

const items = [
  { to: "/planner", label: "献立", icon: "planner" },
  { to: "/pantry", label: "冷蔵庫", icon: "pantry" },
  { to: "/history", label: "履歴", icon: "history" },
  { to: "/shopping", label: "買い物", icon: "shopping" },
  { to: "/settings", label: "設定", icon: "settings" },
] as const;

/** ラベルと併用する装飾アイコン。仕様が禁じるのはアイコン単独の主要操作。 */
function NavIcon({ name }: { name: (typeof items)[number]["icon"] }) {
  const common = {
    className: "nav-item-icon",
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 2,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true as const,
    focusable: false as const,
  };
  switch (name) {
    case "planner":
      return (
        <svg {...common}>
          <path d="M4 7h16" />
          <path d="M4 12h10" />
          <path d="M4 17h14" />
        </svg>
      );
    case "pantry":
      return (
        <svg {...common}>
          <path d="M5 7h14v12H5z" />
          <path d="M9 7V5h6v2" />
        </svg>
      );
    case "history":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="8" />
          <path d="M12 8v5l3 2" />
        </svg>
      );
    case "shopping":
      return (
        <svg {...common}>
          <path d="M6 7h15l-1.5 9h-12z" />
          <path d="M6 7 5 3H2" />
          <circle cx="9" cy="20" r="1" />
          <circle cx="17" cy="20" r="1" />
        </svg>
      );
    case "settings":
      // 歯車。以前の放射状の線は太陽に見えやすかったため、設定として読める形に変える。
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </svg>
      );
  }
}

export function AppShell() {
  const auth = useAuth();
  const queryClient = useQueryClient();
  const location = useLocation();
  const userId = auth.session?.user.id;
  const section = sectionForPath(location.pathname);
  useEffect(() => {
    if (userId === undefined) return undefined;
    const invalidate = () => void invalidateHouseholdSafetyQueries(queryClient, userId);
    const onStorage = (event: StorageEvent) => {
      if (isHouseholdSafetyRevisionStorageKey(event.key)) invalidate();
    };
    window.addEventListener("storage", onStorage);
    window.addEventListener(householdSafetyChangedEvent, invalidate);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener(householdSafetyChangedEvent, invalidate);
    };
  }, [queryClient, userId]);

  // ルート遷移後、ページ h1 へプログラムフォーカスする（Plan 6 Task 5 契約）。
  // 描画後の DOM を対象にするため rAF で1フレーム待つ。既に tabindex がある見出しは尊重し、
  // 無い場合のみ -1 を付与する（キーボード順序に載せない）。
  // L2: 既に dialog / alertdialog 内にフォーカスがあるときは奪わない
  // （pathname 変更直後に開いたモーダルや、ページ側の意図した trap を壊さない）。
  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      const active = document.activeElement;
      if (
        active instanceof Element &&
        active.closest('[role="dialog"], [role="alertdialog"], [aria-modal="true"]')
      ) {
        return;
      }
      const heading = document.querySelector("main h1") ?? document.querySelector("h1");
      if (!(heading instanceof HTMLElement)) return;
      if (!heading.hasAttribute("tabindex")) {
        heading.tabIndex = -1;
      }
      heading.focus({ preventScroll: true });
    });
    return () => {
      window.cancelAnimationFrame(frame);
    };
  }, [location.pathname]);

  return (
    <div className="app-section" data-section={section}>
      {/* 720px 以上のみ表示。ナビラベルは変更せず、現在セクションを細いバーで示す。 */}
      <div className="desktop-section-bar" aria-hidden="true">
        {sectionTitles[section] ?? sectionTitles.other}
      </div>
      <Outlet />
      <nav className="bottom-nav" aria-label="メインメニュー">
        {items.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) => {
              // D-I19 / L6: planner section（generation・menus・emergency）は献立タブを active に
              // sectionForPath の planner chrome と nav active を一致させる
              const sectionActive =
                item.to === "/planner" &&
                (location.pathname === "/generation" ||
                  location.pathname.startsWith("/menus/") ||
                  location.pathname === "/emergency-menus" ||
                  location.pathname.startsWith("/emergency-menus/"));
              const historyChild =
                item.to === "/history" && location.pathname.startsWith("/history/");
              return isActive || sectionActive || historyChild
                ? "nav-item nav-item-active"
                : "nav-item";
            }}
          >
            <NavIcon name={item.icon} />
            <span className="nav-item-label">{item.label}</span>
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
