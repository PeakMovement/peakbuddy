export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      alerts: {
        Row: {
          alert_type: string
          client_id: string
          created_at: string
          id: string
          is_read: boolean
          message: string | null
          practitioner_id: string
          urgency: string
          webhook_fired: boolean
        }
        Insert: {
          alert_type: string
          client_id: string
          created_at?: string
          id?: string
          is_read?: boolean
          message?: string | null
          practitioner_id: string
          urgency: string
          webhook_fired?: boolean
        }
        Update: {
          alert_type?: string
          client_id?: string
          created_at?: string
          id?: string
          is_read?: boolean
          message?: string | null
          practitioner_id?: string
          urgency?: string
          webhook_fired?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "alerts_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      check_ins: {
        Row: {
          client_id: string
          created_at: string
          energy_level: number | null
          flagged: boolean
          id: string
          medication_taken: boolean | null
          mood: string | null
          notes: string | null
          pain_level: number | null
          practitioner_id: string
          sleep_quality: number | null
          stress_level: number | null
        }
        Insert: {
          client_id: string
          created_at?: string
          energy_level?: number | null
          flagged?: boolean
          id?: string
          medication_taken?: boolean | null
          mood?: string | null
          notes?: string | null
          pain_level?: number | null
          practitioner_id: string
          sleep_quality?: number | null
          stress_level?: number | null
        }
        Update: {
          client_id?: string
          created_at?: string
          energy_level?: number | null
          flagged?: boolean
          id?: string
          medication_taken?: boolean | null
          mood?: string | null
          notes?: string | null
          pain_level?: number | null
          practitioner_id?: string
          sleep_quality?: number | null
          stress_level?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "check_ins_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      clients: {
        Row: {
          check_in_frequency: string
          created_at: string
          email: string | null
          full_name: string
          id: string
          login_code: string
          notes: string | null
          phone: string | null
          popia_accepted: boolean
          practitioner_id: string
          primary_complaint: string | null
          yves_enabled: boolean
        }
        Insert: {
          check_in_frequency?: string
          created_at?: string
          email?: string | null
          full_name: string
          id?: string
          login_code: string
          notes?: string | null
          phone?: string | null
          popia_accepted?: boolean
          practitioner_id: string
          primary_complaint?: string | null
          yves_enabled?: boolean
        }
        Update: {
          check_in_frequency?: string
          created_at?: string
          email?: string | null
          full_name?: string
          id?: string
          login_code?: string
          notes?: string | null
          phone?: string | null
          popia_accepted?: boolean
          practitioner_id?: string
          primary_complaint?: string | null
          yves_enabled?: boolean
        }
        Relationships: []
      }
      platform_settings: {
        Row: {
          created_at: string | null
          id: string
          new_practitioner_webhook_enabled: boolean | null
          new_practitioner_webhook_url: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          new_practitioner_webhook_enabled?: boolean | null
          new_practitioner_webhook_url?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string
          new_practitioner_webhook_enabled?: boolean | null
          new_practitioner_webhook_url?: string | null
        }
        Relationships: []
      }
      practices: {
        Row: {
          contact_webhook_enabled: boolean
          contact_webhook_url: string | null
          created_at: string
          data_processing_agreed: boolean
          data_processing_agreed_at: string | null
          id: string
          is_approved: boolean
          onboarding_complete: boolean
          popia_agreed: boolean
          popia_agreed_at: string | null
          practice_name: string | null
          practitioner_id: string
          profession: string | null
          webhook_enabled: boolean
          webhook_url: string | null
          yves_enabled: boolean
        }
        Insert: {
          contact_webhook_enabled?: boolean
          contact_webhook_url?: string | null
          created_at?: string
          data_processing_agreed?: boolean
          data_processing_agreed_at?: string | null
          id?: string
          is_approved?: boolean
          onboarding_complete?: boolean
          popia_agreed?: boolean
          popia_agreed_at?: string | null
          practice_name?: string | null
          practitioner_id: string
          profession?: string | null
          webhook_enabled?: boolean
          webhook_url?: string | null
          yves_enabled?: boolean
        }
        Update: {
          contact_webhook_enabled?: boolean
          contact_webhook_url?: string | null
          created_at?: string
          data_processing_agreed?: boolean
          data_processing_agreed_at?: string | null
          id?: string
          is_approved?: boolean
          onboarding_complete?: boolean
          popia_agreed?: boolean
          popia_agreed_at?: string | null
          practice_name?: string | null
          practitioner_id?: string
          profession?: string | null
          webhook_enabled?: boolean
          webhook_url?: string | null
          yves_enabled?: boolean
        }
        Relationships: []
      }
      profiles: {
        Row: {
          created_at: string
          full_name: string | null
          id: string
          profession: string | null
          role: string
        }
        Insert: {
          created_at?: string
          full_name?: string | null
          id: string
          profession?: string | null
          role?: string
        }
        Update: {
          created_at?: string
          full_name?: string | null
          id?: string
          profession?: string | null
          role?: string
        }
        Relationships: []
      }
      symptom_queries: {
        Row: {
          ai_rationale: string | null
          client_id: string
          created_at: string | null
          id: string
          practitioner_id: string
          query_text: string
          red_flag_detected: boolean | null
          severity: number | null
          source: string | null
          suggested_next_step: string | null
          urgency: string | null
        }
        Insert: {
          ai_rationale?: string | null
          client_id: string
          created_at?: string | null
          id?: string
          practitioner_id: string
          query_text: string
          red_flag_detected?: boolean | null
          severity?: number | null
          source?: string | null
          suggested_next_step?: string | null
          urgency?: string | null
        }
        Update: {
          ai_rationale?: string | null
          client_id?: string
          created_at?: string | null
          id?: string
          practitioner_id?: string
          query_text?: string
          red_flag_detected?: boolean | null
          severity?: number | null
          source?: string | null
          suggested_next_step?: string | null
          urgency?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "symptom_queries_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "symptom_queries_practitioner_id_fkey"
            columns: ["practitioner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
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
  public: {
    Enums: {},
  },
} as const
