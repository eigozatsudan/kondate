import { expect, it, vi } from "vitest";
import { acceptCurrentPrivacyConsent } from "./privacy-api";

const consent = {
  user_id: "user-1",
  notice_version: "2026-07-11.v1",
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
