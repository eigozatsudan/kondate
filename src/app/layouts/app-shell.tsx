import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { NavLink, Outlet, useLocation } from "react-router";
import { useAuth } from "@/features/auth/use-auth";
import {
  householdSafetyChangedEvent,
  householdSafetyRevisionStorageKey,
  invalidateHouseholdSafetyQueries,
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
  return "other";
}

/** デスクトップ上部バーとナビで共有する表示名。e2e のナビラベル文字列は items 側を正とする。 */
const sectionTitles: Record<string, string> = {
  planner: "献立",
  pantry: "冷蔵庫",
  history: "履歴",
  shopping: "買い物",
  settings: "設定",
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
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="3" />
          <path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4 7 17M17 7l1.4-1.4" />
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
      if (event.key === householdSafetyRevisionStorageKey) invalidate();
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
  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
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
            className={({ isActive }) => (isActive ? "nav-item nav-item-active" : "nav-item")}
          >
            <NavIcon name={item.icon} />
            <span className="nav-item-label">{item.label}</span>
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
