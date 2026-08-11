import { defaultDateRange } from "../api/client";

export function DateRangeFilter({
  from,
  to,
  onChange,
}: {
  from: string;
  to: string;
  onChange: (next: { from: string; to: string }) => void;
}) {
  return (
    <div className="flex flex-wrap items-end gap-3">
      <label className="flex flex-col gap-1 text-xs text-slate-600">
        開始日（JST）
        <input
          type="date"
          className="rounded border border-slate-300 bg-white px-2 py-1.5 text-sm"
          value={from}
          onChange={(e) => onChange({ from: e.target.value, to })}
          required
        />
      </label>
      <label className="flex flex-col gap-1 text-xs text-slate-600">
        終了日（JST）
        <input
          type="date"
          className="rounded border border-slate-300 bg-white px-2 py-1.5 text-sm"
          value={to}
          onChange={(e) => onChange({ from, to: e.target.value })}
          required
        />
      </label>
      <button
        type="button"
        className="rounded border border-slate-300 bg-white px-3 py-1.5 text-sm hover:bg-slate-50"
        onClick={() => onChange(defaultDateRange())}
      >
        直近7日
      </button>
    </div>
  );
}
