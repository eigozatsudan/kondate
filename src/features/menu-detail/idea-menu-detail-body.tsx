import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router";
import type { MenuResultViewModel } from "@shared/contracts/menu-result";
import { FlyerUpsellBanner } from "@/features/billing/flyer-upsell-banner";
import { IdeaMenuSafetyNotice } from "@/features/generation/components/idea-menu-safety-notice";
import {
  MENU_ACCEPT_NOTICE_IDEA,
  MENU_ACCEPT_NOTICE_TITLE,
  MenuResultActionBar,
} from "@/features/generation/components/menu-result-action-bar";
import { MenuResult, type MenuResultActions } from "@/features/generation/components/menu-result";
import { useUsageToday } from "@/features/generation/hooks/use-usage-today";
import {
  RegenerationSheet,
  type RegenerationReasonInput,
} from "@/features/history/components/regeneration-sheet";
import { MenuVersionSwitcher } from "@/features/history/components/menu-version-switcher";
import {
  useAcceptMenuVersion,
  useDerivationVersions,
  useToggleFavorite,
} from "@/features/history/hooks/use-history";
import { useRegeneration } from "@/features/history/hooks/use-regeneration";
import { derivationVersionUiState } from "@/features/history/model/derivation-version-ui";
import {
  hasMissingPantrySelectionsForRegeneration,
  listExpiredPantryForRegeneration,
} from "@/features/history/model/expired-pantry-for-regen";
import {
  createPantryItem,
  deletePantryItem,
  listPantryItems,
  pantryKeys,
  updatePantryItem,
} from "@/features/pantry/pantry-api";
import { createPlannerDraftFromMenu } from "@/features/planner/model/draft-from-menu";
import { getPlannerDraft, plannerKeys, savePlannerDraft } from "@/features/planner/planner-api";
import { historyPathForShopping } from "@/features/shopping/shopping-intent";
import { getBrowserSupabaseClient } from "@/shared/lib/supabase";
import { type MenuDetailSurface } from "./menu-detail-types";
import { usageViewFromQuery } from "./usage-view-from-query";

export type IdeaMenuDetailBodyProps = {
  result: MenuResultViewModel;
  menuId: string;
  userId: string | undefined;
  shoppingIntentActive: boolean;
  clearShoppingCycle: () => void;
  /** 画面差分（生成直後 vs 履歴）。 */
  surface: MenuDetailSurface;
};

/**
 * idea履歴の詳細本文。
 * 家族安全再検証・買い物 hook は mount せず、常時noticeと許可操作を表示する。
 * shopping intent は拒否メッセージのみ（list/create/resume は呼ばない）。
 */
