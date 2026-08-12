import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { apiGet, defaultDateRange } from "../api/client";
import { DateRangeFilter } from "../components/DateRangeFilter";
import { DataTable, UuidText } from "../components/DataTable";
import type {
  SharedRecipeDetail,
  SharedRecipePreview,
  SharedRecipesResponse,
} from "../../../shared/schemas";

/** 401/404 を token 未設定・API 無効の案内に寄せる（一覧・詳細共通） */
function formatApiError(err: unknown): string {
  const message = err instanceof Error ? err.message : "API エラー";
  if (message.includes("認証が必要") || message.includes("401")) {
    return "認証が必要です。ヘッダーの API トークンを設定してください。";
  }
  if (
    message.includes("リソースが見つかりません") ||
    message.includes("予期しない応答 (404)") ||
    message.includes("404")
  ) {
    return "共有レシピ API が無効か、対象が見つかりません。ADMIN_LOCAL_TOKEN の設定を確認してください。";
  }
  return message;
}

function previewErrorLabel(
  code: SharedRecipeDetail["previewError"],
): string {
  if (code === "invalid_menu_payload") {
    return "メニュー本文を表示用に変換できませんでした（不正な payload）。";
  }
  if (code === "unsupported_schema_version") {
    return "未対応の schemaVersion のためプレビューできません。";
  }
  return "プレビューを生成できませんでした。";
}

export function SharedRecipesPage() {
  const [range, setRange] = useState(defaultDateRange);
  const [status, setStatus] = useState("");
  const [mealType, setMealType] = useState("");
  const [detailId, setDetailId] = useState<string | null>(null);

  const params = new URLSearchParams({ from: range.from, to: range.to });
  if (status) params.set("status", status);
  if (mealType) params.set("mealType", mealType);

  const list = useQuery({
    queryKey: ["shared-recipes", params.toString()],
    queryFn: () =>
      apiGet<SharedRecipesResponse>(`/api/shared-recipes?${params}`),
  });

  const detail = useQuery({
    queryKey: ["shared-recipe-detail", detailId],
    enabled: !!detailId,
    queryFn: () =>
      apiGet<SharedRecipeDetail>(`/api/shared-recipes/${detailId}`),
  });

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">共有レシピ</h1>
      <p className="text-xs text-amber-800">
        共有プールの匿名化済み本文です。外部共有・スクショ・チャット貼付をしないでください。閲覧専用です。
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Stat label="active（全体）" value={list.data?.activeCount ?? "—"} />
        <Stat
          label="disabled（全体）"
          value={list.data?.disabledCount ?? "—"}
        />
      </div>
      <div className="flex flex-wrap gap-3 rounded border border-slate-200 bg-white p-3">
        <DateRangeFilter from={range.from} to={range.to} onChange={setRange} />
        <label className="flex flex-col gap-1 text-xs text-slate-600">
          status
          <select
            className="rounded border border-slate-300 px-2 py-1.5 text-sm"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
          >
            <option value="">（すべて）</option>
            <option value="active">active</option>
            <option value="disabled">disabled</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-slate-600">
          mealType
          <select
            className="rounded border border-slate-300 px-2 py-1.5 text-sm"
            value={mealType}
            onChange={(e) => setMealType(e.target.value)}
          >
            <option value="">（すべて）</option>
            <option value="breakfast">breakfast</option>
            <option value="lunch">lunch</option>
            <option value="dinner">dinner</option>
          </select>
        </label>
      </div>
      {list.isError && (
        <p className="text-sm text-red-700">{formatApiError(list.error)}</p>
      )}
      <DataTable
        rows={list.data?.items ?? []}
        rowKey={(r) => r.id}
        emptyMessage={
          list.isLoading ? "読み込み中…" : "該当する共有レシピがありません。"
        }
        columns={[
          {
            key: "createdAt",
            header: "created_at",
            render: (r) => (
              <span className="mono whitespace-nowrap">{r.createdAt}</span>
            ),
          },
          { key: "status", header: "status", render: (r) => r.status },
          { key: "mealType", header: "mealType", render: (r) => r.mealType },
          {
            key: "title",
            header: "title",
            render: (r) => (
              <span className="line-clamp-2 max-w-xs">{r.title}</span>
            ),
          },
          {
            key: "elapsed",
            header: "elapsed",
            render: (r) => `${r.totalElapsedMinutes} 分`,
          },
          {
            key: "allergens",
            header: "allergens",
            render: (r) =>
              r.standardAllergenIds.length > 0
                ? r.standardAllergenIds.join(", ")
                : "—",
          },
          {
            key: "ageBands",
            header: "age bands",
            render: (r) =>
              r.eligibleAgeBands.length > 0
                ? r.eligibleAgeBands.join(", ")
                : "—",
          },
          {
            key: "contributor",
            header: "contributor",
            render: (r) => <UuidText value={r.contributorUserId} />,
          },
          {
            key: "id",
            header: "id",
            render: (r) => <UuidText value={r.id} />,
          },
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
            <h2 className="font-semibold">共有レシピ詳細</h2>
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
            <p className="text-sm text-red-700">
              {formatApiError(detail.error)}
            </p>
          )}
          {detail.data && (
            <div className="space-y-3 text-sm">
              <p className="text-xs text-amber-800">
                共有プールの匿名化済み本文です。外部共有・スクショ・チャット貼付をしないでください。閲覧専用です。
              </p>
              <div className="grid gap-1 sm:grid-cols-2">
                <p>
                  id: <UuidText value={detail.data.id} />
                </p>
                <p>status: {detail.data.status}</p>
                <p>mealType: {detail.data.mealType}</p>
                <p>title: {detail.data.title}</p>
                <p>elapsed: {detail.data.totalElapsedMinutes} 分</p>
                <p>
                  contributor:{" "}
                  <UuidText value={detail.data.contributorUserId} />
                </p>
                <p>
                  source_menu: <UuidText value={detail.data.sourceMenuId} />
                </p>
                <p>
                  allergens:{" "}
                  {detail.data.standardAllergenIds.join(", ") || "—"}
                </p>
                <p>
                  age bands:{" "}
                  {detail.data.eligibleAgeBands.join(", ") || "—"}
                </p>
                <p className="mono text-xs text-slate-500">
                  created_at: {detail.data.createdAt}
                </p>
              </div>
              {detail.data.previewError && (
                <p className="rounded border border-amber-200 bg-amber-50 p-3 text-amber-900">
                  {previewErrorLabel(detail.data.previewError)}
                  <span className="mt-1 block text-xs mono">
                    ({detail.data.previewError})
                  </span>
                </p>
              )}
              {detail.data.preview && (
                <PreviewPanel preview={detail.data.preview} />
              )}
              {!detail.data.preview && !detail.data.previewError && (
                <p className="text-slate-500">プレビューがありません。</p>
              )}
            </div>
          )}
        </div>
      )}
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

