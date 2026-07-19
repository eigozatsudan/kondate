import type { AiGenerationResponse } from "../../../shared/contracts/generation.js";

type ScenarioName =
  | "success"
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
  Record<Exclude<ScenarioName, "malformed-json">, AiGenerationResponse> & {
    readonly "malformed-json": string;
  }
>;
