import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { Link, Navigate, useNavigate, useParams } from "react-router";
import { z } from "zod";
import {
  createShoppingListRequestSchema,
  reconcileShoppingListRequestSchema,
  type CreateShoppingListRequest,
  type ReconcileShoppingListRequest,
  type ShoppingDiff,
} from "@shared/contracts/shopping";
import { InlineNotice } from "@/shared/ui/wizard/inline-notice";
import { useAuth } from "@/features/auth/use-auth";
import {
  isRevalidationActionable,
  type RevalidationResult,
} from "@/features/history/api/revalidation-api";
import {
  RegenerationSheet,
  type RegenerationReasonInput,
} from "@/features/history/components/regeneration-sheet";
import {
  useMenuRevalidation,
  type RevalidationPhaseName,
} from "@/features/history/hooks/use-menu-revalidation";
import { useAcceptMenuVersion } from "@/features/history/hooks/use-history";
import { useRegeneration } from "@/features/history/hooks/use-regeneration";
import {
  createPantryItem,
  deletePantryItem,
  pantryKeys,
  updatePantryItem,
} from "@/features/pantry/pantry-api";
import {
  clearShoppingCommand,
  fetchReconcilableMenuSource,
  persistedShoppingCommand,
  previewShoppingDiff,
} from "@/features/shopping/api/shopping-api";
import { CreateListSheet } from "@/features/shopping/components/create-list-sheet";
import { ReconcileListSheet } from "@/features/shopping/components/reconcile-list-sheet";
import {
  shoppingKeys,
  useCreateShoppingList,
  useReconcileShoppingList,
  useResumeShoppingCommand,
  useShoppingList,
  useShoppingSafetyGate,
} from "@/features/shopping/hooks/use-shopping-list";
import { getBrowserSupabaseClient } from "@/shared/lib/supabase";
import { confirmLabelConfirmation } from "../api/confirm-label-api";
import { getMenuResult } from "../api/menu-result-api";
import type { MenuResultViewModel } from "@shared/contracts/menu-result";
import { MenuResult, type MenuResultActions } from "../components/menu-result";
import { useUsageToday } from "../hooks/use-usage-today";
import { clearPendingGeneration } from "../model/pending-generation";

const DISCLAIMER =
  "加工品はラベル確認が必要です。AI生成レシピだけでアレルギー対応を保証するものではありません。";

export type MenuResultPageRevalidationView = {
  phase: RevalidationPhaseName;
  result?: RevalidationResult;
  errorMessage?: string;
  refetch?: () => void;
  /** stale confirm 失敗時などに同期的にゲートを閉じる */
  beginRecheck?: () => void;
};

type MenuResultPageProps = {
  /** テスト注入用。省略時は useMenuRevalidation を使う。 */
  revalidation?: MenuResultPageRevalidationView;
};

export function MenuResultPage({ revalidation: injected }: MenuResultPageProps = {}) {
  const auth = useAuth();
  const userId = auth.session?.user.id;
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

  if (!parsed.success) return <Navigate to="/planner" replace />;
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
  // 献立読み込み中でも操作バー枠は出さず、中立ステータスのみ
  if (query.isPending)
    return (
      <p role="status" className="p-4">
        献立を読み込んでいます
      </p>
    );

  // targetMode をUI分岐の唯一の判定元とし、conditional hook呼び出しではなく
  // household/idea それぞれ専用のchild componentへ分岐する（brief step 11）。
  // household専用のuseMenuRevalidation・買い物hook・pending replayはidea側では
  // 一切importされたhookを呼ばない構造にするため、component自体を分ける。
  if (query.data.targetMode === "idea") {
    return <IdeaResultBody result={query.data} />;
  }
  return (
    <HouseholdResultBody
      result={query.data}
      menuId={menuId}
      userId={userId}
      queryKey={queryKey}
      {...(injected !== undefined ? { injectedRevalidation: injected } : {})}
    />
  );
}

