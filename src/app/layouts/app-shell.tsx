import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { NavLink, Outlet } from "react-router";
import { useAuth } from "@/features/auth/use-auth";
import {
  householdSafetyChangedEvent,
  householdSafetyRevisionStorageKey,
  invalidateHouseholdSafetyQueries,
} from "@/features/household/household-queries";

const items = [
  { to: "/planner", label: "献立" },
  { to: "/pantry", label: "冷蔵庫" },
  { to: "/history", label: "履歴" },
  { to: "/shopping", label: "買い物" },
  { to: "/settings", label: "設定" },
] as const;

export function AppShell() {
  const auth = useAuth();
  const queryClient = useQueryClient();
  const userId = auth.session?.user.id;
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
  return (
    <div>
      <Outlet />
      <nav className="bottom-nav" aria-label="メインメニュー">
        {items.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) => (isActive ? "nav-item nav-item-active" : "nav-item")}
          >
            {item.label}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
