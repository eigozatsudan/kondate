import { afterEach, expect, it } from "vitest";
import {
  LIVE_AUTH_SESSION_MARK_KEY,
  clearLiveAuthSessionMark,
  commitLiveAuthSessionMark,
  liveAuthSessionMarkAppearedOrUpdated,
  liveAuthSessionMarkProtectsFingerprint,
  readLiveAuthSessionMark,
  shouldCommitLiveAuthSessionMark,
  userIdFromSessionProbeKey,
  writeLiveAuthSessionMark,
} from "./live-auth-session-mark";

afterEach(() => {
  window.localStorage.removeItem(LIVE_AUTH_SESSION_MARK_KEY);
});

it("writes and reads a live mark without tokens or email", () => {
  writeLiveAuthSessionMark("user-1");
  const mark = readLiveAuthSessionMark();
  expect(mark?.userId).toBe("user-1");
  expect(typeof mark?.storedAt).toBe("string");
  const raw = window.localStorage.getItem(LIVE_AUTH_SESSION_MARK_KEY);
  expect(raw).not.toMatch(/access_token|@/);
});

it("does not drop an existing userId when writing without one", () => {
  writeLiveAuthSessionMark("user-1");
  writeLiveAuthSessionMark();
  expect(readLiveAuthSessionMark()?.userId).toBe("user-1");
});

it("commitLiveAuthSessionMark starts a new committed live without the prior userId", () => {
  writeLiveAuthSessionMark("user-1");
  commitLiveAuthSessionMark();
  expect(readLiveAuthSessionMark()?.userId).toBeUndefined();
  expect(readLiveAuthSessionMark()?.storedAt).toEqual(expect.any(String));
});

it("protects a matching persist fingerprint and not a different user leftover", () => {
  writeLiveAuthSessionMark("leftover-user");
  expect(liveAuthSessionMarkProtectsFingerprint("leftover-user:leftover-access")).toBe(true);
  expect(liveAuthSessionMarkProtectsFingerprint("other-user:other-access")).toBe(false);
  expect(liveAuthSessionMarkProtectsFingerprint(null)).toBe(true);
});

it("treats a userId-less committed mark as live", () => {
  writeLiveAuthSessionMark();
  expect(liveAuthSessionMarkProtectsFingerprint("anyone:token")).toBe(true);
});

it("detects a live mark that appeared during leftover cleanup", () => {
  expect(
    liveAuthSessionMarkAppearedOrUpdated(null, {
      userId: "otp-user",
      storedAt: new Date().toISOString(),
    }),
  ).toBe(true);
  const same = { userId: "user-a", storedAt: "2026-08-17T00:00:00.000Z" };
  expect(liveAuthSessionMarkAppearedOrUpdated(same, same)).toBe(false);
});

it("commits live marks off /login and not on leftover Login", () => {
  expect(shouldCommitLiveAuthSessionMark("/planner")).toBe(true);
  expect(shouldCommitLiveAuthSessionMark("/auth/callback")).toBe(true);
  expect(shouldCommitLiveAuthSessionMark("/login")).toBe(false);
  expect(shouldCommitLiveAuthSessionMark("/login/")).toBe(false);
});

it("clears the live mark", () => {
  writeLiveAuthSessionMark("user-1");
  clearLiveAuthSessionMark();
  expect(readLiveAuthSessionMark()).toBeNull();
});

it("reads userId from a leftover fingerprint key", () => {
  expect(userIdFromSessionProbeKey("user-1:access")).toBe("user-1");
  expect(userIdFromSessionProbeKey(null)).toBeNull();
});