/**
 * idea結果の本文。家族安全再検証・買い物・冷蔵庫関連のhookを一切mountしない。
 * 常時noticeと献立本文（recipe）だけを表示する。
 */
function IdeaResultBody({ result }: { result: MenuResultViewModel }) {
  return (
    <div className="guided-planner-theme mx-auto w-full max-w-full overflow-x-hidden break-words px-4 pb-28 pt-6 text-stone-900 sm:max-w-3xl">
      <p className="rounded-xl border border-amber-700 p-3 font-semibold">{DISCLAIMER}</p>
      <InlineNotice tone="notice" title="この献立はアイデアとして作成しました">
        <p>家族条件を使用していません</p>
        <p>年齢・アレルギーへの適合は確認されていません</p>
      </InlineNotice>
      <MenuResult result={result} mode="idea" />
    </div>
  );
}

type HouseholdResultBodyProps = {
  result: MenuResultViewModel;
  menuId: string | null;
  userId: string | undefined;
  queryKey: readonly ["menu-result", string, string];
  injectedRevalidation?: MenuResultPageRevalidationView;
};

/**
 * household結果の本文。既存の家族安全再検証・買い物・冷蔵庫連携をすべて維持する。
 * Step 10までの実装をそのままこのcomponentへ移した（表示分岐のみをPageへ委譲）。
 */
