import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import type { PantryItem, PantryItemInput } from "@shared/contracts/pantry";
import { useAuth } from "@/features/auth/use-auth";
import { getBrowserSupabaseClient } from "@/shared/lib/supabase";
import { Button } from "@/shared/ui/button";
import { Badge, EmptyState, Skeleton, type BadgeTone } from "@/shared/ui/feedback";
import { PageHeader } from "@/shared/ui/page-header";
import { Inset, Stack } from "@/shared/ui/stack";
import { Surface } from "@/shared/ui/surface";
import {
  createPantryItem,
  deletePantryItem,
  listPantryItems,
  PantryVersionConflictError,
  pantryKeys,
  updatePantryItem,
} from "./pantry-api";
import { PantryForm } from "./pantry-form";

const expiryLabels = {
  use_by: "消費期限",
  best_before: "賞味期限",
  other: "期限",
  unknown: "期限の種類は未登録",
} as const;
const openedLabels = {
  unopened: "未開封",
  opened: "開封済み",
  unknown: "開けたかは未登録",
} as const;

/** JST の YYYY-MM-DD（期限注意表示用）。 */
function jstDateKey(date: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

export type ExpiryNotice = { tone: BadgeTone | null; suffix: string };

/** D-I6: 期限切れは danger・7日以内は warning（注意表示）。色は Badge のトーンで表す。 */
export function expiryNotice(expiresOn: string, now: Date = new Date()): ExpiryNotice {
  const todayKey = jstDateKey(now);
  if (expiresOn < todayKey) {
    return { tone: "danger", suffix: "（期限切れ）" };
  }
  const soonKey = jstDateKey(new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000));
  if (expiresOn <= soonKey) {
    return { tone: "warning", suffix: "（まもなく）" };
  }
  return { tone: null, suffix: "" };
}

export function PantryPage() {
  const auth = useAuth();
  const userId = auth.session?.user.id;
  const client = getBrowserSupabaseClient();
  const queryClient = useQueryClient();
  const ownerListKey = pantryKeys.list(userId ?? "missing");
  const [mutationFailure, setMutationFailure] = useState<{
    error: unknown;
    itemId?: string;
  } | null>(null);
  const query = useQuery({
    queryKey: ownerListKey,
    queryFn: () => listPantryItems(client, userId ?? ""),
    enabled: userId !== undefined,
  });
  const refreshOwnerListAfterConflict = async (): Promise<void> => {
    await queryClient.refetchQueries({ queryKey: ownerListKey, exact: true });
  };
  const createMutation = useMutation({
    mutationFn: (input: PantryItemInput) => createPantryItem(client, userId ?? "", input),
    onSuccess: async () => {
      setMutationFailure(null);
      await queryClient.invalidateQueries({ queryKey: ownerListKey, exact: true });
    },
    onError: (error) => {
      setMutationFailure({ error });
    },
    retry: false,
  });
  const updateMutation = useMutation({
    mutationFn: (command: { itemId: string; expectedUpdatedAt: string; input: PantryItemInput }) =>
      updatePantryItem(
        client,
        userId ?? "",
        command.itemId,
        command.expectedUpdatedAt,
        command.input,
      ),
    onSuccess: async () => {
      setMutationFailure(null);
      await queryClient.invalidateQueries({ queryKey: ownerListKey, exact: true });
    },
    onError: async (error, command) => {
      setMutationFailure({ error, itemId: command.itemId });
      if (error instanceof PantryVersionConflictError) {
        await refreshOwnerListAfterConflict();
      }
    },
    retry: false,
  });
  const deleteMutation = useMutation({
    mutationFn: (command: { itemId: string; expectedUpdatedAt: string }) =>
      deletePantryItem(client, userId ?? "", command.itemId, command.expectedUpdatedAt),
    onSuccess: async () => {
      setMutationFailure(null);
      await queryClient.invalidateQueries({ queryKey: ownerListKey, exact: true });
    },
    onError: async (error) => {
      setMutationFailure({ error });
      if (error instanceof PantryVersionConflictError) {
        await refreshOwnerListAfterConflict();
      }
    },
    retry: false,
  });
  const clearEditingConflict = () => {
    setMutationFailure((current) =>
      current?.error instanceof PantryVersionConflictError ? null : current,
    );
  };
  const mutationError = mutationFailure?.error ?? null;

  return (
    <PantryPageContent
      items={query.data ?? []}
      loading={query.isPending}
      saving={createMutation.isPending || updateMutation.isPending || deleteMutation.isPending}
      conflictedItemId={
        mutationError instanceof PantryVersionConflictError ? mutationFailure?.itemId : undefined
      }
      error={
        query.isError
          ? "冷蔵庫の食材を読み込めませんでした。通信を確認してください。"
          : mutationError instanceof PantryVersionConflictError
            ? mutationError.message
            : mutationError !== null
              ? "保存に失敗しました。通信を確認してください。"
              : null
      }
      onCreate={async (input) => {
        await createMutation.mutateAsync(input);
      }}
      onUpdate={async (itemId, expectedUpdatedAt, input) => {
        await updateMutation.mutateAsync({ itemId, expectedUpdatedAt, input });
      }}
      onDelete={(itemId, expectedUpdatedAt) => {
        deleteMutation.mutate({ itemId, expectedUpdatedAt });
      }}
      onEditingSessionChange={clearEditingConflict}
    />
  );
}

