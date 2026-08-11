import { useQuery } from "@tanstack/react-query";
import { apiGet } from "../api/client";
import { DataTable, UuidText } from "../components/DataTable";
import type { QuotaHealthResponse } from "../../../shared/schemas";

export function QuotaHealthPage() {
  const q = useQuery({
    queryKey: ["quota-health"],
    queryFn: () => apiGet<QuotaHealthResponse>("/api/quota-health"),
  });

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">利用枠・健全性</h1>
      {q.isError && (
        <p className="text-sm text-red-700">{(q.error as Error).message}</p>
      )}
      {q.isLoading && <p className="text-sm text-slate-500">読み込み中…</p>}
      {q.data && (
        <>
          <section className="rounded border border-slate-200 bg-white p-4">
            <h2 className="mb-2 text-sm font-semibold">グローバル日次（直近14日）</h2>
            <DataTable
              rows={q.data.globalDailyUsage}
              rowKey={(r) => r.usageDay}
              columns={[
                { key: "d", header: "usage_day", render: (r) => r.usageDay },
                {
                  key: "r",
                  header: "reserved",
                  render: (r) => String(r.reservedCount),
                },
                { key: "s", header: "sent", render: (r) => String(r.sentCount) },
              ]}
            />
          </section>
          <section className="rounded border border-slate-200 bg-white p-4">
            <h2 className="mb-2 text-sm font-semibold">stuck 生成</h2>
            <DataTable
              rows={q.data.stuckGenerations}
              rowKey={(r) => r.id}
              columns={[
                {
                  key: "c",
                  header: "created_at",
                  render: (r) => <span className="mono">{r.createdAt}</span>,
                },
                { key: "st", header: "status", render: (r) => r.status },
                { key: "u", header: "user_id", render: (r) => <UuidText value={r.userId} /> },
                { key: "id", header: "id", render: (r) => <UuidText value={r.id} /> },
              ]}
            />
          </section>
          <div className="grid gap-4 lg:grid-cols-2">
            <section className="rounded border border-slate-200 bg-white p-4">
              <h2 className="mb-2 text-sm font-semibold">失敗トップ 24h</h2>
              <CountTable rows={q.data.failureTop24h} />
            </section>
            <section className="rounded border border-slate-200 bg-white p-4">
              <h2 className="mb-2 text-sm font-semibold">失敗トップ 7d</h2>
              <CountTable rows={q.data.failureTop7d} />
            </section>
          </div>
          <section className="rounded border border-slate-200 bg-white p-4">
            <h2 className="mb-2 text-sm font-semibold">
              上限付近（JST 当日・success ≥ limit−1）
            </h2>
            <DataTable
              rows={q.data.nearLimitUsers}
              rowKey={(r) => r.userId}
              columns={[
                { key: "u", header: "user_id", render: (r) => <UuidText value={r.userId} /> },
                {
                  key: "s",
                  header: "success_count",
                  render: (r) => String(r.successCount),
                },
                {
                  key: "l",
                  header: "quota_success_limit",
                  render: (r) => String(r.quotaSuccessLimit),
                },
              ]}
            />
          </section>
        </>
      )}
    </div>
  );
}

function CountTable({ rows }: { rows: { failureCode: string; count: number }[] }) {
  return (
    <DataTable
      rows={rows}
      rowKey={(r) => r.failureCode}
      columns={[
        { key: "c", header: "failure_code", render: (r) => r.failureCode },
        { key: "n", header: "count", render: (r) => String(r.count) },
      ]}
    />
  );
}
