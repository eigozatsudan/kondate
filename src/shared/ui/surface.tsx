import type { HTMLAttributes, JSX, ReactNode, SubmitEventHandler } from "react";

/**
 * レイアウトプリミティブが必ず素通しする属性。
 * これを付けずに実装すると、aria-* はハイフン名のため型検査を素通りし、
 * 実行時に黙って消える（a11y の静かな退行）。
 */
export type LandmarkProps = Pick<
  HTMLAttributes<HTMLElement>,
  "id" | "role" | "aria-label" | "aria-labelledby"
>;

export type SurfaceTone = "plain" | "sunken" | "notice";

export type SurfaceProps = LandmarkProps & {
  tone?: SurfaceTone;
  as?: "div" | "section" | "article" | "form";
  children: ReactNode;
  /**
   * as="form" のときだけ意味を持つ。pantry-form.tsx:131 が
   * <form onSubmit={…}> であり、これが無いと Task 0.7 で
   * <Surface as="form"> に移行できない。
   * onSubmit はハイフンを含まない camelCase なので TypeScript の
   * 余剰プロパティ検査に引っかかり、型に無いと即コンパイルエラーになる
   * （aria-label が黙って消えるのとは逆の壊れ方をする）。
   * React 19 では FormEventHandler が deprecated のため SubmitEventHandler を使う。
   */
  onSubmit?: SubmitEventHandler<HTMLFormElement>;
};

const toneClass: Record<SurfaceTone, string> = {
  plain: "ui-surface--plain",
  sunken: "ui-surface--sunken",
  notice: "ui-surface--notice",
};

export function Surface({
  tone = "plain",
  as: Tag = "div",
  children,
  onSubmit,
  ...rest
}: SurfaceProps): JSX.Element {
  const className = `ui-surface ${toneClass[tone]}`;
  // form 以外に onSubmit を渡すと HTMLDivElement との型が衝突するため分岐する
  if (Tag === "form") {
    return (
      <form {...rest} className={className} onSubmit={onSubmit}>
        {children}
      </form>
    );
  }
  return (
    <Tag {...rest} className={className}>
      {children}
    </Tag>
  );
}
