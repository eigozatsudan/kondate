import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { apiGet, defaultDateRange } from "../api/client";
import { DateRangeFilter } from "../components/DateRangeFilter";
import { DataTable, UuidText } from "../components/DataTable";
import type { ShareJobsResponse } from "../../../shared/schemas";

export function ShareJobsPage() {
  const [range, setRange] = useState(defaultDateRange);
  const [status, setStatus] = useState("");
  const [failureCode, setFailureCode] = useState("");

  const params = new URLSearchParams({ from: range.from, to: range.to });
  if (status) params.set("status", status);
  if (failureCode) params.set("failureCode", failureCode);

  const q = useQuery({
    queryKey: ["share-jobs", params.toString()],
    queryFn: () => apiGet<ShareJobsResponse>(`/api/share-jobs?${params}`),
  });

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">共有パイプライン</h1>
      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="滞留 running (15分超)" value={q.data?.stuckCount ?? "—"} />
        <Stat label="pending 長期 (1h超)" value={q.data?.pendingStaleCount ?? "—"} />
        <Stat label="失敗（範囲内）" value={q.data?.failedCount ?? "—"} />
      </div>
      <div className="flex flex-wrap gap-3 rounded border border-slate-200 bg-white p-3">
        <DateRangeFilter from={range.from} to={range.to} onChange={setRange} />
        <label className="flex flex-col gap-1 text-xs text-slate-600">
          status
          <input
            className="rounded border border-slate-300 px-2 py-1.5 text-sm"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-slate-600">
          failure_code
          <input
            className="rounded border border-slate-300 px-2 py-1.5 text-sm"
            value={failureCode}
            onChange={(e) => setFailureCode(e.target.value)}
          />
        </label>
      </div>
      {q.isError && (
        <p className="text-sm text-red-700">{(q.error as Error).message}</p>
      )}
      <DataTable
        rows={q.data?.jobs ?? []}
        rowKey={(r) => r.id}
        emptyMessage={q.isLoading ? "読み込み中…" : "該当するジョブがありません。"}
        columns={[
          {
            key: "c",
            header: "created_at",
            render: (r) => <span className="mono whitespace-nowrap">{r.createdAt}</span>,
          },
          { key: "s", header: "status", render: (r) => r.status },
          { key: "f", header: "failure", render: (r) => r.failureCode ?? "—" },
          { key: "sk", header: "skip", render: (r) => r.skipReason ?? "—" },
          {
            key: "hb",
            header: "heartbeat",
            render: (r) => r.heartbeatAt ?? "—",
          },
          { key: "p1", header: "pass1", render: (r) => r.pass1Model ?? "—" },
          { key: "p2", header: "pass2", render: (r) => r.pass2Model ?? "—" },
          {
            key: "u",
            header: "contributor",
            render: (r) => <UuidText value={r.contributorUserId} />,
          },
          { key: "id", header: "id", render: (r) => <UuidText value={r.id} /> },
        ]}
      />
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded border border-slate-200 bg-white p-4">
      <p className="text-xs text-slate-500">{label}</p>
      <p className="text-2xl font-semibold tabular-nums">{value}</p>
    </div>
  );
}
