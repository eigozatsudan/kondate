import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { Navigate, useParams } from "react-router";
import { z } from "zod";
import { getMenuResult } from "../api/menu-result-api";
import { MenuResult } from "../components/menu-result";
import { clearPendingGeneration } from "../model/pending-generation";

export function MenuResultPage() {
  const parsed = z.uuid().safeParse(useParams().menuId);
  const query = useQuery({
    queryKey: ["menu-result", parsed.success ? parsed.data : "invalid"],
    queryFn: () => getMenuResult(parsed.success ? parsed.data : "invalid"),
    enabled: parsed.success,
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
        <a href="/history">履歴を見る</a>
      </main>
    );
  return <MenuResult result={query.data} />;
}
