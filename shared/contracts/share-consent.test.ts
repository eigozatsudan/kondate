import { describe, expect, it } from "vitest";
import {
  isCurrentShareConsent,
  SHARE_CONSENT_VERSION_SQL_LITERAL,
  shareConsentVersion,
} from "./share-consent.js";

describe("shareConsentVersion", () => {
  it("locks the single current share consent version", () => {
    expect(shareConsentVersion).toBe("2026-08-01.v1");
  });

  // AP20: TS SSOT と SQL private.share_current_consent_version() の dual-write 一致
  it("AP20: TS shareConsentVersion matches SQL dual-write literal", () => {
    expect(shareConsentVersion).toBe(SHARE_CONSENT_VERSION_SQL_LITERAL);
    // SQL 関数本文（20260801190000_share_community_emergency.sql）の固定値と一致させる
    expect(SHARE_CONSENT_VERSION_SQL_LITERAL).toBe("2026-08-01.v1");
  });

  it("rejects an older version as not current without a compatibility parser", () => {
    expect(
      isCurrentShareConsent({
        consent_version: "2026-07-01.v1",
        revoked_at: null,
      }),
    ).toBe(false);
  });

  it("accepts only the current version with revoked_at null", () => {
    expect(
      isCurrentShareConsent({
        consent_version: shareConsentVersion,
        revoked_at: null,
      }),
    ).toBe(true);
  });

  it("rejects the current version when revoked_at is set", () => {
    expect(
      isCurrentShareConsent({
        consent_version: shareConsentVersion,
        revoked_at: "2026-08-01T00:00:00.000Z",
      }),
    ).toBe(false);
  });
});