function HouseholdResultBody({
  result,
  menuId,
  userId,
  queryKey,
  injectedRevalidation,
}: HouseholdResultBodyProps) {
  const queryClient = useQueryClient();
  const live = useMenuRevalidation(menuId ?? "");
  const beginRecheck = live.beginRecheck;
  const liveView: MenuResultPageRevalidationView = {
    phase: live.phase,
    ...(live.result !== undefined ? { result: live.result } : {}),
    ...(live.errorMessage !== undefined ? { errorMessage: live.errorMessage } : {}),
    refetch: () => {
      void live.refetch();
    },
    beginRecheck,
  };
  const revalidation = injectedRevalidation ?? liveView;

  const usage = useUsageToday(userId ?? "");
  const remaining = usage.data?.success.remaining ?? 0;
  const regeneration = useRegeneration({
    menuId: menuId ?? "00000000-0000-4000-8000-000000000000",
    phase: revalidation.phase,
    result: revalidation.result,
  });
  // 履歴詳細と同じ「これに決めた」採用。再生成結果画面からもバージョンを確定できる。
  const accept = useAcceptMenuVersion();
  const [sheetMode, setSheetMode] = useState<"whole" | "dish" | null>(null);
  const [selectedDishId, setSelectedDishId] = useState<string | null>(null);
  const [fridgeOpen, setFridgeOpen] = useState(false);

  const actionsEnabled =
    revalidation.phase === "checked" &&
    revalidation.result !== undefined &&
    isRevalidationActionable(revalidation.result);

  // 買い物リスト側の現行安全ゲート。献立側の再検証と両方が通るまで
  // create / reconcile のコマンドは組み立てない。
  const navigate = useNavigate();
  const shoppingList = useShoppingList();
  const shoppingGate = useShoppingSafetyGate();
  const createList = useCreateShoppingList();
  const reconcileList = useReconcileShoppingList();
  const [shoppingSheet, setShoppingSheet] = useState<"create" | "reconcile" | null>(null);
  const [shoppingDiff, setShoppingDiff] = useState<ShoppingDiff | null>(null);
  const [shoppingError, setShoppingError] = useState<string | null>(null);
  const activeList = shoppingList.data ?? null;
  const shoppingBlocked =
    !actionsEnabled ||
    shoppingGate.blocked ||
    shoppingList.isFetching ||
    !shoppingList.isSuccess ||
    menuId === null;

  const reconcileTarget = useQuery({
    queryKey: ["shopping", "reconcile-target", menuId ?? "invalid", activeList?.id ?? "none"],
    queryFn: () => fetchReconcilableMenuSource(menuId ?? "invalid", activeList?.id ?? "none"),
    enabled: menuId !== null && activeList !== null && actionsEnabled,
    staleTime: 30_000,
  });

  const finishShoppingCommand = async (kind: "create" | "reconcile", targetId: string) => {
    await queryClient.invalidateQueries({ queryKey: shoppingKeys.active });
    // 反映後は「古い版を取り込んでいるか」の判定も作り直す（staleTime のあいだ
    // 反映済みリストに対して差分を出さないため）。
    await queryClient.invalidateQueries({ queryKey: ["shopping", "reconcile-target"] });
    clearShoppingCommand(kind, targetId);
    setShoppingSheet(null);
    setShoppingDiff(null);
  };
  const failShoppingCommand = (kind: "create" | "reconcile", targetId: string, error: unknown) => {
    // code 付き（HTTP/ドメイン）失敗は自動再送しない。記録を捨てて承認をやり直す。
    if (error instanceof Error && "code" in error) {
      clearShoppingCommand(kind, targetId);
      void queryClient.invalidateQueries({ queryKey: shoppingKeys.active });
      void queryClient.invalidateQueries({ queryKey });
      setShoppingSheet(null);
      setShoppingDiff(null);
      setShoppingError("買い物リストの状態が変わりました。もう一度確認してください");
      return;
    }
    setShoppingError("買い物リストを更新できませんでした。通信が戻ると自動で送り直します");
  };

  const submitCreate = async (command: CreateShoppingListRequest) => {
    try {
      await createList.mutateAsync(command);
      await finishShoppingCommand("create", command.menuId);
      void navigate("/shopping");
    } catch (error) {
      failShoppingCommand("create", command.menuId, error);
    }
  };
  const submitReconcile = async (listId: string, command: ReconcileShoppingListRequest) => {
    try {
      await reconcileList.mutateAsync({ listId, input: command });
      await finishShoppingCommand("reconcile", listId);
      // 作成時と同じく反映後は買い物リストへ移る（E2E・再送完了の到達点を揃える）
      void navigate("/shopping");
    } catch (error) {
      failShoppingCommand("reconcile", listId, error);
    }
  };

  // 応答を取り逃した送信は、再読込・復帰・オンライン復帰で同じバイト列のまま再送する。
  useResumeShoppingCommand({
    kind: "create",
    targetId: menuId,
    schema: createShoppingListRequestSchema,
    submit: submitCreate,
  });
  useResumeShoppingCommand({
    kind: "reconcile",
    targetId: activeList?.id ?? null,
    schema: reconcileShoppingListRequestSchema,
    submit: (command: ReconcileShoppingListRequest) =>
      submitReconcile(activeList?.id ?? "", command),
  });

  const firstDishId = result.menu.dishes[0]?.id ?? null;
  const dishIdForRegen = selectedDishId ?? firstDishId;

  const actions = useMemo((): MenuResultActions | undefined => {
    if (userId === undefined || menuId === null || revalidation.result === undefined) {
      return undefined;
    }
    const client = getBrowserSupabaseClient();
    const safetyFingerprint = revalidation.result.safetyFingerprint;
    return {
      menuId,
      userId,
      onConfirmLabel: async (confirmationId, expectedSafetyFingerprint) => {
        try {
          // ゲートが渡した fingerprint を優先し、呼び出し引数と一致させる
          await confirmLabelConfirmation(
            menuId,
            confirmationId,
            expectedSafetyFingerprint || safetyFingerprint,
          );
          await queryClient.invalidateQueries({ queryKey });
          // 成功後も fingerprint が変わり得るため再検証する（飛行中は checking）
          beginRecheck();
        } catch (error) {
          // stale / archived は閉じた not-found。invalidate を待たず同期的にゲートを閉じる
          beginRecheck();
          throw error;
        }
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
  }, [beginRecheck, menuId, queryClient, queryKey, revalidation.result, userId]);

  const onSubmitReason = async (value: RegenerationReasonInput) => {
    if (sheetMode === "dish") {
      if (dishIdForRegen === null) return;
      await regeneration.startDish(dishIdForRegen, value);
    } else {
      await regeneration.startWhole(value);
    }
    setSheetMode(null);
  };

  const statusCopy =
    revalidation.phase === "checking"
      ? "現在の家族設定で確認しています"
      : revalidation.phase === "error"
        ? (revalidation.errorMessage ?? "確認できませんでした")
        : revalidation.result?.status === "changed"
          ? "現在の家族設定で確認しました。作成時から条件が変わっています"
          : revalidation.result?.status === "valid"
            ? "現在の家族設定で確認しました"
            : null;

  return (
    <div className="guided-planner-theme mx-auto w-full max-w-full overflow-x-hidden break-words px-4 pb-28 pt-6 text-stone-900 sm:max-w-3xl">
      <p className="rounded-xl border border-amber-700 p-3 font-semibold">{DISCLAIMER}</p>

      {revalidation.phase === "checking" && (
        <p role="status" className="mt-4">
          現在の家族設定で確認しています
        </p>
      )}

      {revalidation.phase === "error" && (
        <div className="mt-4 stack gap-2">
          <p role="alert">{statusCopy}</p>
          <button
            type="button"
            className="min-h-11 rounded-lg border-2 border-stone-800 px-4 font-semibold"
            onClick={() => {
              revalidation.refetch?.();
            }}
          >
            もう一度確認
          </button>
        </div>
      )}

      {revalidation.phase === "checked" && revalidation.result?.status === "invalid" && (
        <div className="mt-4 stack gap-2" role="alert">
          <p>現在の家族設定ではこの献立を利用できません</p>
          <ul className="list-disc pl-5">
            {revalidation.result.issues.map((issue) => (
              <li key={`${issue.code}:${issue.path}`}>{issue.message}</li>
            ))}
          </ul>
        </div>
      )}

      {actionsEnabled && revalidation.result !== undefined && (
        <>
          <p className="mt-4" role="status">
            {statusCopy}
          </p>
          {actions === undefined ? (
            <MenuResult
              result={result}
              mode="household"
              currentLabelWarnings={revalidation.result.currentLabelWarnings}
              currentSafetyFingerprint={revalidation.result.safetyFingerprint}
              onSelectedDishChange={setSelectedDishId}
            />
          ) : (
            <MenuResult
              result={result}
              mode="household"
              actions={actions}
              currentLabelWarnings={revalidation.result.currentLabelWarnings}
              currentSafetyFingerprint={revalidation.result.safetyFingerprint}
              onSelectedDishChange={setSelectedDishId}
            />
          )}
          {fridgeOpen && (
            <p className="mt-2 text-sm text-stone-700">
              調理後の冷蔵庫操作は献立本文の「調理後の冷蔵庫」から行えます。
            </p>
          )}
        </>
      )}

      <div className="mt-6 flex flex-wrap gap-2">
        <button
          type="button"
          className="min-h-11 min-w-11 rounded-lg border-2 border-stone-800 px-4 font-semibold"
          disabled={!actionsEnabled}
          onClick={() => {
            setSheetMode("whole");
          }}
        >
          献立をまるごと別案にする
        </button>
        <button
          type="button"
          className="min-h-11 min-w-11 rounded-lg border-2 border-stone-800 px-4 font-semibold"
          disabled={!actionsEnabled || dishIdForRegen === null}
          onClick={() => {
            setSheetMode("dish");
          }}
        >
          この一品だけ別案にする
        </button>
        <button
          type="button"
          className="min-h-11 min-w-11 rounded-lg border-2 border-stone-800 px-4 font-semibold"
          disabled={shoppingBlocked || createList.isPending}
          onClick={() => {
            setShoppingError(null);
            setShoppingSheet("create");
          }}
        >
          買い物リストを作る
        </button>
        {reconcileTarget.data !== null && reconcileTarget.data !== undefined && (
          <button
            type="button"
            className="min-h-11 min-w-11 rounded-lg border-2 border-stone-800 px-4 font-semibold"
            disabled={shoppingBlocked || reconcileList.isPending}
            onClick={() => {
              const target = reconcileTarget.data;
              if (activeList === null || menuId === null || target === null) return;
              setShoppingError(null);
              // 表示専用のプレビュー。反映内容はサーバーが必ず計算し直す。
              previewShoppingDiff(menuId, target.sourceMenuVersion, activeList)
                .then((diff) => {
                  setShoppingDiff(diff);
                  setShoppingSheet("reconcile");
                })
                .catch(() => {
                  setShoppingError("差分を確認できませんでした");
                });
            }}
          >
            買い物リストとの差分を確認
          </button>
        )}
        <button
          type="button"
          className="min-h-11 min-w-11 rounded-lg border-2 border-stone-800 px-4 font-semibold"
          disabled={!actionsEnabled}
          onClick={() => {
            setFridgeOpen(true);
          }}
        >
          冷蔵庫へ反映
        </button>
        <button
          type="button"
          className="min-h-11 min-w-11 rounded-lg bg-terracotta-700 px-4 font-semibold text-white"
          disabled={!actionsEnabled || accept.isPending || menuId === null}
          onClick={() => {
            if (menuId === null) return;
            accept.mutate(menuId);
          }}
        >
          これに決めた
        </button>
      </div>

      {shoppingError !== null && (
        <p role="alert" className="mt-4">
          {shoppingError}
        </p>
      )}

      {shoppingSheet === "create" && menuId !== null && (
        <CreateListSheet
          activeList={
            activeList === null
              ? null
              : {
                  id: activeList.id,
                  version: activeList.version,
                  itemCount: activeList.items.length,
                }
          }
          pending={createList.isPending}
          safetyBlocked={shoppingBlocked}
          onSubmit={(input) => {
            if (shoppingBlocked) return;
            const command = persistedShoppingCommand(
              "create",
              menuId,
              createShoppingListRequestSchema,
              (idempotencyKey) => ({
                menuId,
                mode: input.mode,
                activeListId: input.mode === "append" ? input.activeListId : null,
                expectedListVersion: input.mode === "append" ? input.expectedListVersion : null,
                idempotencyKey,
              }),
            );
            void submitCreate(command);
          }}
          onCancel={() => {
            setShoppingSheet(null);
          }}
        />
      )}

      {shoppingSheet === "reconcile" &&
        shoppingDiff !== null &&
        activeList !== null &&
        menuId !== null &&
        reconcileTarget.data !== null &&
        reconcileTarget.data !== undefined && (
          <ReconcileListSheet
            diff={shoppingDiff}
            pending={reconcileList.isPending}
            safetyBlocked={shoppingBlocked}
            onApply={(approval) => {
              const target = reconcileTarget.data;
              if (shoppingBlocked || target === null) return;
              const listId = activeList.id;
              const command = persistedShoppingCommand(
                "reconcile",
                listId,
                reconcileShoppingListRequestSchema,
                (idempotencyKey) => ({
                  expectedListVersion: activeList.version,
                  sourceMenuId: menuId,
                  sourceMenuVersion: target.sourceMenuVersion,
                  idempotencyKey,
                  // 承認はキーとIDだけを運ぶ。解決済みの値はブラウザから送らない。
                  approval,
                }),
              );
              void submitReconcile(listId, command);
            }}
            onCancel={() => {
              setShoppingSheet(null);
              setShoppingDiff(null);
            }}
          />
        )}

      {sheetMode !== null && (
        <section
          className="mt-6 rounded-2xl border bg-white p-4 shadow-sm"
          aria-label="再生成の理由"
        >
          <RegenerationSheet
            remaining={remaining}
            onSubmit={onSubmitReason}
            onCancel={() => {
              setSheetMode(null);
            }}
          />
        </section>
      )}
    </div>
  );
}
