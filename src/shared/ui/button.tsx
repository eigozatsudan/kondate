import type { ComponentPropsWithRef, JSX } from "react";

export type ButtonVariant = "primary" | "secondary" | "ghost";
export type ButtonSize = "regular" | "large";

/**
 * 共有ボタン。className を受け取らないのは意図的で、呼び出し側からの
 * 生ユーティリティ注入を型で塞ぐ（CSP と二重系統の再発防止）。
 * ComponentPropsWithRef を使うのは ref を通すため（ButtonHTMLAttributes には
 * ref が含まれず、pantry のフォーカス復帰契約が実装できなくなる）。
 */
export type ButtonProps = Omit<ComponentPropsWithRef<"button">, "className"> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  busy?: boolean;
};

/** CSP style-src 'self' のため、可変 prop は列挙済みクラスへのマップのみで表現する。 */
const variantClass: Record<ButtonVariant, string> = {
  primary: "ui-btn--primary",
  secondary: "ui-btn--secondary",
  ghost: "ui-btn--ghost",
};

const sizeClass: Record<ButtonSize, string> = {
  regular: "ui-btn--regular",
  large: "ui-btn--large",
};

export function Button({
  variant = "primary",
  size = "regular",
  busy = false,
  disabled = false,
  type = "button",
  children,
  ...rest
}: ButtonProps): JSX.Element {
  return (
    <button
      {...rest}
      type={type}
      className={`ui-btn ${variantClass[variant]} ${sizeClass[size]}`}
      disabled={disabled || busy}
      aria-busy={busy}
    >
      {children}
    </button>
  );
}
