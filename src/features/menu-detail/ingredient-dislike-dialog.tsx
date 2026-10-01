import { useEffect, useId, useRef, useState, type JSX, type SubmitEvent } from "react";
import { dislikeIdentity, dislikeNameLength } from "@/features/household/member-dislike-identity";
import { Button } from "@/shared/ui/button";
import { Stack } from "@/shared/ui/stack";
import {
  ingredientDislikeSavedMessage,
  planIngredientDislikeOps,
  type DislikeBaselineRow,
  type SaveIngredientDislikesInput,
  type SaveIngredientDislikesResult,
} from "./save-ingredient-dislikes";

export const INGREDIENT_DISLIKE_NOTE =
  "この献立の対象になっている人の苦手が変わると、料理の手順は閉じます。対象でない人だけの変更では、手順は開いたままです。次に作る献立から避けます。食べられないものの登録ではありません。";

const NAME_HELPER =
  "短くすると、次の献立で見つかりやすくなります。名前を変えると新しい苦手として追加し、前の名前は設定に残ります。";

export type IngredientDislikeMember = { id: string; displayName: string };

export type IngredientDislikeDialogProps = {
  ingredientName: string;
  triggerId: string;
  members: readonly IngredientDislikeMember[];
  /** pending は家族一覧の取得中。エラー文は出さず、保存はできない。 */
  membersStatus: "pending" | "ready" | "error";
  dislikesStatus: "pending" | "ready" | "error";
  baseline: readonly DislikeBaselineRow[];
  /** 0 はまだ開いたときの一覧が無い。1 以上でその一覧をチェックの正にする。 */
  baselineEpoch: number;
  save: (input: SaveIngredientDislikesInput) => Promise<SaveIngredientDislikesResult>;
  onClose: () => void;
  onComplete: (message: string) => void;
  /** 失敗後、サーバの一覧へ合わせられたときだけ呼ぶ。 */
  onBaselineReconciled: (baseline: readonly DislikeBaselineRow[]) => void;
};

function memberIdsHaving(
  baseline: readonly DislikeBaselineRow[],
  identity: string,
  members: readonly IngredientDislikeMember[],
): string[] {
  return members
    .filter((member) =>
      baseline.some(
        (row) => row.memberId === member.id && dislikeIdentity(row.ingredientName) === identity,
      ),
    )
    .map((member) => member.id);
}

export function IngredientDislikeDialog({
  ingredientName,
  triggerId,
  members,
  membersStatus,
  dislikesStatus,
  baseline,
  baselineEpoch,
  save,
  onClose,
  onComplete,
  onBaselineReconciled,
}: IngredientDislikeDialogProps): JSX.Element {
  const titleId = useId();
  const lengthErrorId = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  // 開いた材料名。失敗後に epoch が進んでも変えない。
  const openedNameRef = useRef(ingredientName);
  const nameRef = useRef(ingredientName);
  const adoptedEpochRef = useRef<number | null>(null);
  const [name, setName] = useState(ingredientName);
  const [checks, setChecks] = useState<ReadonlySet<string>>(() => new Set());
  const [localBaseline, setLocalBaseline] = useState<readonly DislikeBaselineRow[]>(baseline);
  const [submitting, setSubmitting] = useState(false);
  const [alertMessage, setAlertMessage] = useState<string | null>(null);
  nameRef.current = name;

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog !== null && !dialog.open) dialog.showModal();
    return () => {
      if (dialog !== null && dialog.open) dialog.close();
      // 本文が隠れてボタンが無いときは、別の要素へフォーカスを作らない。
      const trigger = document.getElementById(triggerId);
      if (trigger instanceof HTMLButtonElement) trigger.focus();
    };
  }, [triggerId]);

  useEffect(() => {
    // epoch 0 は一覧未着。同じ epoch の query 更新では、他タブの行をチェックへ取り込まない。
    if (dislikesStatus !== "ready" || baselineEpoch === 0) return;
    if (adoptedEpochRef.current === baselineEpoch) return;
    adoptedEpochRef.current = baselineEpoch;
    setLocalBaseline(baseline);
    setChecks(new Set(memberIdsHaving(baseline, dislikeIdentity(nameRef.current), members)));
  }, [baseline, baselineEpoch, dislikesStatus, members]);

  const length = dislikeNameLength(name);
  const dataReady = membersStatus === "ready" && dislikesStatus === "ready" && baselineEpoch > 0;
  const planned = dataReady
    ? planIngredientDislikeOps({
        openedName: openedNameRef.current,
        currentName: name,
        memberIds: members.map((member) => member.id),
        checkedMemberIds: checks,
        baseline: localBaseline,
      })
    : [];
  const saveDisabled = submitting || !dataReady || length !== "ok" || planned.length === 0;

  async function onSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saveDisabled) return;
    setSubmitting(true);
    setAlertMessage(null);
    try {
      const result = await save({
        openedName: openedNameRef.current,
        currentName: name,
        memberIds: members.map((member) => member.id),
        checkedMemberIds: checks,
        baseline: localBaseline,
      });
      if (result.kind === "no_diff") return;
      if (result.kind === "saved") {
        onComplete(ingredientDislikeSavedMessage(result));
        onClose();
        return;
      }
      setAlertMessage(result.message);
      if (result.nextBaseline !== null) onBaselineReconciled(result.nextBaseline);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      className="history-dialog"
      onCancel={(event) => {
        event.preventDefault();
        if (submitting) return;
        onClose();
      }}
      onClick={(event) => {
        if (event.target !== event.currentTarget || submitting) return;
        onClose();
      }}
    >
      <form
        onSubmit={(event) => {
          void onSubmit(event);
        }}
      >
        <Stack gap={4}>
          <h2 id={titleId} className="history-dialog-title">
            苦手な食べ物
          </h2>
          <label>
            食べ物の名前
            <input
              value={name}
              disabled={submitting}
              onChange={(event) => {
                setName(event.target.value);
              }}
              {...(length === "too_long" ? { "aria-describedby": lengthErrorId } : {})}
            />
          </label>
          <p className="type-small">{NAME_HELPER}</p>
          {length === "too_long" ? (
            <p id={lengthErrorId} role="alert">
              苦手食材は1〜80文字で入力してください
            </p>
          ) : null}
          <fieldset className="history-regen-fieldset" disabled={submitting}>
            <legend>苦手な人</legend>
            <Stack gap={2}>
              {members.map((member) => (
                <label key={member.id} className="history-regen-option min-h-11">
                  <input
                    type="checkbox"
                    checked={checks.has(member.id)}
                    onChange={(event) => {
                      setChecks((current) => {
                        const next = new Set(current);
                        if (event.target.checked) next.add(member.id);
                        else next.delete(member.id);
                        return next;
                      });
                    }}
                  />
                  {member.displayName}
                </label>
              ))}
            </Stack>
          </fieldset>
          {membersStatus === "error" ? <p role="alert">家族情報を読み込めませんでした</p> : null}
          {dislikesStatus === "error" ? <p role="alert">苦手食材を読み込めませんでした</p> : null}
          <p>{INGREDIENT_DISLIKE_NOTE}</p>
          {alertMessage !== null ? <p role="alert">{alertMessage}</p> : null}
          <Button type="submit" busy={submitting} disabled={saveDisabled}>
            {submitting ? "保存しています" : "保存する"}
          </Button>
          <Button
            type="button"
            variant="secondary"
            disabled={submitting}
            onClick={() => {
              onClose();
            }}
          >
            キャンセル
          </Button>
        </Stack>
      </form>
    </dialog>
  );
}
