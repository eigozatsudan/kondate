import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { parseMailpitOtpCode } from "./mailpit-otp-code.ts";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");

test("product template with Token replaced yields six ASCII digits", async () => {
  // 製品テンプレ相当: {{ .Token }} だけを番号にし、URL 断片が無い本文を正とする
  const template = await readFile(join(repoRoot, "infra/supabase/templates/otp-code.html"), "utf8");
  const body = template.replaceAll("{{ .Token }}", "123456");
  assert.equal(parseMailpitOtpCode(body), "123456");
});

test("a body that is only https://example throws", () => {
  assert.throws(() => {
    parseMailpitOtpCode("https://example");
  });
});

test("a mixed body with digits and http throws", () => {
  // https://example だけでは足りない。番号と URL が共存しても fail-closed
  assert.throws(() => {
    parseMailpitOtpCode("123456 http://127.0.0.1/auth/callback");
  });
});

test("a clean six-digit body without http or https succeeds", () => {
  assert.equal(parseMailpitOtpCode("確認番号 123456"), "123456");
});
