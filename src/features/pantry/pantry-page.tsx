import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { PantryItem, PantryItemInput } from "@shared/contracts/pantry";
import { useAuth } from "@/features/auth/auth-provider";
import { getBrowserSupabaseClient } from "@/shared/lib/supabase";
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
  unknown: "期限種別不明",
} as const;
const openedLabels = {
  unopened: "未開封",
  opened: "開封済み",
  unknown: "開封状態不明",
} as const;

export function PantryPage() {
  const auth = useAuth();
  const userId = auth.session?.user.id;
  const client = getBrowserSupabaseClient();
  const queryClient = useQueryClient();
  const ownerListKey = pantryKeys.list(userId ?? "missing");
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
    onSuccess: async () => queryClient.invalidateQueries({ queryKey: ownerListKey, exact: true }),
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
    onSuccess: async () => queryClient.invalidateQueries({ queryKey: ownerListKey, exact: true }),
    onError: async (error) => {
      if (error instanceof PantryVersionConflictError) {
        await refreshOwnerListAfterConflict();
      }
    },
    retry: false,
  });
  const deleteMutation = useMutation({
    mutationFn: (command: { itemId: string; expectedUpdatedAt: string }) =>
      deletePantryItem(client, userId ?? "", command.itemId, command.expectedUpdatedAt),
    onSuccess: async () => queryClient.invalidateQueries({ queryKey: ownerListKey, exact: true }),
    onError: async (error) => {
      if (error instanceof PantryVersionConflictError) {
        await refreshOwnerListAfterConflict();
      }
    },
    retry: false,
  });
  const mutationError = updateMutation.error ?? deleteMutation.error ?? createMutation.error;

  return (
    <PantryPageContent
      items={query.data ?? []}
      loading={query.isPending}
      saving={createMutation.isPending || updateMutation.isPending || deleteMutation.isPending}
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
    />
  );
}

type PantryPageContentProps = {
  items: readonly PantryItem[];
  loading: boolean;
  saving: boolean;
  error: string | null;
  onCreate: (input: PantryItemInput) => Promise<void>;
  onUpdate: (id: string, expectedUpdatedAt: string, input: PantryItemInput) => Promise<void>;
  onDelete: (id: string, expectedUpdatedAt: string) => void;
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
  error,
  onCreate,
  onUpdate,
  onDelete,
}: PantryPageContentProps) {
  const [editing, setEditing] = useState<PantryItem | null>(null);

  return (
    <main className="page-frame stack">
      <header>
        <p className="eyebrow">冷蔵庫</p>
        <h1>食材リスト</h1>
      </header>
      <p>期限日は並べ替えと注意表示のための入力です。アプリは食べられるかを判断しません。</p>
      {editing === null ? (
        <PantryForm saving={saving} onSubmit={onCreate} />
      ) : (
        <PantryForm
          key={editing.id}
          saving={saving}
          title={`${editing.name}を編集`}
          submitLabel="変更を保存"
          initialValue={inputFromItem(editing)}
          onSubmit={async (input) => {
            await onUpdate(editing.id, editing.updatedAt, input);
            setEditing(null);
          }}
          onCancel={() => {
            setEditing(null);
          }}
        />
      )}
      {error !== null && (
        <p role="alert" aria-live="assertive" className="error-message">
          {error}
        </p>
      )}
      {loading && <p>読み込み中…</p>}
      {!loading && items.length === 0 && <p>登録した食材はありません。</p>}
      <ul className="stack pantry-list" aria-label="冷蔵庫の食材">
        {items.map((item) => (
          <li className="card pantry-card" key={item.id}>
            <h2>{item.name}</h2>
            <p>
              {item.quantity === null ? "分量未入力" : `${String(item.quantity)}${item.unit ?? ""}`}
            </p>
            {item.expiresOn !== null && (
              <p>
                {item.expirationType === null ? "期限" : expiryLabels[item.expirationType]}{" "}
                {item.expiresOn}
              </p>
            )}
            {item.openedState !== null && <p>{openedLabels[item.openedState]}</p>}
            <div className="pantry-actions">
              <button
                className="secondary-button"
                type="button"
                aria-label={`${item.name}を編集`}
                onClick={() => {
                  setEditing(item);
                }}
              >
                編集
              </button>
              <button
                className="text-button"
                type="button"
                aria-label={`${item.name}を削除`}
                onClick={() => {
                  if (window.confirm("この食材を削除しますか？")) {
                    onDelete(item.id, item.updatedAt);
                  }
                }}
              >
                削除
              </button>
            </div>
          </li>
        ))}
      </ul>
    </main>
  );
}
