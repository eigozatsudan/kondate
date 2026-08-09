import assert from "node:assert/strict";
import test from "node:test";
import { Linter } from "eslint";
import tsparser from "@typescript-eslint/parser";
import config from "../../eslint.config.js";

/** eslint.config.js から本ルールのブロックだけを取り出して単体で回す。 */
const ruleBlock = config.find(
  (block) => block?.rules !== undefined && "no-restricted-syntax" in block.rules,
);

/**
 * 第 3 引数のファイル名は必須。省略すると既定名 <input> が files パターンに
 * 一致せず languageOptions が適用されないため、全ケースが
 * "Parsing error: Unexpected token <" を 1 件返す。その結果 rejects 側は
 * 偽の緑、allows 側は赤になり、原因をセレクタだと誤診する。
 */
const lint = (code) =>
  new Linter().verify(
    code,
    {
      files: ["**/*.tsx"],
      languageOptions: { parser: tsparser, parserOptions: { ecmaFeatures: { jsx: true } } },
      rules: ruleBlock?.rules ?? {},
    },
    "fixture.tsx",
  ).length;

for (const code of [
  '<div className="font-semibold text-red-800" />',
  '<div className={"bg-terracotta-700"} />',
  '<div className={`stack ${on ? "bg-terracotta-700" : "p-4"}`} />',
  '<div className={on ? "text-amber-800" : "gap-4"} />',
  '<div className="text-ink text-white" />',
  '<div className="flex-col w-full rounded-xl" />',
  '<div className="flex flex-col gap-2" />',
  // TemplateElement セレクタが静的部分を拾うことを固定する（子孫 Literal だけでは漏れうる）
  "<div className={`bg-terracotta-700 ${x}`} />",
  // Literal と TemplateElement の禁止集合を揃えたことを固定（absolute / border- の抜け）
  "<div className={`absolute top-0 ${x}`} />",
  "<div className={`border-red-500 ${x}`} />",
  "<div className={`sticky top-0 ${x}`} />",
  "<div className={`fixed inset-0 ${x}`} />",
]) {
  test(`rejects ${code}`, () => {
    assert.ok(lint(code) > 0, "違反として検出されるべき");
  });
}

for (const code of [
  '<button className="primary-button min-h-11" />',
  '<div className="page-frame stack" />',
  '<p className="type-small" />',
  "<div className={notice.className} />",
]) {
  test(`allows ${code}`, () => {
    assert.equal(lint(code), 0, "許可されるべき");
  });
}
