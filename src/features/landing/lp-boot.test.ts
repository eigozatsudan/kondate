import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("lp-boot", () => {
  it("adds kondate-js on the document element", () => {
    document.documentElement.className = "";
    const source = readFileSync(resolve("public/lp-boot.js"), "utf8");
    new Function(source)();
    expect(document.documentElement.classList.contains("kondate-js")).toBe(true);
  });

  it("hides the public landing node from the entry stylesheet", () => {
    const css = readFileSync(resolve("src/styles.css"), "utf8");
    expect(css).toMatch(/html\.kondate-js\s+#kondate-public-lp\s*\{[^}]*display:\s*none/u);
    const landingCss = readFileSync(resolve("src/features/landing/free-landing-page.css"), "utf8");
    expect(landingCss).not.toMatch(/#kondate-public-lp/u);
  });
});
