import { useRef, useState } from "react";
import { flushSync } from "react-dom";
import { useForm } from "react-hook-form";
import {
  expirationTypes,
  openedStates,
  type PantryItemInput,
  pantryItemInputSchema,
} from "@shared/contracts/pantry";
import { alignLocalDateInputToJstDay } from "@shared/time/jst";
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

/** 「くわしく入力する」の開閉に収める任意項目。食材名と期限日は常に見せる。 */
const detailFields: readonly (keyof PantryItemInput)[] = [
  "quantity",
  "unit",
  "expirationType",
  "openedState",
];

function hasDetailValue(value: PantryItemInput): boolean {
  return (
    value.quantity !== null ||
    value.unit !== null ||
    value.expirationType !== null ||
    value.openedState !== null
  );
}

/**
 * RHF の setValueAs には、DOM からの文字列だけでなく既定値（null）や編集時の数値もそのまま渡る。
 * 型を string と書くと Number(null) = 0 のような取り違えを見落とすため、実際に来る値で受ける。
 */
type RawFieldValue = string | number | null | undefined;

function blankToNull(value: RawFieldValue): string | null {
  if (value === "" || value === null || value === undefined) return null;
  return String(value);
}

function quantityFromField(value: RawFieldValue): number | null {
  // 未操作のまま送信すると既定値の null が渡る。Number(null) は 0 になり
  // 「分量と単位は両方」エラーで名前だけの追加が通らないため、未入力として扱う。
  if (value === "" || value === null || value === undefined) return null;
  return typeof value === "number" ? value : Number(value);
}

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
  // 編集時に任意項目の入力済み値があれば、最初から開いて見せる。
  const [detailsOpen, setDetailsOpen] = useState(() => hasDetailValue(initialValue));
  const submit = form.handleSubmit(async (input) => {
    if (submitInFlightRef.current || saving) return;
    submitInFlightRef.current = true;
    form.clearErrors();
    const parsed = pantryItemInputSchema.safeParse(input);
    if (!parsed.success) {
      let firstInvalidField: keyof PantryItemInput | undefined;
      let hasDetailError = false;
      for (const issue of parsed.error.issues) {
        const field = issue.path[0];
        if (field !== undefined && isPantryField(field)) {
          firstInvalidField ??= field;
          if (detailFields.includes(field)) hasDetailError = true;
          form.setError(field, { message: japaneseValidationMessage(field, issue.message) });
        } else {
          form.setError("root.schema", { message: "入力内容を確認してください" });
        }
      }
      // 最初のエラーが開閉の外（食材名など）でも、開閉の中にエラーがあれば開いて見せる。
      // 閉じた details の中はフォーカスできないため、先に開いて描画を確定させる。
      if (hasDetailError) {
        flushSync(() => {
          setDetailsOpen(true);
        });
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
          <label className="field">
            期限日
            <input
              type="date"
              {...errorAttributes("expiresOn")}
              {...form.register("expiresOn", {
                setValueAs: (value: RawFieldValue) => {
                  const date = blankToNull(value);
                  return date === null ? null : alignLocalDateInputToJstDay(date, new Date());
                },
              })}
            />
          </label>
          <p className="muted">期限日は日本時間で判定します。</p>
          {fieldError("expiresOn")}
          {/*
            任意項目は開閉にまとめ、名前と期限日だけで追加を始められるようにする。
            開閉の中にある項目がエラーになったときは submit 側で自動的に開く。
            ブラウザ標準の制約検証（分量の min/step や途中までの数値入力）は onSubmit より前に
            止まるため、invalid イベントでも開く。閉じたままだとブラウザは項目へフォーカスできず、
            吹き出しも出ないので、押しても何も起きないように見えてしまう。
          */}
          <details
            className="pantry-details"
            open={detailsOpen}
            onInvalid={() => {
              if (detailsOpen) return;
              flushSync(() => {
                setDetailsOpen(true);
              });
            }}
            onToggle={(event) => {
              setDetailsOpen(event.currentTarget.open);
            }}
          >
            <summary className="pantry-details-summary">
              {/* 開閉の記号は見た目だけ。読み上げ名に入れない（最終レビュー C M-2） */}
              <span className="pantry-details-marker" aria-hidden="true">
                {detailsOpen ? "▾" : "▸"}
              </span>
              くわしく入力する（分量・単位・期限の種類・開封状態）
            </summary>
            <div className="pantry-details-body">
              <Stack gap={4}>
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
                          setValueAs: quantityFromField,
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
                          setValueAs: blankToNull,
                        })}
                      />
                    </label>
                    {fieldError("unit")}
                  </div>
                </div>
                <label className="field">
                  期限の種類
                  <select
                    {...errorAttributes("expirationType")}
                    {...form.register("expirationType", {
                      setValueAs: blankToNull,
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
                      setValueAs: blankToNull,
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
              </Stack>
            </div>
          </details>
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
