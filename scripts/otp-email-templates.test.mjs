import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * GoTrue が取りに行くテンプレ URL。キーがあるだけでは届かないので、
 * 値そのものがこの絶対 URL であることを固定する。file:// や
 * host.docker.internal は live 根拠が無く、Linux の auth から届かない。
 */
const EXPECTED_TEMPLATE_URL = "http://otp-templates:8080/otp-code.html";
const EXPECTED_SUBJECT = "こんだて日和の番号";

/**
 * メール本文に残すとリンク経路が復活する断片。
 * `http` は `https` の接頭辞でもあるが、両方を明示して fail-closed にする。
 */
const FORBIDDEN_HTML_FRAGMENTS = ["ConfirmationURL", "TokenHash", "RedirectTo", "http", "https"];

/**
 * override の YAML 値を読む。キー存在だけでは通さず、引用符の有無を正規化して返す。
 * @param {string} source
 * @param {string} key
 */
function readYamlScalar(source, key) {
  const pattern = new RegExp(String.raw`^\s+${key}:\s*(.+?)\s*$`, "m");
  const match = source.match(pattern);
  assert.ok(match, `missing_yaml_key:${key}`);
  const raw = match[1];
  if ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"))) {
    return raw.slice(1, -1);
  }
  return raw;
}

test("otp html has Token and no confirmation URL pieces", async () => {
  const html = await readFile(join(root, "infra/supabase/templates/otp-code.html"), "utf8");
  assert.match(html, /\{\{ \.Token \}\}/u);
  for (const fragment of FORBIDDEN_HTML_FRAGMENTS) {
    assert.equal(html.includes(fragment), false, `forbidden_html:${fragment}`);
  }
});

test("subject file is exactly the locked Japanese subject", async () => {
  const subject = await readFile(
    join(root, "infra/supabase/templates/otp-code-subject.txt"),
    "utf8",
  );
  assert.equal(subject.replace(/\r?\n$/u, ""), EXPECTED_SUBJECT);
});

test("override pins OTP lifetime and the same reachable template URL", async () => {
  const override = await readFile(join(root, "infra/supabase.override.yaml"), "utf8");

  assert.equal(readYamlScalar(override, "GOTRUE_MAILER_OTP_EXP"), "3600");
  assert.equal(readYamlScalar(override, "GOTRUE_MAILER_OTP_LENGTH"), "6");

  const magicLink = readYamlScalar(override, "GOTRUE_MAILER_TEMPLATES_MAGIC_LINK");
  const confirmation = readYamlScalar(override, "GOTRUE_MAILER_TEMPLATES_CONFIRMATION");
  assert.equal(magicLink, EXPECTED_TEMPLATE_URL);
  assert.equal(confirmation, EXPECTED_TEMPLATE_URL);
  assert.equal(magicLink, confirmation);

  // /otp メールは GoTrue 内部で MagicLink。false だと番号送信が 422 になる。
  assert.equal(readYamlScalar(override, "GOTRUE_EXTERNAL_EMAIL_MAGIC_LINK_ENABLED"), "true");
});
