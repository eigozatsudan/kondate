import { Link, NavLink, Outlet } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { apiGet, getStoredToken, setStoredToken } from "../api/client";

type HealthData = {
  status: "up" | "degraded";
  dbReady: boolean;
  connectionHost: string | null;
  sessionUser: string | null;
};

const nav = [
  { to: "/", label: "ダッシュボード", end: true },
  { to: "/generations", label: "生成ログ" },
  { to: "/feedback", label: "不具合・要望" },
  { to: "/quota-health", label: "利用枠" },
  { to: "/billing", label: "課金" },
  { to: "/share-jobs", label: "共有ジョブ" },
];

export function Layout() {
  const [tokenDraft, setTokenDraft] = useState(getStoredToken);
  const health = useQuery({
    queryKey: ["health"],
    queryFn: () => apiGet<HealthData>("/api/health"),
    refetchInterval: 60_000,
  });

  return (
    <div className="min-h-screen">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-3 px-4 py-3">
          <Link to="/" className="text-lg font-bold text-slate-900">
            こんだて日和 運用コンソール
          </Link>
          <span className="rounded bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-900">
            本番・閲覧のみ
          </span>
          <div className="ml-auto flex flex-wrap items-center gap-3 text-xs text-slate-600">
            <span>
              接続:{" "}
              <span className="mono text-slate-800">
                {health.data?.connectionHost ?? "—"}
              </span>
            </span>
            <span>
              session_user:{" "}
              <span className="mono text-slate-800">
                {health.data?.sessionUser ?? "—"}
              </span>
            </span>
            <span>
              DB: {health.data?.dbReady ? "接続可" : health.isError ? "不明" : "未確認"}
            </span>
          </div>
        </div>
        <p className="mx-auto max-w-7xl px-4 pb-2 text-xs text-red-700">
          注意: 共有 PC では起動しないでください。DB
          秘密・フィードバック本文・UUID 以外の識別子をログやチャットに貼らないでください。
        </p>
        <nav className="mx-auto flex max-w-7xl gap-1 overflow-x-auto px-4 pb-2">
          {nav.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                `rounded px-3 py-1.5 text-sm ${
                  isActive
                    ? "bg-slate-900 text-white"
                    : "text-slate-700 hover:bg-slate-100"
                }`
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="mx-auto flex max-w-7xl flex-wrap items-end gap-2 px-4 pb-3">
          <label className="flex flex-col gap-1 text-xs text-slate-600">
            API トークン（sessionStorage・任意）
            <input
              type="password"
              className="w-64 rounded border border-slate-300 px-2 py-1 text-sm"
              value={tokenDraft}
              onChange={(e) => setTokenDraft(e.target.value)}
              placeholder="ADMIN_LOCAL_TOKEN"
              autoComplete="off"
            />
          </label>
          <button
            type="button"
            className="rounded bg-slate-800 px-3 py-1.5 text-sm text-white hover:bg-slate-700"
            onClick={() => {
              setStoredToken(tokenDraft.trim());
              void health.refetch();
            }}
          >
            保存
          </button>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-4 py-6">
        <Outlet />
      </main>
    </div>
  );
}
