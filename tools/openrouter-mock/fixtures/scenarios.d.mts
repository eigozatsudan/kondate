import type { AiGenerationResponse } from "../../../shared/contracts/generation.js";
import type { DishRegenerationAiOutput } from "../../../shared/contracts/regeneration.js";

type ScenarioName =
  | "success"
  | "idea-servings-1"
  | "idea-servings-2"
  | "idea-servings-20"
  | "idea-alternate-menu-1"
  | "duplicate-menu"
  | "alternate-menu"
  | "dish-replacement"
  | "constraint-conflict"
  | "malformed-json"
  | "direct-allergen"
  | "alias-in-step"
  | "missing-label-confirmation"
  | "unsafe-age-shape"
  | "invalid-adaptation-branch"
  | "invalid-pantry-dish-link"
  | "over-time-limit";

export declare const scenarios: Readonly<
  Record<Exclude<ScenarioName, "malformed-json" | "dish-replacement">, AiGenerationResponse> & {
    readonly "malformed-json": string;
    readonly "dish-replacement": DishRegenerationAiOutput;
  }
>;
