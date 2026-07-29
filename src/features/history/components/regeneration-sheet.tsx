import { useEffect, useId, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { changeReasons } from "@shared/contracts/domain";
import type { ExpiredPantryConfirmation } from "@shared/contracts/generation";
import type { TargetMode } from "@shared/contracts/planner";
import { formatFreeTierQuotaCopy } from "@shared/copy/free-tier";
import type { ExpiredPantryForRegen } from "../model/expired-pantry-for-regen";

const allReasons = [
  ["simpler", "もっと簡単に"],
  ["different_ingredient", "別の食材で"],
  ["child_friendly", "子どもが食べやすく"],
  ["different_flavor", "別の味に"],
  ["custom", "その他"],
] as const;

/** 再生成理由のブラウザ入力契約。custom のときだけ自由記述を必須にする。 */
const regenerationReasonSchema = z
  .object({
    // 未選択（undefined / 空）でも Zod 既定の英語 Invalid option を出さない
    changeReason: z.enum(changeReasons, "理由を選んでください"),
    changeReasonCustom: z
      .string()
      .trim()
      .min(1, "内容を入力してください")
      .max(200, "200文字以内で入力してください")
      .nullable()
      .default(null),
  })
  .superRefine((value, context) => {
    if (value.changeReason === "custom" && !value.changeReasonCustom) {
      context.addIssue({
        code: "custom",
        path: ["changeReasonCustom"],
        message: "内容を入力してください",
      });
    }
    if (value.changeReason !== "custom" && value.changeReasonCustom !== null) {
      context.addIssue({
        code: "custom",
        path: ["changeReasonCustom"],
        message: "その他を選んだ場合だけ入力できます",
      });
    }
  });

export type RegenerationReasonInput = z.infer<typeof regenerationReasonSchema> & {
  expiredPantryConfirmations: readonly ExpiredPantryConfirmation[];
};

export type RegenerationUsageView = {
  /** null = 未取得・失敗。0 を嘘で出さない（D-I14） */
  successRemaining: number | null;
  attemptsRemaining: number | null;
  shortWindowRemaining: number | null;
  shortWindowRetryAt: string | null;
  loading: boolean;
  error: boolean;
};

export type RegenerationSheetProps = {
  /** idea では child_friendly（年齢適合）を出さない。household は全理由を出す。 */
  targetMode: TargetMode;
  usage: RegenerationUsageView;
  /** 安全再検証中など、送信不可のとき true */
  actionsEnabled?: boolean;
  /**
   * design §269: 元条件で選んでいた期限経過在庫。再生成前に実物確認チェックが必要。
   * 空なら確認 UI を出さない。
   */
  expiredPantryItems?: readonly ExpiredPantryForRegen[];
  onSubmit: (value: RegenerationReasonInput) => Promise<void>;
  onCancel: () => void;
};

type FormValues = {
  changeReason: (typeof changeReasons)[number] | "";
  changeReasonCustom: string;
};

/**
 * 再生成の必須理由ダイアログ。
 * インライン section ではなく native <dialog> の modal で、背景操作を遮る。
 * 「安全」表現は出さず、成功時のみ1回消費する条件付きquota文言を固定する。
 * idea では年齢適合を意味する child_friendly を UI から除く（server も拒否する）。
 *
 * dialog 本体に .stack（display:grid）を付けない。作者スタイルの display は
 * UA の dialog:not([open]){display:none} を上書きするため、閉じた確認が
 * 初期表示から見えて操作を妨げる（DeleteAccountDialog / history-card と同じ方針）。
 */
export function RegenerationSheet({
  targetMode,
  usage,
  actionsEnabled = true,
  expiredPantryItems = [],
  onSubmit,
  onCancel,
}: RegenerationSheetProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const form = useForm<FormValues>({
    defaultValues: {
      changeReason: "",
      changeReasonCustom: "",
    },
  });
  const selectedReason = form.watch("changeReason");
  // design §269: 期限経過在庫は再生成のたびに未確認へ戻し、チェックで今回確認する
  const [confirmedExpiredIds, setConfirmedExpiredIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [expiredConfirmError, setExpiredConfirmError] = useState<string | null>(null);
  // idea は年齢適合を保証しないため「子どもが食べやすく」を選択肢から外す
  const reasons =
    targetMode === "idea" ? allReasons.filter(([value]) => value !== "child_friendly") : allReasons;

  // 親が mount した時点で modal を開く。unmount 時は close して top-layer を解放する。
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (!dialog.open) {
      dialog.showModal();
    }
    return () => {
      if (dialog.open) {
        dialog.close();
      }
    };
  }, []);

  const submit = form.handleSubmit(async (raw) => {
    form.clearErrors();
    // RHF は未選択 radio を "" または undefined にし得る。どちらも「未選択」として扱う
    const selected =
      raw.changeReason === "" || raw.changeReason === undefined ? undefined : raw.changeReason;
    if (selected === undefined) {
      form.setError("changeReason", { message: "理由を選んでください" });
      return;
    }
    const parsed = regenerationReasonSchema.safeParse({
      changeReason: selected,
      changeReasonCustom:
        selected === "custom"
          ? raw.changeReasonCustom.trim() === ""
            ? null
            : raw.changeReasonCustom.trim()
          : null,
    });
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        const field = issue.path[0];
        if (field === "changeReason" || field === "changeReasonCustom") {
          form.setError(field, { message: issue.message });
        } else {
          form.setError("changeReason", { message: "理由を選んでください" });
        }
      }
      return;
    }
    // idea UI から child_friendly を選べないことを二重に守る
    if (targetMode === "idea" && parsed.data.changeReason === "child_friendly") {
      form.setError("changeReason", { message: "理由を選んでください" });
      return;
    }
    if (
      expiredPantryItems.length > 0 &&
      expiredPantryItems.some((item) => !confirmedExpiredIds.has(item.pantryItemId))
    ) {
      setExpiredConfirmError("期限を過ぎた食材は、実物の状態を確認してチェックしてください。");
      return;
    }
    setExpiredConfirmError(null);
    const expiredPantryConfirmations: readonly ExpiredPantryConfirmation[] = expiredPantryItems.map(
      (item) => ({
        pantryItemId: item.pantryItemId,
        checkedAt: new Date().toISOString(),
      }),
    );
    try {
      await onSubmit({ ...parsed.data, expiredPantryConfirmations });
    } catch (error) {
      // D-M7: revalidation_required は unhandled rejection にせず利用者へ示す
      const message =
        error instanceof Error && error.message === "revalidation_required"
          ? "家族条件の再確認が終わるまで別案は作れません。しばらくしてからもう一度お試しください。"
          : "別案の作成を開始できませんでした。もう一度お試しください。";
      form.setError("changeReason", { message });
    }
  });

  const successBlocked = usage.successRemaining === 0;
  const expiredUnconfirmed =
    expiredPantryItems.length > 0 &&
    expiredPantryItems.some((item) => !confirmedExpiredIds.has(item.pantryItemId));
  const submitDisabled =
    form.formState.isSubmitting ||
    !actionsEnabled ||
    usage.loading ||
    usage.error ||
    successBlocked ||
    expiredUnconfirmed;

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      onCancel={(event) => {
        // Escape / 背面クリックの native close を止め、親の sheetMode 解除に委ねる
        event.preventDefault();
        if (form.formState.isSubmitting) return;
        onCancel();
      }}
      className="m-auto w-[calc(100%-2rem)] max-w-md rounded-2xl border bg-white p-5 shadow-lg"
    >
      <form onSubmit={(event) => void submit(event)} className="stack gap-4">
        <fieldset className="stack gap-2">
          <legend id={titleId} className="text-lg font-bold">
            どのように変えますか？
          </legend>
          {reasons.map(([value, label]) => (
            <label key={value} className="flex min-h-11 items-center gap-3">
              <input type="radio" value={value} {...form.register("changeReason")} />
              {label}
            </label>
          ))}
          {form.formState.errors.changeReason?.message !== undefined && (
            <span role="alert" className="error-message">
              {form.formState.errors.changeReason.message}
            </span>
          )}
        </fieldset>
        {selectedReason === "custom" ? (
          <label className="mt-2 block">
            どのように変えたいですか？
            <textarea
              className="mt-2 min-h-24 w-full rounded-xl border p-3"
              {...form.register("changeReasonCustom")}
            />
            {/* HR-I4: 自由記述に個人名を入れない注意（設計 §3） */}
            <p className="type-small mt-1">
              個人名や連絡先は書かないでください。献立の変えたい点だけ書いてください。
            </p>
            {form.formState.errors.changeReasonCustom?.message !== undefined && (
              <span role="alert" className="error-message">
                {form.formState.errors.changeReasonCustom.message}
              </span>
            )}
          </label>
        ) : null}
        {expiredPantryItems.length > 0 ? (
          <fieldset className="stack gap-2">
            <legend className="font-semibold">期限を過ぎた食材の確認</legend>
            <p className="type-small">
              入力した期限を過ぎています。実物の状態を確認できた食材だけチェックしてください（可食性の保証ではありません）。
            </p>
            {expiredPantryItems.map((item) => (
              <label key={item.pantryItemId} className="flex min-h-11 items-center gap-3">
                <input
                  type="checkbox"
                  checked={confirmedExpiredIds.has(item.pantryItemId)}
                  onChange={(event) => {
                    setConfirmedExpiredIds((current) => {
                      const next = new Set(current);
                      if (event.target.checked) next.add(item.pantryItemId);
                      else next.delete(item.pantryItemId);
                      return next;
                    });
                    setExpiredConfirmError(null);
                  }}
                />
                <span>{item.name}</span>
              </label>
            ))}
            {expiredConfirmError !== null ? (
              <span role="alert" className="error-message">
                {expiredConfirmError}
              </span>
            ) : null}
          </fieldset>
        ) : null}
        {usage.loading ? (
          <p role="status">本日の作成回数を確認しています…</p>
        ) : usage.error ? (
          <p role="alert" className="error-message">
            本日の作成回数を確認できませんでした。通信を確認してください。
          </p>
        ) : (
          <div className="stack gap-1">
            <p>
              {formatFreeTierQuotaCopy(
                usage.successRemaining === null
                  ? "別の献立が完成した場合に1回使用します"
                  : `別の献立が完成した場合に1回使用・現在残り${String(usage.successRemaining)}回`,
              )}
            </p>
            {usage.attemptsRemaining !== null && (
              <p className="type-small" role="status">
                {formatFreeTierQuotaCopy(
                  `AIへの問い合わせは本日あと${String(usage.attemptsRemaining)}回まで受け付けます`,
                )}
              </p>
            )}
            {usage.shortWindowRemaining === 0 && usage.shortWindowRetryAt !== null && (
              <p className="type-small" role="status">
                {formatFreeTierQuotaCopy(
                  `しばらく続けて作成を試したため、${new Intl.DateTimeFormat("ja-JP", {
                    timeZone: "Asia/Tokyo",
                    dateStyle: "short",
                    timeStyle: "short",
                  }).format(new Date(usage.shortWindowRetryAt))}以降に再試行してください`,
                )}
              </p>
            )}
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          <button
            className="min-h-11 rounded-xl bg-terracotta-700 px-4 font-semibold text-white"
            type="submit"
            disabled={submitDisabled}
          >
            別案を作る
          </button>
          <button
            type="button"
            className="min-h-11 rounded-xl border-2 border-terracotta-700 px-4 font-semibold"
            disabled={form.formState.isSubmitting}
            onClick={onCancel}
          >
            やめる
          </button>
        </div>
      </form>
    </dialog>
  );
}
