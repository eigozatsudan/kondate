import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { apiGet, defaultDateRange } from "../api/client";
import { DateRangeFilter } from "../components/DateRangeFilter";
import { DataTable, UuidText } from "../components/DataTable";
import type {
  GenerationDetail,
  GenerationListItem,
} from "../../../shared/schemas";

type ListResponse = {
  items: GenerationListItem[];
  range: { from: string; to: string };
};

/** Spec §5.2 詳細フィールドを表示（禁止列は API/DTO 側で除外済み） */
function formatJson(value: unknown): string {
  if (value == null) return "—";
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export function GenerationsPage() {
  const [range, setRange] = useState(defaultDateRange);
  const [status, setStatus] = useState("");
  const [requestKind, setRequestKind] = useState("");
  const [failureCode, setFailureCode] = useState("");
  const [userId, setUserId] = useState("");
  const [detailId, setDetailId] = useState<string | null>(null);

  const params = new URLSearchParams({
    from: range.from,
    to: range.to,
  });
  if (status) params.set("status", status);
  if (requestKind) params.set("requestKind", requestKind);
  if (failureCode) params.set("failureCode", failureCode);
  if (userId) params.set("userId", userId);

  const list = useQuery({
    queryKey: ["generations", params.toString()],
    queryFn: () => apiGet<ListResponse>(`/api/generations?${params}`),
  });

  const detail = useQuery({
    queryKey: ["generation-detail", detailId],
    enabled: !!detailId,
    queryFn: () => apiGet<GenerationDetail>(`/api/generations/${detailId}`),
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
      {list.isError && (
        <p className="text-sm text-red-700">{(list.error as Error).message}</p>
      )}
      <DataTable
        rows={list.data?.items ?? []}
        rowKey={(r) => r.id}
        emptyMessage={list.isLoading ? "読み込み中…" : "該当する生成がありません。"}
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
          {
            key: "open",
            header: "",
            render: (r) => (
              <button
                type="button"
                className="text-sky-700 hover:underline"
                onClick={() => setDetailId(r.id)}
              >
                詳細
              </button>
            ),
          },
        ]}
      />
      {detailId && (
        <div className="rounded border border-slate-300 bg-white p-4 shadow">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="font-semibold">生成詳細</h2>
            <button
              type="button"
              className="text-sm text-slate-600 hover:underline"
              onClick={() => setDetailId(null)}
            >
              閉じる
            </button>
          </div>
          {detail.isLoading && <p className="text-sm">読み込み中…</p>}
          {detail.isError && (
            <p className="text-sm text-red-700">{(detail.error as Error).message}</p>
          )}
          {detail.data && (
            <div className="space-y-2 text-sm">
              <p>
                id: <UuidText value={detail.data.id} />
              </p>
              <p>
                user_id: <UuidText value={detail.data.userId} />
              </p>
              <p>status: {detail.data.status}</p>
              <p>request_kind: {detail.data.requestKind}</p>
              <p>failure_code: {detail.data.failureCode ?? "—"}</p>
              <p>
                created_at:{" "}
                <span className="mono">{detail.data.createdAt}</span>
              </p>
              <p>
                started_at:{" "}
                <span className="mono">{detail.data.startedAt ?? "—"}</span>
              </p>
              <p>
                completed_at:{" "}
                <span className="mono">{detail.data.completedAt ?? "—"}</span>
              </p>
              <p>
                processing_expires_at:{" "}
                <span className="mono">
                  {detail.data.processingExpiresAt ?? "—"}
                </span>
              </p>
              <p>duration_ms: {detail.data.durationMs ?? "—"}</p>
              <p>
                actual_model_ids:{" "}
                {detail.data.actualModelIds.join(", ") || "—"}
              </p>
              <p>quality_mode: {detail.data.qualityMode ? "yes" : "no"}</p>
              <p>
                repair_attempted: {detail.data.repairAttempted ? "yes" : "no"}
              </p>
              <p>user_usage_day: {detail.data.userUsageDay ?? "—"}</p>
              <p>global_sent_calls: {detail.data.globalSentCalls ?? "—"}</p>
              <p>quota_success_limit: {detail.data.quotaSuccessLimit ?? "—"}</p>
              <p>change_reason: {detail.data.changeReason ?? "—"}</p>
              <p>
                draft_id:{" "}
                {detail.data.draftId ? (
                  <UuidText value={detail.data.draftId} />
                ) : (
                  "—"
                )}
              </p>
              <p>
                source_menu_id:{" "}
                {detail.data.sourceMenuId ? (
                  <UuidText value={detail.data.sourceMenuId} />
                ) : (
                  "—"
                )}
              </p>
              <p>
                replace_dish_id:{" "}
                {detail.data.replaceDishId ? (
                  <UuidText value={detail.data.replaceDishId} />
                ) : (
                  "—"
                )}
              </p>
              <p>
                completed_menu_id:{" "}
                {detail.data.completedMenuId ? (
                  <UuidText value={detail.data.completedMenuId} />
                ) : (
                  "—"
                )}
              </p>
              <div>
                <p className="mb-1 font-medium">terminal_details</p>
                <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded bg-slate-50 p-3 text-xs mono">
                  {formatJson(detail.data.terminalDetails)}
                </pre>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
