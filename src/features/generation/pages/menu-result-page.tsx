import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo } from "react";
// useMemo は queryKey 安定化と actions 生成の両方で使う
import { Link, Navigate, useParams } from "react-router";
import { z } from "zod";
import { useAuth } from "@/features/auth/use-auth";
import {
  createPantryItem,
  deletePantryItem,
  pantryKeys,
  updatePantryItem,
} from "@/features/pantry/pantry-api";
import { getBrowserSupabaseClient } from "@/shared/lib/supabase";
import { confirmLabelConfirmation } from "../api/confirm-label-api";
import { getMenuResult } from "../api/menu-result-api";
import { MenuResult, type MenuResultActions } from "../components/menu-result";
import { clearPendingGeneration } from "../model/pending-generation";

export function MenuResultPage() {
  const auth = useAuth();
  const userId = auth.session?.user.id;
  const queryClient = useQueryClient();
  const parsed = z.uuid().safeParse(useParams().menuId);
  const menuId = parsed.success ? parsed.data : null;
  const queryKey = useMemo(
    () => ["menu-result", userId ?? "missing", menuId ?? "invalid"] as const,
    [menuId, userId],
  );
  const query = useQuery({
    queryKey,
    queryFn: () => getMenuResult(menuId ?? "invalid"),
    enabled: menuId !== null && auth.status === "authenticated" && userId !== undefined,
    staleTime: 30_000,
  });
  useEffect(() => {
    if (query.data) clearPendingGeneration();
  }, [query.data]);

  const actions = useMemo((): MenuResultActions | undefined => {
    if (userId === undefined || menuId === null) return undefined;
    const client = getBrowserSupabaseClient();
    return {
      menuId,
      userId,
      onConfirmLabel: async (confirmationId, expectedSafetyFingerprint) => {
        await confirmLabelConfirmation(menuId, confirmationId, expectedSafetyFingerprint);
        await queryClient.invalidateQueries({ queryKey });
      },
      onDeletePantry: async (row) => {
        await deletePantryItem(client, userId, row.id, row.updatedAt);
        await queryClient.invalidateQueries({ queryKey: pantryKeys.list(userId) });
      },
      onUpdatePantry: async (row, input) => {
        await updatePantryItem(client, userId, row.id, row.updatedAt, input);
        await queryClient.invalidateQueries({ queryKey: pantryKeys.list(userId) });
      },
      onCreatePantry: async (input) => {
        await createPantryItem(client, userId, input);
        await queryClient.invalidateQueries({ queryKey: pantryKeys.list(userId) });
      },
      onRefetchResult: async () => {
        await queryClient.invalidateQueries({ queryKey });
      },
    };
  }, [menuId, queryClient, queryKey, userId]);

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
  return actions === undefined ? (
    <MenuResult result={query.data} />
  ) : (
    <MenuResult result={query.data} actions={actions} />
  );
}
