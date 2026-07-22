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
      alert_action_tokens: {
        Row: {
          action: string
          alert_id: string
          created_at: string
          expires_at: string
          id: string
          practitioner_id: string
          token_hash: string
          used_at: string | null
        }
        Insert: {
          action: string
          alert_id: string
          created_at?: string
          expires_at: string
          id?: string
          practitioner_id: string
          token_hash: string
          used_at?: string | null
        }
        Update: {
          action?: string
          alert_id?: string
          created_at?: string
          expires_at?: string
          id?: string
          practitioner_id?: string
          token_hash?: string
          used_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "alert_action_tokens_alert_id_fkey"
            columns: ["alert_id"]
            isOneToOne: false
            referencedRelation: "alerts"
            referencedColumns: ["id"]
          },
        ]
      }
      alerts: {
        Row: {
          alert_type: string
          client_id: string
          created_at: string
          email_fired: boolean
          id: string
          is_read: boolean
          message: string | null
          outcome: string | null
          outcome_at: string | null
          outcome_by: string | null
          pattern: string | null
          practitioner_assessment: string | null
          practitioner_id: string
          push_fired: boolean
          red_flag_category: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          urgency: string
          webhook_fired: boolean
        }
        Insert: {
          alert_type: string
          client_id: string
          created_at?: string
          email_fired?: boolean
          id?: string
          is_read?: boolean
          message?: string | null
          outcome?: string | null
          outcome_at?: string | null
          outcome_by?: string | null
          pattern?: string | null
          practitioner_assessment?: string | null
          practitioner_id: string
          push_fired?: boolean
          red_flag_category?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          urgency: string
          webhook_fired?: boolean
        }
        Update: {
          alert_type?: string
          client_id?: string
          created_at?: string
          email_fired?: boolean
          id?: string
          is_read?: boolean
          message?: string | null
          outcome?: string | null
          outcome_at?: string | null
          outcome_by?: string | null
          pattern?: string | null
          practitioner_assessment?: string | null
          practitioner_id?: string
          push_fired?: boolean
          red_flag_category?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
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
          condition_context: string | null
          condition_note: string | null
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
          condition_context?: string | null
          condition_note?: string | null
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
          condition_context?: string | null
          condition_note?: string | null
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
      checkin_reminders: {
        Row: {
          client_id: string
          created_at: string
          days_of_week: number[]
          enabled: boolean
          frequency: string
          id: string
          last_sent_on: string | null
          time_of_day: string
          timezone: string
          updated_at: string
        }
        Insert: {
          client_id: string
          created_at?: string
          days_of_week?: number[]
          enabled?: boolean
          frequency?: string
          id?: string
          last_sent_on?: string | null
          time_of_day?: string
          timezone?: string
          updated_at?: string
        }
        Update: {
          client_id?: string
          created_at?: string
          days_of_week?: number[]
          enabled?: boolean
          frequency?: string
          id?: string
          last_sent_on?: string | null
          time_of_day?: string
          timezone?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "checkin_reminders_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: true
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      client_baselines: {
        Row: {
          client_id: string
          computed_at: string
          energy_mean: number | null
          energy_std: number | null
          id: string
          mood_mean: number | null
          mood_std: number | null
          pain_mean: number | null
          pain_std: number | null
          sample_size: number
          sleep_mean: number | null
          sleep_std: number | null
          stress_mean: number | null
          stress_std: number | null
        }
        Insert: {
          client_id: string
          computed_at?: string
          energy_mean?: number | null
          energy_std?: number | null
          id?: string
          mood_mean?: number | null
          mood_std?: number | null
          pain_mean?: number | null
          pain_std?: number | null
          sample_size?: number
          sleep_mean?: number | null
          sleep_std?: number | null
          stress_mean?: number | null
          stress_std?: number | null
        }
        Update: {
          client_id?: string
          computed_at?: string
          energy_mean?: number | null
          energy_std?: number | null
          id?: string
          mood_mean?: number | null
          mood_std?: number | null
          pain_mean?: number | null
          pain_std?: number | null
          sample_size?: number
          sleep_mean?: number | null
          sleep_std?: number | null
          stress_mean?: number | null
          stress_std?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "client_baselines_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: true
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      client_insight_logs: {
        Row: {
          client_id: string
          created_at: string
          focus: string | null
          generated_by: string | null
          grade: string | null
          grade_note: string | null
          graded_at: string | null
          graded_by: string | null
          id: string
          memory_version: number | null
          model: string | null
          response: string
        }
        Insert: {
          client_id: string
          created_at?: string
          focus?: string | null
          generated_by?: string | null
          grade?: string | null
          grade_note?: string | null
          graded_at?: string | null
          graded_by?: string | null
          id?: string
          memory_version?: number | null
          model?: string | null
          response: string
        }
        Update: {
          client_id?: string
          created_at?: string
          focus?: string | null
          generated_by?: string | null
          grade?: string | null
          grade_note?: string | null
          graded_at?: string | null
          graded_by?: string | null
          id?: string
          memory_version?: number | null
          model?: string | null
          response?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_insight_logs_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      client_patterns: {
        Row: {
          active: boolean
          avg_value: number
          client_id: string
          confidence: number
          day_of_week: number
          id: string
          last_detected_at: string
          metric: string
          pattern_type: string
          sample_size: number
        }
        Insert: {
          active?: boolean
          avg_value: number
          client_id: string
          confidence?: number
          day_of_week: number
          id?: string
          last_detected_at?: string
          metric: string
          pattern_type: string
          sample_size?: number
        }
        Update: {
          active?: boolean
          avg_value?: number
          client_id?: string
          confidence?: number
          day_of_week?: number
          id?: string
          last_detected_at?: string
          metric?: string
          pattern_type?: string
          sample_size?: number
        }
        Relationships: [
          {
            foreignKeyName: "client_patterns_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      client_rewards: {
        Row: {
          client_id: string
          earned_at: string
          id: string
          practitioner_id: string | null
          reward_id: string
          status: string
        }
        Insert: {
          client_id: string
          earned_at?: string
          id?: string
          practitioner_id?: string | null
          reward_id: string
          status?: string
        }
        Update: {
          client_id?: string
          earned_at?: string
          id?: string
          practitioner_id?: string | null
          reward_id?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_rewards_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_rewards_reward_id_fkey"
            columns: ["reward_id"]
            isOneToOne: false
            referencedRelation: "rewards"
            referencedColumns: ["id"]
          },
        ]
      }
      clients: {
        Row: {
          auth_user_id: string | null
          check_in_frequency: string
          created_at: string
          email: string | null
          first_login_at: string | null
          full_name: string
          id: string
          login_code: string
          notes: string | null
          passive_monitoring_enabled: boolean
          phone: string | null
          popia_accepted: boolean
          practitioner_id: string
          predictive_nudges_enabled: boolean
          primary_complaint: string | null
          program_decided_at: string | null
          program_personal_note: string | null
          program_reminder_snoozed_until: string | null
          program_status: string
          program_suggested_at: string | null
          program_suggested_by: string | null
          suggested_program_id: string | null
          timezone: string
          yves_ai_consent: boolean
          yves_ai_consent_at: string | null
          yves_enabled: boolean
        }
        Insert: {
          auth_user_id?: string | null
          check_in_frequency?: string
          created_at?: string
          email?: string | null
          first_login_at?: string | null
          full_name: string
          id?: string
          login_code: string
          notes?: string | null
          passive_monitoring_enabled?: boolean
          phone?: string | null
          popia_accepted?: boolean
          practitioner_id: string
          predictive_nudges_enabled?: boolean
          primary_complaint?: string | null
          program_decided_at?: string | null
          program_personal_note?: string | null
          program_reminder_snoozed_until?: string | null
          program_status?: string
          program_suggested_at?: string | null
          program_suggested_by?: string | null
          suggested_program_id?: string | null
          timezone?: string
          yves_ai_consent?: boolean
          yves_ai_consent_at?: string | null
          yves_enabled?: boolean
        }
        Update: {
          auth_user_id?: string | null
          check_in_frequency?: string
          created_at?: string
          email?: string | null
          first_login_at?: string | null
          full_name?: string
          id?: string
          login_code?: string
          notes?: string | null
          passive_monitoring_enabled?: boolean
          phone?: string | null
          popia_accepted?: boolean
          practitioner_id?: string
          predictive_nudges_enabled?: boolean
          primary_complaint?: string | null
          program_decided_at?: string | null
          program_personal_note?: string | null
          program_reminder_snoozed_until?: string | null
          program_status?: string
          program_suggested_at?: string | null
          program_suggested_by?: string | null
          suggested_program_id?: string | null
          timezone?: string
          yves_ai_consent?: boolean
          yves_ai_consent_at?: string | null
          yves_enabled?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "clients_suggested_program_id_fkey"
            columns: ["suggested_program_id"]
            isOneToOne: false
            referencedRelation: "programs"
            referencedColumns: ["id"]
          },
        ]
      }
      email_send_log: {
        Row: {
          created_at: string
          error_message: string | null
          id: string
          message_id: string | null
          metadata: Json | null
          recipient_email: string
          status: string
          template_name: string
        }
        Insert: {
          created_at?: string
          error_message?: string | null
          id?: string
          message_id?: string | null
          metadata?: Json | null
          recipient_email: string
          status: string
          template_name: string
        }
        Update: {
          created_at?: string
          error_message?: string | null
          id?: string
          message_id?: string | null
          metadata?: Json | null
          recipient_email?: string
          status?: string
          template_name?: string
        }
        Relationships: []
      }
      email_send_state: {
        Row: {
          auth_email_ttl_minutes: number
          batch_size: number
          id: number
          retry_after_until: string | null
          send_delay_ms: number
          transactional_email_ttl_minutes: number
          updated_at: string
        }
        Insert: {
          auth_email_ttl_minutes?: number
          batch_size?: number
          id?: number
          retry_after_until?: string | null
          send_delay_ms?: number
          transactional_email_ttl_minutes?: number
          updated_at?: string
        }
        Update: {
          auth_email_ttl_minutes?: number
          batch_size?: number
          id?: number
          retry_after_until?: string | null
          send_delay_ms?: number
          transactional_email_ttl_minutes?: number
          updated_at?: string
        }
        Relationships: []
      }
      email_unsubscribe_tokens: {
        Row: {
          created_at: string
          email: string
          id: string
          token: string
          used_at: string | null
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          token: string
          used_at?: string | null
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          token?: string
          used_at?: string | null
        }
        Relationships: []
      }
      garmin_oauth_state: {
        Row: {
          client_id: string
          code_verifier: string
          created_at: string
          expires_at: string
          state: string
        }
        Insert: {
          client_id: string
          code_verifier: string
          created_at?: string
          expires_at: string
          state: string
        }
        Update: {
          client_id?: string
          code_verifier?: string
          created_at?: string
          expires_at?: string
          state?: string
        }
        Relationships: [
          {
            foreignKeyName: "garmin_oauth_state_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      google_calendar_oauth_state: {
        Row: {
          created_at: string
          expires_at: string
          redirect_after: string | null
          state: string
          user_id: string
        }
        Insert: {
          created_at?: string
          expires_at: string
          redirect_after?: string | null
          state: string
          user_id: string
        }
        Update: {
          created_at?: string
          expires_at?: string
          redirect_after?: string | null
          state?: string
          user_id?: string
        }
        Relationships: []
      }
      google_calendar_tokens: {
        Row: {
          access_token: string
          created_at: string
          expires_at: string
          google_email: string | null
          id: string
          refresh_token: string | null
          scope: string | null
          token_type: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          access_token: string
          created_at?: string
          expires_at: string
          google_email?: string | null
          id?: string
          refresh_token?: string | null
          scope?: string | null
          token_type?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          access_token?: string
          created_at?: string
          expires_at?: string
          google_email?: string | null
          id?: string
          refresh_token?: string | null
          scope?: string | null
          token_type?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      grading_settings: {
        Row: {
          id: number
          mode: string
          sample_rate: number
          updated_at: string
        }
        Insert: {
          id?: number
          mode?: string
          sample_rate?: number
          updated_at?: string
        }
        Update: {
          id?: number
          mode?: string
          sample_rate?: number
          updated_at?: string
        }
        Relationships: []
      }
      platform_settings: {
        Row: {
          created_at: string | null
          id: string
          new_practitioner_webhook_enabled: boolean | null
          new_practitioner_webhook_url: string | null
          passive_monitoring_enabled: boolean
          predictive_nudges_enabled: boolean
          programs_feature_enabled: boolean
          rewards_allowed_days: number[]
          rewards_enabled: boolean
        }
        Insert: {
          created_at?: string | null
          id?: string
          new_practitioner_webhook_enabled?: boolean | null
          new_practitioner_webhook_url?: string | null
          passive_monitoring_enabled?: boolean
          predictive_nudges_enabled?: boolean
          programs_feature_enabled?: boolean
          rewards_allowed_days?: number[]
          rewards_enabled?: boolean
        }
        Update: {
          created_at?: string | null
          id?: string
          new_practitioner_webhook_enabled?: boolean | null
          new_practitioner_webhook_url?: string | null
          passive_monitoring_enabled?: boolean
          predictive_nudges_enabled?: boolean
          programs_feature_enabled?: boolean
          rewards_allowed_days?: number[]
          rewards_enabled?: boolean
        }
        Relationships: []
      }
      practices: {
        Row: {
          ai_features_enabled: boolean
          alert_sensitivity: string
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
          ai_features_enabled?: boolean
          alert_sensitivity?: string
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
          ai_features_enabled?: boolean
          alert_sensitivity?: string
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
      practitioner_drafts: {
        Row: {
          acted_at: string | null
          client_id: string
          created_at: string
          draft_body: string
          draft_title: string
          id: string
          kind: string
          practitioner_id: string
          risk_score_id: string | null
          status: string
          suggested_action: Json
        }
        Insert: {
          acted_at?: string | null
          client_id: string
          created_at?: string
          draft_body: string
          draft_title: string
          id?: string
          kind: string
          practitioner_id: string
          risk_score_id?: string | null
          status?: string
          suggested_action?: Json
        }
        Update: {
          acted_at?: string | null
          client_id?: string
          created_at?: string
          draft_body?: string
          draft_title?: string
          id?: string
          kind?: string
          practitioner_id?: string
          risk_score_id?: string | null
          status?: string
          suggested_action?: Json
        }
        Relationships: [
          {
            foreignKeyName: "practitioner_drafts_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "practitioner_drafts_risk_score_id_fkey"
            columns: ["risk_score_id"]
            isOneToOne: false
            referencedRelation: "risk_scores"
            referencedColumns: ["id"]
          },
        ]
      }
      predictive_nudges: {
        Row: {
          client_id: string
          created_at: string
          id: string
          nudge_body: string
          nudge_title: string
          opened_at: string | null
          pattern_id: string | null
          program_id: string | null
          scheduled_for: string
          sent_at: string | null
          status: string
        }
        Insert: {
          client_id: string
          created_at?: string
          id?: string
          nudge_body: string
          nudge_title: string
          opened_at?: string | null
          pattern_id?: string | null
          program_id?: string | null
          scheduled_for: string
          sent_at?: string | null
          status?: string
        }
        Update: {
          client_id?: string
          created_at?: string
          id?: string
          nudge_body?: string
          nudge_title?: string
          opened_at?: string | null
          pattern_id?: string | null
          program_id?: string | null
          scheduled_for?: string
          sent_at?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "predictive_nudges_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "predictive_nudges_pattern_id_fkey"
            columns: ["pattern_id"]
            isOneToOne: false
            referencedRelation: "client_patterns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "predictive_nudges_program_id_fkey"
            columns: ["program_id"]
            isOneToOne: false
            referencedRelation: "programs"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          full_name: string | null
          id: string
          morning_analysis_enabled: boolean
          profession: string | null
          role: string
        }
        Insert: {
          created_at?: string
          full_name?: string | null
          id: string
          morning_analysis_enabled?: boolean
          profession?: string | null
          role?: string
        }
        Update: {
          created_at?: string
          full_name?: string | null
          id?: string
          morning_analysis_enabled?: boolean
          profession?: string | null
          role?: string
        }
        Relationships: []
      }
      programs: {
        Row: {
          active: boolean
          approved_at: string | null
          approved_by: string | null
          approved_by_admin: boolean
          cover_image_url: string | null
          created_at: string
          description: string
          duration_label: string | null
          external_url: string
          focus_area: string | null
          id: string
          image_url: string | null
          name: string
          outcomes: string[]
          pain_max: number | null
          pain_min: number | null
          priority: number
          symptom_tags: string[]
          updated_at: string
        }
        Insert: {
          active?: boolean
          approved_at?: string | null
          approved_by?: string | null
          approved_by_admin?: boolean
          cover_image_url?: string | null
          created_at?: string
          description?: string
          duration_label?: string | null
          external_url: string
          focus_area?: string | null
          id?: string
          image_url?: string | null
          name: string
          outcomes?: string[]
          pain_max?: number | null
          pain_min?: number | null
          priority?: number
          symptom_tags?: string[]
          updated_at?: string
        }
        Update: {
          active?: boolean
          approved_at?: string | null
          approved_by?: string | null
          approved_by_admin?: boolean
          cover_image_url?: string | null
          created_at?: string
          description?: string
          duration_label?: string | null
          external_url?: string
          focus_area?: string | null
          id?: string
          image_url?: string | null
          name?: string
          outcomes?: string[]
          pain_max?: number | null
          pain_min?: number | null
          priority?: number
          symptom_tags?: string[]
          updated_at?: string
        }
        Relationships: []
      }
      push_send_log: {
        Row: {
          attempted: number
          body: string
          created_at: string
          delivered: number
          error_message: string | null
          id: string
          provider: string
          recipient_user_id: string
          response: Json | null
          sent_by: string | null
          status: string
          title: string
        }
        Insert: {
          attempted?: number
          body: string
          created_at?: string
          delivered?: number
          error_message?: string | null
          id?: string
          provider?: string
          recipient_user_id: string
          response?: Json | null
          sent_by?: string | null
          status: string
          title: string
        }
        Update: {
          attempted?: number
          body?: string
          created_at?: string
          delivered?: number
          error_message?: string | null
          id?: string
          provider?: string
          recipient_user_id?: string
          response?: Json | null
          sent_by?: string | null
          status?: string
          title?: string
        }
        Relationships: []
      }
      push_tokens: {
        Row: {
          created_at: string
          id: string
          last_seen: string
          platform: string
          token: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          last_seen?: string
          platform?: string
          token: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          last_seen?: string
          platform?: string
          token?: string
          user_id?: string
        }
        Relationships: []
      }
      rewards: {
        Row: {
          active: boolean
          created_at: string
          description: string
          id: string
          maps_url: string | null
          name: string
          updated_at: string
          voucher_code: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          description?: string
          id?: string
          maps_url?: string | null
          name: string
          updated_at?: string
          voucher_code: string
        }
        Update: {
          active?: boolean
          created_at?: string
          description?: string
          id?: string
          maps_url?: string | null
          name?: string
          updated_at?: string
          voucher_code?: string
        }
        Relationships: []
      }
      risk_scores: {
        Row: {
          client_id: string
          created_at: string
          delta_vs_baseline: Json
          id: string
          risk_score: number
          score_date: string
          summary: string | null
          trend: string
        }
        Insert: {
          client_id: string
          created_at?: string
          delta_vs_baseline?: Json
          id?: string
          risk_score: number
          score_date: string
          summary?: string | null
          trend?: string
        }
        Update: {
          client_id?: string
          created_at?: string
          delta_vs_baseline?: Json
          id?: string
          risk_score?: number
          score_date?: string
          summary?: string | null
          trend?: string
        }
        Relationships: [
          {
            foreignKeyName: "risk_scores_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      suppressed_emails: {
        Row: {
          created_at: string
          email: string
          id: string
          metadata: Json | null
          reason: string
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          metadata?: Json | null
          reason: string
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          metadata?: Json | null
          reason?: string
        }
        Relationships: []
      }
      symptom_queries: {
        Row: {
          ai_rationale: string | null
          client_id: string
          created_at: string | null
          differential: Json | null
          id: string
          patient_feedback_at: string | null
          patient_helpful: boolean | null
          patient_understood: boolean | null
          practitioner_id: string
          query_text: string
          red_flag_category: string | null
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
          differential?: Json | null
          id?: string
          patient_feedback_at?: string | null
          patient_helpful?: boolean | null
          patient_understood?: boolean | null
          practitioner_id: string
          query_text: string
          red_flag_category?: string | null
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
          differential?: Json | null
          id?: string
          patient_feedback_at?: string | null
          patient_helpful?: boolean | null
          patient_understood?: boolean | null
          practitioner_id?: string
          query_text?: string
          red_flag_category?: string | null
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
      wearable_sessions: {
        Row: {
          active_calories: number | null
          activity_score: number | null
          avg_heart_rate: number | null
          body_battery_charged: number | null
          body_battery_drained: number | null
          body_battery_max: number | null
          body_battery_min: number | null
          client_id: string
          date: string
          deep_sleep_duration: number | null
          duration_minutes: number | null
          fetched_at: string
          hrv_avg: number | null
          id: string
          light_sleep_duration: number | null
          max_heart_rate: number | null
          readiness_score: number | null
          rem_sleep_duration: number | null
          respiration_rate_avg: number | null
          resting_hr: number | null
          session_type: string | null
          sleep_efficiency: number | null
          sleep_score: number | null
          source: string
          spo2_avg: number | null
          stress_avg: number | null
          total_calories: number | null
          total_distance_km: number | null
          total_sleep_duration: number | null
          total_steps: number | null
          training_load: number | null
          vo2_max: number | null
        }
        Insert: {
          active_calories?: number | null
          activity_score?: number | null
          avg_heart_rate?: number | null
          body_battery_charged?: number | null
          body_battery_drained?: number | null
          body_battery_max?: number | null
          body_battery_min?: number | null
          client_id: string
          date: string
          deep_sleep_duration?: number | null
          duration_minutes?: number | null
          fetched_at?: string
          hrv_avg?: number | null
          id?: string
          light_sleep_duration?: number | null
          max_heart_rate?: number | null
          readiness_score?: number | null
          rem_sleep_duration?: number | null
          respiration_rate_avg?: number | null
          resting_hr?: number | null
          session_type?: string | null
          sleep_efficiency?: number | null
          sleep_score?: number | null
          source: string
          spo2_avg?: number | null
          stress_avg?: number | null
          total_calories?: number | null
          total_distance_km?: number | null
          total_sleep_duration?: number | null
          total_steps?: number | null
          training_load?: number | null
          vo2_max?: number | null
        }
        Update: {
          active_calories?: number | null
          activity_score?: number | null
          avg_heart_rate?: number | null
          body_battery_charged?: number | null
          body_battery_drained?: number | null
          body_battery_max?: number | null
          body_battery_min?: number | null
          client_id?: string
          date?: string
          deep_sleep_duration?: number | null
          duration_minutes?: number | null
          fetched_at?: string
          hrv_avg?: number | null
          id?: string
          light_sleep_duration?: number | null
          max_heart_rate?: number | null
          readiness_score?: number | null
          rem_sleep_duration?: number | null
          respiration_rate_avg?: number | null
          resting_hr?: number | null
          session_type?: string | null
          sleep_efficiency?: number | null
          sleep_score?: number | null
          source?: string
          spo2_avg?: number | null
          stress_avg?: number | null
          total_calories?: number | null
          total_distance_km?: number | null
          total_sleep_duration?: number | null
          total_steps?: number | null
          training_load?: number | null
          vo2_max?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "wearable_sessions_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      wearable_tokens: {
        Row: {
          access_token: string
          client_id: string
          created_at: string
          expires_at: string | null
          garmin_device_model: string | null
          provider: string
          provider_user_id: string | null
          refresh_token: string | null
          status: string
          updated_at: string
        }
        Insert: {
          access_token: string
          client_id: string
          created_at?: string
          expires_at?: string | null
          garmin_device_model?: string | null
          provider: string
          provider_user_id?: string | null
          refresh_token?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          access_token?: string
          client_id?: string
          created_at?: string
          expires_at?: string | null
          garmin_device_model?: string | null
          provider?: string
          provider_user_id?: string | null
          refresh_token?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "wearable_tokens_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      yves_feedback_log: {
        Row: {
          admin_correction: string | null
          admin_id: string | null
          created_at: string
          id: string
          question: string | null
          resulted_in_staging_id: string | null
          scope: string | null
          session_id: string
          test_context: Json | null
          yves_answer: string | null
        }
        Insert: {
          admin_correction?: string | null
          admin_id?: string | null
          created_at?: string
          id?: string
          question?: string | null
          resulted_in_staging_id?: string | null
          scope?: string | null
          session_id: string
          test_context?: Json | null
          yves_answer?: string | null
        }
        Update: {
          admin_correction?: string | null
          admin_id?: string | null
          created_at?: string
          id?: string
          question?: string | null
          resulted_in_staging_id?: string | null
          scope?: string | null
          session_id?: string
          test_context?: Json | null
          yves_answer?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "yves_feedback_log_admin_id_fkey"
            columns: ["admin_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "yves_feedback_log_resulted_in_staging_id_fkey"
            columns: ["resulted_in_staging_id"]
            isOneToOne: false
            referencedRelation: "yves_memory_staging"
            referencedColumns: ["id"]
          },
        ]
      }
      yves_memory: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          is_active: boolean
          rationale: string | null
          rule_text: string
          rule_type: string
          scope: string
          supersedes: string | null
          title: string
          updated_at: string
          version: number
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          rationale?: string | null
          rule_text: string
          rule_type: string
          scope: string
          supersedes?: string | null
          title: string
          updated_at?: string
          version?: number
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          rationale?: string | null
          rule_text?: string
          rule_type?: string
          scope?: string
          supersedes?: string | null
          title?: string
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "yves_memory_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "yves_memory_supersedes_fkey"
            columns: ["supersedes"]
            isOneToOne: false
            referencedRelation: "yves_memory"
            referencedColumns: ["id"]
          },
        ]
      }
      yves_memory_staging: {
        Row: {
          conflict_flags: Json | null
          created_at: string
          created_by: string | null
          id: string
          is_active: boolean
          proposed_by: string
          rationale: string | null
          review_note: string | null
          rule_text: string
          rule_type: string
          scope: string
          source_feedback_id: string | null
          status: string
          supersedes: string | null
          title: string
          updated_at: string
          version: number
        }
        Insert: {
          conflict_flags?: Json | null
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          proposed_by?: string
          rationale?: string | null
          review_note?: string | null
          rule_text: string
          rule_type: string
          scope: string
          source_feedback_id?: string | null
          status?: string
          supersedes?: string | null
          title: string
          updated_at?: string
          version?: number
        }
        Update: {
          conflict_flags?: Json | null
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          proposed_by?: string
          rationale?: string | null
          review_note?: string | null
          rule_text?: string
          rule_type?: string
          scope?: string
          source_feedback_id?: string | null
          status?: string
          supersedes?: string | null
          title?: string
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "yves_memory_staging_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "yves_memory_staging_supersedes_fkey"
            columns: ["supersedes"]
            isOneToOne: false
            referencedRelation: "yves_memory"
            referencedColumns: ["id"]
          },
        ]
      }
      yves_memory_versions: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          note: string | null
          snapshot: Json
          version_number: number
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          note?: string | null
          snapshot: Json
          version_number: number
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          note?: string | null
          snapshot?: Json
          version_number?: number
        }
        Relationships: [
          {
            foreignKeyName: "yves_memory_versions_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      yves_triage_logs: {
        Row: {
          client_id: string
          combination_floor_hit: string[]
          created_at: string
          error: string | null
          escalated: boolean
          escalation_reasons: string[]
          extraction_model: string | null
          extraction_output: Json | null
          final_model: string | null
          final_red_flag_category: string | null
          final_severity: number | null
          final_urgency: string | null
          first_pass_confidence: number | null
          first_pass_model: string | null
          first_pass_severity: number | null
          first_pass_urgency: string | null
          floor_terms_hit: string[]
          hard_override_hit: string[]
          id: string
          practitioner_id: string
          prompt_version: string
          query_text_len: number | null
          symptom_query_id: string | null
          total_latency_ms: number | null
        }
        Insert: {
          client_id: string
          combination_floor_hit?: string[]
          created_at?: string
          error?: string | null
          escalated?: boolean
          escalation_reasons?: string[]
          extraction_model?: string | null
          extraction_output?: Json | null
          final_model?: string | null
          final_red_flag_category?: string | null
          final_severity?: number | null
          final_urgency?: string | null
          first_pass_confidence?: number | null
          first_pass_model?: string | null
          first_pass_severity?: number | null
          first_pass_urgency?: string | null
          floor_terms_hit?: string[]
          hard_override_hit?: string[]
          id?: string
          practitioner_id: string
          prompt_version: string
          query_text_len?: number | null
          symptom_query_id?: string | null
          total_latency_ms?: number | null
        }
        Update: {
          client_id?: string
          combination_floor_hit?: string[]
          created_at?: string
          error?: string | null
          escalated?: boolean
          escalation_reasons?: string[]
          extraction_model?: string | null
          extraction_output?: Json | null
          final_model?: string | null
          final_red_flag_category?: string | null
          final_severity?: number | null
          final_urgency?: string | null
          first_pass_confidence?: number | null
          first_pass_model?: string | null
          first_pass_severity?: number | null
          first_pass_urgency?: string | null
          floor_terms_hit?: string[]
          hard_override_hit?: string[]
          id?: string
          practitioner_id?: string
          prompt_version?: string
          query_text_len?: number | null
          symptom_query_id?: string | null
          total_latency_ms?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "yves_triage_logs_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "yves_triage_logs_symptom_query_id_fkey"
            columns: ["symptom_query_id"]
            isOneToOne: false
            referencedRelation: "symptom_queries"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      current_client_id: { Args: never; Returns: string }
      delete_email: {
        Args: { message_id: number; queue_name: string }
        Returns: boolean
      }
      email_queue_dispatch: { Args: never; Returns: undefined }
      enqueue_email: {
        Args: { payload: Json; queue_name: string }
        Returns: number
      }
      insert_alert: {
        Args: {
          p_alert_type: string
          p_client_id: string
          p_message: string
          p_practitioner_id: string
          p_urgency: string
        }
        Returns: string
      }
      insert_check_in:
        | {
            Args: {
              p_client_id: string
              p_energy_level: number
              p_flagged: boolean
              p_medication_taken: boolean
              p_mood: string
              p_notes: string
              p_pain_level: number
              p_practitioner_id: string
              p_sleep_quality: number
              p_stress_level: number
            }
            Returns: string
          }
        | {
            Args: {
              p_client_id: string
              p_condition_context?: string
              p_condition_note?: string
              p_energy_level: number
              p_flagged: boolean
              p_medication_taken: boolean
              p_mood: string
              p_notes: string
              p_pain_level: number
              p_practitioner_id: string
              p_sleep_quality: number
              p_stress_level: number
            }
            Returns: string
          }
      is_super_admin: { Args: { _uid: string }; Returns: boolean }
      move_to_dlq: {
        Args: {
          dlq_name: string
          message_id: number
          payload: Json
          source_queue: string
        }
        Returns: number
      }
      read_email_batch: {
        Args: { batch_size: number; queue_name: string; vt: number }
        Returns: {
          message: Json
          msg_id: number
          read_ct: number
        }[]
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
  public: {
    Enums: {},
  },
} as const
