import type { AiGenerationResponse } from "../../../shared/contracts/generation.js";
import type { DishRegenerationAiOutput } from "../../../shared/contracts/regeneration.js";

type ScenarioName =
  | "success"
  | "idea-servings-1"
  | "idea-servings-2"
  | "idea-servings-20"
  | "idea-alternate-menu-1"
  | "idea-dish-replacement-1"
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
  | "over-time-limit"
  | "allergen-alias"
  | "processed-label-confirmation"
  | "unsafe-child-shape"
  | "senior-texture-adaptation"
  | "unsupported-medical"
  | "missing-portion-branch"
  | "must-use-pantry-omission"
  | "unavailable-pantry-quantity"
  | "duplicate-dish-regeneration"
  | "fallback-model-success";

type DishScenarioName =
  | "dish-replacement"
  | "idea-dish-replacement-1"
  | "duplicate-dish-regeneration";

export declare const scenarios: Readonly<
  Record<Exclude<ScenarioName, "malformed-json" | DishScenarioName>, AiGenerationResponse> & {
    readonly "malformed-json": string;
    readonly "dish-replacement": DishRegenerationAiOutput;
    readonly "idea-dish-replacement-1": DishRegenerationAiOutput;
    readonly "duplicate-dish-regeneration": DishRegenerationAiOutput;
  }
>;
