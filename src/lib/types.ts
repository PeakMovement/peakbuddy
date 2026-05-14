// Database types for Buddy

export interface Profile {
  id: string;
  user_id: string;
  full_name: string | null;
  email: string | null;
  role: "client" | "practitioner" | "admin";
  avatar_url: string | null;
  created_at: string;
  updated_at: string;
}

export interface Practice {
  id: string;
  name: string;
  owner_id: string;
  description: string | null;
  logo_url: string | null;
  created_at: string;
  updated_at: string;
}

export interface Client {
  id: string;
  profile_id: string;
  practice_id: string | null;
  practitioner_id: string | null;
  date_of_birth: string | null;
  notes: string | null;
  status: "active" | "paused" | "archived";
  created_at: string;
  updated_at: string;
}

export interface CheckIn {
  id: string;
  client_id: string;
  mood: number | null;
  energy: number | null;
  sleep_hours: number | null;
  pain_level: number | null;
  notes: string | null;
  symptoms: string[] | null;
  created_at: string;
}

export interface SymptomQuery {
  id: string;
  client_id: string;
  query: string;
  response: string | null;
  resolved: boolean;
  created_at: string;
  updated_at: string;
}

export interface Alert {
  id: string;
  client_id: string;
  practitioner_id: string | null;
  type: "warning" | "critical" | "info";
  title: string;
  message: string;
  acknowledged: boolean;
  acknowledged_at: string | null;
  created_at: string;
}
