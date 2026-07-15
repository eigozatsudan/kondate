/// <reference types="node" />

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  currentAllergenCatalogV1,
  type CurrentAllergenCatalogEntry,
} from "./current-allergen-catalog.v1.js";

const migrationSql = readFileSync(
  "supabase/migrations/20260711000400_safety_catalog_data.sql",
  "utf8",
);

function quoteSqlString(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function toSqlTuple(entry: CurrentAllergenCatalogEntry): string {
  return `(${[
    quoteSqlString(entry.id),
    quoteSqlString(entry.displayName),
    quoteSqlString(entry.regulatoryClass),
    quoteSqlString(entry.catalogVersion),
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

function extractCatalogTuples(sql: string): string {
  const insertMarker = "insert into public.allergen_catalog";
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

describe("current allergen catalog v1 migration contract", () => {
  it("keeps exactly the 29 canonical tuples and every reviewed field in sync", () => {
    expect(currentAllergenCatalogV1).toHaveLength(29);
    expect(new Set(currentAllergenCatalogV1.map((entry) => entry.id)).size).toBe(29);
    const actual = removeFormattingWhitespace(extractCatalogTuples(migrationSql));
    const expectedTuples = currentAllergenCatalogV1.map((entry) =>
      removeFormattingWhitespace(toSqlTuple(entry)),
    );

    for (const tuple of expectedTuples) {
      expect(actual.split(tuple)).toHaveLength(2);
    }
    expect(actual).toBe(expectedTuples.join(","));
  });
});