export function IdeaMenuDetailBody({
  result,
  menuId,
  userId,
  shoppingIntentActive,
  clearShoppingCycle,
  surface,
}: IdeaMenuDetailBodyProps) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  // storage clear 後もメッセージを残す（設計 I5・MenuResultPage と同順）
  const [showIdeaShoppingRejected, setShowIdeaShoppingRejected] = useState(false);
  useEffect(() => {
    if (!shoppingIntentActive) return;
    setShowIdeaShoppingRejected(true);
    clearShoppingCycle();
  }, [shoppingIntentActive, clearShoppingCycle]);
  const usage = useUsageToday(userId ?? "");
  const usageView = usageViewFromQuery(usage);
  const pantryQuery = useQuery({
    queryKey: pantryKeys.list(userId ?? "missing"),
    queryFn: () => listPantryItems(getBrowserSupabaseClient(), userId ?? ""),
    enabled: userId !== undefined,
  });
  const expiredPantryItems = useMemo(
    () =>
      listExpiredPantryForRegeneration(result.sourceSubmission, pantryQuery.data ?? [], new Date()),
    [pantryQuery.data, result.sourceSubmission],
  );
  // HR5: live に無い selection は期限 UI に出ないため、欠落を別ゲートで塞ぐ
  // isSuccess 時 data は確定するので ?? [] は不要（exact narrowing）
  const missingPantrySelections =
    pantryQuery.isSuccess &&
    hasMissingPantrySelectionsForRegeneration(result.sourceSubmission, pantryQuery.data);
  // HR-I1: 冷蔵庫未取得・失敗時は期限確認 UI を開かない（空配列 fail-open を防ぐ）
  // HR5: 欠落 selection があるときは再生成 CTA を閉じる（server 422 を先回り）
  const pantryGateReady = pantryQuery.isSuccess && !missingPantrySelections;
  const pantryGateMessage = pantryQuery.isError
    ? "冷蔵庫を確認できません。通信を確認してから別案を作り直してください。"
    : pantryQuery.isPending
      ? "冷蔵庫を確認しています…"
      : missingPantrySelections
        ? "作成時に選んだ冷蔵庫の食材がありません。条件を変えて作り直してください。"
        : null;
  const regeneration = useRegeneration({
    targetMode: "idea",
    menuId,
    phase: null,
    result: null,
  });
  const accept = useAcceptMenuVersion();
  const favorite = useToggleFavorite();
  const versionsQuery = useDerivationVersions(result.derivationGroupId);
  const siblingVersions = versionsQuery.data ?? [];
  const { confirmedSingle, versionsFailed } = derivationVersionUiState(versionsQuery);
  const [sheetMode, setSheetMode] = useState<"whole" | "dish" | null>(null);
  const [postCookOpen, setPostCookOpen] = useState(false);
  const [selectedDishId, setSelectedDishId] = useState<string | null>(null);
  // DB hydrate: query の isFavorite を初期値にし、同一 route での再取得も useEffect で同期する
  const [isFavorite, setIsFavorite] = useState(result.isFavorite);
  /** 採用成功後は「履歴一覧」を主操作。is_selected も hydrate。 */
  const [accepted, setAccepted] = useState(result.isSelected);
  const [acceptError, setAcceptError] = useState<string | null>(null);
  const [favoriteError, setFavoriteError] = useState<string | null>(null);
  const [retargetError, setRetargetError] = useState<string | null>(null);
  const [retargetPending, setRetargetPending] = useState(false);

  useEffect(() => {
    setIsFavorite(result.isFavorite);
  }, [result.isFavorite]);

  useEffect(() => {
    setAccepted(result.isSelected);
  }, [menuId]);
  useEffect(() => {
    if (result.isSelected) setAccepted(true);
  }, [result.isSelected]);

  const firstDishId = result.menu.dishes[0]?.id ?? null;
  const dishIdForRegen = selectedDishId ?? firstDishId;
  const canUpdatePostCook = result.pantryPostCookTargets.length > 0;
  const queryKey = useMemo(
    () => ["menu-result", userId ?? "missing", menuId] as const,
    [menuId, userId],
  );

  const actions = useMemo((): MenuResultActions | undefined => {
    if (userId === undefined) return undefined;
    const client = getBrowserSupabaseClient();
    return {
      menuId,
      userId,
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

  const onSubmitReason = async (value: RegenerationReasonInput) => {
    if (sheetMode === "dish") {
      if (dishIdForRegen === null) return;
      await regeneration.startDish(dishIdForRegen, value);
    } else {
      await regeneration.startWhole(value);
    }
    setSheetMode(null);
  };

  const onRetarget = async () => {
    if (result.sourceSubmission === null || userId === undefined) return;
    setRetargetError(null);
    setRetargetPending(true);
    try {
      const client = getBrowserSupabaseClient();
      const existing = await getPlannerDraft(client, userId);
      const draft = createPlannerDraftFromMenu(result.sourceSubmission);
      await savePlannerDraft(client, userId, draft, existing?.revision ?? 0);
      await queryClient.invalidateQueries({ queryKey: plannerKeys.draft(userId) });
      void navigate("/planner?resume=audience");
    } catch {
      setRetargetError("献立条件を引き継げませんでした。もう一度お試しください");
    } finally {
      setRetargetPending(false);
    }
  };

  // idea の必須注意は 1 枠に集約（免責・家族未使用・AI 作成を別枠で重ねない）。
  return (
    <main className="page-frame guided-planner-theme min-w-0 overflow-x-hidden break-words text-ink [overflow-wrap:anywhere]">
      <IdeaMenuSafetyNotice />
      {surface.showFlyerUpsell && usage.isSuccess && !usage.data.plusEntitled ? (
        <div className="mb-4">
          <FlyerUpsellBanner plusEntitled={false} />
        </div>
      ) : null}
      {showIdeaShoppingRejected ? (
        <section className="card stack mb-4" role="status">
          <p>アイデア献立は買い物リストに使えません。家族に合わせた献立を選んでください</p>
          <Link className="secondary-button min-h-11" to={historyPathForShopping()}>
            履歴に戻る
          </Link>
          <Link className="secondary-button min-h-11" to="/shopping">
            買い物に戻る
          </Link>
        </section>
      ) : null}
      <MenuVersionSwitcher
        versions={siblingVersions}
        currentMenuId={menuId}
        pathForMenuId={surface.pathForMenuId}
      />
      {versionsFailed ? (
        <p className="mb-2" role="alert">
          案の一覧を読み込めませんでした。
          <button
            type="button"
            className="ml-2 underline"
            onClick={() => {
              void versionsQuery.refetch();
            }}
          >
            もう一度読み込む
          </button>
        </p>
      ) : null}
      {actions === undefined ? (
        <MenuResult
          result={result}
          mode="idea"
          postCookOpen={postCookOpen}
          onPostCookClose={() => {
            setPostCookOpen(false);
          }}
          onSelectedDishChange={setSelectedDishId}
          onRegenerateSelectedDish={() => {
            if (!pantryGateReady) return;
            setSheetMode("dish");
          }}
          regenerateSelectedDishDisabled={dishIdForRegen === null || !pantryGateReady}
        />
      ) : (
        <MenuResult
          result={result}
          mode="idea"
          actions={actions}
          postCookOpen={postCookOpen}
          onPostCookClose={() => {
            setPostCookOpen(false);
          }}
          onSelectedDishChange={setSelectedDishId}
          onRegenerateSelectedDish={() => {
            if (!pantryGateReady) return;
            setSheetMode("dish");
          }}
          regenerateSelectedDishDisabled={dishIdForRegen === null || !pantryGateReady}
        />
      )}
      {acceptError !== null && (
        <p className="mt-2" role="alert">
          {acceptError}
        </p>
      )}
      {favoriteError !== null && (
        <p className="mt-2" role="alert">
          {favoriteError}
        </p>
      )}
      {pantryGateMessage !== null && (
        <p className="mt-2" role="status">
          {pantryGateMessage}
        </p>
      )}

      <MenuResultActionBar
        notice={
          accepted ? (
            <div role="status">
              <p className="menu-result-actions-notice-title">{MENU_ACCEPT_NOTICE_TITLE}</p>
              <p className="menu-result-actions-notice-hint">{MENU_ACCEPT_NOTICE_IDEA}</p>
            </div>
          ) : null
        }
        primary={
          accepted || confirmedSingle ? (
            <Link className="primary-button min-h-11" to="/history">
              {surface.ideaAcceptedPrimaryLabel}
            </Link>
          ) : (
            <button
              type="button"
              className="primary-button min-h-11"
              disabled={accept.isPending}
              onClick={() => {
                setAcceptError(null);
                accept.mutate(menuId, {
                  onSuccess: () => {
                    setAccepted(true);
                  },
                  onError: () => {
                    setAcceptError("採用を保存できませんでした。もう一度お試しください");
                  },
                });
              }}
            >
              この献立にする
            </button>
          )
        }
        auxiliaries={
          <>
            {!accepted && confirmedSingle ? (
              <button
                type="button"
                className="secondary-button min-h-11"
                disabled={accept.isPending}
                onClick={() => {
                  setAcceptError(null);
                  accept.mutate(menuId, {
                    onSuccess: () => {
                      setAccepted(true);
                    },
                    onError: () => {
                      setAcceptError("採用を保存できませんでした。もう一度お試しください");
                    },
                  });
                }}
              >
                この献立にする
              </button>
            ) : null}
            <button
              type="button"
              className="secondary-button min-h-11"
              disabled={!pantryGateReady}
              onClick={() => {
                if (!pantryGateReady) return;
                setSheetMode("whole");
              }}
            >
              この案を元に別の献立を作り直す
            </button>
            {canUpdatePostCook ? (
              <button
                type="button"
                className="secondary-button min-h-11"
                onClick={() => {
                  setPostCookOpen(true);
                }}
              >
                使った食材の在庫を更新
              </button>
            ) : null}
            <button
              type="button"
              className="secondary-button min-h-11"
              disabled={favorite.isPending}
              aria-pressed={isFavorite}
              aria-label={isFavorite ? "お気に入りを外す" : "お気に入りに追加"}
              onClick={() => {
                const nextFavorite = !isFavorite;
                setFavoriteError(null);
                favorite.mutate(
                  { menuId, isFavorite: nextFavorite },
                  {
                    onSuccess: () => {
                      setIsFavorite(nextFavorite);
                    },
                    onError: () => {
                      setFavoriteError("お気に入りを更新できませんでした");
                    },
                  },
                );
              }}
            >
              {isFavorite ? "★ お気に入り" : "☆ お気に入り"}
            </button>
            {result.sourceSubmission !== null ? (
              <button
                type="button"
                className="secondary-button min-h-11"
                disabled={retargetPending}
                onClick={() => {
                  void onRetarget();
                }}
              >
                条件を変えて作り直す
              </button>
            ) : null}
          </>
        }
      />

      {retargetError !== null && (
        <p role="alert" className="mt-4">
          {retargetError}
        </p>
      )}

      {sheetMode !== null && (
        <RegenerationSheet
          targetMode="idea"
          usage={usageView}
          expiredPantryItems={expiredPantryItems}
          onSubmit={onSubmitReason}
          onCancel={() => {
            setSheetMode(null);
          }}
        />
      )}
    </main>
  );
}
