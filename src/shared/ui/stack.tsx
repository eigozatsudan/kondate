import type { JSX, ReactNode } from "react";
import type { LandmarkProps } from "./surface";

/** 既存の --space-1〜--space-7（4/8/12/16/24/32/48px）に 1 対 1 対応する。 */
export type SpaceStep = 1 | 2 | 3 | 4 | 5 | 6 | 7;

export type StackProps = LandmarkProps & {
  gap?: SpaceStep;
  as?: "div" | "section" | "ul";
  children: ReactNode;
};

export function Stack({
  gap = 4,
  as: Tag = "div",
  children,
  role,
  ...rest
}: StackProps): JSX.Element {
  // list-style: none は Safari/VoiceOver でリストセマンティクスを失わせるため、
  // as="ul" かつ role 未指定のとき role="list" を既定で付ける。
  // rest を必ず spread する。落とすと aria-* が型検査を素通りして実行時に消える。
  const resolvedRole = role ?? (Tag === "ul" ? "list" : undefined);

  return (
    <Tag
      {...rest}
      {...(resolvedRole !== undefined ? { role: resolvedRole } : {})}
      className={`ui-stack ui-stack--gap-${String(gap)}`}
    >
      {children}
    </Tag>
  );
}

export type InsetProps = LandmarkProps & { pad?: SpaceStep; children: ReactNode };

export function Inset({ pad = 4, children, ...rest }: InsetProps): JSX.Element {
  return (
    <div {...rest} className={`ui-inset ui-inset--pad-${String(pad)}`}>
      {children}
    </div>
  );
}
