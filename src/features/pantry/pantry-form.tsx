import { useForm } from "react-hook-form";
import {
  expirationTypes,
  openedStates,
  type PantryItemInput,
  pantryItemInputSchema,
} from "@shared/contracts/pantry";

const defaults: PantryItemInput = {
  name: "",
  quantity: null,
  unit: null,
  expiresOn: null,
  expirationType: null,
  openedState: null,
};

const expirationLabels = {
  use_by: "消費期限",
  best_before: "賞味期限",
  other: "その他",
  unknown: "不明",
} as const;
const openedLabels = {
  unopened: "未開封として登録",
  opened: "開封済みとして登録",
  unknown: "不明として登録",
} as const;

const pantryFields: readonly (keyof PantryItemInput)[] = [
  "name",
  "quantity",
  "unit",
  "expiresOn",
  "expirationType",
  "openedState",
];

function isPantryField(value: PropertyKey): value is keyof PantryItemInput {
  return pantryFields.some((field) => field === value);
}

type PantryFormProps = {
  saving: boolean;
  initialValue?: PantryItemInput;
  title?: string;
  submitLabel?: string;
  onSubmit: (input: PantryItemInput) => Promise<void>;
  onCancel?: () => void;
};

export function PantryForm({
  saving,
  initialValue = defaults,
  title = "食材を追加",
  submitLabel = "追加する",
  onSubmit,
  onCancel,
}: PantryFormProps) {
  const form = useForm<PantryItemInput>({
    defaultValues: initialValue,
  });
  const submit = form.handleSubmit(async (input) => {
    form.clearErrors();
    const parsed = pantryItemInputSchema.safeParse(input);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        const field = issue.path[0];
        if (field !== undefined && isPantryField(field)) {
          form.setError(field, { message: issue.message });
        }
      }
      return;
    }
    try {
      await onSubmit(parsed.data);
      form.reset(defaults);
    } catch {
      // 親画面が通信・競合エラーを表示するため、入力値を保持して再確認できる状態にします。
    }
  });
  return (
    <form
      className="card stack"
      onSubmit={(event) => {
        void submit(event);
      }}
    >
      <h2>{title}</h2>
      <label className="field">
        食材名
        <input autoComplete="off" {...form.register("name")} />
      </label>
      {form.formState.errors.name !== undefined && (
        <p className="error-message">{form.formState.errors.name.message}</p>
      )}
      <div className="pantry-field-row">
        <label className="field">
          分量
          <input
            type="number"
            min="0.001"
            step="0.001"
            {...form.register("quantity", {
              setValueAs: (value: string) => (value === "" ? null : Number(value)),
            })}
          />
        </label>
        <label className="field">
          単位
          <input
            autoComplete="off"
            {...form.register("unit", {
              setValueAs: (value: string) => (value === "" ? null : value),
            })}
          />
        </label>
      </div>
      {form.formState.errors.quantity !== undefined && (
        <p className="error-message">{form.formState.errors.quantity.message}</p>
      )}
      <label className="field">
        期限日
        <input
          type="date"
          {...form.register("expiresOn", {
            setValueAs: (value: string) => (value === "" ? null : value),
          })}
        />
      </label>
      <label className="field">
        期限の種類
        <select
          {...form.register("expirationType", {
            setValueAs: (value: string) => (value === "" ? null : value),
          })}
        >
          <option value="">指定なし</option>
          {expirationTypes.map((value) => (
            <option key={value} value={value}>
              {expirationLabels[value]}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        開封状態
        <select
          {...form.register("openedState", {
            setValueAs: (value: string) => (value === "" ? null : value),
          })}
        >
          <option value="">指定なし</option>
          {openedStates.map((value) => (
            <option key={value} value={value}>
              {openedLabels[value]}
            </option>
          ))}
        </select>
      </label>
      <button className="primary-button" disabled={saving} type="submit">
        {saving ? "保存中…" : submitLabel}
      </button>
      {onCancel !== undefined && (
        <button className="text-button" disabled={saving} type="button" onClick={onCancel}>
          キャンセル
        </button>
      )}
    </form>
  );
}
