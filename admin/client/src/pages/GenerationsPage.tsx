import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { apiGet, defaultDateRange } from "../api/client";
import { DateRangeFilter } from "../components/DateRangeFilter";
import { DataTable, UuidText } from "../components/DataTable";
import type { GenerationListItem } from "../../../shared/schemas";

type ListResponse = {
  items: GenerationListItem[];
  range: { from: string; to: string };
};

export function GenerationsPage() {
  const [range, setRange] = useState(defaultDateRange);
  const [status, setStatus] = useState("");
  const [requestKind, setRequestKind] = useState("");
  const [failureCode, setFailureCode] = useState("");
  const [userId, setUserId] = useState("");

  const params = new URLSearchParams({
    from: range.from,
    to: range.to,
  });
  if (status) params.set("status", status);
  if (requestKind) params.set("requestKind", requestKind);
  if (failureCode) params.set("failureCode", failureCode);
  if (userId) params.set("userId", userId);

  const q = useQuery({
    queryKey: ["generations", params.toString()],
    queryFn: () => apiGet<ListResponse>(`/api/generations?${params}`),
  });

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">生成ログ</h1>
      <div className="flex flex-wrap gap-3 rounded border border-slate-200 bg-white p-3">
        <DateRangeFilter from={range.from} to={range.to} onChange={setRange} />
        <label className="flex flex-col gap-1 text-xs text-slate-600">
          status
          <input
            className="rounded border border-slate-300 px-2 py-1.5 text-sm"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            placeholder="succeeded 等"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-slate-600">
          request_kind
          <input
            className="rounded border border-slate-300 px-2 py-1.5 text-sm"
            value={requestKind}
            onChange={(e) => setRequestKind(e.target.value)}
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
        <label className="flex flex-col gap-1 text-xs text-slate-600">
          user_id
          <input
            className="w-64 rounded border border-slate-300 px-2 py-1.5 text-sm mono"
            value={userId}
            onChange={(e) => setUserId(e.target.value)}
          />
        </label>
      </div>
      {q.isError && (
        <p className="text-sm text-red-700">{(q.error as Error).message}</p>
      )}
      <DataTable
        rows={q.data?.items ?? []}
        rowKey={(r) => r.id}
        emptyMessage={q.isLoading ? "読み込み中…" : "該当する生成がありません。"}
        columns={[
          {
            key: "createdAt",
            header: "created_at",
            render: (r) => <span className="mono whitespace-nowrap">{r.createdAt}</span>,
          },
          { key: "status", header: "status", render: (r) => r.status },
          { key: "kind", header: "request_kind", render: (r) => r.requestKind },
          { key: "fail", header: "failure_code", render: (r) => r.failureCode ?? "—" },
          {
            key: "dur",
            header: "ms",
            render: (r) => (r.durationMs == null ? "—" : String(r.durationMs)),
          },
          {
            key: "models",
            header: "models",
            render: (r) => r.actualModelIds.join(", ") || "—",
          },
          {
            key: "qm",
            header: "quality",
            render: (r) => (r.qualityMode ? "yes" : "no"),
          },
          {
            key: "repair",
            header: "repair",
            render: (r) => (r.repairAttempted ? "yes" : "no"),
          },
          { key: "user", header: "user_id", render: (r) => <UuidText value={r.userId} /> },
          { key: "id", header: "id", render: (r) => <UuidText value={r.id} /> },
        ]}
      />
    </div>
  );
}
