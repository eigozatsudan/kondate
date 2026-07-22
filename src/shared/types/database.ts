import type { OnboardingStatus } from "@shared/contracts/domain.js";
import type { Database as GeneratedDatabase } from "./database.generated.js";

type GeneratedPublic = GeneratedDatabase["public"];
type GeneratedFunctions = GeneratedPublic["Functions"];
type GeneratedSaveDraft = GeneratedFunctions["save_generation_draft"];
type GeneratedSaveDraftArgs = GeneratedSaveDraft["Args"];
type GeneratedReserveGeneration = GeneratedFunctions["reserve_ai_generation"];
type GeneratedReserveGenerationArgs = GeneratedReserveGeneration["Args"];
type GeneratedFinalizeGenerationFailure = GeneratedFunctions["finalize_ai_generation_failure"];
type GeneratedFinalizeGenerationFailureArgs = GeneratedFinalizeGenerationFailure["Args"];
type GeneratedFinalizeGenerationSuccess = GeneratedFunctions["finalize_ai_generation_success"];
type GeneratedFinalizeGenerationSuccessArgs = GeneratedFinalizeGenerationSuccess["Args"];

type NullableDraftArgs =
  "p_meal_type" | "p_cuisine_genre" | "p_time_limit_minutes" | "p_budget_preference";

type SaveDraftArgs = Omit<GeneratedSaveDraftArgs, NullableDraftArgs> & {
  p_meal_type: GeneratedSaveDraftArgs["p_meal_type"] | null;
  p_cuisine_genre: GeneratedSaveDraftArgs["p_cuisine_genre"] | null;
  p_time_limit_minutes: GeneratedSaveDraftArgs["p_time_limit_minutes"] | null;
  p_budget_preference: GeneratedSaveDraftArgs["p_budget_preference"] | null;
};

// Postgres Meta は nullable 引数を非 null として生成するため、overlay で復元する
type NullableReserveGenerationArgs =
  "p_draft_id" | "p_draft_revision" | "p_source_menu_id" | "p_replace_dish_id" | "p_change_reason";

type ReserveGenerationArgs = Omit<GeneratedReserveGenerationArgs, NullableReserveGenerationArgs> & {
  p_draft_id: GeneratedReserveGenerationArgs["p_draft_id"] | null;
  p_draft_revision: GeneratedReserveGenerationArgs["p_draft_revision"] | null;
  p_source_menu_id: GeneratedReserveGenerationArgs["p_source_menu_id"] | null;
  p_replace_dish_id: GeneratedReserveGenerationArgs["p_replace_dish_id"] | null;
  p_change_reason: GeneratedReserveGenerationArgs["p_change_reason"] | null;
};

type FinalizeGenerationFailureArgs = Omit<GeneratedFinalizeGenerationFailureArgs, "p_retry_at"> & {
  p_retry_at?: NonNullable<GeneratedFinalizeGenerationFailureArgs["p_retry_at"]> | null;
};

type NullableFinalizeGenerationSuccessArgs =
  "p_source_menu_id" | "p_change_reason" | "p_change_reason_custom";

type FinalizeGenerationSuccessArgs = Omit<
  GeneratedFinalizeGenerationSuccessArgs,
  NullableFinalizeGenerationSuccessArgs
> & {
  p_source_menu_id: GeneratedFinalizeGenerationSuccessArgs["p_source_menu_id"] | null;
  p_change_reason: GeneratedFinalizeGenerationSuccessArgs["p_change_reason"] | null;
  p_change_reason_custom: GeneratedFinalizeGenerationSuccessArgs["p_change_reason_custom"] | null;
};

type GeneratedSetOnboardingStatus = GeneratedFunctions["set_onboarding_status"];

type GeneratedTables = GeneratedPublic["Tables"];
type GeneratedProfiles = GeneratedTables["profiles"];

// Postgres Meta は text 列を CHECK 制約の値集合ではなく string として生成するため、
// overlay で OnboardingStatus のリテラルユニオンへ絞り込む。
type ProfilesRow = Omit<GeneratedProfiles["Row"], "onboarding_status"> & {
  onboarding_status: OnboardingStatus;
};
type ProfilesInsert = Omit<GeneratedProfiles["Insert"], "onboarding_status"> & {
  onboarding_status?: OnboardingStatus;
};
type ProfilesUpdate = Omit<GeneratedProfiles["Update"], "onboarding_status"> & {
  onboarding_status?: OnboardingStatus;
};

export type Database = Omit<GeneratedDatabase, "public"> & {
  public: Omit<GeneratedPublic, "Functions" | "Tables"> & {
    Tables: Omit<GeneratedTables, "profiles"> & {
      profiles: Omit<GeneratedProfiles, "Row" | "Insert" | "Update"> & {
        Row: ProfilesRow;
        Insert: ProfilesInsert;
        Update: ProfilesUpdate;
      };
    };
    Functions: Omit<
      GeneratedFunctions,
      | "save_generation_draft"
      | "reserve_ai_generation"
      | "finalize_ai_generation_failure"
      | "finalize_ai_generation_success"
      | "set_onboarding_status"
    > & {
      save_generation_draft: Omit<GeneratedSaveDraft, "Args"> & {
        Args: SaveDraftArgs;
      };
      reserve_ai_generation: Omit<GeneratedReserveGeneration, "Args"> & {
        Args: ReserveGenerationArgs;
      };
      finalize_ai_generation_failure: Omit<GeneratedFinalizeGenerationFailure, "Args"> & {
        Args: FinalizeGenerationFailureArgs;
      };
      finalize_ai_generation_success: Omit<GeneratedFinalizeGenerationSuccess, "Args"> & {
        Args: FinalizeGenerationSuccessArgs;
      };
      set_onboarding_status: Omit<GeneratedSetOnboardingStatus, "Args" | "Returns"> & {
        Args: { p_status: OnboardingStatus };
        Returns: ProfilesRow;
      };
    };
  };
};
