import type { ExpiredPantryConfirmation } from "@shared/contracts/generation";
import type { PantryItem } from "@shared/contracts/pantry";
import { getJstDateKey } from "@shared/time/jst";

// サーバ GenerationContext の expiredPantryChecks と同形。browser は contracts を正とする。
export type ExpiredPantryCheck = ExpiredPantryConfirmation;

/**
 * P7: checkedAt が有効 Date かつ today（JST）と一致するか。
 * 破損 session / 不正 ISO は Number.isNaN で drop（サーバ validateTransientChecks と同型 fail-closed＝未確認）。
 * Invalid Date を getJstDateKey に渡すと formatToParts が RangeError になり得るため先に弾く。
 */
function isCheckedAtOnJstDay(checkedAt: string, today: string): boolean {
  const date = new Date(checkedAt);
  if (Number.isNaN(date.getTime())) return false;
  return getJstDateKey(date) === today;
}

export type PlannerAttempt = {
  idempotencyKey: string;
  expiredPantryChecks: readonly ExpiredPantryCheck[];
  /** Plus 品質モード「くわしく作る」。Free でも UI は出せるがサーバが 403。 */
  qualityMode: boolean;
};

/**
 * PE8: planner CTA で確認した期限切れ pantry を /emergency-menus 直接到達でも共有する。
 * 当日（JST）単位。attempt は React メモリのみなので sessionStorage に当日確認を載せる。
 */
export function expiredPantryConfirmSessionKey(userId: string): string {
  return `kondate:expired-pantry-confirm:v1:${userId}`;
}

type SessionExpiredConfirmEnvelope = {
  /** JST 日付キー。日跨ぎで無効化する */
  dayKey: string;
  checks: readonly ExpiredPantryCheck[];
};

function readSessionExpiredEnvelope(userId: string): SessionExpiredConfirmEnvelope | null {
  let raw: string | null;
  try {
    raw = sessionStorage.getItem(expiredPantryConfirmSessionKey(userId));
  } catch {
    return null;
  }
  if (raw === null) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      !("dayKey" in parsed) ||
      !("checks" in parsed) ||
      typeof (parsed as { dayKey: unknown }).dayKey !== "string" ||
      !Array.isArray((parsed as { checks: unknown }).checks)
    ) {
      return null;
    }
    const checks: ExpiredPantryCheck[] = [];
    for (const entry of (parsed as { checks: unknown[] }).checks) {
      if (
        typeof entry !== "object" ||
        entry === null ||
        typeof (entry as { pantryItemId?: unknown }).pantryItemId !== "string" ||
        typeof (entry as { checkedAt?: unknown }).checkedAt !== "string"
      ) {
        continue;
      }
      const checkedAt = (entry as { checkedAt: string }).checkedAt;
      // P7: 文字列型だけでは不足。Invalid Date は parse 時点で drop（後段 getJstDateKey throw を防ぐ）
      if (Number.isNaN(new Date(checkedAt).getTime())) {
        continue;
      }
      checks.push({
        pantryItemId: (entry as { pantryItemId: string }).pantryItemId,
        checkedAt,
      });
    }
    return { dayKey: (parsed as { dayKey: string }).dayKey, checks };
  } catch {
    return null;
  }
}

function writeSessionExpiredEnvelope(
  userId: string,
  envelope: SessionExpiredConfirmEnvelope,
): void {
  try {
    sessionStorage.setItem(expiredPantryConfirmSessionKey(userId), JSON.stringify(envelope));
  } catch {
    /* Quota / private mode — 画面内 state に委ねる */
  }
}

/** 当日の session 確認一覧（日跨ぎ・破損は空）。 */
export function loadSessionExpiredPantryChecks(
  userId: string,
  now: Date,
): readonly ExpiredPantryCheck[] {
  const today = getJstDateKey(now);
  const envelope = readSessionExpiredEnvelope(userId);
  if (envelope === null || envelope.dayKey !== today) {
    if (envelope !== null) {
      try {
        sessionStorage.removeItem(expiredPantryConfirmSessionKey(userId));
      } catch {
        /* ignore */
      }
    }
    return [];
  }
  return envelope.checks.filter((item) => isCheckedAtOnJstDay(item.checkedAt, today));
}

/** 1 件の当日確認を session に追記（同一 pantryItemId は上書き）。 */
export function persistSessionExpiredPantryConfirmation(
  userId: string,
  pantryItemId: string,
  now: Date,
): void {
  const today = getJstDateKey(now);
  const existing = loadSessionExpiredPantryChecks(userId, now);
  const next: SessionExpiredConfirmEnvelope = {
    dayKey: today,
    checks: [
      ...existing.filter((item) => item.pantryItemId !== pantryItemId),
      { pantryItemId, checkedAt: now.toISOString() },
    ],
  };
  writeSessionExpiredEnvelope(userId, next);
}

