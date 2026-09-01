import { useEffect, useRef } from "react";
import { Button } from "@/shared/ui/button";
import { Inset, Stack } from "@/shared/ui/stack";
import { Surface } from "@/shared/ui/surface";

/**
 * ページ遷移直後の誤タップを弾く猶予（設計 P-03）。
 * 5〜8ページ目は .wizard-actions のボタンが同じ座標に並ぶため、連打の2発目が
 * 次ページの同位置ボタンへ落ちる。mount からこの間のボタン押下は無視する。
 *
 * 6〜8ページ目は「戻る」だけになり :only-child で右端へ寄るので、その座標は
 * 5ページ目の「以降は指定なしでスキップ」と重なる。戻るの2度押しが素通りすると、
 * 任意4項目を null にして確認へ飛ばしてしまう。
 */
const activationGuardMs = 350;

export type OptionalChoiceOption = {
  readonly value: string;
  readonly label: string;
};

export type OptionalChoiceStepProps = {
  /** radio の name と各種 id の接頭辞 */
  id: string;
  /** 「5. 調理時間」など。radiogroup の名前はこの heading 側に持たせる */
  title: string;
  /** 先頭は必ず「指定なし」（value: ""） */
  options: readonly OptionalChoiceOption[];
  /** 現在値。null は "" として渡す */
  value: string;
  onSelect: (selected: string) => void;
  onNext: () => void;
  onBack: () => void;
  disabled?: boolean;
  errorMessage?: string | null;
  description?: string;
  /** 渡されたときだけ「以降は指定なしでスキップ」を出す */
  onSkipRest?: () => void;
  nextLabel?: string;
  backLabel?: string;
};

/**
 * 任意の追加条件を1問1ページで選ばせる step。
 *
 * 選択と遷移は分ける。radio は値を変えるだけで、ページを進めるのは「次へ」だけ。
 * 選んだ瞬間に自動遷移していた頃は、選択が画面に残らないまま次ページへ飛ぶため
 * radio の見た目と挙動が食い違っていた（実機確認での指摘）。
 * 任意項目なので未選択（＝「指定なし」）のまま「次へ」で進める。
 */
export function OptionalChoiceStep({
  id,
  title,
  options,
  value,
  onSelect,
  onNext,
  onBack,
  disabled = false,
  errorMessage = null,
  description,
  onSkipRest,
  nextLabel = "次へ",
  backLabel = "戻る",
}: OptionalChoiceStepProps) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const mountedAt = useRef(Date.now());

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  const titleId = `${id}-title`;
  const errorId = `${id}-error`;
  const descriptionId = `${id}-description`;

  /** ボタン押下の可否。mount 直後の連打は次ページのボタンへの誤爆なので落とす。 */
  const blocked = (): boolean => disabled || Date.now() - mountedAt.current < activationGuardMs;

  // エラー時も説明は残す。7ページ目の調味料の注記は、直そうとしている本人にこそ要る。
  const describedByIds = [
    ...(description !== undefined ? [descriptionId] : []),
    ...(errorMessage != null ? [errorId] : []),
  ];
  const describedBy = describedByIds.length === 0 ? undefined : describedByIds.join(" ");

  return (
    <section aria-labelledby={titleId}>
      <Surface>
        <Inset pad={5}>
          <Stack gap={5}>
            <h2 id={titleId} tabIndex={-1} ref={headingRef}>
              {title}
            </h2>
            <div
              className="wizard-option-list"
              role="radiogroup"
              aria-labelledby={titleId}
              aria-describedby={describedBy}
            >
              {options.map((option) => (
                <label key={option.value} className="wizard-option">
                  <input
                    type="radio"
                    name={id}
                    disabled={disabled}
                    checked={value === option.value}
                    aria-invalid={errorMessage != null ? "true" : undefined}
                    onChange={() => {
                      onSelect(option.value);
                    }}
                  />
                  <span>{option.label}</span>
                </label>
              ))}
            </div>
            {description !== undefined && (
              <p id={descriptionId} className="type-small">
                {description}
              </p>
            )}
            {errorMessage != null && (
              <p id={errorId} role="alert">
                {errorMessage}
              </p>
            )}
            <div className="wizard-actions">
              <Button
                variant="secondary"
                disabled={disabled}
                onClick={() => {
                  if (blocked()) return;
                  onBack();
                }}
              >
                {backLabel}
              </Button>
              {onSkipRest !== undefined && (
                <Button
                  variant="secondary"
                  disabled={disabled}
                  onClick={() => {
                    if (blocked()) return;
                    onSkipRest();
                  }}
                >
                  以降は指定なしでスキップ
                </Button>
              )}
              <Button
                variant="primary"
                disabled={disabled}
                onClick={() => {
                  if (blocked()) return;
                  onNext();
                }}
              >
                {nextLabel}
              </Button>
            </div>
          </Stack>
        </Inset>
      </Surface>
    </section>
  );
}
