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
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      is_valid_draft_pantry_selections: {
        Args: { p_value: Json }
        Returns: boolean
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
          id: string
          main_ingredients: string[]
          meal_type: string | null
          memo: string
          pantry_selections: Json
          revision: number
          target_member_ids: string[]
          time_limit_minutes: number | null
          updated_at: string
          user_id: string
        }
        Insert: {
          avoid_ingredients?: string[]
          budget_preference?: string | null
          created_at?: string
          cuisine_genre?: string | null
          id?: string
          main_ingredients?: string[]
          meal_type?: string | null
          memo?: string
          pantry_selections?: Json
          revision?: number
          target_member_ids?: string[]
          time_limit_minutes?: number | null
          updated_at?: string
          user_id: string
        }
        Update: {
          avoid_ingredients?: string[]
          budget_preference?: string | null
          created_at?: string
          cuisine_genre?: string | null
          id?: string
          main_ingredients?: string[]
          meal_type?: string | null
          memo?: string
          pantry_selections?: Json
          revision?: number
          target_member_ids?: string[]
          time_limit_minutes?: number | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
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
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
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
      cleanup_auth_continuations: { Args: { p_now: string }; Returns: number }
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
      deposit_auth_continuation: {
        Args: {
          p_ciphertext: string
          p_id: string
          p_iv: string
          p_now: string
          p_origin: string
          p_state_hash: string
        }
        Returns: boolean
      }
      save_generation_draft: {
        Args: {
          p_avoid_ingredients: string[]
          p_budget_preference: string
          p_cuisine_genre: string
          p_expected_revision: number
          p_main_ingredients: string[]
          p_meal_type: string
          p_memo: string
          p_pantry_selections: Json
          p_target_member_ids: string[]
          p_time_limit_minutes: number
        }
        Returns: {
          avoid_ingredients: string[]
          budget_preference: string | null
          created_at: string
          cuisine_genre: string | null
          id: string
          main_ingredients: string[]
          meal_type: string | null
          memo: string
          pantry_selections: Json
          revision: number
          target_member_ids: string[]
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
        Args: { p_status: string }
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
