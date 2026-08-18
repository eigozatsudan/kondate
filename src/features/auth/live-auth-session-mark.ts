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
 * 番号 verify / 既存 live 印の userId 埋め。
 * 印なし leftover persist を /planner 等の成功 apply で昇格させない。
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
 * userId が分かるときは埋める（C6: userId 無し印が任意 persist を spare しない）。
 */
export function commitLiveAuthSessionMark(
  storage: Storage = window.localStorage,
  userId?: string,
): void {
  try {
    const snapshot: LiveAuthSessionMark = {
      storedAt: new Date().toISOString(),
      ...(typeof userId === "string" && userId !== "" ? { userId } : {}),
    };
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
 * - userId 無しの印 → 任意 persist は spare しない（C6）。指紋不明（probe miss）だけ触らない
 * - userId 一致 → live
 * - userId 不一致 → 別 user の leftover
 */
export function liveAuthSessionMarkProtectsFingerprint(
  sessionKey: string | null,
  storage: Storage = window.localStorage,
): boolean {
  const mark = readLiveAuthSessionMark(storage);
  if (mark === null) return false;
  const sessionUserId = userIdFromSessionProbeKey(sessionKey);
  if (mark.userId === undefined) {
    return sessionUserId === null;
  }
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

/**
 * 既存 live 印の userId を埋めてよい path。
 * /login 上の leftover persist を live と誤認しない。印なし persist は昇格しない。
 */
export function shouldCommitLiveAuthSessionMark(pathname: string): boolean {
  return pathname !== "/login" && !pathname.startsWith("/login/");
}

/**
 * leftover persist を first-writer pin してはいけない path。
 * /login は番号の誕生点なので印なし first pin を許す。
 * /auth/callback は印なし leftover を first-pin すると後着 Google を拒む（C4）。
 * 新規 exchange session は AuthProvider が mount 時 persist token と照合して通す。
 */
export function shouldRefuseUnmarkedLeftoverFirstPin(pathname: string): boolean {
  return pathname !== "/login" && !pathname.startsWith("/login/");
}

/** 番号 / Google 成功の意図的 pin 付け替え。sessionStorage。token は載せない。 */
export const AUTH_SESSION_SWITCH_KEY = "kondate.auth.sessionSwitch";
const AUTH_SESSION_SWITCH_TTL_MS = 60_000;

export type AuthSessionSwitchKind = "email_otp" | "google_callback";

type AuthSessionSwitchMark = {
  kind: AuthSessionSwitchKind;
  storedAt: string;
};

function parseAuthSessionSwitchMark(raw: string): AuthSessionSwitchMark | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return null;
    const kind = "kind" in parsed ? parsed.kind : null;
    const storedAt = "storedAt" in parsed ? parsed.storedAt : null;
    if (kind !== "email_otp" && kind !== "google_callback") return null;
    if (typeof storedAt !== "string" || Number.isNaN(Date.parse(storedAt))) return null;
    return { kind, storedAt };
  } catch {
    return null;
  }
}

/**
 * verifyOtp / exchange 直前に立てる。onAuthStateChange が pin 拒否する前に届く。
 * 同一タブの誕生点だけ有効（C2 / C4）。
 */
export function armIntentionalAuthSessionSwitch(
  kind: AuthSessionSwitchKind,
  storage: Storage = window.sessionStorage,
): void {
  try {
    const snapshot: AuthSessionSwitchMark = { kind, storedAt: new Date().toISOString() };
    storage.setItem(AUTH_SESSION_SWITCH_KEY, JSON.stringify(snapshot));
  } catch {
    // 印が書けなくても verify / exchange 自体は進める
  }
}

export function clearIntentionalAuthSessionSwitch(storage: Storage = window.sessionStorage): void {
  try {
    storage.removeItem(AUTH_SESSION_SWITCH_KEY);
  } catch {
    // best-effort
  }
}

/**
 * leftover pin A の上に今このタブで立てた番号 / Google session を載せてよいか。
 * 他 path では residual / 他タブ last-writer を pin で拒む（既存 C2）。
 */
export function isIntentionalAuthSessionSwitchArmed(
  pathname: string,
  storage: Storage = window.sessionStorage,
): boolean {
  try {
    const raw = storage.getItem(AUTH_SESSION_SWITCH_KEY);
    if (raw === null) return false;
    const mark = parseAuthSessionSwitchMark(raw);
    if (mark === null) {
      storage.removeItem(AUTH_SESSION_SWITCH_KEY);
      return false;
    }
    const storedMs = Date.parse(mark.storedAt);
    if (Number.isNaN(storedMs) || Date.now() - storedMs > AUTH_SESSION_SWITCH_TTL_MS) {
      storage.removeItem(AUTH_SESSION_SWITCH_KEY);
      return false;
    }
    if (mark.kind === "email_otp") {
      return pathname === "/login" || pathname.startsWith("/login/");
    }
    return pathname === "/auth/callback" || pathname.startsWith("/auth/callback/");
  } catch {
    return false;
  }
}
