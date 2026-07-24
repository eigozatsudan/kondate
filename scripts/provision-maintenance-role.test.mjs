import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";

const scriptPath = fileURLToPath(new URL("./provision-maintenance-role.sh", import.meta.url));
const source = readFileSync(scriptPath, "utf8");

test("does not enable shell xtrace", () => {
  assert.doesNotMatch(source, /set\s+-[a-zA-Z]*x/u);
  assert.doesNotMatch(source, /\bset\s+-o\s+xtrace\b/u);
});

test("does not echo password or URL", () => {
  assert.doesNotMatch(source, /echo\s+"?\$\{?MAINTENANCE_DB_PASSWORD/u);
  assert.doesNotMatch(source, /echo\s+"?\$\{?SUPABASE_MAINTENANCE_DB_URL/u);
  assert.doesNotMatch(source, /printf\s+.*MAINTENANCE_DB_PASSWORD/u);
});

test("does not put password on process argv for docker/psql", () => {
  // docker compose exec の引数にパスワード変数を並べない
  assert.doesNotMatch(source, /docker\s+compose[^\n]*\$\{?MAINTENANCE_DB_PASSWORD\}?/u);
  assert.doesNotMatch(source, /psql[^\n]*\$\{?MAINTENANCE_DB_PASSWORD\}?/u);
});

test("does not embed literal production credentials", () => {
  assert.doesNotMatch(source, /password\s+'[^'$]+'/iu);
  assert.doesNotMatch(source, /postgresql:\/\/[^\s"']+/u);
});

test("provisions login outside migrations and sets statement_timeout", () => {
  assert.match(source, /kondate_maintenance_login/u);
  assert.match(source, /statement_timeout\s*=\s*'20s'/u);
  assert.match(source, /grant\s+kondate_maintenance_executor\s+to\s+kondate_maintenance_login/u);
  assert.match(source, /docker\s+compose/u);
  assert.match(source, /exec\s+-T\s+-e\s+PGPASSWORD\s+db/u);
  // CREATE は NOSUPERUSER 明示。再プロビジョン ALTER はローカル非 superuser postgres 向けに NOSUPERUSER を付けない。
  assert.match(source, /create role kondate_maintenance_login[^;]*nosuperuser/iu);
  assert.doesNotMatch(source, /alter role kondate_maintenance_login[^;]*nosuperuser/iu);
});

test("unsets password material before exit paths", () => {
  assert.match(source, /unset\s+MAINTENANCE_DB_PASSWORD/u);
});
