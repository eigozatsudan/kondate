import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { apiGet, defaultDateRange } from "../api/client";
import { DateRangeFilter } from "../components/DateRangeFilter";
import { DataTable, UuidText } from "../components/DataTable";
import type { FeedbackDetail, FeedbackListItem } from "../../../shared/schemas";

type ListResponse = {
  items: FeedbackListItem[];
  range: { from: string; to: string };
};

export function FeedbackPage() {
  const [range, setRange] = useState(defaultDateRange);
  const [category, setCategory] = useState("");
  const [userId, setUserId] = useState("");
  const [detailId, setDetailId] = useState<string | null>(null);
  const [includeBody, setIncludeBody] = useState(false);

  const params = new URLSearchParams({ from: range.from, to: range.to });
  if (category) params.set("category", category);
  if (userId) params.set("userId", userId);

  const list = useQuery({
    queryKey: ["feedback", params.toString()],
    queryFn: () => apiGet<ListResponse>(`/api/feedback?${params}`),
  });

  const detail = useQuery({
    queryKey: ["feedback-detail", detailId, includeBody],
    enabled: !!detailId,
    queryFn: () => {
      const q = includeBody ? "?includeBody=1" : "";
      return apiGet<FeedbackDetail>(`/api/feedback/${detailId}${q}`);
    },
  });

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">不具合・要望</h1>
      <p className="text-xs text-amber-800">
        自由記述です。外部共有・スクショ・チャット貼付をしないでください。第1版では本文キーワード検索はありません。
      </p>
      <div className="flex flex-wrap gap-3 rounded border border-slate-200 bg-white p-3">
        <DateRangeFilter from={range.from} to={range.to} onChange={setRange} />
        <label className="flex flex-col gap-1 text-xs text-slate-600">
          category
          <input
            className="rounded border border-slate-300 px-2 py-1.5 text-sm"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            placeholder="bug_report 等"
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
        emptyMessage={list.isLoading ? "読み込み中…" : "該当するフィードバックがありません。"}
        columns={[
          {
            key: "createdAt",
            header: "created_at",
            render: (r) => <span className="mono whitespace-nowrap">{r.createdAt}</span>,
          },
          { key: "cat", header: "category", render: (r) => r.category },
          { key: "path", header: "client_path", render: (r) => r.clientPath ?? "—" },
          { key: "user", header: "user_id", render: (r) => <UuidText value={r.userId} /> },
          {
            key: "preview",
            header: "本文（先頭80字）",
            render: (r) => <span className="line-clamp-2 max-w-md">{r.bodyPreview}</span>,
          },
          {
            key: "open",
            header: "",
            render: (r) => (
              <button
                type="button"
                className="text-sky-700 hover:underline"
                onClick={() => {
                  setDetailId(r.id);
                  setIncludeBody(false);
                }}
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
            <h2 className="font-semibold">詳細</h2>
            <button
              type="button"
              className="text-sm text-slate-600 hover:underline"
              onClick={() => {
                setDetailId(null);
                setIncludeBody(false);
              }}
            >
              閉じる
            </button>
          </div>
          {detail.isLoading && <p className="text-sm">読み込み中…</p>}
          {detail.data && (
            <div className="space-y-2 text-sm">
              <p>
                id: <UuidText value={detail.data.id} />
              </p>
              <p>category: {detail.data.category}</p>
              <p className="text-xs text-amber-800">
                自由記述。外部共有・スクショ・チャット貼付をしないでください。
              </p>
              <p className="whitespace-pre-wrap rounded bg-slate-50 p-3">
                {includeBody
                  ? (detail.data.body ?? "（本文なし）")
                  : `${detail.data.bodyPreview}…`}
              </p>
              {!includeBody && (
                <button
                  type="button"
                  className="rounded bg-slate-800 px-3 py-1.5 text-white"
                  onClick={() => setIncludeBody(true)}
                >
                  全文を表示
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
