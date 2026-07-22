import type { ReactNode } from "react";

export type InlineNoticeTone = "notice" | "warning" | "error";

export type InlineNoticeProps = {
  tone: InlineNoticeTone;
  title: string;
  children: ReactNode;
};

export function InlineNotice({ tone, title, children }: InlineNoticeProps) {
  return (
    <section
      className={`inline-notice inline-notice-${tone}`}
      role={tone === "error" ? "alert" : "note"}
    >
      <strong className="inline-notice-title">{title}</strong>
      <div className="inline-notice-body">{children}</div>
    </section>
  );
}
