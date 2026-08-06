export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  private: {
    Tables: {
      ai_generation_requests: {
        Row: {
          actual_model_ids: string[]
          change_reason: string | null
          completed_at: string | null
          completed_menu_id: string | null
          created_at: string
          draft_id: string | null
          draft_revision: number | null
          duration_ms: number | null
          failure_code: string | null
          global_reserved_day: string | null
          global_sent_calls: number
          id: string
          idempotency_key: string
          identity_key: string
          personal_quota_disabled: boolean
          processing_expires_at: string | null
          quality_mode: boolean
          quota_attempt_limit: number
          quota_short_limit: number
          quota_success_limit: number
          repair_attempted: boolean
          replace_dish_id: string | null
          request_hmac: string
          request_hmac_version: string
          request_kind: string
          retry_at: string | null
          source_menu_id: string | null
          started_at: string
          status: string
          terminal_details: Json | null
          updated_at: string
          user_attempt_day: string | null
          user_attempt_reserved: boolean
          user_id: string
          user_quota_reserved: boolean
          user_usage_day: string
        }
        Insert: {
          actual_model_ids?: string[]
          change_reason?: string | null
          completed_at?: string | null
          completed_menu_id?: string | null
          created_at?: string
          draft_id?: string | null
          draft_revision?: number | null
          duration_ms?: number | null
          failure_code?: string | null
          global_reserved_day?: string | null
          global_sent_calls?: number
          id?: string
          idempotency_key: string
          identity_key: string
          personal_quota_disabled?: boolean
          processing_expires_at?: string | null
          quality_mode?: boolean
          quota_attempt_limit?: number
          quota_short_limit?: number
          quota_success_limit?: number
          repair_attempted?: boolean
          replace_dish_id?: string | null
          request_hmac: string
          request_hmac_version: string
          request_kind: string
          retry_at?: string | null
          source_menu_id?: string | null
          started_at: string
          status: string
          terminal_details?: Json | null
          updated_at?: string
          user_attempt_day?: string | null
          user_attempt_reserved?: boolean
          user_id: string
          user_quota_reserved?: boolean
          user_usage_day: string
        }
        Update: {
          actual_model_ids?: string[]
          change_reason?: string | null
          completed_at?: string | null
          completed_menu_id?: string | null
          created_at?: string
          draft_id?: string | null
          draft_revision?: number | null
          duration_ms?: number | null
          failure_code?: string | null
          global_reserved_day?: string | null
          global_sent_calls?: number
          id?: string
          idempotency_key?: string
          identity_key?: string
          personal_quota_disabled?: boolean
          processing_expires_at?: string | null
          quality_mode?: boolean
          quota_attempt_limit?: number
          quota_short_limit?: number
          quota_success_limit?: number
          repair_attempted?: boolean
          replace_dish_id?: string | null
          request_hmac?: string
          request_hmac_version?: string
          request_kind?: string
          retry_at?: string | null
          source_menu_id?: string | null
          started_at?: string
          status?: string
          terminal_details?: Json | null
          updated_at?: string
          user_attempt_day?: string | null
          user_attempt_reserved?: boolean
          user_id?: string
          user_quota_reserved?: boolean
          user_usage_day?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_generation_requests_draft_id_user_id_draft_revision_fkey"
            columns: ["draft_id", "user_id", "draft_revision"]
            isOneToOne: false
            referencedRelation: "generation_draft_submission_versions"
            referencedColumns: ["draft_id", "user_id", "draft_revision"]
          },
        ]
      }
      ai_global_daily_usage: {
        Row: {
          reserved_count: number
          sent_count: number
          updated_at: string
          usage_day: string
        }
        Insert: {
          reserved_count?: number
          sent_count?: number
          updated_at?: string
          usage_day: string
        }
        Update: {
          reserved_count?: number
          sent_count?: number
          updated_at?: string
          usage_day?: string
        }
        Relationships: []
      }
      ai_identity_daily_external_attempts: {
        Row: {
          identity_key: string
          reserved_count: number
          sent_count: number
          updated_at: string
          usage_day: string
        }
        Insert: {
          identity_key: string
          reserved_count?: number
          sent_count?: number
          updated_at?: string
          usage_day: string
        }
        Update: {
          identity_key?: string
          reserved_count?: number
          sent_count?: number
          updated_at?: string
          usage_day?: string
        }
        Relationships: []
      }
      ai_identity_daily_usage: {
        Row: {
          identity_key: string
          reserved_count: number
          success_count: number
          updated_at: string
          usage_day: string
        }
        Insert: {
          identity_key: string
          reserved_count?: number
          success_count?: number
          updated_at?: string
          usage_day: string
        }
        Update: {
          identity_key?: string
          reserved_count?: number
          success_count?: number
          updated_at?: string
          usage_day?: string
        }
        Relationships: []
      }
      ai_identity_flyer_weekly: {
        Row: {
          identity_key: string
          reserved_count: number
          success_count: number
          updated_at: string
          week_start: string
        }
        Insert: {
          identity_key: string
          reserved_count?: number
          success_count?: number
          updated_at?: string
          week_start: string
        }
        Update: {
          identity_key?: string
          reserved_count?: number
          success_count?: number
          updated_at?: string
          week_start?: string
        }
        Relationships: []
      }
      ai_identity_flyer_weekly_tries: {
        Row: {
          identity_key: string
          reserved_count: number
          sent_count: number
          updated_at: string
          week_start: string
        }
        Insert: {
          identity_key: string
          reserved_count?: number
          sent_count?: number
          updated_at?: string
          week_start: string
        }
        Update: {
          identity_key?: string
          reserved_count?: number
          sent_count?: number
          updated_at?: string
          week_start?: string
        }
        Relationships: []
      }
      ai_identity_quality_daily: {
        Row: {
          identity_key: string
          reserved_count: number
          success_count: number
          updated_at: string
          usage_day: string
        }
        Insert: {
          identity_key: string
          reserved_count?: number
          success_count?: number
          updated_at?: string
          usage_day: string
        }
        Update: {
          identity_key?: string
          reserved_count?: number
          success_count?: number
          updated_at?: string
          usage_day?: string
        }
        Relationships: []
      }
      ai_identity_quality_monthly: {
        Row: {
          identity_key: string
          reserved_count: number
          success_count: number
          updated_at: string
          usage_month: string
        }
        Insert: {
          identity_key: string
          reserved_count?: number
          success_count?: number
          updated_at?: string
          usage_month: string
        }
        Update: {
          identity_key?: string
          reserved_count?: number
          success_count?: number
          updated_at?: string
          usage_month?: string
        }
        Relationships: []
      }
      ai_user_rate_windows: {
        Row: {
          sent_count: number
          updated_at: string
          user_id: string
          window_started_at: string
        }
        Insert: {
          sent_count?: number
          updated_at?: string
          user_id: string
          window_started_at: string
        }
        Update: {
          sent_count?: number
          updated_at?: string
          user_id?: string
          window_started_at?: string
        }
        Relationships: []
      }
      auth_continuations: {
        Row: {
          claimed_at: string | null
          code_iv: string | null
          created_at: string
          deposited_at: string | null
          encrypted_code: string | null
          expires_at: string
          id: string
          origin: string
          return_to: string
          secret_hash: string
          state_hash: string
        }
        Insert: {
          claimed_at?: string | null
          code_iv?: string | null
          created_at?: string
          deposited_at?: string | null
          encrypted_code?: string | null
          expires_at: string
          id?: string
          origin: string
          return_to: string
          secret_hash: string
          state_hash: string
        }
        Update: {
          claimed_at?: string | null
          code_iv?: string | null
          created_at?: string
          deposited_at?: string | null
          encrypted_code?: string | null
          expires_at?: string
          id?: string
          origin?: string
          return_to?: string
          secret_hash?: string
          state_hash?: string
        }
        Relationships: []
      }
      billing_checkout_locks: {
        Row: {
          created_at: string
          expires_at: string
          lock_token: string
          stripe_checkout_session_id: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          expires_at: string
          lock_token: string
          stripe_checkout_session_id?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          expires_at?: string
          lock_token?: string
          stripe_checkout_session_id?: string | null
          user_id?: string
        }
        Relationships: []
      }
      billing_customers: {
        Row: {
          created_at: string
          stripe_customer_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          stripe_customer_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          stripe_customer_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      billing_subscriptions: {
        Row: {
          cancel_at_period_end: boolean
          current_period_end: string
          current_period_start: string
          last_stripe_event_created: number
          last_stripe_event_id: string | null
          past_due_since: string | null
          status: string
          stripe_price_id: string
          stripe_subscription_id: string
          trial_end: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          cancel_at_period_end?: boolean
          current_period_end: string
          current_period_start: string
          last_stripe_event_created?: number
          last_stripe_event_id?: string | null
          past_due_since?: string | null
          status: string
          stripe_price_id: string
          stripe_subscription_id: string
          trial_end?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          cancel_at_period_end?: boolean
          current_period_end?: string
          current_period_start?: string
          last_stripe_event_created?: number
          last_stripe_event_id?: string | null
          past_due_since?: string | null
          status?: string
          stripe_price_id?: string
          stripe_subscription_id?: string
          trial_end?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      billing_trial_history: {
        Row: {
          first_trial_at: string
          identity_key: string
        }
        Insert: {
          first_trial_at?: string
          identity_key: string
        }
        Update: {
          first_trial_at?: string
          identity_key?: string
        }
        Relationships: []
      }
      billing_webhook_events: {
        Row: {
          event_type: string
          processed_at: string
          stripe_event_created: number
          stripe_event_id: string
        }
        Insert: {
          event_type: string
          processed_at?: string
          stripe_event_created: number
          stripe_event_id: string
        }
        Update: {
          event_type?: string
          processed_at?: string
          stripe_event_created?: number
          stripe_event_id?: string
        }
        Relationships: []
      }
      flyer_weekly_requests: {
        Row: {
          completed_at: string | null
          created_at: string
          duration_ms: number | null
          failure_code: string | null
          flyer_success_reserved: boolean
          flyer_try_reserved: boolean
          flyer_try_sent: boolean
          global_reserved_day: string | null
          global_sent_calls: number
          id: string
          idempotency_key: string
          identity_key: string
          personal_quota_disabled: boolean
          processing_expires_at: string | null
          quota_attempt_limit: number | null
          quota_short_limit: number | null
          result_payload: Json | null
          retry_at: string | null
          started_at: string
          status: string
          updated_at: string
          user_attempt_day: string | null
          user_attempt_reserved: boolean
          user_id: string
          week_start: string
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          duration_ms?: number | null
          failure_code?: string | null
          flyer_success_reserved?: boolean
          flyer_try_reserved?: boolean
          flyer_try_sent?: boolean
          global_reserved_day?: string | null
          global_sent_calls?: number
          id?: string
          idempotency_key: string
          identity_key: string
          personal_quota_disabled?: boolean
          processing_expires_at?: string | null
          quota_attempt_limit?: number | null
          quota_short_limit?: number | null
          result_payload?: Json | null
          retry_at?: string | null
          started_at: string
          status: string
          updated_at?: string
          user_attempt_day?: string | null
          user_attempt_reserved?: boolean
          user_id: string
          week_start: string
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          duration_ms?: number | null
          failure_code?: string | null
          flyer_success_reserved?: boolean
          flyer_try_reserved?: boolean
          flyer_try_sent?: boolean
          global_reserved_day?: string | null
          global_sent_calls?: number
          id?: string
          idempotency_key?: string
          identity_key?: string
          personal_quota_disabled?: boolean
          processing_expires_at?: string | null
          quota_attempt_limit?: number | null
          quota_short_limit?: number | null
          result_payload?: Json | null
          retry_at?: string | null
          started_at?: string
          status?: string
          updated_at?: string
          user_attempt_day?: string | null
          user_attempt_reserved?: boolean
          user_id?: string
          week_start?: string
        }
        Relationships: []
      }
      generation_draft_submission_versions: {
        Row: {
          avoid_ingredients: string[]
          budget_preference: string | null
          captured_at: string
          cuisine_genre: string
          draft_id: string
          draft_revision: number
          ingredient_preference: string | null
          main_ingredients: string[]
          meal_type: string
          memo: string
          pantry_selections: Json
          servings: number | null
          target_member_ids: string[]
          target_mode: string
          time_limit_minutes: number | null
          user_id: string
        }
        Insert: {
          avoid_ingredients: string[]
          budget_preference?: string | null
          captured_at?: string
          cuisine_genre: string
          draft_id: string
          draft_revision: number
          ingredient_preference?: string | null
          main_ingredients: string[]
          meal_type: string
          memo: string
          pantry_selections: Json
          servings?: number | null
          target_member_ids: string[]
          target_mode: string
          time_limit_minutes?: number | null
          user_id: string
        }
        Update: {
          avoid_ingredients?: string[]
          budget_preference?: string | null
          captured_at?: string
          cuisine_genre?: string
          draft_id?: string
          draft_revision?: number
          ingredient_preference?: string | null
          main_ingredients?: string[]
          meal_type?: string
          memo?: string
          pantry_selections?: Json
          servings?: number | null
          target_member_ids?: string[]
          target_mode?: string
          time_limit_minutes?: number | null
          user_id?: string
        }
        Relationships: []
      }
      generation_regeneration_snapshots: {
        Row: {
          created_at: string
          kind: string
          replace_dish_id: string | null
          request_id: string
          servings: number
          source_menu_id: string
          source_menu_version: number
          target_member_ids: string[]
          target_mode: string
          user_id: string
        }
        Insert: {
          created_at?: string
          kind: string
          replace_dish_id?: string | null
          request_id: string
          servings: number
          source_menu_id: string
          source_menu_version: number
          target_member_ids?: string[]
          target_mode: string
          user_id: string
        }
        Update: {
          created_at?: string
          kind?: string
          replace_dish_id?: string | null
          request_id?: string
          servings?: number
          source_menu_id?: string
          source_menu_version?: number
          target_member_ids?: string[]
          target_mode?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "generation_regeneration_snapshots_request_id_user_id_fkey"
            columns: ["request_id", "user_id"]
            isOneToOne: false
            referencedRelation: "ai_generation_requests"
            referencedColumns: ["id", "user_id"]
          },
        ]
      }
      share_app_daily_usage: {
        Row: {
          ai_call_count: number
          success_count: number
          updated_at: string
          usage_day: string
        }
        Insert: {
          ai_call_count?: number
          success_count?: number
          updated_at?: string
          usage_day: string
        }
        Update: {
          ai_call_count?: number
          success_count?: number
          updated_at?: string
          usage_day?: string
        }
        Relationships: []
      }
      share_generalization_jobs: {
        Row: {
          claimed_at: string | null
          contributor_user_id: string | null
          created_at: string
          failure_code: string | null
          finished_at: string | null
          heartbeat_at: string | null
          id: string
          pass1_model: string | null
          pass2_model: string | null
          skip_reason: string | null
          source_menu_id: string | null
          status: string
        }
        Insert: {
          claimed_at?: string | null
          contributor_user_id?: string | null
          created_at?: string
          failure_code?: string | null
          finished_at?: string | null
          heartbeat_at?: string | null
          id?: string
          pass1_model?: string | null
          pass2_model?: string | null
          skip_reason?: string | null
          source_menu_id?: string | null
          status: string
        }
        Update: {
          claimed_at?: string | null
          contributor_user_id?: string | null
          created_at?: string
          failure_code?: string | null
          finished_at?: string | null
          heartbeat_at?: string | null
          id?: string
          pass1_model?: string | null
          pass2_model?: string | null
          skip_reason?: string | null
          source_menu_id?: string | null
          status?: string
        }
        Relationships: []
      }
      share_user_daily_usage: {
        Row: {
          attempt_count: number
          contributor_user_id: string
          success_count: number
          updated_at: string
          usage_day: string
        }
        Insert: {
          attempt_count?: number
          contributor_user_id: string
          success_count?: number
          updated_at?: string
          usage_day: string
        }
        Update: {
          attempt_count?: number
          contributor_user_id?: string
          success_count?: number
          updated_at?: string
          usage_day?: string
        }
        Relationships: []
      }
      shared_emergency_recipe_origins: {
        Row: {
          contributor_user_id: string | null
          created_at: string
          recipe_id: string
          source_menu_id: string | null
        }
        Insert: {
          contributor_user_id?: string | null
          created_at?: string
          recipe_id: string
          source_menu_id?: string | null
        }
        Update: {
          contributor_user_id?: string | null
          created_at?: string
          recipe_id?: string
          source_menu_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "shared_emergency_recipe_origins_recipe_id_fkey"
            columns: ["recipe_id"]
            isOneToOne: true
            referencedRelation: "shared_emergency_recipes"
            referencedColumns: ["id"]
          },
        ]
      }
      shared_emergency_recipes: {
        Row: {
          created_at: string
          eligible_age_bands: string[]
          id: string
          meal_type: string
          menu_payload: Json
          standard_allergen_ids: string[]
          status: string
          total_elapsed_minutes: number
        }
        Insert: {
          created_at?: string
          eligible_age_bands: string[]
          id?: string
          meal_type: string
          menu_payload: Json
          standard_allergen_ids?: string[]
          status?: string
          total_elapsed_minutes: number
        }
        Update: {
          created_at?: string
          eligible_age_bands?: string[]
          id?: string
          meal_type?: string
          menu_payload?: Json
          standard_allergen_ids?: string[]
          status?: string
          total_elapsed_minutes?: number
        }
        Relationships: []
      }
      shopping_mutations: {
        Row: {
          created_at: string
          idempotency_key: string
          request_hash: string
          response: Json
          user_id: string
        }
        Insert: {
          created_at?: string
          idempotency_key: string
          request_hash: string
          response: Json
          user_id: string
        }
        Update: {
          created_at?: string
          idempotency_key?: string
          request_hash?: string
          response?: Json
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      ai_conflict_codes_valid: { Args: { p_codes: string[] }; Returns: boolean }
      ai_generation_terminal_details_valid: {
        Args: { p_status: string; p_terminal_details: Json }
        Returns: boolean
      }
      ai_jst_day: { Args: { p_now: string }; Returns: string }
      ai_jst_month_start: { Args: { p_now: string }; Returns: string }
      ai_jst_week_start: { Args: { p_now: string }; Returns: string }
      ai_next_jst_midnight: { Args: { p_now: string }; Returns: string }
      ai_request_payload: {
        Args: {
          p_replayed?: boolean
          p_request: Database["private"]["Tables"]["ai_generation_requests"]["Row"]
        }
        Returns: Json
      }
      assign_regeneration_lineage: {
        Args: {
          p_change_reason: string
          p_change_reason_custom: string
          p_completed_menu_id: string
          p_source_menu_id: string
          p_user_id: string
        }
        Returns: undefined
      }
      billing_entitlement_json: {
        Args: {
          p_cancel_at_period_end: boolean
          p_current_period_end: string
          p_now: string
          p_past_due_since: string
          p_status: string
          p_trial_end: string
        }
        Returns: Json
      }
      billing_iso_z: { Args: { p_ts: string }; Returns: string }
      billing_payload_timestamptz: { Args: { p_value: Json }; Returns: string }
      billing_status_terminality_rank: {
        Args: { p_status: string }
        Returns: number
      }
      cleanup_expired_shopping_mutations: {
        Args: { p_limit?: number; p_user_id: string }
        Returns: number
      }
      cleanup_generation_draft_submission_versions: {
        Args: { p_before: string; p_limit: number }
        Returns: number
      }
      cleanup_shopping_mutations: {
        Args: { p_before: string; p_limit: number }
        Returns: number
      }
      cleanup_user_feedback: {
        Args: { p_before: string; p_limit: number }
        Returns: number
      }
      current_safety_fingerprint: {
        Args: { p_target_member_ids: string[]; p_user_id: string }
        Returns: string
      }
      flyer_weekly_request_payload: {
        Args: {
          p_replayed?: boolean
          p_request: Database["private"]["Tables"]["flyer_weekly_requests"]["Row"]
        }
        Returns: Json
      }
      idea_safety_fingerprint: { Args: never; Returns: string }
      is_canonical_bounded_text: {
        Args: { p_max_length: number; p_min_length: number; p_value: string }
        Returns: boolean
      }
      is_valid_draft_pantry_selections: {
        Args: { p_value: Json }
        Returns: boolean
      }
      is_valid_draft_text_array: {
        Args: { p_max_count: number; p_max_length: number; p_value: string[] }
        Returns: boolean
      }
      is_valid_draft_uuid_array: {
        Args: { p_max_count: number; p_value: string[] }
        Returns: boolean
      }
      is_valid_generation_integrity_context: {
        Args: { p_context: Json; p_request_kind: string }
        Returns: boolean
      }
      is_valid_generation_target_member_ids: {
        Args: { p_target_mode: string; p_value: string[] }
        Returns: boolean
      }
      is_valid_submission_target_member_ids: {
        Args: { p_target_mode: string; p_value: string[] }
        Returns: boolean
      }
      lock_and_assert_current_safety_fingerprint: {
        Args: {
          p_expected: string
          p_target_member_ids: string[]
          p_user_id: string
        }
        Returns: undefined
      }
      lock_and_assert_selected_pantry_rows: {
        Args: { p_pantry_usage: Json; p_user_id: string }
        Returns: undefined
      }
      lock_and_check_shopping_list_safety: {
        Args: { p_expected: string; p_list_id: string; p_user_id: string }
        Returns: undefined
      }
      lock_and_check_shopping_safety: {
        Args: { p_expected: string; p_menu_id: string; p_user_id: string }
        Returns: undefined
      }
      normalize_allergen_term: { Args: { p_value: string }; Returns: string }
      persist_validated_menu: {
        Args: {
          p_allergen_version: string
          p_expired_checks: Json
          p_food_rule_version: string
          p_menu: Json
          p_preference_snapshot: Json
          p_request: Database["private"]["Tables"]["ai_generation_requests"]["Row"]
          p_safety_fingerprint: string
          p_safety_snapshot: Json
          p_target_members: Json
          p_target_mode: string
        }
        Returns: string
      }
      project_billing_subscription: {
        Args: { p_force_apply?: boolean; p_payload: Json; p_user_id: string }
        Returns: string
      }
      release_flyer_weekly_for_user_processing: {
        Args: { p_now?: string; p_user_id: string }
        Returns: number
      }
      release_flyer_weekly_reservations: {
        Args: {
          p_now: string
          p_request: Database["private"]["Tables"]["flyer_weekly_requests"]["Row"]
        }
        Returns: undefined
      }
      release_identity_and_global_for_user_processing: {
        Args: { p_now?: string; p_user_id: string }
        Returns: number
      }
      release_request_quota_reservations: {
        Args: {
          p_now: string
          p_request: Database["private"]["Tables"]["ai_generation_requests"]["Row"]
        }
        Returns: undefined
      }
      share_consent_is_valid: { Args: { p_user_id: string }; Returns: boolean }
      share_current_consent_version: { Args: never; Returns: string }
      share_increment_ai_calls: {
        Args: { p_ai_call_count: number; p_usage_day: string }
        Returns: undefined
      }
      share_recipe_title_from_payload: {
        Args: { p_payload: Json }
        Returns: string
      }
      soft_delete_generation_draft: {
        Args: {
          p_draft_id: string
          p_expected_revision: number
          p_user_id: string
        }
        Returns: Database["public"]["Tables"]["generation_drafts"]["Row"]
        SetofOptions: {
          from: "*"
          to: "generation_drafts"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      write_shopping_items: {
        Args: { p_items: Json; p_list_id: string; p_user_id: string }
        Returns: undefined
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      allergen_aliases: {
        Row: {
          alias: string
          alias_kind: string
          allergen_id: string
          created_at: string
          dictionary_version: string
          id: string
          normalized_alias: string
          requires_label_confirmation: boolean
        }
        Insert: {
          alias: string
          alias_kind: string
          allergen_id: string
          created_at?: string
          dictionary_version: string
          id?: string
          normalized_alias: string
          requires_label_confirmation: boolean
        }
        Update: {
          alias?: string
          alias_kind?: string
          allergen_id?: string
          created_at?: string
          dictionary_version?: string
          id?: string
          normalized_alias?: string
          requires_label_confirmation?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "allergen_aliases_allergen_id_fkey"
            columns: ["allergen_id"]
            isOneToOne: false
            referencedRelation: "allergen_catalog"
            referencedColumns: ["id"]
          },
        ]
      }
      allergen_catalog: {
        Row: {
          catalog_version: string
          created_at: string
          display_name: string
          id: string
          regulatory_class: string
        }
        Insert: {
          catalog_version: string
          created_at?: string
          display_name: string
          id: string
          regulatory_class: string
        }
        Update: {
          catalog_version?: string
          created_at?: string
          display_name?: string
          id?: string
          regulatory_class?: string
        }
        Relationships: []
      }
      dish_ingredients: {
        Row: {
          created_at: string
          dish_id: string
          id: string
          label_confirmation_required: boolean
          menu_id: string
          name: string
          pantry_selection_id: string | null
          position: number
          quantity_text: string
          quantity_value: number | null
          store_section: string
          unit: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          dish_id: string
          id?: string
          label_confirmation_required?: boolean
          menu_id: string
          name: string
          pantry_selection_id?: string | null
          position: number
          quantity_text: string
          quantity_value?: number | null
          store_section: string
          unit?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          dish_id?: string
          id?: string
          label_confirmation_required?: boolean
          menu_id?: string
          name?: string
          pantry_selection_id?: string | null
          position?: number
          quantity_text?: string
          quantity_value?: number | null
          store_section?: string
          unit?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "dish_ingredients_dish_owner_fkey"
            columns: ["dish_id", "menu_id", "user_id"]
            isOneToOne: false
            referencedRelation: "dishes"
            referencedColumns: ["id", "menu_id", "user_id"]
          },
          {
            foreignKeyName: "dish_ingredients_pantry_owner_fkey"
            columns: ["pantry_selection_id", "menu_id", "user_id"]
            isOneToOne: false
            referencedRelation: "generation_pantry_selections"
            referencedColumns: ["id", "menu_id", "user_id"]
          },
        ]
      }
      dishes: {
        Row: {
          cooking_time_minutes: number
          created_at: string
          description: string
          id: string
          menu_id: string
          name: string
          position: number
          role: string
          user_id: string
        }
        Insert: {
          cooking_time_minutes: number
          created_at?: string
          description: string
          id?: string
          menu_id: string
          name: string
          position: number
          role: string
          user_id: string
        }
        Update: {
          cooking_time_minutes?: number
          created_at?: string
          description?: string
          id?: string
          menu_id?: string
          name?: string
          position?: number
          role?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "dishes_menu_owner_fkey"
            columns: ["menu_id", "user_id"]
            isOneToOne: false
            referencedRelation: "menus"
            referencedColumns: ["id", "user_id"]
          },
        ]
      }
      food_safety_rules: {
        Row: {
          applies_to_age_bands: string[]
          created_at: string
          id: string
          match_terms: string[]
          required_safety_tag: string | null
          rule_kind: string
          rule_version: string
          user_message: string
        }
        Insert: {
          applies_to_age_bands: string[]
          created_at?: string
          id: string
          match_terms: string[]
          required_safety_tag?: string | null
          rule_kind: string
          rule_version: string
          user_message: string
        }
        Update: {
          applies_to_age_bands?: string[]
          created_at?: string
          id?: string
          match_terms?: string[]
          required_safety_tag?: string | null
          rule_kind?: string
          rule_version?: string
          user_message?: string
        }
        Relationships: []
      }
      generation_drafts: {
        Row: {
          avoid_ingredients: string[]
          budget_preference: string | null
          created_at: string
          cuisine_genre: string | null
          deleted_at: string | null
          id: string
          ingredient_preference: string | null
          main_ingredients: string[]
          meal_type: string | null
          memo: string
          pantry_selections: Json
          revision: number
          servings: number | null
          target_member_ids: string[]
          target_mode: string | null
          time_limit_minutes: number | null
          updated_at: string
          user_id: string
        }
        Insert: {
          avoid_ingredients?: string[]
          budget_preference?: string | null
          created_at?: string
          cuisine_genre?: string | null
          deleted_at?: string | null
          id?: string
          ingredient_preference?: string | null
          main_ingredients?: string[]
          meal_type?: string | null
          memo?: string
          pantry_selections?: Json
          revision?: number
          servings?: number | null
          target_member_ids?: string[]
          target_mode?: string | null
          time_limit_minutes?: number | null
          updated_at?: string
          user_id: string
        }
        Update: {
          avoid_ingredients?: string[]
          budget_preference?: string | null
          created_at?: string
          cuisine_genre?: string | null
          deleted_at?: string | null
          id?: string
          ingredient_preference?: string | null
          main_ingredients?: string[]
          meal_type?: string | null
          memo?: string
          pantry_selections?: Json
          revision?: number
          servings?: number | null
          target_member_ids?: string[]
          target_mode?: string | null
          time_limit_minutes?: number | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      generation_pantry_selections: {
        Row: {
          created_at: string
          expired_item_check_jst_date: string | null
          expired_item_checked_at: string | null
          id: string
          idempotency_key: string
          inventory_quantity_snapshot: number | null
          menu_id: string
          pantry_item_id: string | null
          pantry_name_snapshot: string
          planned_quantity: number | null
          priority: string
          shortage_quantity: number | null
          unit: string | null
          unused_reason: string | null
          usage_status: string
          user_id: string
        }
        Insert: {
          created_at?: string
          expired_item_check_jst_date?: string | null
          expired_item_checked_at?: string | null
          id?: string
          idempotency_key: string
          inventory_quantity_snapshot?: number | null
          menu_id: string
          pantry_item_id?: string | null
          pantry_name_snapshot: string
          planned_quantity?: number | null
          priority: string
          shortage_quantity?: number | null
          unit?: string | null
          unused_reason?: string | null
          usage_status: string
          user_id: string
        }
        Update: {
          created_at?: string
          expired_item_check_jst_date?: string | null
          expired_item_checked_at?: string | null
          id?: string
          idempotency_key?: string
          inventory_quantity_snapshot?: number | null
          menu_id?: string
          pantry_item_id?: string | null
          pantry_name_snapshot?: string
          planned_quantity?: number | null
          priority?: string
          shortage_quantity?: number | null
          unit?: string | null
          unused_reason?: string | null
          usage_status?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "generation_pantry_selections_item_owner_fkey"
            columns: ["pantry_item_id", "user_id"]
            isOneToOne: false
            referencedRelation: "pantry_items"
            referencedColumns: ["id", "user_id"]
          },
          {
            foreignKeyName: "generation_pantry_selections_menu_owner_fkey"
            columns: ["menu_id", "user_id"]
            isOneToOne: false
            referencedRelation: "menus"
            referencedColumns: ["id", "user_id"]
          },
        ]
      }
      household_members: {
        Row: {
          age_band: string | null
          allergy_status: string | null
          created_at: string
          display_name: string | null
          ease_preferences: string[]
          id: string
          portion_size: string | null
          required_safety_constraints: string[]
          sort_order: number
          spice_level: string | null
          status: string
          unsupported_diet_kinds: string[]
          unsupported_diet_status: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          age_band?: string | null
          allergy_status?: string | null
          created_at?: string
          display_name?: string | null
          ease_preferences?: string[]
          id?: string
          portion_size?: string | null
          required_safety_constraints?: string[]
          sort_order?: number
          spice_level?: string | null
          status?: string
          unsupported_diet_kinds?: string[]
          unsupported_diet_status?: string | null
          updated_at?: string
          user_id?: string
        }
        Update: {
          age_band?: string | null
          allergy_status?: string | null
          created_at?: string
          display_name?: string | null
          ease_preferences?: string[]
          id?: string
          portion_size?: string | null
          required_safety_constraints?: string[]
          sort_order?: number
          spice_level?: string | null
          status?: string
          unsupported_diet_kinds?: string[]
          unsupported_diet_status?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      member_allergies: {
        Row: {
          allergen_id: string | null
          created_at: string
          custom_aliases: string[]
          custom_confirmed: boolean
          custom_name: string | null
          id: string
          member_id: string
          user_id: string
        }
        Insert: {
          allergen_id?: string | null
          created_at?: string
          custom_aliases?: string[]
          custom_confirmed?: boolean
          custom_name?: string | null
          id?: string
          member_id: string
          user_id?: string
        }
        Update: {
          allergen_id?: string | null
          created_at?: string
          custom_aliases?: string[]
          custom_confirmed?: boolean
          custom_name?: string | null
          id?: string
          member_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "member_allergies_allergen_id_fkey"
            columns: ["allergen_id"]
            isOneToOne: false
            referencedRelation: "allergen_catalog"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "member_allergies_member_id_user_id_fkey"
            columns: ["member_id", "user_id"]
            isOneToOne: false
            referencedRelation: "household_members"
            referencedColumns: ["id", "user_id"]
          },
        ]
      }
      member_dislikes: {
        Row: {
          created_at: string
          id: string
          ingredient_name: string
          member_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          ingredient_name: string
          member_id: string
          user_id?: string
        }
        Update: {
          created_at?: string
          id?: string
          ingredient_name?: string
          member_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "member_dislikes_member_id_user_id_fkey"
            columns: ["member_id", "user_id"]
            isOneToOne: false
            referencedRelation: "household_members"
            referencedColumns: ["id", "user_id"]
          },
        ]
      }
      menu_label_confirmations: {
        Row: {
          allergen_id: string
          anonymous_member_ref: string
          confirmation_status: string
          confirmed_at: string | null
          confirmed_by: string | null
          created_at: string
          dictionary_version: string
          id: string
          is_current: boolean
          menu_id: string
          requirement_safety_fingerprint: string
          source_id: string
          source_path: string
          source_text_snapshot: string
          source_type: string
          user_id: string
        }
        Insert: {
          allergen_id: string
          anonymous_member_ref: string
          confirmation_status?: string
          confirmed_at?: string | null
          confirmed_by?: string | null
          created_at?: string
          dictionary_version: string
          id?: string
          is_current?: boolean
          menu_id: string
          requirement_safety_fingerprint: string
          source_id: string
          source_path: string
          source_text_snapshot: string
          source_type: string
          user_id: string
        }
        Update: {
          allergen_id?: string
          anonymous_member_ref?: string
          confirmation_status?: string
          confirmed_at?: string | null
          confirmed_by?: string | null
          created_at?: string
          dictionary_version?: string
          id?: string
          is_current?: boolean
          menu_id?: string
          requirement_safety_fingerprint?: string
          source_id?: string
          source_path?: string
          source_text_snapshot?: string
          source_type?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "menu_label_confirmations_allergen_id_fkey"
            columns: ["allergen_id"]
            isOneToOne: false
            referencedRelation: "allergen_catalog"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "menu_label_confirmations_member_owner_fkey"
            columns: ["menu_id", "user_id", "anonymous_member_ref"]
            isOneToOne: false
            referencedRelation: "menu_target_members"
            referencedColumns: ["menu_id", "user_id", "anonymous_ref"]
          },
          {
            foreignKeyName: "menu_label_confirmations_menu_owner_fkey"
            columns: ["menu_id", "user_id"]
            isOneToOne: false
            referencedRelation: "menus"
            referencedColumns: ["id", "user_id"]
          },
        ]
      }
      menu_member_adaptations: {
        Row: {
          additional_cutting: string | null
          additional_heating: string | null
          additional_seasoning: string | null
          anonymous_member_ref: string
          branch_before_recipe_step_id: string
          created_at: string
          dish_id: string
          id: string
          menu_id: string
          portion_text: string
          safety_tags: string[]
          serving_check: string
          user_id: string
        }
        Insert: {
          additional_cutting?: string | null
          additional_heating?: string | null
          additional_seasoning?: string | null
          anonymous_member_ref: string
          branch_before_recipe_step_id: string
          created_at?: string
          dish_id: string
          id?: string
          menu_id: string
          portion_text: string
          safety_tags?: string[]
          serving_check: string
          user_id: string
        }
        Update: {
          additional_cutting?: string | null
          additional_heating?: string | null
          additional_seasoning?: string | null
          anonymous_member_ref?: string
          branch_before_recipe_step_id?: string
          created_at?: string
          dish_id?: string
          id?: string
          menu_id?: string
          portion_text?: string
          safety_tags?: string[]
          serving_check?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "menu_member_adaptations_branch_owner_fkey"
            columns: [
              "branch_before_recipe_step_id",
              "dish_id",
              "menu_id",
              "user_id",
            ]
            isOneToOne: false
            referencedRelation: "recipe_steps"
            referencedColumns: ["id", "dish_id", "menu_id", "user_id"]
          },
          {
            foreignKeyName: "menu_member_adaptations_dish_owner_fkey"
            columns: ["dish_id", "menu_id", "user_id"]
            isOneToOne: false
            referencedRelation: "dishes"
            referencedColumns: ["id", "menu_id", "user_id"]
          },
          {
            foreignKeyName: "menu_member_adaptations_member_owner_fkey"
            columns: ["menu_id", "user_id", "anonymous_member_ref"]
            isOneToOne: false
            referencedRelation: "menu_target_members"
            referencedColumns: ["menu_id", "user_id", "anonymous_ref"]
          },
        ]
      }
      menu_revalidations: {
        Row: {
          allergen_catalog_version: string
          created_at: string
          food_rule_version: string
          id: string
          issues: Json
          menu_id: string
          safety_fingerprint: string
          status: string
          user_id: string
        }
        Insert: {
          allergen_catalog_version: string
          created_at?: string
          food_rule_version: string
          id?: string
          issues?: Json
          menu_id: string
          safety_fingerprint: string
          status: string
          user_id: string
        }
        Update: {
          allergen_catalog_version?: string
          created_at?: string
          food_rule_version?: string
          id?: string
          issues?: Json
          menu_id?: string
          safety_fingerprint?: string
          status?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "menu_revalidations_menu_owner_fkey"
            columns: ["menu_id", "user_id"]
            isOneToOne: false
            referencedRelation: "menus"
            referencedColumns: ["id", "user_id"]
          },
        ]
      }
      menu_safety_actions: {
        Row: {
          anonymous_member_ref: string
          before_recipe_step_id: string
          created_at: string
          dish_id: string
          id: string
          ingredient_id: string
          instruction: string
          kind: string
          menu_id: string
          position: number
          user_id: string
        }
        Insert: {
          anonymous_member_ref: string
          before_recipe_step_id: string
          created_at?: string
          dish_id: string
          id?: string
          ingredient_id: string
          instruction: string
          kind: string
          menu_id: string
          position: number
          user_id: string
        }
        Update: {
          anonymous_member_ref?: string
          before_recipe_step_id?: string
          created_at?: string
          dish_id?: string
          id?: string
          ingredient_id?: string
          instruction?: string
          kind?: string
          menu_id?: string
          position?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "menu_safety_actions_adaptation_owner_fkey"
            columns: ["menu_id", "dish_id", "user_id", "anonymous_member_ref"]
            isOneToOne: false
            referencedRelation: "menu_member_adaptations"
            referencedColumns: [
              "menu_id",
              "dish_id",
              "user_id",
              "anonymous_member_ref",
            ]
          },
          {
            foreignKeyName: "menu_safety_actions_dish_owner_fkey"
            columns: ["dish_id", "menu_id", "user_id"]
            isOneToOne: false
            referencedRelation: "dishes"
            referencedColumns: ["id", "menu_id", "user_id"]
          },
          {
            foreignKeyName: "menu_safety_actions_ingredient_owner_fkey"
            columns: ["ingredient_id", "dish_id", "menu_id", "user_id"]
            isOneToOne: false
            referencedRelation: "dish_ingredients"
            referencedColumns: ["id", "dish_id", "menu_id", "user_id"]
          },
          {
            foreignKeyName: "menu_safety_actions_member_owner_fkey"
            columns: ["menu_id", "user_id", "anonymous_member_ref"]
            isOneToOne: false
            referencedRelation: "menu_target_members"
            referencedColumns: ["menu_id", "user_id", "anonymous_ref"]
          },
          {
            foreignKeyName: "menu_safety_actions_menu_owner_fkey"
            columns: ["menu_id", "user_id"]
            isOneToOne: false
            referencedRelation: "menus"
            referencedColumns: ["id", "user_id"]
          },
          {
            foreignKeyName: "menu_safety_actions_step_owner_fkey"
            columns: ["before_recipe_step_id", "dish_id", "menu_id", "user_id"]
            isOneToOne: false
            referencedRelation: "recipe_steps"
            referencedColumns: ["id", "dish_id", "menu_id", "user_id"]
          },
        ]
      }
      menu_target_members: {
        Row: {
          anonymous_ref: string
          created_at: string
          household_member_id: string | null
          household_member_user_id: string | null
          id: string
          member_display_name_snapshot: string
          menu_id: string
          user_id: string
        }
        Insert: {
          anonymous_ref: string
          created_at?: string
          household_member_id?: string | null
          household_member_user_id?: string | null
          id?: string
          member_display_name_snapshot: string
          menu_id: string
          user_id: string
        }
        Update: {
          anonymous_ref?: string
          created_at?: string
          household_member_id?: string | null
          household_member_user_id?: string | null
          id?: string
          member_display_name_snapshot?: string
          menu_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "menu_target_members_member_owner_fkey"
            columns: ["household_member_id", "household_member_user_id"]
            isOneToOne: false
            referencedRelation: "household_members"
            referencedColumns: ["id", "user_id"]
          },
          {
            foreignKeyName: "menu_target_members_menu_owner_fkey"
            columns: ["menu_id", "user_id"]
            isOneToOne: false
            referencedRelation: "menus"
            referencedColumns: ["id", "user_id"]
          },
        ]
      }
      menu_timeline_steps: {
        Row: {
          created_at: string
          dish_id: string | null
          duration_minutes: number
          id: string
          instruction: string
          menu_id: string
          position: number
          recipe_step_id: string | null
          start_minute: number
          user_id: string
        }
        Insert: {
          created_at?: string
          dish_id?: string | null
          duration_minutes: number
          id?: string
          instruction: string
          menu_id: string
          position: number
          recipe_step_id?: string | null
          start_minute: number
          user_id: string
        }
        Update: {
          created_at?: string
          dish_id?: string | null
          duration_minutes?: number
          id?: string
          instruction?: string
          menu_id?: string
          position?: number
          recipe_step_id?: string | null
          start_minute?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "menu_timeline_steps_dish_owner_fkey"
            columns: ["dish_id", "menu_id", "user_id"]
            isOneToOne: false
            referencedRelation: "dishes"
            referencedColumns: ["id", "menu_id", "user_id"]
          },
          {
            foreignKeyName: "menu_timeline_steps_menu_owner_fkey"
            columns: ["menu_id", "user_id"]
            isOneToOne: false
            referencedRelation: "menus"
            referencedColumns: ["id", "user_id"]
          },
          {
            foreignKeyName: "menu_timeline_steps_step_owner_fkey"
            columns: ["recipe_step_id", "dish_id", "menu_id", "user_id"]
            isOneToOne: false
            referencedRelation: "recipe_steps"
            referencedColumns: ["id", "dish_id", "menu_id", "user_id"]
          },
        ]
      }
      menus: {
        Row: {
          allergen_dictionary_version: string | null
          change_reason: string | null
          change_reason_custom: string | null
          created_at: string
          cuisine_genre: string
          derivation_group_id: string
          food_safety_rule_version: string | null
          id: string
          is_favorite: boolean
          is_selected: boolean
          meal_type: string
          output_schema_version: string
          parent_menu_id: string | null
          preference_snapshot: Json
          safety_fingerprint: string
          safety_snapshot: Json
          selected_at: string | null
          servings: number
          target_mode: string
          total_elapsed_minutes: number
          user_id: string
          version: number
        }
        Insert: {
          allergen_dictionary_version?: string | null
          change_reason?: string | null
          change_reason_custom?: string | null
          created_at?: string
          cuisine_genre: string
          derivation_group_id: string
          food_safety_rule_version?: string | null
          id?: string
          is_favorite?: boolean
          is_selected?: boolean
          meal_type: string
          output_schema_version: string
          parent_menu_id?: string | null
          preference_snapshot: Json
          safety_fingerprint: string
          safety_snapshot: Json
          selected_at?: string | null
          servings: number
          target_mode: string
          total_elapsed_minutes: number
          user_id: string
          version?: number
        }
        Update: {
          allergen_dictionary_version?: string | null
          change_reason?: string | null
          change_reason_custom?: string | null
          created_at?: string
          cuisine_genre?: string
          derivation_group_id?: string
          food_safety_rule_version?: string | null
          id?: string
          is_favorite?: boolean
          is_selected?: boolean
          meal_type?: string
          output_schema_version?: string
          parent_menu_id?: string | null
          preference_snapshot?: Json
          safety_fingerprint?: string
          safety_snapshot?: Json
          selected_at?: string | null
          servings?: number
          target_mode?: string
          total_elapsed_minutes?: number
          user_id?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "menus_parent_owner_fkey"
            columns: ["parent_menu_id", "user_id"]
            isOneToOne: false
            referencedRelation: "menus"
            referencedColumns: ["id", "user_id"]
          },
        ]
      }
      pantry_items: {
        Row: {
          created_at: string
          expiration_type: string | null
          expires_on: string | null
          id: string
          name: string
          opened_state: string | null
          quantity: number | null
          unit: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          expiration_type?: string | null
          expires_on?: string | null
          id?: string
          name: string
          opened_state?: string | null
          quantity?: number | null
          unit?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          expiration_type?: string | null
          expires_on?: string | null
          id?: string
          name?: string
          opened_state?: string | null
          quantity?: number | null
          unit?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      privacy_consents: {
        Row: {
          accepted_at: string
          created_at: string
          notice_version: string
          user_id: string
        }
        Insert: {
          accepted_at?: string
          created_at?: string
          notice_version: string
          user_id?: string
        }
        Update: {
          accepted_at?: string
          created_at?: string
          notice_version?: string
          user_id?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          created_at: string
          onboarding_completed_at: string | null
          onboarding_status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          onboarding_completed_at?: string | null
          onboarding_status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          onboarding_completed_at?: string | null
          onboarding_status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      recipe_steps: {
        Row: {
          created_at: string
          dish_id: string
          id: string
          instruction: string
          menu_id: string
          position: number
          user_id: string
        }
        Insert: {
          created_at?: string
          dish_id: string
          id?: string
          instruction: string
          menu_id: string
          position: number
          user_id: string
        }
        Update: {
          created_at?: string
          dish_id?: string
          id?: string
          instruction?: string
          menu_id?: string
          position?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "recipe_steps_dish_owner_fkey"
            columns: ["dish_id", "menu_id", "user_id"]
            isOneToOne: false
            referencedRelation: "dishes"
            referencedColumns: ["id", "menu_id", "user_id"]
          },
        ]
      }
      shopping_current_label_warnings: {
        Row: {
          allergen_display_name: string
          allergen_id: string
          anonymous_member_ref: string
          checked_at: string
          dictionary_version: string
          id: string
          item_id: string | null
          list_id: string
          member_display_name: string
          source_derivation_group_id: string
          source_display_name: string
          source_id: string
          source_menu_id: string
          source_path: string
          source_type: string
          user_id: string
          warning_key: string
        }
        Insert: {
          allergen_display_name: string
          allergen_id: string
          anonymous_member_ref: string
          checked_at?: string
          dictionary_version: string
          id?: string
          item_id?: string | null
          list_id: string
          member_display_name: string
          source_derivation_group_id: string
          source_display_name: string
          source_id: string
          source_menu_id: string
          source_path: string
          source_type: string
          user_id: string
          warning_key: string
        }
        Update: {
          allergen_display_name?: string
          allergen_id?: string
          anonymous_member_ref?: string
          checked_at?: string
          dictionary_version?: string
          id?: string
          item_id?: string | null
          list_id?: string
          member_display_name?: string
          source_derivation_group_id?: string
          source_display_name?: string
          source_id?: string
          source_menu_id?: string
          source_path?: string
          source_type?: string
          user_id?: string
          warning_key?: string
        }
        Relationships: [
          {
            foreignKeyName: "shopping_current_label_warnings_allergen_id_fkey"
            columns: ["allergen_id"]
            isOneToOne: false
            referencedRelation: "allergen_catalog"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shopping_current_label_warnings_item_owner_fk"
            columns: ["item_id", "user_id"]
            isOneToOne: false
            referencedRelation: "shopping_items"
            referencedColumns: ["id", "user_id"]
          },
          {
            foreignKeyName: "shopping_current_label_warnings_list_owner_fk"
            columns: ["list_id", "user_id"]
            isOneToOne: false
            referencedRelation: "shopping_lists"
            referencedColumns: ["id", "user_id"]
          },
          {
            foreignKeyName: "shopping_current_label_warnings_menu_owner_fk"
            columns: ["source_menu_id", "user_id"]
            isOneToOne: false
            referencedRelation: "menus"
            referencedColumns: ["id", "user_id"]
          },
        ]
      }
      shopping_item_sources: {
        Row: {
          created_at: string
          dish_ingredient_id: string | null
          id: string
          item_id: string
          source_dish_id_snapshot: string
          source_dish_name: string
          source_ingredient_id_snapshot: string
          source_name: string
          source_quantity_text: string
          source_quantity_value: number | null
          source_unit: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          dish_ingredient_id?: string | null
          id?: string
          item_id: string
          source_dish_id_snapshot: string
          source_dish_name: string
          source_ingredient_id_snapshot: string
          source_name: string
          source_quantity_text: string
          source_quantity_value?: number | null
          source_unit?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          dish_ingredient_id?: string | null
          id?: string
          item_id?: string
          source_dish_id_snapshot?: string
          source_dish_name?: string
          source_ingredient_id_snapshot?: string
          source_name?: string
          source_quantity_text?: string
          source_quantity_value?: number | null
          source_unit?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "shopping_item_sources_dish_ingredient_id_user_id_fkey"
            columns: ["dish_ingredient_id", "user_id"]
            isOneToOne: false
            referencedRelation: "dish_ingredients"
            referencedColumns: ["id", "user_id"]
          },
          {
            foreignKeyName: "shopping_item_sources_item_id_user_id_fkey"
            columns: ["item_id", "user_id"]
            isOneToOne: false
            referencedRelation: "shopping_items"
            referencedColumns: ["id", "user_id"]
          },
        ]
      }
      shopping_items: {
        Row: {
          created_at: string
          display_name: string
          id: string
          is_checked: boolean
          is_manual: boolean
          is_manually_edited: boolean
          is_removed_by_user: boolean
          list_id: string
          normalized_name: string
          pantry_check_required: boolean
          quantity_text: string
          quantity_value: number | null
          store_section: string
          unit: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          display_name: string
          id?: string
          is_checked?: boolean
          is_manual?: boolean
          is_manually_edited?: boolean
          is_removed_by_user?: boolean
          list_id: string
          normalized_name: string
          pantry_check_required?: boolean
          quantity_text: string
          quantity_value?: number | null
          store_section: string
          unit?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          display_name?: string
          id?: string
          is_checked?: boolean
          is_manual?: boolean
          is_manually_edited?: boolean
          is_removed_by_user?: boolean
          list_id?: string
          normalized_name?: string
          pantry_check_required?: boolean
          quantity_text?: string
          quantity_value?: number | null
          store_section?: string
          unit?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "shopping_items_list_id_user_id_fkey"
            columns: ["list_id", "user_id"]
            isOneToOne: false
            referencedRelation: "shopping_lists"
            referencedColumns: ["id", "user_id"]
          },
        ]
      }
      shopping_label_confirmations: {
        Row: {
          allergen_display_name: string
          allergen_id: string
          anonymous_member_ref: string
          confirmation_status: string
          created_at: string
          dictionary_version: string
          id: string
          item_id: string | null
          list_id: string
          member_display_name: string
          menu_label_confirmation_id: string | null
          source_confirmation_id_snapshot: string | null
          source_derivation_group_id: string
          source_display_name: string
          source_id_snapshot: string
          source_menu_id_snapshot: string
          source_path: string
          source_type: string
          source_warning_key: string
          user_id: string
        }
        Insert: {
          allergen_display_name: string
          allergen_id: string
          anonymous_member_ref: string
          confirmation_status: string
          created_at?: string
          dictionary_version: string
          id?: string
          item_id?: string | null
          list_id: string
          member_display_name: string
          menu_label_confirmation_id?: string | null
          source_confirmation_id_snapshot?: string | null
          source_derivation_group_id: string
          source_display_name: string
          source_id_snapshot: string
          source_menu_id_snapshot: string
          source_path: string
          source_type: string
          source_warning_key: string
          user_id: string
        }
        Update: {
          allergen_display_name?: string
          allergen_id?: string
          anonymous_member_ref?: string
          confirmation_status?: string
          created_at?: string
          dictionary_version?: string
          id?: string
          item_id?: string | null
          list_id?: string
          member_display_name?: string
          menu_label_confirmation_id?: string | null
          source_confirmation_id_snapshot?: string | null
          source_derivation_group_id?: string
          source_display_name?: string
          source_id_snapshot?: string
          source_menu_id_snapshot?: string
          source_path?: string
          source_type?: string
          source_warning_key?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "shopping_label_confirmations_allergen_id_fkey"
            columns: ["allergen_id"]
            isOneToOne: false
            referencedRelation: "allergen_catalog"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shopping_label_confirmations_item_id_user_id_fkey"
            columns: ["item_id", "user_id"]
            isOneToOne: false
            referencedRelation: "shopping_items"
            referencedColumns: ["id", "user_id"]
          },
          {
            foreignKeyName: "shopping_label_confirmations_list_id_user_id_fkey"
            columns: ["list_id", "user_id"]
            isOneToOne: false
            referencedRelation: "shopping_lists"
            referencedColumns: ["id", "user_id"]
          },
          {
            foreignKeyName: "shopping_label_confirmations_menu_label_confirmation_id_us_fkey"
            columns: ["menu_label_confirmation_id", "user_id"]
            isOneToOne: false
            referencedRelation: "menu_label_confirmations"
            referencedColumns: ["id", "user_id"]
          },
        ]
      }
      shopping_list_sources: {
        Row: {
          created_at: string
          id: string
          list_id: string
          menu_id: string | null
          source_derivation_group_id: string
          source_menu_id_snapshot: string
          source_menu_version: number
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          list_id: string
          menu_id?: string | null
          source_derivation_group_id: string
          source_menu_id_snapshot: string
          source_menu_version: number
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          list_id?: string
          menu_id?: string | null
          source_derivation_group_id?: string
          source_menu_id_snapshot?: string
          source_menu_version?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "shopping_list_sources_list_id_user_id_fkey"
            columns: ["list_id", "user_id"]
            isOneToOne: false
            referencedRelation: "shopping_lists"
            referencedColumns: ["id", "user_id"]
          },
          {
            foreignKeyName: "shopping_list_sources_menu_id_user_id_fkey"
            columns: ["menu_id", "user_id"]
            isOneToOne: false
            referencedRelation: "menus"
            referencedColumns: ["id", "user_id"]
          },
        ]
      }
      shopping_lists: {
        Row: {
          created_at: string
          id: string
          safety_fingerprint: string
          status: string
          updated_at: string
          user_id: string
          version: number
        }
        Insert: {
          created_at?: string
          id?: string
          safety_fingerprint: string
          status?: string
          updated_at?: string
          user_id: string
          version?: number
        }
        Update: {
          created_at?: string
          id?: string
          safety_fingerprint?: string
          status?: string
          updated_at?: string
          user_id?: string
          version?: number
        }
        Relationships: []
      }
      user_feedback: {
        Row: {
          body: string
          category: string
          client_path: string | null
          created_at: string
          id: string
          user_id: string
        }
        Insert: {
          body: string
          category: string
          client_path?: string | null
          created_at?: string
          id?: string
          user_id?: string
        }
        Update: {
          body?: string
          category?: string
          client_path?: string | null
          created_at?: string
          id?: string
          user_id?: string
        }
        Relationships: []
      }
      user_share_consents: {
        Row: {
          accepted_at: string
          consent_version: string
          created_at: string
          revoked_at: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          accepted_at: string
          consent_version: string
          created_at?: string
          revoked_at?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          accepted_at?: string
          consent_version?: string
          created_at?: string
          revoked_at?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      accept_menu_version: { Args: { p_menu_id: string }; Returns: undefined }
      acquire_billing_checkout_lock: {
        Args: { p_expires_at: string; p_lock_token: string; p_user_id: string }
        Returns: Json
      }
      add_custom_member_allergy: {
        Args: {
          p_custom_aliases?: string[]
          p_custom_name: string
          p_member_id: string
        }
        Returns: {
          allergen_id: string | null
          created_at: string
          custom_aliases: string[]
          custom_confirmed: boolean
          custom_name: string | null
          id: string
          member_id: string
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "member_allergies"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      apply_shopping_draft: {
        Args: {
          p_active_list_id: string
          p_draft: Json
          p_expected_list_version: number
          p_idempotency_key: string
          p_menu_id: string
          p_mode: string
          p_request_hash: string
          p_safety_fingerprint: string
          p_user_id: string
        }
        Returns: Json
      }
      apply_shopping_reconciliation: {
        Args: {
          p_expected_list_version: number
          p_idempotency_key: string
          p_list_id: string
          p_request_hash: string
          p_resolved_diff: Json
          p_safety_fingerprint: string
          p_source_menu_id: string
          p_source_menu_version: number
          p_user_id: string
        }
        Returns: Json
      }
      bind_billing_checkout_session: {
        Args: {
          p_lock_token: string
          p_stripe_checkout_session_id: string
          p_user_id: string
        }
        Returns: Json
      }
      claim_auth_continuation: {
        Args: {
          p_id: string
          p_now: string
          p_origin: string
          p_secret_hash: string
          p_state_hash: string
        }
        Returns: {
          code_iv: string
          encrypted_code: string
          return_to: string
        }[]
      }
      claim_share_generalization_jobs: {
        Args: { p_limit: number }
        Returns: Json
      }
      cleanup_ai_generation_requests: {
        Args: { p_before: string; p_user_id?: string }
        Returns: number
      }
      cleanup_ai_generation_requests_batch: {
        Args: { p_before: string; p_limit: number }
        Returns: number
      }
      cleanup_auth_continuations: { Args: { p_now: string }; Returns: number }
      cleanup_auth_continuations_batch: {
        Args: { p_limit: number; p_now: string }
        Returns: number
      }
      cleanup_stale_ai_generations: {
        Args: { p_now?: string }
        Returns: number
      }
      cleanup_stale_ai_generations_batch: {
        Args: { p_limit: number; p_now: string }
        Returns: number
      }
      cleanup_stale_flyer_weekly_batch: {
        Args: { p_limit: number; p_now: string }
        Returns: number
      }
      complete_household_member: {
        Args: { p_member_id: string }
        Returns: {
          age_band: string | null
          allergy_status: string | null
          created_at: string
          display_name: string | null
          ease_preferences: string[]
          id: string
          portion_size: string | null
          required_safety_constraints: string[]
          sort_order: number
          spice_level: string | null
          status: string
          unsupported_diet_kinds: string[]
          unsupported_diet_status: string | null
          updated_at: string
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "household_members"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      confirm_menu_label_confirmation: {
        Args: {
          p_confirmation_id: string
          p_expected_safety_fingerprint: string
          p_menu_id: string
        }
        Returns: {
          allergen_id: string
          anonymous_member_ref: string
          confirmation_status: string
          confirmed_at: string | null
          confirmed_by: string | null
          created_at: string
          dictionary_version: string
          id: string
          is_current: boolean
          menu_id: string
          requirement_safety_fingerprint: string
          source_id: string
          source_path: string
          source_text_snapshot: string
          source_type: string
          user_id: string
        }[]
        SetofOptions: {
          from: "*"
          to: "menu_label_confirmations"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      create_auth_continuation: {
        Args: {
          p_now: string
          p_origin: string
          p_return_to: string
          p_secret_hash: string
          p_state_hash: string
          p_ttl_seconds: number
        }
        Returns: {
          expires_at: string
          id: string
        }[]
      }
      delete_generation_draft: {
        Args: { p_expected_revision: number }
        Returns: number
      }
      delete_member_allergy: {
        Args: { p_allergy_id: string }
        Returns: undefined
      }
      delete_menu_group: {
        Args: { p_derivation_group_id: string }
        Returns: number
      }
      deposit_auth_continuation: {
        Args: {
          p_ciphertext: string
          p_id: string
          p_iv: string
          p_now: string
          p_origin: string
          p_secret_hash?: string
          p_state_hash: string
        }
        Returns: boolean
      }
      ensure_billing_customer: {
        Args: { p_stripe_customer_id: string; p_user_id: string }
        Returns: Json
      }
      finalize_ai_generation_conflict: {
        Args: {
          p_conflict_codes: string[]
          p_now?: string
          p_request_id: string
        }
        Returns: Json
      }
      finalize_ai_generation_failure: {
        Args: {
          p_failure_code: string
          p_now?: string
          p_request_id: string
          p_retry_at?: string
        }
        Returns: Json
      }
      finalize_ai_generation_success: {
        Args: {
          p_allergen_version: string
          p_change_reason: string
          p_change_reason_custom: string
          p_expired_checks: Json
          p_food_rule_version: string
          p_menu: Json
          p_now?: string
          p_preference_snapshot: Json
          p_request_id: string
          p_safety_fingerprint: string
          p_safety_snapshot: Json
          p_source_menu_id: string
          p_target_members: Json
        }
        Returns: Json
      }
      finalize_ai_generation_success_deadline_bounded: {
        Args: {
          p_allergen_version: string
          p_change_reason: string
          p_change_reason_custom: string
          p_expired_checks: Json
          p_food_rule_version: string
          p_menu: Json
          p_now?: string
          p_preference_snapshot: Json
          p_request_id: string
          p_safety_fingerprint: string
          p_safety_snapshot: Json
          p_source_menu_id: string
          p_target_members: Json
          p_timeout_ms: number
        }
        Returns: Json
      }
      finalize_flyer_weekly_failure: {
        Args: {
          p_failure_code: string
          p_now?: string
          p_request_id: string
          p_sent: boolean
        }
        Returns: Json
      }
      finalize_flyer_weekly_success: {
        Args: { p_now?: string; p_request_id: string; p_result: Json }
        Returns: Json
      }
      finish_share_generalization_job: {
        Args: {
          p_ai_call_count?: number
          p_code?: string
          p_job_id: string
          p_pass1_model?: string
          p_pass2_model?: string
          p_status: string
        }
        Returns: Json
      }
      get_ai_generation_regeneration_snapshot: {
        Args: { p_request_id: string; p_user_id: string }
        Returns: {
          created_at: string
          kind: string
          replace_dish_id: string
          request_id: string
          servings: number
          source_menu_id: string
          source_menu_version: number
          target_member_ids: string[]
          target_mode: string
          user_id: string
        }[]
      }
      get_ai_generation_status: {
        Args: {
          p_attempt_limit: number
          p_idempotency_key: string
          p_identity_key: string
          p_now?: string
          p_short_window_limit: number
          p_user_id: string
          p_user_limit: number
        }
        Returns: Json
      }
      get_ai_generation_submission_snapshot: {
        Args: { p_request_id: string; p_user_id: string }
        Returns: {
          avoid_ingredients: string[]
          budget_preference: string
          captured_at: string
          cuisine_genre: string
          draft_id: string
          draft_revision: number
          ingredient_preference: string
          main_ingredients: string[]
          meal_type: string
          memo: string
          pantry_selections: Json
          servings: number
          target_member_ids: string[]
          target_mode: string
          time_limit_minutes: number
        }[]
      }
      get_ai_usage_today: {
        Args: {
          p_attempt_limit: number
          p_global_limit: number
          p_identity_key: string
          p_now?: string
          p_short_window_limit: number
          p_user_id: string
          p_user_limit: number
        }
        Returns: Json
      }
      get_billing_customer_by_stripe_id: {
        Args: { p_stripe_customer_id: string }
        Returns: Json
      }
      get_billing_customer_by_user: {
        Args: { p_user_id: string }
        Returns: Json
      }
      get_billing_entitlement_for_user: {
        Args: { p_now?: string; p_user_id: string }
        Returns: Json
      }
      get_current_safety_snapshot: {
        Args: { p_target_member_ids: string[]; p_user_id: string }
        Returns: Json
      }
      get_menu_generation_model: {
        Args: { p_menu_id: string }
        Returns: string
      }
      get_my_share_consent: { Args: never; Returns: Json }
      get_shopping_mutation_replay: {
        Args: {
          p_idempotency_key: string
          p_request_hash: string
          p_user_id: string
        }
        Returns: Json
      }
      has_billing_trial_history: {
        Args: { p_identity_key: string }
        Returns: boolean
      }
      heartbeat_share_generalization_job: {
        Args: { p_job_id: string }
        Returns: Json
      }
      insert_billing_trial_history: {
        Args: { p_identity_key: string }
        Returns: Json
      }
      insert_user_feedback_rate_limited: {
        Args: {
          p_body: string
          p_category: string
          p_client_path: string
          p_limit?: number
          p_user_id: string
          p_window_seconds?: number
        }
        Returns: Json
      }
      list_active_shared_emergency_recipes: {
        Args: { p_limit: number; p_meal_type: string; p_salt: string }
        Returns: Json
      }
      list_my_shared_emergency_recipes: { Args: never; Returns: Json }
      lookup_ai_generation_request: {
        Args: { p_idempotency_key: string; p_user_id: string }
        Returns: Json
      }
      mark_ai_global_sent: {
        Args: { p_now?: string; p_request_id: string }
        Returns: Json
      }
      mark_billing_subscription_dual_cancel_keep: {
        Args: { p_keep_stripe_subscription_id: string; p_user_id: string }
        Returns: Json
      }
      mark_flyer_weekly_sent: {
        Args: { p_now?: string; p_request_id: string }
        Returns: Json
      }
      mutate_shopping_item: {
        Args: {
          p_expected_list_version: number
          p_expected_safety_fingerprint: string
          p_idempotency_key: string
          p_item_id: string
          p_list_id: string
          p_operation: string
          p_payload: Json
        }
        Returns: Json
      }
      process_billing_stripe_event: { Args: { p_payload: Json }; Returns: Json }
      publish_shared_emergency_recipe: {
        Args: {
          p_ai_call_count?: number
          p_eligible_age_bands: string[]
          p_job_id: string
          p_meal_type: string
          p_pass1_model?: string
          p_pass2_model?: string
          p_payload: Json
          p_standard_allergen_ids: string[]
          p_total_elapsed: number
        }
        Returns: Json
      }
      reap_stale_share_jobs: {
        Args: { p_limit?: number; p_now?: string }
        Returns: number
      }
      reconcile_menu_label_confirmations: {
        Args: {
          p_expected_safety_fingerprint: string
          p_menu_id: string
          p_requirements: Json
          p_user_id: string
        }
        Returns: {
          allergen_id: string
          anonymous_member_ref: string
          confirmation_status: string
          confirmed_at: string | null
          confirmed_by: string | null
          created_at: string
          dictionary_version: string
          id: string
          is_current: boolean
          menu_id: string
          requirement_safety_fingerprint: string
          source_id: string
          source_path: string
          source_text_snapshot: string
          source_type: string
          user_id: string
        }[]
        SetofOptions: {
          from: "*"
          to: "menu_label_confirmations"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      record_ai_generation_model: {
        Args: { p_model_id: string; p_now?: string; p_request_id: string }
        Returns: undefined
      }
      refresh_shopping_list_safety: {
        Args: {
          p_expected_fingerprint: string
          p_list_id: string
          p_user_id: string
          p_warnings: Json
        }
        Returns: Json
      }
      release_billing_checkout_lock: {
        Args: {
          p_lock_token?: string
          p_stripe_checkout_session_id?: string
          p_user_id: string
        }
        Returns: Json
      }
      release_flyer_weekly_for_user_processing: {
        Args: { p_now?: string; p_user_id: string }
        Returns: number
      }
      release_identity_and_global_for_user_processing: {
        Args: { p_now?: string; p_user_id: string }
        Returns: number
      }
      reserve_ai_generation: {
        Args: {
          p_attempt_limit: number
          p_change_reason: string
          p_draft_id: string
          p_draft_revision: number
          p_global_limit: number
          p_idempotency_key: string
          p_identity_key: string
          p_integrity_context: Json
          p_now?: string
          p_quality_mode?: boolean
          p_quota_disabled?: boolean
          p_replace_dish_id: string
          p_request_hmac: string
          p_request_hmac_version: string
          p_request_kind: string
          p_short_window_limit: number
          p_source_menu_id: string
          p_stale_after_seconds?: number
          p_user_id: string
          p_user_limit: number
        }
        Returns: Json
      }
      reserve_ai_repair_call: {
        Args: {
          p_global_limit: number
          p_now?: string
          p_quota_disabled?: boolean
          p_request_id: string
        }
        Returns: Json
      }
      reserve_flyer_weekly: {
        Args: {
          p_attempt_limit: number
          p_global_limit: number
          p_idempotency_key: string
          p_identity_key: string
          p_now?: string
          p_quota_disabled?: boolean
          p_short_window_limit: number
          p_user_id: string
        }
        Returns: Json
      }
      run_kondate_maintenance: {
        Args: { p_limit: number; p_now: string }
        Returns: Json
      }
      save_generation_draft: {
        Args: {
          p_avoid_ingredients: string[]
          p_budget_preference: string
          p_cuisine_genre: string
          p_expected_revision: number
          p_ingredient_preference: string
          p_main_ingredients: string[]
          p_meal_type: string
          p_memo: string
          p_pantry_selections: Json
          p_servings: number
          p_target_member_ids: string[]
          p_target_mode: string
          p_time_limit_minutes: number
        }
        Returns: {
          avoid_ingredients: string[]
          budget_preference: string | null
          created_at: string
          cuisine_genre: string | null
          deleted_at: string | null
          id: string
          ingredient_preference: string | null
          main_ingredients: string[]
          meal_type: string | null
          memo: string
          pantry_selections: Json
          revision: number
          servings: number | null
          target_member_ids: string[]
          target_mode: string | null
          time_limit_minutes: number | null
          updated_at: string
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "generation_drafts"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      set_onboarding_status: {
        Args: { p_expected_status?: string; p_status: string }
        Returns: {
          created_at: string
          onboarding_completed_at: string | null
          onboarding_status: string
          updated_at: string
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "profiles"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      share_app_ai_budget_remaining: { Args: never; Returns: number }
      shopping_list_safety_fingerprint: {
        Args: { p_list_id: string; p_user_id: string }
        Returns: string
      }
      shopping_safety_fingerprint: {
        Args: { p_menu_id: string; p_user_id: string }
        Returns: string
      }
      start_household_onboarding: {
        Args: { p_sort_order: number }
        Returns: {
          age_band: string | null
          allergy_status: string | null
          created_at: string
          display_name: string | null
          ease_preferences: string[]
          id: string
          portion_size: string | null
          required_safety_constraints: string[]
          sort_order: number
          spice_level: string | null
          status: string
          unsupported_diet_kinds: string[]
          unsupported_diet_status: string | null
          updated_at: string
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "household_members"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      try_enqueue_share_job: { Args: { p_menu_id: string }; Returns: Json }
      upsert_billing_subscription_from_stripe: {
        Args: { p_payload: Json }
        Returns: Json
      }
      upsert_my_share_consent: {
        Args: { p_accept: boolean; p_version: string }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  private: {
    Enums: {},
  },
  public: {
    Enums: {},
  },
} as const
