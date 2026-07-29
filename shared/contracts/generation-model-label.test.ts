import { describe, expect, it } from "vitest";
import { formatGenerationModelLabel } from "./generation-model-label.js";

describe("formatGenerationModelLabel", () => {
  it("maps known OpenRouter IDs to short labels", () => {
    expect(formatGenerationModelLabel("inception/mercury-2")).toBe("Mercury 2");
    expect(formatGenerationModelLabel("openai/gpt-4.1-nano")).toBe("GPT-4.1 Nano");
    expect(formatGenerationModelLabel("mock/kondate-primary:free")).toBe("Kondate Primary");
  });

  it("title-cases unknown vendor/name IDs and drops :variant", () => {
    expect(formatGenerationModelLabel("google/gemma-3-27b-it")).toBe("Gemma 3 27b It");
    expect(formatGenerationModelLabel("acme/foo-bar:beta")).toBe("Foo Bar");
  });

  it("returns empty string for blank input", () => {
    expect(formatGenerationModelLabel("")).toBe("");
    expect(formatGenerationModelLabel("   ")).toBe("");
  });
});
