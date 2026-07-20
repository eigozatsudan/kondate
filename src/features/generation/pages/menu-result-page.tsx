import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { Link, Navigate, useParams } from "react-router";
import { z } from "zod";
import { useAuth } from "@/features/auth/use-auth";
import { getMenuResult } from "../api/menu-result-api";
import { MenuResult } from "../components/menu-result";
import { clearPendingGeneration } from "../model/pending-generation";

export function MenuResultPage() {
  const auth = useAuth();
  const userId = auth.session?.user.id;
  const parsed = z.uuid().safeParse(useParams().menuId);
  const query = useQuery({
    queryKey: ["menu-result", userId ?? "missing", parsed.success ? parsed.data : "invalid"],
    queryFn: () => getMenuResult(parsed.success ? parsed.data : "invalid"),
    enabled: parsed.success && auth.status === "authenticated" && userId !== undefined,
    staleTime: 30_000,
  });
  useEffect(() => {
    if (query.data) clearPendingGeneration();
  }, [query.data]);
  if (!parsed.success) return <Navigate to="/planner" replace />;
  if (query.isPending)
    return (
      <p role="status" className="p-4">
        献立を読み込んでいます
      </p>
    );
  if (query.isError)
    return (
      <main className="p-4">
        <h1>献立を表示できません</h1>
        <p>履歴からもう一度確認してください。</p>
        <Link
          to="/history"
          className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg px-3 font-semibold"
        >
          履歴を見る
        </Link>
      </main>
    );
  return <MenuResult result={query.data} />;
}
