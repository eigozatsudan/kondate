import { describe, expect, it } from "vitest";
import { isCurrentShareConsent, shareConsentVersion } from "./share-consent.js";

describe("shareConsentVersion", () => {
  it("locks the single current share consent version", () => {
    expect(shareConsentVersion).toBe("2026-08-01.v1");
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
