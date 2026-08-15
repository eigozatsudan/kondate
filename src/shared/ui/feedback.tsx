import { useEffect, useState, type JSX, type ReactNode } from "react";

export type SkeletonProps = { lines?: 1 | 2 | 3; label: string };

/**
 * 読み込み中のプレースホルダ。label は必須。
 * 視覚的な箱だけを出して読み上げを黙らせない（axe region 契約と同じ考え方）。
 */
export function Skeleton({ lines = 2, label }: SkeletonProps): JSX.Element {
  return (
    <div className="ui-skeleton" role="status" aria-live="polite">
      <span className="ui-skeleton__label">{label}</span>
      {Array.from({ length: lines }, (_, index) => (
        <span key={index} className="ui-skeleton__line" aria-hidden="true" />
      ))}
    </div>
  );
}

/**
 * L10: 全画面待ち。aria-live の初期コンテンツは多くの SR で通知されないため、
 * mount 後に role=status を埋めて「変更」として通知する。
 * 視覚は初回 paint から message を出し、announce 後は status ノードだけに集約する。
 */
/**
 * L2: lazy 初回一致で Router ツリーが空のあいだの pending `<main>`。
 * hang 打ち切りは各 route の withTimeout(C5) のまま。ここは空白を埋めるだけ。
 */
export function RouterPendingFallback(): JSX.Element {
  return <LivePendingMain message="読み込み中…" />;
}

export function LivePendingMain({
  message,
  heading,
}: {
  message: string;
  /** AppShell 外の待ち面向け。見出しランドマークが必要なときだけ渡す。 */
  heading?: string;
}): JSX.Element {
  const [announced, setAnnounced] = useState(false);
  useEffect(() => {
    setAnnounced(true);
  }, []);
  return (
    <main className="page-frame" aria-busy="true">
      {heading !== undefined ? <h1>{heading}</h1> : null}
      {!announced ? <p aria-hidden="true">{message}</p> : null}
      <p role="status" aria-live="polite">
        {announced ? message : ""}
      </p>
    </main>
  );
}

export type EmptyStateProps = {
  title: string;
  body: string;
  /** aria-labelledby の参照先にする場合の見出し id。 */
  titleId?: string;
  action?: ReactNode;
};

export function EmptyState({ title, body, titleId, action }: EmptyStateProps): JSX.Element {
  return (
    <div className="ui-empty">
      <h3 className="ui-empty__title" {...(titleId !== undefined ? { id: titleId } : {})}>
        {title}
      </h3>
      <p className="ui-empty__body">{body}</p>
      {action !== undefined && <div className="ui-empty__action">{action}</div>}
    </div>
  );
}

export type BadgeTone = "neutral" | "warning" | "danger";

const badgeToneClass: Record<BadgeTone, string> = {
  neutral: "ui-badge--neutral",
  warning: "ui-badge--warning",
  danger: "ui-badge--danger",
};

export function Badge({
  tone = "neutral",
  children,
}: {
  tone?: BadgeTone;
  children: ReactNode;
}): JSX.Element {
  return <span className={`ui-badge ${badgeToneClass[tone]}`}>{children}</span>;
}
