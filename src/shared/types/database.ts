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
// Meta が収録した deadline_bounded も text/uuid の null を非 null と誤るため overlay 対象
type GeneratedFinalizeGenerationSuccessDeadlineBounded =
  GeneratedFunctions["finalize_ai_generation_success_deadline_bounded"];
type GeneratedSubmissionSnapshot = GeneratedFunctions["get_ai_generation_submission_snapshot"];
type GeneratedSubmissionSnapshotReturns = GeneratedSubmissionSnapshot["Returns"][number];

type NullableDraftArgs =
  | "p_meal_type"
  | "p_cuisine_genre"
  | "p_target_mode"
  | "p_servings"
  | "p_time_limit_minutes"
  | "p_budget_preference";

type SaveDraftArgs = Omit<GeneratedSaveDraftArgs, NullableDraftArgs> & {
  p_meal_type: GeneratedSaveDraftArgs["p_meal_type"] | null;
  p_cuisine_genre: GeneratedSaveDraftArgs["p_cuisine_genre"] | null;
  p_target_mode: GeneratedSaveDraftArgs["p_target_mode"] | null;
  p_servings: GeneratedSaveDraftArgs["p_servings"] | null;
  p_time_limit_minutes: GeneratedSaveDraftArgs["p_time_limit_minutes"] | null;
  p_budget_preference: GeneratedSaveDraftArgs["p_budget_preference"] | null;
};

// Postgres Meta は nullable 引数を非 null として生成するため、overlay で復元する
type NullableReserveGenerationArgs =
  "p_draft_id" | "p_draft_revision" | "p_source_menu_id" | "p_replace_dish_id" | "p_change_reason";

// identity 日次枠: typegen 前後どちらでも p_identity_key / p_quota_disabled と plan limits を要求する
type ReserveGenerationArgs = Omit<GeneratedReserveGenerationArgs, NullableReserveGenerationArgs> & {
  p_draft_id: GeneratedReserveGenerationArgs["p_draft_id"] | null;
  p_draft_revision: GeneratedReserveGenerationArgs["p_draft_revision"] | null;
  p_source_menu_id: GeneratedReserveGenerationArgs["p_source_menu_id"] | null;
  p_replace_dish_id: GeneratedReserveGenerationArgs["p_replace_dish_id"] | null;
  p_change_reason: GeneratedReserveGenerationArgs["p_change_reason"] | null;
  p_identity_key: string;
  p_user_limit: number;
  p_attempt_limit: number;
  p_short_window_limit: number;
  p_global_limit: number;
  p_quota_disabled?: boolean;
  /** Task6: Plus 品質モード原子 reserve */
  p_quality_mode?: boolean;
};

type GetAiUsageTodayArgs = {
  p_user_id: string;
  p_identity_key: string;
  p_user_limit: number;
  p_attempt_limit: number;
  p_short_window_limit: number;
  p_global_limit: number;
  p_now?: string;
};

type GetAiGenerationStatusArgs = {
  p_user_id: string;
  p_idempotency_key: string;
  p_user_limit: number;
  p_attempt_limit: number;
  p_short_window_limit: number;
  p_identity_key: string;
  p_now?: string;
};

type ReserveAiRepairCallArgs = {
  p_request_id: string;
  p_global_limit: number;
  p_quota_disabled?: boolean;
  p_now?: string;
};

type ReleaseIdentityProcessingArgs = {
  p_user_id: string;
  p_now?: string;
};

type FinalizeGenerationFailureArgs = Omit<GeneratedFinalizeGenerationFailureArgs, "p_retry_at"> & {
  p_retry_at?: NonNullable<GeneratedFinalizeGenerationFailureArgs["p_retry_at"]> | null;
};

// Postgres text 引数は NULL を受け取れるが、生成型は non-null になるため idea 用に復元する
type NullableFinalizeGenerationSuccessArgs =
  | "p_source_menu_id"
  | "p_change_reason"
  | "p_change_reason_custom"
  | "p_allergen_version"
  | "p_food_rule_version";

type FinalizeGenerationSuccessArgs = Omit<
  GeneratedFinalizeGenerationSuccessArgs,
  NullableFinalizeGenerationSuccessArgs
