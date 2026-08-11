import { useQuery } from "@tanstack/react-query";
import { apiGet } from "../api/client";
import { DataTable, UuidText } from "../components/DataTable";
import type { BillingResponse } from "../../../shared/schemas";

export function BillingPage() {
  const q = useQuery({
    queryKey: ["billing"],
    queryFn: () => apiGet<BillingResponse>("/api/billing"),
  });

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">課金概況</h1>
      <p className="text-xs text-slate-600">
        Stripe の顧客 ID・サブスクリプション ID 等は表示しません。
      </p>
      {q.isError && (
        <p className="text-sm text-red-700">{(q.error as Error).message}</p>
      )}
      {q.isLoading && <p className="text-sm text-slate-500">読み込み中…</p>}
      {q.data && (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <Stat label="cancel_at_period_end" value={q.data.cancelAtPeriodEndCount} />
            <Stat label="past_due" value={q.data.pastDueCount} />
            <Stat
              label="status 種別数"
              value={q.data.statusCounts.length}
            />
          </div>
          <section className="rounded border border-slate-200 bg-white p-4">
            <h2 className="mb-2 text-sm font-semibold">status 別件数</h2>
            <DataTable
              rows={q.data.statusCounts}
              rowKey={(r) => r.status}
              columns={[
                { key: "s", header: "status", render: (r) => r.status },
                { key: "c", header: "count", render: (r) => String(r.count) },
              ]}
            />
          </section>
          <section className="rounded border border-slate-200 bg-white p-4">
            <h2 className="mb-2 text-sm font-semibold">
              webhook event_type（直近7日）
            </h2>
            <DataTable
              rows={q.data.webhookEventTypeCounts}
              rowKey={(r) => r.eventType}
              columns={[
                { key: "e", header: "event_type", render: (r) => r.eventType },
                { key: "c", header: "count", render: (r) => String(r.count) },
              ]}
            />
          </section>
          <section className="rounded border border-slate-200 bg-white p-4">
            <h2 className="mb-2 text-sm font-semibold">サブスクリプション一覧（最大100）</h2>
            <DataTable
              rows={q.data.subscriptions}
              rowKey={(r) => r.userId}
              columns={[
                { key: "u", header: "user_id", render: (r) => <UuidText value={r.userId} /> },
                { key: "s", header: "status", render: (r) => r.status },
                {
                  key: "e",
                  header: "period_end",
                  render: (r) => (
                    <span className="mono whitespace-nowrap">
                      {r.currentPeriodEnd ?? "—"}
                    </span>
                  ),
                },
                {
                  key: "t",
                  header: "trial_end",
                  render: (r) => r.trialEnd ?? "—",
                },
                {
                  key: "c",
                  header: "cancel_eop",
                  render: (r) => (r.cancelAtPeriodEnd ? "yes" : "no"),
                },
                {
                  key: "p",
                  header: "past_due_since",
                  render: (r) => r.pastDueSince ?? "—",
                },
              ]}
            />
          </section>
        </>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded border border-slate-200 bg-white p-4">
      <p className="text-xs text-slate-500">{label}</p>
      <p className="text-2xl font-semibold tabular-nums">{value}</p>
    </div>
  );
}
