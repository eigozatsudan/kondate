import { readFile } from "node:fs/promises";
import type { Page } from "@playwright/test";
import { z } from "zod";
import { ownedAuthStoragePrefixes } from "../../src/features/auth/auth-flow";

/** ローカル Compose の公開キーを .env から読む（REST apikey 用） */
export async function readLocalPublishableKey(): Promise<string> {
  const envText = await readFile(".env", "utf8");
  // Compose は VITE_SUPABASE_PUBLISHABLE_KEY=${ANON_KEY} を注入する。
  // .env 本体には VITE_ 行が無く ANON_KEY / SUPABASE_PUBLISHABLE_KEY がある。
  const value =
    /^VITE_SUPABASE_PUBLISHABLE_KEY=(.+)$/mu.exec(envText)?.[1]?.trim() ??
    /^SUPABASE_PUBLISHABLE_KEY=(.+)$/mu.exec(envText)?.[1]?.trim() ??
    /^ANON_KEY=(.+)$/mu.exec(envText)?.[1]?.trim();
  return z.string().min(20).parse(value);
}

/** ブラウザ localStorage 上の Supabase セッションから access_token を取り出す */
export async function accessTokenFromPage(page: Page): Promise<string> {
  const storageKey = ownedAuthStoragePrefixes.find((prefix) => prefix === "kondate.auth.supabase");
  if (storageKey === undefined) {
    throw new Error("Supabase auth storage prefix is not configured");
  }
  const value: unknown = await page.evaluate((key) => {
    const raw = localStorage.getItem(key);
    if (raw === null) return null;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return null;
    const record = parsed as Record<string, unknown>;
    if (typeof record.access_token === "string") return record.access_token;
    // 古い / 別形のネスト
    const nested = record.currentSession;
    if (typeof nested === "object" && nested !== null) {
      const session = nested as Record<string, unknown>;
      if (typeof session.access_token === "string") return session.access_token;
    }
    return null;
  }, storageKey);
  return z.string().min(20).parse(value);
}

/** ローカル PostgREST 向け Authorization / apikey ヘッダ */
export async function localRestHeaders(page: Page): Promise<Record<string, string>> {
  return {
    authorization: `Bearer ${await accessTokenFromPage(page)}`,
    apikey: await readLocalPublishableKey(),
    "content-type": "application/json",
  };
}
