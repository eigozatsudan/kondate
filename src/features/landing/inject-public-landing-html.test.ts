import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { FREE_LP_H1, FREE_LP_LEAD } from "./free-landing-copy";
import {
  PUBLIC_LANDING_HEAD_MARK,
  PUBLIC_LANDING_MOUNT,
  injectPublicLandingHtml,
  isPublicLandingIndexFilename,
} from "./inject-public-landing-html";

const shell = `<!doctype html><html lang="ja"><head>${PUBLIC_LANDING_HEAD_MARK}<title>こんだて日和</title></head><body>${PUBLIC_LANDING_MOUNT}<div id="root"></div></body></html>`;

describe("isPublicLandingIndexFilename", () => {
  it("accepts only index.html", () => {
    expect(isPublicLandingIndexFilename("/workspace/index.html")).toBe(true);
    expect(isPublicLandingIndexFilename("/workspace/app.html")).toBe(false);
    expect(isPublicLandingIndexFilename("/workspace/login.html")).toBe(false);
  });
});

describe("injectPublicLandingHtml", () => {
  it("fills mount and head, and is idempotent", () => {
    const once = injectPublicLandingHtml(shell);
    expect(once).toContain(FREE_LP_H1);
    expect(once).toContain(FREE_LP_LEAD);
    expect(once).toContain('id="kondate-public-lp"');
    expect(once).toContain('name="description"');
    expect(once).toContain('rel="canonical" href="/"');
    expect(once).not.toContain(PUBLIC_LANDING_HEAD_MARK);
    expect(injectPublicLandingHtml(once)).toBe(once);
  });

  it("fails closed on a missing or prefilled mount", () => {
    expect(() => injectPublicLandingHtml("<html></html>")).toThrow(/public_lp_mount_missing/u);
    expect(() =>
      injectPublicLandingHtml(
        shell.replace(PUBLIC_LANDING_MOUNT, '<div id="kondate-public-lp">x</div>'),
      ),
    ).toThrow(/public_lp_mount_not_empty/u);
    expect(() => injectPublicLandingHtml(shell.replace(PUBLIC_LANDING_HEAD_MARK, ""))).toThrow(
      /public_lp_head_mark_missing/u,
    );
  });
});

describe("html sources", () => {
  it("keeps LP mount only on index.html", () => {
    const indexHtml = readFileSync(resolve("index.html"), "utf8");
    const appHtml = readFileSync(resolve("app.html"), "utf8");
    expect(indexHtml).toContain(PUBLIC_LANDING_MOUNT);
    expect(indexHtml).toContain(PUBLIC_LANDING_HEAD_MARK);
    expect(indexHtml).toContain('src="/lp-boot.js"');
    expect(indexHtml).not.toContain('type="module" src="/lp-boot.js"');
    expect(appHtml).not.toContain("kondate-public-lp");
    expect(appHtml).not.toContain("lp-boot.js");
    expect(appHtml).not.toContain('name="description"');
    expect(appHtml).toContain('id="root"');
    expect(appHtml).toContain('src="/src/main.tsx"');
  });
});
