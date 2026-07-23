import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  createIdeaSafetyFingerprint,
  ideaSafetyCanonicalJson,
  ideaSafetySnapshot,
} from "./idea-fingerprint.js";

describe("idea safety fingerprint", () => {
  it("hashes only the fixed idea safety snapshot", () => {
    expect(ideaSafetyCanonicalJson).toBe('{"assurance":"none","members":[],"mode":"idea"}');
    expect(ideaSafetySnapshot).toEqual({
      assurance: "none",
      members: [],
      mode: "idea",
    });
    expect(createIdeaSafetyFingerprint()).toMatch(/^[0-9a-f]{64}$/);
    expect(createIdeaSafetyFingerprint()).toBe(
      createHash("sha256").update(ideaSafetyCanonicalJson, "utf8").digest("hex"),
    );
  });

  it("is deterministic and independent of household state", () => {
    expect(createIdeaSafetyFingerprint()).toBe(createIdeaSafetyFingerprint());
  });
});