> & {
  p_source_menu_id: GeneratedFinalizeGenerationSuccessArgs["p_source_menu_id"] | null;
  p_change_reason: GeneratedFinalizeGenerationSuccessArgs["p_change_reason"] | null;
  p_change_reason_custom: GeneratedFinalizeGenerationSuccessArgs["p_change_reason_custom"] | null;
  p_allergen_version: string | null;
  p_food_rule_version: string | null;
};

// I1: finalize 前に SET LOCAL statement_timeout を張る薄い wrapper。
// 生成型 Args の null 欠落と同型の success Args を共有し、p_timeout_ms だけ足す。
type FinalizeGenerationSuccessDeadlineBoundedArgs = FinalizeGenerationSuccessArgs & {
  p_timeout_ms: GeneratedFinalizeGenerationSuccessDeadlineBounded["Args"]["p_timeout_ms"];
};

type GeneratedSetOnboardingStatus = GeneratedFunctions["set_onboarding_status"];
type GeneratedInsertUserFeedback = GeneratedFunctions["insert_user_feedback_rate_limited"];
type GeneratedInsertUserFeedbackArgs = GeneratedInsertUserFeedback["Args"];

// Postgres Meta は nullable 引数を非 null として生成するため、overlay で復元する
type InsertUserFeedbackArgs = Omit<GeneratedInsertUserFeedbackArgs, "p_client_path"> & {
  p_client_path: GeneratedInsertUserFeedbackArgs["p_client_path"] | null;
};

// Postgres Meta は household 凍結の null servings を非 null number として生成するため復元する
type SubmissionSnapshotRow = Omit<GeneratedSubmissionSnapshotReturns, "servings"> & {
  servings: GeneratedSubmissionSnapshotReturns["servings"] | null;
};

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
      | "reserve_ai_repair_call"
      | "get_ai_usage_today"
      | "get_ai_generation_status"
      | "finalize_ai_generation_failure"
      | "finalize_ai_generation_success"
      | "finalize_ai_generation_success_deadline_bounded"
      | "get_ai_generation_submission_snapshot"
      | "set_onboarding_status"
      | "insert_user_feedback_rate_limited"
    > & {
      save_generation_draft: Omit<GeneratedSaveDraft, "Args"> & {
        Args: SaveDraftArgs;
      };
      reserve_ai_generation: Omit<GeneratedReserveGeneration, "Args"> & {
        Args: ReserveGenerationArgs;
      };
      reserve_ai_repair_call: {
        Args: ReserveAiRepairCallArgs;
        Returns: unknown;
      };
      get_ai_usage_today: {
        Args: GetAiUsageTodayArgs;
        Returns: unknown;
      };
      get_ai_generation_status: {
        Args: GetAiGenerationStatusArgs;
        Returns: unknown;
      };
      release_identity_and_global_for_user_processing: {
        Args: ReleaseIdentityProcessingArgs;
        Returns: number;
      };
      finalize_ai_generation_failure: Omit<GeneratedFinalizeGenerationFailure, "Args"> & {
        Args: FinalizeGenerationFailureArgs;
      };
      finalize_ai_generation_success: Omit<GeneratedFinalizeGenerationSuccess, "Args"> & {
        Args: FinalizeGenerationSuccessArgs;
      };
      // 生成型と交差させず Omit 後に差し替え、null 復元 Args を優先する
      finalize_ai_generation_success_deadline_bounded: Omit<
        GeneratedFinalizeGenerationSuccessDeadlineBounded,
        "Args"
      > & {
        Args: FinalizeGenerationSuccessDeadlineBoundedArgs;
      };
      get_ai_generation_submission_snapshot: Omit<GeneratedSubmissionSnapshot, "Returns"> & {
        Returns: SubmissionSnapshotRow[];
      };
      set_onboarding_status: Omit<GeneratedSetOnboardingStatus, "Args" | "Returns"> & {
        Args: { p_status: OnboardingStatus };
        Returns: ProfilesRow;
      };
      insert_user_feedback_rate_limited: Omit<GeneratedInsertUserFeedback, "Args"> & {
        Args: InsertUserFeedbackArgs;
      };
    };
  };
};
