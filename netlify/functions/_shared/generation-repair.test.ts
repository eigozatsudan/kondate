import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  GenerationOutputError,
  generationRepairCodes,
  repairPathByCode,
  toRepairDiagnostics,
} from "./generation-repair.js";

describe("generation repair boundary", () => {
  it("owns a fixed path for every closed code", () => {
    expect(Object.keys(repairPathByCode)).toEqual(generationRepairCodes);
    expect(Object.values(repairPathByCode).every((path) => path.startsWith("menu"))).toBe(true);
  });

  it("deduplicates stably, collapses unknown codes, and never copies raw paths", () => {
    const diagnostics = toRepairDiagnostics([
      { code: "dangling_ref", path: "menu.dishes.0.secret" },
      { code: "unknown_provider_code", path: "55000000-0000-4000-8000-000000000001" },
      { code: "dangling_ref", path: "provider_ref" },
    ]);
    expect(diagnostics).toEqual([
      { code: "dangling_ref", path: "menu.references" },
      { code: "invalid_provider_menu", path: "menu" },
    ]);
    expect(JSON.stringify(diagnostics)).not.toContain("55000000");
    expect(JSON.stringify(diagnostics)).not.toContain("provider_ref");
  });

  it("caps diagnostics at 64", () => {
    expect(generationRepairCodes.length).toBeLessThanOrEqual(64);
    const canary = "55000000-0000-4000-8000-000000000001/provider_ref.99";
    const issues = [
      ...generationRepairCodes.map((code) => ({ code, path: canary, message: canary })),
      { code: "unknown", path: canary, message: canary },
      ...Array.from({ length: 100 }, (_, index) => ({
        code: generationRepairCodes[index % generationRepairCodes.length] ?? "unknown",
        path: canary,
        message: canary,
      })),
    ];
    const diagnostics = toRepairDiagnostics(issues);
    expect(diagnostics).toEqual(
      generationRepairCodes.map((code) => ({ code, path: repairPathByCode[code] })),
    );
    expect(JSON.stringify(diagnostics)).not.toContain(canary);
  });

  it("exposes only sanitized diagnostics from the common error", () => {
    const error = new GenerationOutputError(["unknown_pantry_ref", "unknown_pantry_ref"]);
    expect(error.message).toBe("invalid_generation_output");
    expect(error.issues).toEqual([{ code: "unknown_pantry_ref", path: "menu.pantryUsage" }]);
  });

  it("keeps the repair leaf independent and the materializer service-free", () => {
    const repairSource = readFileSync("netlify/functions/_shared/generation-repair.ts", "utf8");
    const materializerSource = readFileSync(
      "netlify/functions/_shared/generation-materializer.ts",
      "utf8",
    );
    expect(repairSource).not.toContain("generation-service");
    expect(repairSource).not.toContain("generation-materializer");
    expect(materializerSource).not.toContain("generation-service");
  });
});
