/**
 * 運用コンソールの日付は JST 暦日 YYYY-MM-DD。
 * クライアントは TZ 解釈せず、サーバが [from, to+1day) の timestamptz に変換する。
 */
import { badRequest } from "../errors.js";

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/u;
const MAX_RANGE_DAYS = 31;
const DEFAULT_RANGE_DAYS = 7;

/** 現在時刻の JST 暦日キー */
export function getJstDateKey(now: Date = new Date()): string {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts: Record<"year" | "month" | "day", string> = {
    year: "",
    month: "",
    day: "",
  };
  for (const part of formatter.formatToParts(now)) {
    if (part.type === "year" || part.type === "month" || part.type === "day") {
      parts[part.type] = part.value;
    }
  }
  return `${parts.year}-${parts.month}-${parts.day}`;
}

/** JST 暦日の 00:00 を UTC Date で返す */
export function jstDayStartUtc(dateKey: string): Date {
  const m = DATE_RE.exec(dateKey);
  if (!m) {
    throw badRequest("invalid_date", "日付は YYYY-MM-DD（JST）で指定してください。");
  }
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) {
    throw badRequest("invalid_date", "日付は YYYY-MM-DD（JST）で指定してください。");
  }
  const dt = new Date(`${dateKey}T00:00:00+09:00`);
  if (Number.isNaN(dt.getTime())) {
    throw badRequest("invalid_date", "日付は YYYY-MM-DD（JST）で指定してください。");
  }
  // 正規化後の暦日が一致するか（例: 2026-02-31 のずれを検出）
  const check = getJstDateKey(dt);
  if (check !== dateKey) {
    throw badRequest("invalid_date", "日付は YYYY-MM-DD（JST）で指定してください。");
  }
  // y/mo/d を参照して未使用警告を防ぐ（上記で検証済み）
  void y;
  void mo;
  void d;
  return dt;
}

/** JST 暦日を n 日進めたキー */
export function addJstDays(dateKey: string, days: number): string {
  const start = jstDayStartUtc(dateKey);
  // 正午 JST 付近で加算して DST 非依存（日本は DST なし）
  const mid = new Date(start.getTime() + days * 24 * 60 * 60 * 1000 + 12 * 60 * 60 * 1000);
  return getJstDateKey(mid);
}

export type JstDateRange = {
  fromJst: string;
  toJst: string;
  fromUtc: Date;
  /** to 日の翌日 00:00 JST（排他） */
  toUtcExclusive: Date;
};

/**
 * from/to は任意。缺損時は直近 7 日（JST 当日含む）。
 * 両端 inclusive の暦日数は最大 31。
 */
export function parseJstDateRange(query: {
  from?: string;
  to?: string;
  now?: Date;
}): JstDateRange {
  const now = query.now ?? new Date();
  const today = getJstDateKey(now);

  let fromJst = query.from;
  let toJst = query.to;

  if (!fromJst && !toJst) {
    toJst = today;
    fromJst = addJstDays(today, -(DEFAULT_RANGE_DAYS - 1));
  } else if (!fromJst || !toJst) {
    throw badRequest(
      "date_range_required",
      "日付範囲 from と to はセットで指定してください（または両方省略で直近7日）。",
    );
  }

  if (!DATE_RE.test(fromJst) || !DATE_RE.test(toJst)) {
    throw badRequest("invalid_date", "日付は YYYY-MM-DD（JST）で指定してください。");
  }

  const fromUtc = jstDayStartUtc(fromJst);
  const toStart = jstDayStartUtc(toJst);
  if (toStart.getTime() < fromUtc.getTime()) {
    throw badRequest("invalid_date_range", "to は from 以降の日付にしてください。");
  }

  // inclusive 日数
  const days =
    Math.floor((toStart.getTime() - fromUtc.getTime()) / (24 * 60 * 60 * 1000)) + 1;
  if (days > MAX_RANGE_DAYS) {
    throw badRequest(
      "date_range_too_long",
      `日付範囲は最大 ${MAX_RANGE_DAYS} 日までです。`,
    );
  }

  const toUtcExclusive = jstDayStartUtc(addJstDays(toJst, 1));
  return { fromJst, toJst, fromUtc, toUtcExclusive };
}

export function formatIso(d: Date | string | null | undefined): string | null {
  if (d == null) return null;
  if (typeof d === "string") {
    const t = new Date(d);
    return Number.isNaN(t.getTime()) ? d : t.toISOString();
  }
  return d.toISOString();
}

export function clampLimit(raw: string | undefined, fallback = 50, max = 100): number {
  if (raw === undefined || raw === "") return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) {
    throw badRequest("invalid_limit", "limit が不正です。");
  }
  return Math.min(n, max);
}

export function clampOffset(raw: string | undefined): number {
  if (raw === undefined || raw === "") return 0;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0) {
    throw badRequest("invalid_offset", "offset が不正です。");
  }
  return n;
}


