/**
 * 同一 origin の GET API クライアント。
 * VITE_ADMIN_TOKEN は使わない。token は sessionStorage の任意設定のみ。
 */

const TOKEN_KEY = "admin_local_token";

export function getStoredToken(): string {
  try {
    return sessionStorage.getItem(TOKEN_KEY) ?? "";
  } catch {
    return "";
  }
}

export function setStoredToken(token: string): void {
  try {
    if (token) {
      sessionStorage.setItem(TOKEN_KEY, token);
    } else {
      sessionStorage.removeItem(TOKEN_KEY);
    }
  } catch {
    /* ignore */
  }
}

export type ApiSuccess<T> = { ok: true; data: T };
export type ApiFailure = {
  ok: false;
  error: { code: string; message: string };
};

export async function apiGet<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  const token = getStoredToken();
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }
  if (!headers.has("Accept")) {
    headers.set("Accept", "application/json");
  }

  const res = await fetch(path, {
    ...init,
    method: "GET",
    credentials: "same-origin",
    headers,
  });

  let body: unknown;
  try {
    body = await res.json();
  } catch {
    throw new Error("応答の解析に失敗しました。");
  }

  if (
    typeof body === "object" &&
    body !== null &&
    "ok" in body &&
    (body as { ok: unknown }).ok === true &&
    "data" in body
  ) {
    return (body as ApiSuccess<T>).data;
  }

  if (
    typeof body === "object" &&
    body !== null &&
    "ok" in body &&
    (body as { ok: unknown }).ok === false
  ) {
    const err = (body as ApiFailure).error;
    throw new Error(err?.message ?? "API エラー");
  }

  throw new Error(`予期しない応答 (${res.status})`);
}

/** 直近 7 日の from/to（JST 表示用。サーバが正） */
export function defaultDateRange(): { from: string; to: string } {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = (d: Date) => {
    const p: Record<string, string> = {};
    for (const x of formatter.formatToParts(d)) {
      if (x.type !== "literal") p[x.type] = x.value;
    }
    return `${p.year}-${p.month}-${p.day}`;
  };
  const to = new Date();
  const from = new Date(to.getTime() - 6 * 24 * 60 * 60 * 1000);
  return { from: parts(from), to: parts(to) };
}
