import {
  dislikeIdentity,
  dislikeNameLength,
  normalizeDislikeName,
} from "@/features/household/member-dislike-identity";

export type DislikeBaselineRow = {
  id: string;
  memberId: string;
  ingredientName: string;
};

export type SaveIngredientDislikesInput = {
  /** ダイアログを開いたときの材料名。失敗後の読み直しでも変えない。 */
  openedName: string;
  /** フィールドの今の名前。 */
  currentName: string;
  /** 登録完了の人。listHouseholdMembers の順。 */
  memberIds: readonly string[];
  checkedMemberIds: ReadonlySet<string>;
  /**
   * 直前の成功読み込み。初回は開いたとき。失敗後に合わせたあとはその結果。
   * 保存ボタンでは取り直さない。
   */
  baseline: readonly DislikeBaselineRow[];
};

export type IngredientDislikeOp =
  | { kind: "add"; memberId: string; ingredientName: string }
  | { kind: "delete"; memberId: string; dislikeId: string };

export type IngredientDislikeWriter = {
  addMemberDislike(memberId: string, ingredientName: string): Promise<unknown>;
  deleteMemberDislike(dislikeId: string): Promise<void>;
  listMemberDislikes(memberId: string): Promise<readonly DislikeBaselineRow[]>;
};

export type SaveIngredientDislikesResult =
  | { kind: "no_diff" }
  | {
      kind: "saved";
      normalizedName: string;
      inserted: number;
      alreadyPresent: number;
      deleted: number;
      refreshFailed: boolean;
    }
  | {
      kind: "stopped";
      normalizedName: string;
      inserted: number;
      alreadyPresent: number;
      deleted: number;
      refreshFailed: boolean;
      message: string;
      /** null は揃えるための読み直しが失敗した。チェックは変えない。 */
      nextCheckedMemberIds: readonly string[] | null;
      nextBaseline: readonly DislikeBaselineRow[] | null;
    };

/**
 * 設定画面の HOUSEHOLD_SAVED_REFRESH_FAILED と同一文。
 * 設定画面モジュールは import しない（画面のローカル定数のままにする）。
 */
export const HOUSEHOLD_SAVED_REFRESH_FAILED =
  "家族設定を保存しました。画面の再確認に失敗したため、献立・履歴を開き直すか再読み込みしてください。";

export const INGREDIENT_DISLIKE_PARTIAL_SAVED =
  "一部は保存済みです。チェックを確認して、もう一度保存してください。";

const ADD_FALLBACK = "苦手食材を追加できませんでした";
const DELETE_FALLBACK = "苦手食材を削除できませんでした";
const LIST_FAILED = "苦手食材を読み込めませんでした";

function thrownMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function rowsFor(baseline: readonly DislikeBaselineRow[], memberId: string, identity: string) {
  return baseline.filter(
    (row) => row.memberId === memberId && dislikeIdentity(row.ingredientName) === identity,
  );
}

export function planIngredientDislikeOps(
  input: SaveIngredientDislikesInput,
): IngredientDislikeOp[] {
  if (dislikeNameLength(input.currentName) !== "ok") return [];
  const opened = dislikeIdentity(input.openedName);
  const current = dislikeIdentity(input.currentName);
  const normalized = normalizeDislikeName(input.currentName);
  const ops: IngredientDislikeOp[] = [];
  for (const memberId of input.memberIds) {
    const rows = rowsFor(input.baseline, memberId, current);
    const checked = input.checkedMemberIds.has(memberId);
    if (checked && rows.length === 0) {
      ops.push({ kind: "add", memberId, ingredientName: normalized });
    } else if (!checked && rows.length > 0 && current === opened) {
      for (const row of rows) {
        ops.push({ kind: "delete", memberId, dislikeId: row.id });
      }
    }
  }
  return ops;
}

export function ingredientDislikeSavedMessage(result: {
  normalizedName: string;
  inserted: number;
  alreadyPresent: number;
  deleted: number;
  refreshFailed: boolean;
}): string {
  if (result.refreshFailed) return HOUSEHOLD_SAVED_REFRESH_FAILED;
  const added = result.inserted + result.alreadyPresent > 0;
  const removed = result.deleted > 0;
  if (added && removed) return "苦手を更新しました";
  if (removed) return `${result.normalizedName}の苦手を外しました`;
  return `${result.normalizedName}を苦手に覚えました`;
}

export async function saveIngredientDislikes(
  writer: IngredientDislikeWriter,
  input: SaveIngredientDislikesInput,
  invalidate: () => Promise<void>,
): Promise<SaveIngredientDislikesResult> {
  const ops = planIngredientDislikeOps(input);
  if (ops.length === 0) return { kind: "no_diff" };

  const normalizedName = normalizeDislikeName(input.currentName);
  const current = dislikeIdentity(input.currentName);
  let inserted = 0;
  let alreadyPresent = 0;
  let deleted = 0;
  let stopped: { message: string } | null = null;

  for (const op of ops) {
    if (op.kind === "add") {
      try {
        await writer.addMemberDislike(op.memberId, op.ingredientName);
        inserted += 1;
      } catch (error) {
        // 一意制約かどうかは判別しない。household-api がすべての insert 失敗を同じ Error に畳む。
        let listed: readonly DislikeBaselineRow[];
        try {
          listed = await writer.listMemberDislikes(op.memberId);
        } catch (listError) {
          stopped = { message: thrownMessage(listError, LIST_FAILED) };
          break;
        }
        if (rowsFor(listed, op.memberId, current).length > 0) {
          alreadyPresent += 1;
          continue;
        }
        stopped = { message: thrownMessage(error, ADD_FALLBACK) };
        break;
      }
    } else {
      try {
        // 0 行削除でも API は resolve する。resolve したらコミットに数える。
        await writer.deleteMemberDislike(op.dislikeId);
        deleted += 1;
      } catch (error) {
        stopped = { message: thrownMessage(error, DELETE_FALLBACK) };
        break;
      }
    }
  }

  const committed = inserted + deleted > 0;

  if (stopped === null) {
    let refreshFailed = false;
    if (committed) {
      try {
        await invalidate();
      } catch {
        refreshFailed = true;
      }
    }
    return { kind: "saved", normalizedName, inserted, alreadyPresent, deleted, refreshFailed };
  }

  let message = stopped.message;
  let nextCheckedMemberIds: readonly string[] | null = null;
  let nextBaseline: DislikeBaselineRow[] | null = null;
  try {
    const lists = await Promise.all(
      input.memberIds.map(async (memberId) => {
        const listed = await writer.listMemberDislikes(memberId);
        return listed.map((row) => ({ ...row, memberId }));
      }),
    );
    nextBaseline = lists.flat();
    nextCheckedMemberIds = input.memberIds.filter(
      (memberId) => rowsFor(nextBaseline ?? [], memberId, current).length > 0,
    );
  } catch {
    if (!message.includes(LIST_FAILED)) {
      message = `${message} ${LIST_FAILED}`;
    }
  }

  if (committed) {
    message = `${message} ${INGREDIENT_DISLIKE_PARTIAL_SAVED}`;
  }

  let refreshFailed = false;
  if (committed) {
    try {
      await invalidate();
    } catch {
      refreshFailed = true;
      message = `${message} ${HOUSEHOLD_SAVED_REFRESH_FAILED}`;
    }
  }

  return {
    kind: "stopped",
    normalizedName,
    inserted,
    alreadyPresent,
    deleted,
    refreshFailed,
    message,
    nextCheckedMemberIds,
    nextBaseline,
  };
}
