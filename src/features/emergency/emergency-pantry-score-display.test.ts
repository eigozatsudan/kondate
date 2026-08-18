import { expect, it } from "vitest";
import { makeValidatedMenu } from "@shared/testing/factories";
import { listEmergencyPantryScoreMatches } from "./emergency-pantry-score-display";

it("matches selected pantry names that appear in dish or ingredient text", () => {
  const menu = makeValidatedMenu();
  expect(
    listEmergencyPantryScoreMatches({
      menu,
      selectedPantryNames: ["ごはん", "とうふ"],
    }),
  ).toEqual(["ごはん"]);
});

it("does not treat unmatched selected names as used", () => {
  const menu = makeValidatedMenu();
  expect(
    listEmergencyPantryScoreMatches({
      menu,
      selectedPantryNames: ["とうふ"],
    }),
  ).toEqual([]);
});

it("dedupes the same pantry name after food-text normalization", () => {
  const menu = makeValidatedMenu();
  expect(
    listEmergencyPantryScoreMatches({
      menu,
      selectedPantryNames: ["ごはん", "ご はん"],
    }),
  ).toEqual(["ごはん"]);
});
