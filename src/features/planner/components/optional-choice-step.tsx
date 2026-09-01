import { useEffect, useRef } from "react";
import { Button } from "@/shared/ui/button";
import { Inset, Stack } from "@/shared/ui/stack";
import { Surface } from "@/shared/ui/surface";

/**
 * 自動遷移直後の誤タップを弾く猶予（設計 P-03）。
 * 4ページとも .wizard-option が同じ座標に並ぶため、~300ms 後の2発目が
 * 次ページの同位置カードへ落ちる。mount からこの間の活性化と change は無視する。
 *
 * .wizard-actions のボタンも同じ猶予の対象にする。6〜8ページ目は「戻る」だけになり
 * :only-child で右端へ寄るため、その座標は5ページ目の「以降は指定なしでスキップ」と
 * 重なる。戻るの2度押しが素通りすると、任意4項目を null にして確認へ飛ばしてしまう。
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
  backLabel?: string;
};

/**
 * 任意の追加条件を1問1ページで選ばせる step。選んだ瞬間に次のページへ進むため
 * 「次へ」は持たない。
 *
 * 遷移の受け口を cuisine-step と変えているのは意図的（設計 P-02 / D-03）。
 * native radio の onChange を遷移トリガにすると、既定で checked の「指定なし」を
 * 再タップしても change が出ずページから出られず、矢印キーの change でページが飛ぶ。
 * そこで値の更新（onChange）と活性化（label の pointerup / radio の Space keyup）を
 * 分け、活性化単位の mutex で同一ジェスチャの後続イベントを吸収する。
 *
 * mountedAt / activating は instance ローカルなので、呼び出し側は key={step} を渡すこと。
 * 4ページは同一 component type で <main> の形も同じため、key が無いと React が
 * instance を再利用し、mutex が立ったまま次ページへ持ち越される。
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
  backLabel = "戻る",
}: OptionalChoiceStepProps) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const mountedAt = useRef(Date.now());
  // 活性化 mutex（instance ごと）。同一ジェスチャの後続 click / change を落とす。
  const activating = useRef(false);

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  const titleId = `${id}-title`;
  const errorId = `${id}-error`;
  const descriptionId = `${id}-description`;

  /**
   * 350ms ガードと disabled は mutex より先に見る。ここで弾いたときは mutex を立てない。
   * 逆順にすると弾かれた操作が mutex を立て、「戻る」しか無い 6〜8 ページ目から出られなくなる。
   */
  const blocked = (): boolean => disabled || Date.now() - mountedAt.current < activationGuardMs;

  const activate = (optionValue: string): void => {
    if (blocked() || activating.current) return;
    activating.current = true;
    onSelect(optionValue);
    onNext();
  };

  /** 値だけの更新（矢印キー・プログラム的変更）。mutex は立てない。 */
  const handleChange = (optionValue: string): void => {
    if (blocked() || activating.current) return;
    onSelect(optionValue);
  };

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
                <label
                  key={option.value}
                  className="wizard-option"
                  onPointerUp={(event) => {
                    // キーボードは pointer event を出さないので矢印キーはここに来ない。
                    // WebKit の label 転送 click は detail が 0 固定なので detail は見ない。
                    if (event.button === 0 && event.isPrimary) {
                      activate(option.value);
                    }
                  }}
                >
                  <input
                    type="radio"
                    name={id}
                    disabled={disabled}
                    checked={value === option.value}
                    aria-invalid={errorMessage != null ? "true" : undefined}
                    onChange={() => {
                      handleChange(option.value);
                    }}
                    onKeyUp={(event) => {
                      if (event.key === " ") {
                        activate(option.value);
                      }
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
            </div>
          </Stack>
        </Inset>
      </Surface>
    </section>
  );
}
