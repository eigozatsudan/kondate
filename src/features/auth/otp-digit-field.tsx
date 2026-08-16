import { useRef, type ChangeEvent, type ClipboardEvent, type JSX, type KeyboardEvent } from "react";
import { EMAIL_OTP_DIGIT_ARIA_LABELS } from "./email-otp-copy";

const OTP_DIGIT_COUNT = 6;

/**
 * 全角数字や混在文字列を、確認に使える半角数字だけにする。
 * NFKC で全角→半角したあと非数字を落とし、6 桁で切る（7 桁貼付の先頭 6）。
 */
// eslint-disable-next-line react-refresh/only-export-components -- 正規化はマス入力と同じ契約ファイルに置く
export function normalizeOtpDigits(raw: string): string {
  return raw.normalize("NFKC").replace(/\D/gu, "").slice(0, 6);
}

/**
 * 6 マスの確認番号入力。
 * 親が value を持ち、6 桁そろったタイミングで確認する。
 * ここでは verify せず、番号も storage / console に残さない。
 */
export function OtpDigitField(props: {
  value: string;
  disabled: boolean;
  onChange(next: string): void;
}): JSX.Element {
  const { value, disabled } = props;
  const digits = normalizeOtpDigits(value);
  // IME 確定前の Enter で onChange しないための同期フラグ。render を起こさない。
  const composingRef = useRef(false);
  const boxRefs = useRef<Array<HTMLInputElement | null>>([]);

  function emit(next: string): void {
    // 分割代入すると unbound-method になるため、props 経由で呼ぶ
    props.onChange(normalizeOtpDigits(next));
  }

  function focusBox(index: number): void {
    const nextIndex = Math.min(OTP_DIGIT_COUNT - 1, Math.max(0, index));
    boxRefs.current[nextIndex]?.focus();
  }

  function commitFromBox(index: number, raw: string): void {
    if (composingRef.current) return;
    const incoming = normalizeOtpDigits(raw);
    if (incoming === "") {
      // 文字入力のゴミは無視し、空になったときだけそのマス以降を捨てる
      if (raw === "") {
        emit(digits.slice(0, index));
      }
      return;
    }
    emit(digits.slice(0, index) + incoming);
    if (index < OTP_DIGIT_COUNT - 1) {
      focusBox(index + incoming.length);
    }
  }

  function handleHiddenInput(event: ChangeEvent<HTMLInputElement>): void {
    if (composingRef.current) return;
    emit(event.currentTarget.value);
  }

  function handleBoxPaste(index: number, event: ClipboardEvent<HTMLInputElement>): void {
    event.preventDefault();
    if (disabled || composingRef.current) return;
    // 貼付先より前の桁は残し、貼った数字を続けて最大 6 桁にする
    const pasted = normalizeOtpDigits(event.clipboardData.getData("text"));
    const next = normalizeOtpDigits(digits.slice(0, index) + pasted);
    emit(next);
    focusBox(Math.min(OTP_DIGIT_COUNT - 1, next.length));
  }

  function handleBoxKeyDown(index: number, event: KeyboardEvent<HTMLInputElement>): void {
    if (event.key === "Enter") {
      // フォーム送信を起こさず、IME 中は確定前の値を親へ渡さない
      event.preventDefault();
      return;
    }
    if (event.key !== "Backspace" || composingRef.current || disabled) return;
    event.preventDefault();
    const hasDigit = digits[index] !== undefined;
    if (hasDigit) {
      emit(digits.slice(0, index));
      if (index > 0) focusBox(index - 1);
      return;
    }
    if (index > 0) {
      emit(digits.slice(0, index - 1));
      focusBox(index - 1);
    }
  }

  return (
    <fieldset className="control-group" disabled={disabled}>
      <legend>確認番号</legend>
      {/*
        SMS 等の one-time-code は単一ルートにだけ付ける。
        6 マス側の名前と二重に読ませないため a11y ツリーから外す。
      */}
      <input
        className="sr-only"
        aria-hidden="true"
        tabIndex={-1}
        autoComplete="one-time-code"
        inputMode="numeric"
        maxLength={6}
        value={digits}
        disabled={disabled}
        onChange={handleHiddenInput}
        onCompositionStart={() => {
          composingRef.current = true;
        }}
        onCompositionEnd={(event) => {
          composingRef.current = false;
          emit(event.currentTarget.value);
        }}
      />
      <div className="flex w-full min-w-0 flex-nowrap justify-start gap-0.5">
        {EMAIL_OTP_DIGIT_ARIA_LABELS.map((label, index) => (
          <input
            key={label}
            ref={(node) => {
              boxRefs.current[index] = node;
            }}
            type="text"
            inputMode="numeric"
            autoComplete="off"
            maxLength={1}
            aria-label={label}
            className="h-11 w-11 min-h-11 min-w-11 shrink-0 rounded-[10px] border border-line-strong bg-white text-center text-lg text-ink tabular-nums"
            value={digits[index] ?? ""}
            disabled={disabled}
            onChange={(event) => {
              commitFromBox(index, event.currentTarget.value);
            }}
            onPaste={(event) => {
              handleBoxPaste(index, event);
            }}
            onKeyDown={(event) => {
              handleBoxKeyDown(index, event);
            }}
            onCompositionStart={() => {
              composingRef.current = true;
            }}
            onCompositionEnd={(event) => {
              composingRef.current = false;
              commitFromBox(index, event.currentTarget.value);
            }}
          />
        ))}
      </div>
    </fieldset>
  );
}
