// Database types — match the Supabase schema for Buddy

export type Role = "super_admin" | "practitioner" | "client";
export type Urgency = "emergency" | "urgent" | "soon" | "monitor" | "routine";

export interface Profile {
  id: string;
  role: Role;
  full_name: string;
  profession: string | null;
  created_at: string;
}

export interface Practice {
  id: string;
  practitioner_id: string;
  practice_name: string;
  profession: string | null;
  popia_agreed: boolean;
  popia_agreed_at: string | null;
  data_processing_agreed: boolean;
  data_processing_agreed_at: string | null;
  webhook_url: string;
  webhook_enabled: boolean;
  contact_webhook_url: string;
  contact_webhook_enabled: boolean;
  onboarding_complete: boolean;
  is_approved: boolean;
  yves_enabled: boolean;
  created_at: string;
}

export interface PlatformSettings {
  id: string;
  new_practitioner_webhook_url: string;
  new_practitioner_webhook_enabled: boolean;
  created_at: string;
}

export interface Client {
  id: string;
  practitioner_id: string;
  full_name: string;
  email: string;
  phone: string | null;
  primary_complaint: string;
  notes: string;
  check_in_frequency: string;
  next_appointment: string | null;
  tracking_duration_weeks: number;
  login_code: string;
  popia_accepted: boolean;
  yves_enabled: boolean;
  suggested_program_id: string | null;
  program_status: "none" | "pending" | "accepted" | "declined";
  program_decided_at: string | null;
  first_login_at: string | null;
  created_at: string;
}

export interface CheckIn {
  id: string;
  client_id: string;
  practitioner_id: string;
  pain_level: number | null;
  sleep_quality: number | null;
  stress_level: number | null;
  energy_level: number | null;
  mood: number | null;
  notes: string;
  medication_taken: boolean;
  flagged: boolean;
  created_at: string;
}

export interface SymptomQuery {
  id: string;
  client_id: string;
  practitioner_id: string;
  query_text: string;
  urgency: Urgency;
  red_flag_detected: boolean;
  suggested_next_step: string;
  ai_rationale: string;
  severity: number;
  source: string;
  created_at: string;
}

export interface Alert {
  id: string;
  practitioner_id: string;
  client_id: string;
  alert_type: string;
  message: string;
  urgency: Urgency | string;
  is_read: boolean;
  webhook_fired: boolean;
  created_at: string;
}
