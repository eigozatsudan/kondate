import { expect, it, vi } from "vitest";
import { privacyNoticeVersion } from "@shared/contracts/domain";
import {
  acceptCurrentPrivacyConsent,
  getCurrentPrivacyConsent,
  hasCurrentPrivacyConsent,
} from "./privacy-api";

const consent = {
  user_id: "user-1",
  notice_version: "2026-07-28.v1",
  accepted_at: "2026-07-12T00:00:00.000Z",
  created_at: "2026-07-12T00:00:00.000Z",
};

function consentQuery(data: typeof consent | null) {
  const result = {
    select: vi.fn(),
    eq: vi.fn(),
    maybeSingle: vi.fn(),
  };
  result.select.mockReturnValue(result);
  result.eq.mockReturnValue(result);
  result.maybeSingle.mockResolvedValue({ data, error: null });
  return result;
}

it("returns the immutable consent already accepted for the current notice", async () => {
  const existing = consentQuery(consent);
  const from = vi.fn().mockReturnValue(existing);
  const client = { from } as never;

  await expect(acceptCurrentPrivacyConsent(client, "user-1")).resolves.toEqual(consent);

  expect(from).toHaveBeenCalledOnce();
});

// F4: current notice のみを読む query 条件を固定する
it("queries privacy_consents by user_id and the current notice_version", async () => {
  const existing = consentQuery(consent);
  const from = vi.fn().mockReturnValue(existing);
  const client = { from } as never;

  await expect(getCurrentPrivacyConsent(client, "user-1")).resolves.toEqual(consent);

  expect(from).toHaveBeenCalledWith("privacy_consents");
  expect(existing.select).toHaveBeenCalledWith("*");
  expect(existing.eq).toHaveBeenNthCalledWith(1, "user_id", "user-1");
  expect(existing.eq).toHaveBeenNthCalledWith(2, "notice_version", privacyNoticeVersion);
  expect(privacyNoticeVersion).toBe("2026-07-28.v1");
  expect(existing.maybeSingle).toHaveBeenCalledOnce();
});

// F4: 旧 version 行だけでは現行同意とみなさない
it("treats an older notice_version row as not current consent", () => {
  const older = {
    ...consent,
    notice_version: "2026-07-11.v1",
  };
  expect(hasCurrentPrivacyConsent(older)).toBe(false);
  expect(hasCurrentPrivacyConsent(null)).toBe(false);
  expect(hasCurrentPrivacyConsent(consent)).toBe(true);
});
