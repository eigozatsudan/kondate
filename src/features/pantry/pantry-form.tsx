import { useRef } from "react";
import { useForm } from "react-hook-form";
import {
  expirationTypes,
  openedStates,
  type PantryItemInput,
  pantryItemInputSchema,
} from "@shared/contracts/pantry";
import { Button } from "@/shared/ui/button";
import { Inset, Stack } from "@/shared/ui/stack";
import { Surface } from "@/shared/ui/surface";

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
  unknown: "わからない",
} as const;
const openedLabels = {
  unopened: "未開封として登録",
  opened: "開封済みとして登録",
  unknown: "わからないまま登録",
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

const fallbackValidationMessages: Record<keyof PantryItemInput, string> = {
  name: "食材名を正しく入力してください",
  quantity: "分量を正しく入力してください",
  unit: "単位を正しく入力してください",
  expiresOn: "期限日を正しく入力してください",
  expirationType: "期限の種類を選び直してください",
  openedState: "開封状態を選び直してください",
};

function japaneseValidationMessage(field: keyof PantryItemInput, message: string): string {
  return /[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u.test(message)
    ? message
    : fallbackValidationMessages[field];
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
  // PE14: React の isPending 反映前に enter 連打されると handleSubmit が二重起動し得る。
  // フォーム側でも single-flight して create 二重 insert を抑止する。
  const submitInFlightRef = useRef(false);
  const submit = form.handleSubmit(async (input) => {
    if (submitInFlightRef.current || saving) return;
    submitInFlightRef.current = true;
    form.clearErrors();
    const parsed = pantryItemInputSchema.safeParse(input);
    if (!parsed.success) {
      let firstInvalidField: keyof PantryItemInput | undefined;
      for (const issue of parsed.error.issues) {
        const field = issue.path[0];
        if (field !== undefined && isPantryField(field)) {
          firstInvalidField ??= field;
          form.setError(field, { message: japaneseValidationMessage(field, issue.message) });
        } else {
          form.setError("root.schema", { message: "入力内容を確認してください" });
        }
      }
      if (firstInvalidField !== undefined) {
        form.setFocus(firstInvalidField);
      }
      submitInFlightRef.current = false;
      return;
    }
    try {
      await onSubmit(parsed.data);
      form.reset(defaults);
    } catch {
      // 親画面が通信・競合エラーを表示するため、入力値を保持して再確認できる状態にします。
    } finally {
      submitInFlightRef.current = false;
    }
  });
  const errorAttributes = (field: keyof PantryItemInput) => {
    const hasError = form.formState.errors[field] !== undefined;
    return {
      "aria-invalid": hasError,
      "aria-describedby": hasError ? `pantry-${field}-error` : undefined,
    } as const;
  };
  const fieldError = (field: keyof PantryItemInput) => {
    const error = form.formState.errors[field];
    return error === undefined ? null : (
      <p id={`pantry-${field}-error`} className="error-message" role="alert" lang="ja">
        {error.message}
      </p>
    );
  };
  return (
    <Surface
      as="form"
      onSubmit={(event) => {
        void submit(event);
      }}
    >
      <Inset pad={5}>
        <Stack gap={4}>
          {/* フォーカス復帰契約: 親が querySelector("h2") で掴む。tabIndex=-1 必須。 */}
          <h2 className="pantry-form-title" tabIndex={-1}>
            {title}
          </h2>
          <label className="field">
            食材名
            <input autoComplete="off" {...errorAttributes("name")} {...form.register("name")} />
          </label>
          {fieldError("name")}
          <div className="pantry-field-row">
            <div>
              <label className="field">
                分量
                <input
                  type="number"
                  min="0.001"
                  step="0.001"
                  {...errorAttributes("quantity")}
                  {...form.register("quantity", {
                    setValueAs: (value: string) => (value === "" ? null : Number(value)),
                  })}
                />
              </label>
              {fieldError("quantity")}
            </div>
            <div>
              <label className="field">
                単位
                <input
                  autoComplete="off"
                  {...errorAttributes("unit")}
                  {...form.register("unit", {
                    setValueAs: (value: string) => (value === "" ? null : value),
                  })}
                />
              </label>
              {fieldError("unit")}
            </div>
          </div>
          <label className="field">
            期限日
            <input
              type="date"
              {...errorAttributes("expiresOn")}
              {...form.register("expiresOn", {
                setValueAs: (value: string) => (value === "" ? null : value),
              })}
            />
          </label>
          {fieldError("expiresOn")}
          <label className="field">
            期限の種類
            <select
              {...errorAttributes("expirationType")}
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
          {fieldError("expirationType")}
          <label className="field">
            開封状態
            <select
              {...errorAttributes("openedState")}
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
          {fieldError("openedState")}
          {form.formState.errors.root?.schema !== undefined && (
            <p className="error-message" role="alert" lang="ja">
              {form.formState.errors.root.schema.message}
            </p>
          )}
          {/* type="submit" を明示しないと既定の button になり Enter 送信が壊れる */}
          <Button type="submit" busy={saving}>
            {saving ? "保存中…" : submitLabel}
          </Button>
          {onCancel !== undefined && (
            <Button variant="ghost" disabled={saving} type="button" onClick={onCancel}>
              キャンセル
            </Button>
          )}
        </Stack>
      </Inset>
    </Surface>
  );
}
