import { NavLink, Outlet } from "react-router";

const items = [
  { to: "/planner", label: "献立" },
  { to: "/pantry", label: "冷蔵庫" },
  { to: "/history", label: "履歴" },
  { to: "/shopping", label: "買い物" },
  { to: "/settings", label: "設定" },
] as const;

export function AppShell() {
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
