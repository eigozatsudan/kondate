/// <reference types="node" />

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { currentFoodSafetyRulesV1 } from "./current-food-safety-rules.v1.js";
import type { FoodSafetyRule } from "./food-rules.js";

const migrationSql = readFileSync(
  "supabase/migrations/20260711000400_safety_catalog_data.sql",
  "utf8",
);

function quoteSqlString(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function toSqlArray(values: readonly string[]): string {
  return `array[${values.map(quoteSqlString).join(",")}]`;
}

function toSqlTuple(rule: FoodSafetyRule): string {
  return `(${[
    quoteSqlString(rule.id),
    toSqlArray(rule.appliesToAgeBands),
    toSqlArray(rule.matchTerms),
    quoteSqlString(rule.ruleKind),
    rule.requiredSafetyTag === null ? "null" : quoteSqlString(rule.requiredSafetyTag),
    quoteSqlString(rule.userMessage),
    quoteSqlString(rule.ruleVersion),
  ].join(",")})`;
}

function removeFormattingWhitespace(sql: string): string {
  let normalized = "";
  let insideString = false;

  for (let index = 0; index < sql.length; index += 1) {
    const character = sql[index]!;
    if (character === "'") {
      normalized += character;
      if (insideString && sql[index + 1] === "'") {
        normalized += "'";
        index += 1;
      } else {
        insideString = !insideString;
      }
    } else if (insideString || !/\s/u.test(character)) {
      normalized += character;
    }
  }

  return normalized;
}

function extractFoodSafetyRuleTuples(sql: string): string {
  const insertMarker = "insert into public.food_safety_rules";
  const insertStart = sql.indexOf(insertMarker);
  expect(insertStart).toBeGreaterThanOrEqual(0);

  const valuesMarker = ") values";
  const valuesStart = sql.indexOf(valuesMarker, insertStart);
  expect(valuesStart).toBeGreaterThan(insertStart);

  const conflictMarker = "on conflict (id) do update set";
  const conflictStart = sql.indexOf(conflictMarker, valuesStart);
  expect(conflictStart).toBeGreaterThan(valuesStart);

  return sql.slice(valuesStart + valuesMarker.length, conflictStart);
}

describe("current food safety rules v1 migration contract", () => {
  it("keeps exactly the seven canonical rules and every behavioral field in sync", () => {
    expect(currentFoodSafetyRulesV1).toHaveLength(7);

    const actual = removeFormattingWhitespace(extractFoodSafetyRuleTuples(migrationSql));
    const expectedTuples = currentFoodSafetyRulesV1.map((rule) =>
      removeFormattingWhitespace(toSqlTuple(rule)),
    );

    for (const tuple of expectedTuples) {
      expect(actual.split(tuple)).toHaveLength(2);
    }
    expect(actual).toBe(expectedTuples.join(","));
  });
});
