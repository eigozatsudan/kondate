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

type SurfaceCommon = LandmarkProps & {
  tone?: SurfaceTone;
  children: ReactNode;
};

/**
 * as ごとの prop を判別共用体にする。
 * onSubmit を常に受け付けると as="section" でも型が通り、実行時に黙って捨てられる
 * （Phase 0 敵対的レビュー指摘）。form のときだけ onSubmit を許可する。
 */
export type SurfaceProps =
  | (SurfaceCommon & {
      as?: "div" | "section" | "article";
    })
  | (SurfaceCommon & {
      as: "form";
      onSubmit?: SubmitEventHandler<HTMLFormElement>;
    });

const toneClass: Record<SurfaceTone, string> = {
  plain: "ui-surface--plain",
  sunken: "ui-surface--sunken",
  notice: "ui-surface--notice",
};

export function Surface(props: SurfaceProps): JSX.Element {
  const tone = props.tone ?? "plain";
  const className = `ui-surface ${toneClass[tone]}`;

  if (props.as === "form") {
    const { tone: _tone, as: _as, children, onSubmit, ...rest } = props;
    return (
      <form {...rest} className={className} onSubmit={onSubmit}>
        {children}
      </form>
    );
  }

  const { tone: _tone, as: Tag = "div", children, ...rest } = props;
  return (
    <Tag {...rest} className={className}>
      {children}
    </Tag>
  );
}