/** planner attempt 上の当日確認をまとめて session へ（緊急 CTA 通過時）。 */
export function persistSessionExpiredPantryChecks(
  userId: string,
  checks: readonly ExpiredPantryCheck[],
  now: Date,
): void {
  const today = getJstDateKey(now);
  const existing = [...loadSessionExpiredPantryChecks(userId, now)];
  const byId = new Map(existing.map((item) => [item.pantryItemId, item]));
  for (const check of checks) {
    // P7: 不正 checkedAt は skip（サーバ同型）
    if (!isCheckedAtOnJstDay(check.checkedAt, today)) continue;
    byId.set(check.pantryItemId, check);
  }
  writeSessionExpiredEnvelope(userId, { dayKey: today, checks: [...byId.values()] });
}

export function hasSessionExpiredPantryConfirmation(
  userId: string,
  pantryItemId: string,
  now: Date,
): boolean {
  const today = getJstDateKey(now);
  return loadSessionExpiredPantryChecks(userId, now).some(
    (item) => item.pantryItemId === pantryItemId && isCheckedAtOnJstDay(item.checkedAt, today),
  );
}

export function createPlannerAttempt(): PlannerAttempt {
  return {
    idempotencyKey: crypto.randomUUID(),
    expiredPantryChecks: [],
    qualityMode: false,
  };
}

export function isPastEnteredExpiry(item: Pick<PantryItem, "expiresOn">, now: Date): boolean {
  return item.expiresOn !== null && item.expiresOn < getJstDateKey(now);
}

export function hasCurrentExpiredConfirmation(
  attempt: PlannerAttempt,
  pantryItemId: string,
  now: Date,
): boolean {
  const today = getJstDateKey(now);
  return attempt.expiredPantryChecks.some(
    (item) => item.pantryItemId === pantryItemId && isCheckedAtOnJstDay(item.checkedAt, today),
  );
}

/**
 * attempt メモリまたは session 当日確認のどちらかがあれば確認済み（PE8）。
 * 緊急ページは attempt を持たないため session 側を正とする。
 */
export function hasExpiredPantryConfirmation(
  attempt: PlannerAttempt | null,
  userId: string | undefined,
  pantryItemId: string,
  now: Date,
): boolean {
  if (attempt !== null && hasCurrentExpiredConfirmation(attempt, pantryItemId, now)) {
    return true;
  }
  if (userId !== undefined && hasSessionExpiredPantryConfirmation(userId, pantryItemId, now)) {
    return true;
  }
  return false;
}

export function confirmExpiredPantryItem(
  attempt: PlannerAttempt,
  pantryItemId: string,
  now: Date,
): PlannerAttempt {
  return {
    ...attempt,
    qualityMode: attempt.qualityMode,
    expiredPantryChecks: [
      ...attempt.expiredPantryChecks.filter((item) => item.pantryItemId !== pantryItemId),
      { pantryItemId, checkedAt: now.toISOString() },
    ],
  };
}

/**
 * 入力期限が過去の pantryItemId 集合（サーバ expired 集合と同型）。
 * soft 更新で期限が延びた ID はここに入らない。
 */
export function currentlyExpiredPantryItemIds(
  items: readonly Pick<PantryItem, "id" | "expiresOn">[],
  now: Date,
): Set<string> {
  const ids = new Set<string>();
  for (const item of items) {
    if (isPastEnteredExpiry(item, now)) ids.add(item.id);
  }
  return ids;
}

/**
 * サーバ validateTransientChecks は「選択中 ∩ 期限切れ」と confirmation の exact-set を要求する。
 * 同一 attempt 内で確認済み→解除しても checks を attempt に残し再選択時 dialog を抑止する設計のため、
 * 送信・緊急 handoff 直前に selected ∩ currently-expired へ絞り込む
 * （P1: 非選択 extra と期限切れ解消後の surplus confirmation を載せない）。
 */
export function filterExpiredPantryChecksForSelections(
  checks: readonly ExpiredPantryCheck[],
  selections: readonly { pantryItemId: string }[],
  currentlyExpiredIds: ReadonlySet<string>,
): ExpiredPantryCheck[] {
  const selected = new Set(selections.map((selection) => selection.pantryItemId));
  return checks.filter(
    (check) => selected.has(check.pantryItemId) && currentlyExpiredIds.has(check.pantryItemId),
  );
}
