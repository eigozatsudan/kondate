import { useQuery } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { apiGet, defaultDateRange } from "../api/client";
import { DateRangeFilter } from "../components/DateRangeFilter";
import type { DashboardResponse } from "../../../shared/schemas";

export function DashboardPage() {
  const [range, setRange] = useState(defaultDateRange);
  const q = useQuery({
    queryKey: ["dashboard", range.from, range.to],
    queryFn: () =>
      apiGet<DashboardResponse>(
        `/api/dashboard?from=${encodeURIComponent(range.from)}&to=${encodeURIComponent(range.to)}`,
      ),
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-bold">ダッシュボード</h1>
        <DateRangeFilter from={range.from} to={range.to} onChange={setRange} />
      </div>
      {q.isLoading && <p className="text-sm text-slate-500">読み込み中…</p>}
      {q.isError && (
        <p className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          {(q.error as Error).message}
        </p>
      )}
      {q.data && (
        <>
          <p className="text-xs text-slate-500">
            取得: {q.data.generatedAt} / 範囲 {q.data.rangeFromJst}〜{q.data.rangeToJst}（JST）/
            本日 {q.data.todayJst}
          </p>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Card title="stuck 生成" value={String(q.data.stuckGenerationCount)} />
            <Card title="共有 滞留 (15分)" value={String(q.data.shareStuckCount)} />
            <Card title="共有 失敗" value={String(q.data.shareFailedCount)} />
            <Card title="共有 pending 長期" value={String(q.data.sharePendingStaleCount)} />
          </div>
          <Section title="生成 status 別">
            <CountList
              items={q.data.generationStatusCounts.map((x) => ({
                k: x.status,
                v: x.count,
              }))}
            />
          </Section>
          <Section title="全体 AI 枠（本日 JST）">
            {q.data.globalUsageToday ? (
              <p className="text-sm">
                day={q.data.globalUsageToday.usageDay} / reserved=
                {q.data.globalUsageToday.reservedCount} / sent=
                {q.data.globalUsageToday.sentCount}
              </p>
            ) : (
              <p className="text-sm text-slate-500">行なし</p>
            )}
          </Section>
          <Section title="フィードバック category 別">
            <CountList
              items={q.data.feedbackCategoryCounts.map((x) => ({
                k: x.category,
                v: x.count,
              }))}
            />
          </Section>
          <Section title="課金 status 別">
            <CountList
              items={q.data.billingStatusCounts.map((x) => ({
                k: x.status,
                v: x.count,
              }))}
            />
          </Section>
        </>
      )}
    </div>
  );
}

function Card({ title, value }: { title: string; value: string }) {
  return (
    <div className="rounded border border-slate-200 bg-white p-4 shadow-sm">
      <p className="text-xs text-slate-500">{title}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded border border-slate-200 bg-white p-4 shadow-sm">
      <h2 className="mb-2 text-sm font-semibold text-slate-800">{title}</h2>
      {children}
    </section>
  );
}

function CountList({ items }: { items: { k: string; v: number }[] }) {
  if (items.length === 0) {
    return <p className="text-sm text-slate-500">件数 0</p>;
  }
  return (
    <ul className="space-y-1 text-sm">
      {items.map((i) => (
        <li key={i.k} className="flex justify-between gap-4">
          <span className="mono">{i.k}</span>
          <span className="tabular-nums font-medium">{i.v}</span>
        </li>
      ))}
    </ul>
  );
}