type PantryPageContentProps = {
  items: readonly PantryItem[];
  loading: boolean;
  saving: boolean;
  conflictedItemId?: string | undefined;
  error: string | null;
  onCreate: (input: PantryItemInput) => Promise<void>;
  onUpdate: (id: string, expectedUpdatedAt: string, input: PantryItemInput) => Promise<void>;
  onDelete: (id: string, expectedUpdatedAt: string) => void;
  onEditingSessionChange?: () => void;
};

function inputFromItem(item: PantryItem): PantryItemInput {
  return {
    name: item.name,
    quantity: item.quantity,
    unit: item.unit,
    expiresOn: item.expiresOn,
    expirationType: item.expirationType,
    openedState: item.openedState,
  };
}

export function PantryPageContent({
  items,
  loading,
  saving,
  conflictedItemId,
  error,
  onCreate,
  onUpdate,
  onDelete,
  onEditingSessionChange,
}: PantryPageContentProps) {
  const [editing, setEditing] = useState<PantryItem | null>(null);
  const [creating, setCreating] = useState(false);
  const addTriggerRef = useRef<HTMLButtonElement>(null);
  const editorTriggerRef = useRef<HTMLButtonElement | null>(null);
  const editorContainerRef = useRef<HTMLDivElement>(null);
  const shouldReturnFocusRef = useRef(false);
  const latestEditingItem =
    editing !== null && conflictedItemId === editing.id
      ? items.find((item) => item.id === editing.id)
      : undefined;

  useEffect(() => {
    if (!creating && editing === null) {
      if (shouldReturnFocusRef.current) {
        shouldReturnFocusRef.current = false;
        editorTriggerRef.current?.focus();
      }
      return;
    }
    editorContainerRef.current?.querySelector<HTMLHeadingElement>("h2")?.focus();
  }, [creating, editing]);

  const closeEditorAndReturnFocus = () => {
    shouldReturnFocusRef.current = true;
  };

  return (
    <main className="page-frame">
      <Stack gap={5}>
        <PageHeader
          title="食材リスト"
          lead="冷蔵庫やパントリーにある食材を登録する場所です。献立を作るときに「使いたい食材」として選べます。"
          note="期限日は並び順や注意表示のための入力です。アプリが「食べられるか」を判断するものではありません。"
        />
        <section className="pantry-overview" aria-labelledby="pantry-list-heading">
          <Stack gap={4}>
            <div className="pantry-section-heading">
              <h2 id="pantry-list-heading">
                登録済みの食材（{loading ? "件数を確認中" : `${String(items.length)}件`}）
              </h2>
              <Button
                ref={addTriggerRef}
                disabled={saving || creating}
                aria-expanded={creating}
                aria-controls="pantry-editor"
                onClick={() => {
                  onEditingSessionChange?.();
                  editorTriggerRef.current = addTriggerRef.current;
                  setEditing(null);
                  setCreating(true);
                }}
              >
                食材を追加
              </Button>
            </div>
            {(creating || editing !== null) && (
              <div id="pantry-editor" ref={editorContainerRef}>
                {creating && (
                  <PantryForm
                    saving={saving}
                    onSubmit={async (input) => {
                      await onCreate(input);
                      closeEditorAndReturnFocus();
                      setCreating(false);
                    }}
                    onCancel={() => {
                      closeEditorAndReturnFocus();
                      setCreating(false);
                    }}
                  />
                )}
                {editing !== null && (
                  <PantryForm
                    key={`${editing.id}:${editing.updatedAt}`}
                    saving={saving}
                    title={`${editing.name}を編集`}
                    submitLabel="変更を保存"
                    initialValue={inputFromItem(editing)}
                    onSubmit={async (input) => {
                      await onUpdate(editing.id, editing.updatedAt, input);
                      closeEditorAndReturnFocus();
                      setEditing(null);
                    }}
                    onCancel={() => {
                      onEditingSessionChange?.();
                      closeEditorAndReturnFocus();
                      setEditing(null);
                    }}
                  />
                )}
              </div>
            )}
            {loading && <Skeleton label="食材リストを読み込んでいます…" lines={3} />}
            {!loading && items.length === 0 && !creating && (
              <Surface as="section" aria-labelledby="pantry-empty-title" tone="sunken">
                <EmptyState
                  titleId="pantry-empty-title"
                  title="まだ食材がありません"
                  body="「食材を追加」から、名前と分量などを入力して登録できます。全部入れなくても大丈夫です。使いたいものだけ登録してください。あとから編集や削除もできます。"
                />
              </Surface>
            )}
            <Stack as="ul" gap={3} aria-label="冷蔵庫の食材">
              {items.map((item) => {
                const notice = item.expiresOn !== null ? expiryNotice(item.expiresOn) : null;
                return (
                  <li key={item.id}>
                    <Surface>
                      <Inset pad={4}>
                        <Stack gap={2}>
                          <h3 className="pantry-card-text">{item.name}</h3>
                          <p className="pantry-card-text">
                            {item.quantity === null
                              ? "分量未入力"
                              : `${String(item.quantity)}${item.unit ?? ""}`}
                          </p>
                          {item.expiresOn !== null && notice !== null && (
                            <Stack gap={1}>
                              {/* 接尾辞は Badge のみが持ち、p と二重一致しないようにする */}
                              <p className="pantry-card-text">
                                {item.expirationType === null
                                  ? "期限"
                                  : expiryLabels[item.expirationType]}{" "}
                                {item.expiresOn}
                              </p>
                              {notice.tone !== null && (
                                <Badge tone={notice.tone}>{notice.suffix}</Badge>
                              )}
                            </Stack>
                          )}
                          {item.openedState !== null && <p>{openedLabels[item.openedState]}</p>}
                          <div className="pantry-actions">
                            <Button
                              variant="secondary"
                              aria-label={`${item.name}を編集`}
                              onClick={(event) => {
                                onEditingSessionChange?.();
                                editorTriggerRef.current = event.currentTarget;
                                setCreating(false);
                                setEditing(item);
                              }}
                            >
                              編集
                            </Button>
                            <Button
                              variant="ghost"
                              aria-label={`${item.name}を削除`}
                              onClick={() => {
                                if (window.confirm("この食材を削除しますか？")) {
                                  onDelete(item.id, item.updatedAt);
                                }
                              }}
                            >
                              削除
                            </Button>
                          </div>
                        </Stack>
                      </Inset>
                    </Surface>
                  </li>
                );
              })}
            </Stack>
          </Stack>
        </section>
        {error !== null && (
          <p role="alert" aria-live="assertive" className="error-message">
            {error}
          </p>
        )}
        {latestEditingItem !== undefined && (
          <Surface as="section" aria-labelledby="pantry-latest-item-heading" tone="notice">
            <Inset pad={4}>
              <Stack gap={3}>
                <h2 id="pantry-latest-item-heading">最新の内容</h2>
                <p className="pantry-card-text">最新の食材名: {latestEditingItem.name}</p>
                <p>
                  最新の分量:{" "}
                  {latestEditingItem.quantity === null
                    ? "未入力"
                    : `${String(latestEditingItem.quantity)}${latestEditingItem.unit ?? ""}`}
                </p>
                {latestEditingItem.expiresOn !== null && (
                  <p>
                    最新の期限:{" "}
                    {latestEditingItem.expirationType === null
                      ? "期限"
                      : expiryLabels[latestEditingItem.expirationType]}{" "}
                    {latestEditingItem.expiresOn}
                  </p>
                )}
                {latestEditingItem.openedState !== null && (
                  <p>最新の開封状態: {openedLabels[latestEditingItem.openedState]}</p>
                )}
                <Button
                  variant="secondary"
                  onClick={(event) => {
                    onEditingSessionChange?.();
                    editorTriggerRef.current = event.currentTarget;
                    setEditing(latestEditingItem);
                  }}
                >
                  最新の内容を編集フォームに反映
                </Button>
              </Stack>
            </Inset>
          </Surface>
        )}
      </Stack>
    </main>
  );
}
