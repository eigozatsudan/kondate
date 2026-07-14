import type { Database as GeneratedDatabase } from "./database.generated";

type GeneratedPublic = GeneratedDatabase["public"];
type GeneratedFunctions = GeneratedPublic["Functions"];
type GeneratedSaveDraft = GeneratedFunctions["save_generation_draft"];
type GeneratedSaveDraftArgs = GeneratedSaveDraft["Args"];

type NullableDraftArgs =
  "p_meal_type" | "p_cuisine_genre" | "p_time_limit_minutes" | "p_budget_preference";

type SaveDraftArgs = Omit<GeneratedSaveDraftArgs, NullableDraftArgs> & {
  p_meal_type: GeneratedSaveDraftArgs["p_meal_type"] | null;
  p_cuisine_genre: GeneratedSaveDraftArgs["p_cuisine_genre"] | null;
  p_time_limit_minutes: GeneratedSaveDraftArgs["p_time_limit_minutes"] | null;
  p_budget_preference: GeneratedSaveDraftArgs["p_budget_preference"] | null;
};

export type Database = Omit<GeneratedDatabase, "public"> & {
  public: Omit<GeneratedPublic, "Functions"> & {
    Functions: Omit<GeneratedFunctions, "save_generation_draft"> & {
      save_generation_draft: Omit<GeneratedSaveDraft, "Args"> & {
        Args: SaveDraftArgs;
      };
    };
  };
};