/** 構造化 preview を見出し＋リストで表示（本編デザイン不要） */
function PreviewPanel({ preview }: { preview: SharedRecipePreview }) {
  return (
    <div className="space-y-4 rounded border border-slate-200 bg-slate-50 p-3">
      <div>
        <h3 className="mb-1 font-semibold">プレビュー概要</h3>
        <ul className="list-inside list-disc text-xs text-slate-700">
          <li>schemaVersion: {preview.schemaVersion}</li>
          <li>
            menuId: <UuidText value={preview.menuId} />
          </li>
          <li>mealType: {preview.mealType}</li>
          <li>cuisineGenre: {preview.cuisineGenre}</li>
          <li>servings: {preview.servings}</li>
          <li>totalElapsedMinutes: {preview.totalElapsedMinutes}</li>
          <li>
            safetyTags:{" "}
            {preview.safetyTags.length > 0
              ? preview.safetyTags.join(", ")
              : "—"}
          </li>
        </ul>
      </div>

      <div>
        <h3 className="mb-1 font-semibold">料理（dishes）</h3>
        <ul className="space-y-3">
          {preview.dishes.map((dish) => (
            <li
              key={`${dish.position}-${dish.name}`}
              className="rounded border border-slate-200 bg-white p-2"
            >
              <p className="font-medium">
                [{dish.role}] {dish.name}（{dish.cookingTimeMinutes} 分）
              </p>
              <p className="text-xs text-slate-600">{dish.description}</p>
              <p className="mt-1 text-xs font-semibold text-slate-500">
                材料
              </p>
              <ul className="list-inside list-disc text-xs">
                {dish.ingredients.map((ing, i) => (
                  <li key={`${ing.name}-${i}`}>
                    {ing.name} {ing.quantityText}
                    {ing.unit ? ` ${ing.unit}` : ""}（{ing.storeSection}）
                  </li>
                ))}
              </ul>
              <p className="mt-1 text-xs font-semibold text-slate-500">
                手順
              </p>
              <ol className="list-inside list-decimal text-xs">
                {dish.steps
                  .slice()
                  .sort((a, b) => a.position - b.position)
                  .map((step) => (
                    <li key={step.position}>{step.instruction}</li>
                  ))}
              </ol>
            </li>
          ))}
        </ul>
      </div>

      <div>
        <h3 className="mb-1 font-semibold">タイムライン</h3>
        {preview.timeline.length === 0 ? (
          <p className="text-xs text-slate-500">—</p>
        ) : (
          <ol className="list-inside list-decimal space-y-1 text-xs">
            {preview.timeline
              .slice()
              .sort((a, b) => a.position - b.position)
              .map((t) => (
                <li key={t.position}>
                  {t.startMinute}分〜（{t.durationMinutes}分）:{" "}
                  {t.instruction}
                </li>
              ))}
          </ol>
        )}
      </div>

      <div>
        <h3 className="mb-1 font-semibold">アダプテーション</h3>
        {preview.adaptations.length === 0 ? (
          <p className="text-xs text-slate-500">—</p>
        ) : (
          <ul className="space-y-2">
            {preview.adaptations.map((ad, i) => (
              <li
                key={`${ad.anonymousMemberRef}-${i}`}
                className="rounded border border-slate-200 bg-white p-2 text-xs"
              >
                <p>member: {ad.anonymousMemberRef}</p>
                <p>portion: {ad.portionText}</p>
                <p>servingCheck: {ad.servingCheck}</p>
                {ad.additionalCutting && (
                  <p>cutting: {ad.additionalCutting}</p>
                )}
                {ad.additionalHeating && (
                  <p>heating: {ad.additionalHeating}</p>
                )}
                {ad.additionalSeasoning && (
                  <p>seasoning: {ad.additionalSeasoning}</p>
                )}
                {ad.safetyActions.length > 0 && (
                  <ul className="mt-1 list-inside list-disc">
                    {ad.safetyActions.map((act, j) => (
                      <li key={`${act.kind}-${j}`}>
                        [{act.kind}] {act.instruction}
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
