/// <reference types="node" />

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { makeValidatedMenu } from "../testing/factories.js";
import { emergencyMenusDataSchema } from "./contracts.js";

describe("emergency menu contracts", () => {
  it("parses a complete emergency menu response", () => {
    const response = {
      fixtureVersion: "2026-07-11.v1",
      candidates: [
        {
          menu: makeValidatedMenu(),
          memberLabels: {},
          allergenLabels: {},
          labelWarnings: [],
        },
      ],
      message: "AIを使わない15分緊急献立です",
      consumesAiQuota: false,
    };

    expect(emergencyMenusDataSchema.parse(response)).toEqual(response);
  });

  it.each(["filter-emergency-menus", "validate-generated-menu", "fingerprint", "node:"])(
    "does not import the server-only dependency %s",
    (forbiddenDependency) => {
      const source = readFileSync("shared/emergency/contracts.ts", "utf8");

      expect(source).not.toContain(forbiddenDependency);
    },
  );
});
