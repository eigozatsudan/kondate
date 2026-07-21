import { useForm } from "react-hook-form";
import { z } from "zod";
import { changeReasons } from "@shared/contracts/domain";

const reasons = [
  ["simpler", "もっと簡単に"],
  ["different_ingredient", "別の食材で"],
  ["child_friendly", "子どもが食べやすく"],
  ["different_flavor", "別の味に"],
  ["custom", "その他"],
] as const;

/** 再生成理由のブラウザ入力契約。custom のときだけ自由記述を必須にする。 */
const regenerationReasonSchema = z
  .object({
    changeReason: z.enum(changeReasons),
    changeReasonCustom: z.string().trim().min(1).max(200).nullable().default(null),
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

export type RegenerationReasonInput = z.infer<typeof regenerationReasonSchema>;

type RegenerationSheetProps = {
  remaining: number;
  onSubmit: (value: RegenerationReasonInput) => Promise<void>;
  onCancel?: () => void;
};

type FormValues = {
  changeReason: (typeof changeReasons)[number] | "";
  changeReasonCustom: string;
};

/**
 * 再生成の必須理由シート。
 * 「安全」表現は出さず、成功時のみ1回消費する条件付きquota文言を固定する。
 */
export function RegenerationSheet({ remaining, onSubmit, onCancel }: RegenerationSheetProps) {
  const form = useForm<FormValues>({
    defaultValues: {
      changeReason: "",
      changeReasonCustom: "",
    },
  });
  const selectedReason = form.watch("changeReason");

  const submit = form.handleSubmit(async (raw) => {
    form.clearErrors();
    const parsed = regenerationReasonSchema.safeParse({
      changeReason: raw.changeReason === "" ? undefined : raw.changeReason,
      changeReasonCustom:
        raw.changeReason === "custom"
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
      if (raw.changeReason === "") {
        form.setError("changeReason", { message: "理由を選んでください" });
      }
      return;
    }
    await onSubmit(parsed.data);
  });

  return (
    <form onSubmit={(event) => void submit(event)} className="stack gap-4">
      <fieldset className="stack gap-2">
        <legend className="text-lg font-bold">どのように変えますか？</legend>
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
          {form.formState.errors.changeReasonCustom?.message !== undefined && (
            <span role="alert" className="error-message">
              {form.formState.errors.changeReasonCustom.message}
            </span>
          )}
        </label>
      ) : null}
      <p>別の献立が完成した場合に1回使用・現在残り{remaining}回</p>
      <div className="flex flex-wrap gap-2">
        <button
          className="min-h-11 rounded-xl bg-slate-900 px-4 font-semibold text-white"
          type="submit"
          disabled={form.formState.isSubmitting}
        >
          別案を作る
        </button>
        {onCancel !== undefined && (
          <button
            type="button"
            className="min-h-11 rounded-xl border-2 border-stone-800 px-4 font-semibold"
            disabled={form.formState.isSubmitting}
            onClick={onCancel}
          >
            やめる
          </button>
        )}
      </div>
    </form>
  );
}
