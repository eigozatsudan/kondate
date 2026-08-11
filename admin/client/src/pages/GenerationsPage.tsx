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

/** API の UTC ISO を JST の `YYYY-MM-DD HH:mm:ss` に整形する（表示専用） */
function formatJstDateTime(iso: string | null | undefined): string {
  if (iso == null || iso === "") return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  // sv-SE は YYYY-MM-DD HH:mm:ss 形式で、JST 固定表示に向く
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(d);
}

/** duration_ms を秒表示に変換（整数秒はそのまま、端数は小数1桁） */
function formatDurationSec(durationMs: number | null | undefined): string {
  if (durationMs == null) return "—";
  const sec = durationMs / 1000;
  return Number.isInteger(sec) ? String(sec) : sec.toFixed(1);
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
            header: "作成日時（JST）",
            render: (r) => (
              <span className="mono whitespace-nowrap">{formatJstDateTime(r.createdAt)}</span>
            ),
          },
          { key: "status", header: "ステータス", render: (r) => r.status },
          { key: "kind", header: "リクエスト種別", render: (r) => r.requestKind },
          { key: "fail", header: "失敗コード", render: (r) => r.failureCode ?? "—" },
          {
            key: "dur",
            header: "秒",
            render: (r) => formatDurationSec(r.durationMs),
          },
          {
            key: "models",
            header: "モデル",
            render: (r) => r.actualModelIds.join(", ") || "—",
          },
          {
            key: "qm",
            header: "品質モード",
            render: (r) => (r.qualityMode ? "yes" : "no"),
          },
          {
            key: "repair",
            header: "修復試行",
            render: (r) => (r.repairAttempted ? "yes" : "no"),
          },
          { key: "user", header: "ユーザーID", render: (r) => <UuidText value={r.userId} /> },
          { key: "id", header: "ID", render: (r) => <UuidText value={r.id} /> },
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
                作成日時（JST）:{" "}
                <span className="mono">{formatJstDateTime(detail.data.createdAt)}</span>
              </p>
              <p>
                開始（JST）:{" "}
                <span className="mono">{formatJstDateTime(detail.data.startedAt)}</span>
              </p>
              <p>
                完了（JST）:{" "}
                <span className="mono">{formatJstDateTime(detail.data.completedAt)}</span>
              </p>
              <p>
                処理期限（JST）:{" "}
                <span className="mono">
                  {formatJstDateTime(detail.data.processingExpiresAt)}
                </span>
              </p>
              <p>所要時間（秒）: {formatDurationSec(detail.data.durationMs)}</p>
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
