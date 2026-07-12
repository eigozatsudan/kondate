import { describe, expect, it } from "vitest";
import {
  decryptContinuationCode,
  encryptContinuationCode,
  sha256,
} from "./auth-continuation-crypto.js";

describe("auth continuation crypto", () => {
  it("binds AES-GCM ciphertext to its continuation ID and origin", async () => {
    const key = new Uint8Array(32).fill(1);
    const encrypted = await encryptContinuationCode(
      "code",
      "10000000-0000-4000-8000-000000000001",
      "https://app.test",
      key,
    );
    await expect(
      decryptContinuationCode(
        encrypted,
        "10000000-0000-4000-8000-000000000001",
        "https://app.test",
        key,
      ),
    ).resolves.toBe("code");
    await expect(
      decryptContinuationCode(
        encrypted,
        "10000000-0000-4000-8000-000000000001",
        "https://other.test",
        key,
      ),
    ).rejects.toThrow("continuation_decryption_failed");
  });

  it("hashes a value to exactly 32 bytes", async () => {
    expect((await sha256("state")).byteLength).toBe(32);
  });
});
