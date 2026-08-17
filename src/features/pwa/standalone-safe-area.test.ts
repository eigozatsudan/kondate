import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const VIEWPORT_FIT_COVER =
  /<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" \/>/u;

describe("standalone safe area", () => {
  it.each(["index.html", "app.html"] as const)(
    "enables env(safe-area-inset-*) on %s so Face ID home indicator does not cover the tab bar",
    (file) => {
      const html = readFileSync(resolve(file), "utf8");
      expect(html).toMatch(VIEWPORT_FIT_COVER);
    },
  );

  it("keeps the bottom nav padded by the home-indicator inset", () => {
    const css = readFileSync(resolve("src/styles.css"), "utf8");
    expect(css).toMatch(
      /\.bottom-nav\s*\{[^}]*padding-bottom:\s*env\(safe-area-inset-bottom, 0px\)/u,
    );
  });

  it("keeps the public landing bottom padding after cover extends into the unsafe area", () => {
    const css = readFileSync(resolve("src/features/landing/free-landing-page.css"), "utf8");
    expect(css).toMatch(
      /padding-bottom:\s*calc\(var\(--space-7\) \+ env\(safe-area-inset-bottom, 0px\)\)/u,
    );
  });

  it("keeps the document top padded if cover extends under the status bar", () => {
    const css = readFileSync(resolve("src/styles.css"), "utf8");
    expect(css).toMatch(/body\s*\{[^}]*padding-top:\s*env\(safe-area-inset-top, 0px\)/u);
  });
});
