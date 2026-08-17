/**
 * committed live session 印。番号 / Google 成功後の persist を leftover と区別する。
 * origin 共有 localStorage。token / email / returnTo は載せない。TTL は無い
 * （60s 番号印 / 300s Google completion 切れ後も live を守る。logout が消す）。
 */
export const LIVE_AUTH_SESSION_MARK_KEY = "kondate.auth.liveSession";

export type LiveAuthSessionMark = {
  userId?: string;
  storedAt: string;
};

function parseLiveAuthSessionMark(raw: string): LiveAuthSessionMark | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return null;
    const storedAt = "storedAt" in parsed ? parsed.storedAt : null;
    if (typeof storedAt !== "string" || Number.isNaN(Date.parse(storedAt))) return null;
    const userId = "userId" in parsed ? parsed.userId : undefined;
    if (userId !== undefined && (typeof userId !== "string" || userId === "")) {
      return { storedAt };
    }
    return typeof userId === "string" ? { userId, storedAt } : { storedAt };
  } catch {
    return null;
  }
}

export function readLiveAuthSessionMark(
  storage: Storage = window.localStorage,
): LiveAuthSessionMark | null {
  try {
    const raw = storage.getItem(LIVE_AUTH_SESSION_MARK_KEY);
    if (raw === null) return null;
    const mark = parseLiveAuthSessionMark(raw);
    if (mark === null) {
      storage.removeItem(LIVE_AUTH_SESSION_MARK_KEY);
      return null;
    }
    return mark;
  } catch {
    return null;
  }
}

/**
 * 番号 verify / 非 /login の成功 apply で書く。
 * userId 無しで書くときは既存 userId を落とさない（OTP 直後の race）。
 */
export function writeLiveAuthSessionMark(
  userId?: string,
  storage: Storage = window.localStorage,
): void {
  try {
    const existing = readLiveAuthSessionMark(storage);
    const resolvedUserId = typeof userId === "string" && userId !== "" ? userId : existing?.userId;
    const snapshot: LiveAuthSessionMark = {
      storedAt: new Date().toISOString(),
      ...(resolvedUserId === undefined ? {} : { userId: resolvedUserId }),
    };
    storage.setItem(LIVE_AUTH_SESSION_MARK_KEY, JSON.stringify(snapshot));
  } catch {
    // 印が書けなくても Login は進む。leftover 誤認は残差
  }
}

/**
 * Google completion など「新しい committed live」。旧 userId は残さない
 * （前ユーザ leftover 印を Google 成功後に引き継がない）。
 */
export function commitLiveAuthSessionMark(storage: Storage = window.localStorage): void {
  try {
    const snapshot: LiveAuthSessionMark = { storedAt: new Date().toISOString() };
    storage.setItem(LIVE_AUTH_SESSION_MARK_KEY, JSON.stringify(snapshot));
  } catch {
    // 印が書けなくても completion 自体は既に書けている
  }
}

export function clearLiveAuthSessionMark(storage: Storage = window.localStorage): void {
  try {
    storage.removeItem(LIVE_AUTH_SESSION_MARK_KEY);
  } catch {
    // best-effort
  }
}

/** leftover 指紋 `userId:access_token` から userId だけ取る。 */
export function userIdFromSessionProbeKey(sessionKey: string | null): string | null {
  if (sessionKey === null) return null;
  const separator = sessionKey.indexOf(":");
  if (separator <= 0) return null;
  const userId = sessionKey.slice(0, separator);
  return userId === "" ? null : userId;
}

/**
 * persist 指紋が committed live と一致するか。
 * - 印なし → leftover
 * - userId 無しの印 → committed（wipe/signOut を控える）
 * - userId 一致 → live
 * - userId 不一致 → 別 user の leftover
 */
export function liveAuthSessionMarkProtectsFingerprint(
  sessionKey: string | null,
  storage: Storage = window.localStorage,
): boolean {
  const mark = readLiveAuthSessionMark(storage);
  if (mark === null) return false;
  if (mark.userId === undefined) return true;
  const sessionUserId = userIdFromSessionProbeKey(sessionKey);
  if (sessionUserId === null) return true;
  return sessionUserId === mark.userId;
}

/** leftover 掃除中に番号 / Google が印を立てたか（afterWipe 後着 signOut 抑止）。 */
export function liveAuthSessionMarkAppearedOrUpdated(
  before: LiveAuthSessionMark | null,
  after: LiveAuthSessionMark | null,
): boolean {
  if (after === null) return false;
  if (before === null) return true;
  if (after.userId !== before.userId) return true;
  const beforeMs = Date.parse(before.storedAt);
  const afterMs = Date.parse(after.storedAt);
  if (Number.isNaN(beforeMs) || Number.isNaN(afterMs)) return false;
  return afterMs > beforeMs;
}

/** /login 上の leftover persist を live と誤認しない。callback / planner は committed。 */
export function shouldCommitLiveAuthSessionMark(pathname: string): boolean {
  return pathname !== "/login" && !pathname.startsWith("/login/");
}
