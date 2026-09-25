export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  public: {
    Tables: {
      application_activities: {
        Row: {
          actor_type: Database["public"]["Enums"]["actor_type"]
          application_id: string
          created_at: string
          id: string
          metadata: Json
          occurred_at: string
          summary: string
          type: Database["public"]["Enums"]["activity_type"]
          user_id: string
        }
        Insert: {
          actor_type: Database["public"]["Enums"]["actor_type"]
          application_id: string
          created_at?: string
          id?: string
          metadata?: Json
          occurred_at?: string
          summary: string
          type: Database["public"]["Enums"]["activity_type"]
          user_id: string
        }
        Update: {
          actor_type?: Database["public"]["Enums"]["actor_type"]
          application_id?: string
          created_at?: string
          id?: string
          metadata?: Json
          occurred_at?: string
          summary?: string
          type?: Database["public"]["Enums"]["activity_type"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "application_activities_application_owner_fkey"
            columns: ["user_id", "application_id"]
            isOneToOne: false
            referencedRelation: "application_overview"
            referencedColumns: ["user_id", "application_id"]
          },
          {
            foreignKeyName: "application_activities_application_owner_fkey"
            columns: ["user_id", "application_id"]
            isOneToOne: false
            referencedRelation: "applications"
            referencedColumns: ["user_id", "id"]
          },
        ]
      }
      application_notes: {
        Row: {
          application_id: string
          body: string
          created_at: string
          id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          application_id: string
          body: string
          created_at?: string
          id?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          application_id?: string
          body?: string
          created_at?: string
          id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "application_notes_application_owner_fkey"
            columns: ["user_id", "application_id"]
            isOneToOne: false
            referencedRelation: "application_overview"
            referencedColumns: ["user_id", "application_id"]
          },
          {
            foreignKeyName: "application_notes_application_owner_fkey"
            columns: ["user_id", "application_id"]
            isOneToOne: false
            referencedRelation: "applications"
            referencedColumns: ["user_id", "id"]
          },
        ]
      }
      applications: {
        Row: {
          applied_at: string | null
          created_at: string
          date_found: string | null
          id: string
          job_id: string
          last_activity_at: string
          priority: Database["public"]["Enums"]["application_priority"]
          referral: string | null
          resume_version: string | null
          status: Database["public"]["Enums"]["application_status"]
          updated_at: string
          user_id: string
          version: number
        }
        Insert: {
          applied_at?: string | null
          created_at?: string
          date_found?: string | null
          id?: string
          job_id: string
          last_activity_at?: string
          priority?: Database["public"]["Enums"]["application_priority"]
          referral?: string | null
          resume_version?: string | null
          status?: Database["public"]["Enums"]["application_status"]
          updated_at?: string
          user_id: string
          version?: number
        }
        Update: {
          applied_at?: string | null
          created_at?: string
          date_found?: string | null
          id?: string
          job_id?: string
          last_activity_at?: string
          priority?: Database["public"]["Enums"]["application_priority"]
          referral?: string | null
          resume_version?: string | null
          status?: Database["public"]["Enums"]["application_status"]
          updated_at?: string
          user_id?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "applications_job_owner_fkey"
            columns: ["user_id", "job_id"]
            isOneToOne: true
            referencedRelation: "jobs"
            referencedColumns: ["user_id", "id"]
          },
        ]
      }
      candidate_profiles: {
        Row: {
          created_at: string
          degree: string | null
          email: string | null
          full_name: string | null
          github_url: string | null
          graduation_date: string | null
          linkedin_url: string | null
          location: string | null
          phone: string | null
          portfolio_url: string | null
          requires_sponsorship: boolean | null
          school: string | null
          updated_at: string
          user_id: string
          work_authorization: string | null
        }
        Insert: {
          created_at?: string
          degree?: string | null
          email?: string | null
          full_name?: string | null
          github_url?: string | null
          graduation_date?: string | null
          linkedin_url?: string | null
          location?: string | null
          phone?: string | null
          portfolio_url?: string | null
          requires_sponsorship?: boolean | null
          school?: string | null
          updated_at?: string
          user_id: string
          work_authorization?: string | null
        }
        Update: {
          created_at?: string
          degree?: string | null
          email?: string | null
          full_name?: string | null
          github_url?: string | null
          graduation_date?: string | null
          linkedin_url?: string | null
          location?: string | null
          phone?: string | null
          portfolio_url?: string | null
          requires_sponsorship?: boolean | null
          school?: string | null
          updated_at?: string
          user_id?: string
          work_authorization?: string | null
        }
        Relationships: []
      }
      companies: {
        Row: {
          created_at: string
          id: string
          interest_level: number | null
          name: string
          normalized_name: string
          notes: string | null
          target_company: boolean
          updated_at: string
          user_id: string
          website_url: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          interest_level?: number | null
          name: string
          normalized_name: string
          notes?: string | null
          target_company?: boolean
          updated_at?: string
          user_id: string
          website_url?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          interest_level?: number | null
          name?: string
          normalized_name?: string
          notes?: string | null
          target_company?: boolean
          updated_at?: string
          user_id?: string
          website_url?: string | null
        }
        Relationships: []
      }
      company_watch_activities: {
        Row: {
          actor_type: Database["public"]["Enums"]["actor_type"]
          created_at: string
          id: string
          metadata: Json
          original_watch_id: string
          occurred_at: string
          summary: string
          type: Database["public"]["Enums"]["watch_event_type"]
          user_id: string
          watch_id: string | null
        }
        Insert: {
          actor_type: Database["public"]["Enums"]["actor_type"]
          created_at?: string
          id?: string
          metadata?: Json
          original_watch_id: string
          occurred_at?: string
          summary: string
          type: Database["public"]["Enums"]["watch_event_type"]
          user_id: string
          watch_id?: string | null
        }
        Update: {
          actor_type?: Database["public"]["Enums"]["actor_type"]
          created_at?: string
          id?: string
          metadata?: Json
          original_watch_id?: string
          occurred_at?: string
          summary?: string
          type?: Database["public"]["Enums"]["watch_event_type"]
          user_id?: string
          watch_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "company_watch_activities_watch_owner_fkey"
            columns: ["user_id", "watch_id"]
            isOneToOne: false
            referencedRelation: "company_watch_overview"
            referencedColumns: ["user_id", "watch_id"]
          },
          {
            foreignKeyName: "company_watch_activities_watch_owner_fkey"
            columns: ["user_id", "watch_id"]
            isOneToOne: false
            referencedRelation: "company_watches"
            referencedColumns: ["user_id", "id"]
          },
        ]
      }
      company_watch_boards: {
        Row: {
          board_identifier: string | null
          board_url: string
          created_at: string
          id: string
          position: number
          provider: Database["public"]["Enums"]["ats_provider"]
          user_id: string
          watch_id: string
        }
        Insert: {
          board_identifier?: string | null
          board_url: string
          created_at?: string
          id?: string
          position: number
          provider: Database["public"]["Enums"]["ats_provider"]
          user_id: string
          watch_id: string
        }
        Update: {
          board_identifier?: string | null
          board_url?: string
          created_at?: string
          id?: string
          position?: number
          provider?: Database["public"]["Enums"]["ats_provider"]
          user_id?: string
          watch_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "company_watch_boards_watch_owner_fkey"
            columns: ["user_id", "watch_id"]
            isOneToOne: false
            referencedRelation: "company_watch_overview"
            referencedColumns: ["user_id", "watch_id"]
          },
          {
            foreignKeyName: "company_watch_boards_watch_owner_fkey"
            columns: ["user_id", "watch_id"]
            isOneToOne: false
            referencedRelation: "company_watches"
            referencedColumns: ["user_id", "id"]
          },
        ]
      }
      company_watches: {
        Row: {
          active: boolean
          company_id: string
          created_at: string
          id: string
          updated_at: string
          user_id: string
          version: number
        }
        Insert: {
          active?: boolean
          company_id: string
          created_at?: string
          id?: string
          updated_at?: string
          user_id: string
          version?: number
        }
        Update: {
          active?: boolean
          company_id?: string
          created_at?: string
          id?: string
          updated_at?: string
          user_id?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "company_watches_company_owner_fkey"
            columns: ["user_id", "company_id"]
            isOneToOne: true
            referencedRelation: "companies"
            referencedColumns: ["user_id", "id"]
          },
        ]
      }
      jobs: {
        Row: {
          company_id: string
          created_at: string
          date_posted: string | null
          description: string | null
          external_job_id: string | null
          id: string
          job_url: string | null
          location: string | null
          normalized_title: string
          source: string | null
          title: string
          updated_at: string
          user_id: string
          work_arrangement: Database["public"]["Enums"]["work_arrangement"]
        }
        Insert: {
          company_id: string
          created_at?: string
          date_posted?: string | null
          description?: string | null
          external_job_id?: string | null
          id?: string
          job_url?: string | null
          location?: string | null
          normalized_title: string
          source?: string | null
          title: string
          updated_at?: string
          user_id: string
          work_arrangement?: Database["public"]["Enums"]["work_arrangement"]
        }
        Update: {
          company_id?: string
          created_at?: string
          date_posted?: string | null
          description?: string | null
          external_job_id?: string | null
          id?: string
          job_url?: string | null
          location?: string | null
          normalized_title?: string
          source?: string | null
          title?: string
          updated_at?: string
          user_id?: string
          work_arrangement?: Database["public"]["Enums"]["work_arrangement"]
        }
        Relationships: [
          {
            foreignKeyName: "jobs_company_owner_fkey"
            columns: ["user_id", "company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["user_id", "id"]
          },
        ]
      }
      mutation_requests: {
        Row: {
          created_at: string
          input_hash: string
          operation: string
          request_id: string
          result: Json
          user_id: string
        }
        Insert: {
          created_at?: string
          input_hash: string
          operation: string
          request_id: string
          result: Json
          user_id: string
        }
        Update: {
          created_at?: string
          input_hash?: string
          operation?: string
          request_id?: string
          result?: Json
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      application_overview: {
        Row: {
          application_id: string | null
          applied_at: string | null
          company_id: string | null
          company_name: string | null
          company_normalized_name: string | null
          created_at: string | null
          date_found: string | null
          date_posted: string | null
          description: string | null
          external_job_id: string | null
          job_id: string | null
          job_url: string | null
          last_activity_at: string | null
          location: string | null
          normalized_title: string | null
          priority: Database["public"]["Enums"]["application_priority"] | null
          referral: string | null
          resume_version: string | null
          source: string | null
          status: Database["public"]["Enums"]["application_status"] | null
          title: string | null
          updated_at: string | null
          user_id: string | null
          version: number | null
          work_arrangement:
            | Database["public"]["Enums"]["work_arrangement"]
            | null
        }
        Relationships: [
          {
            foreignKeyName: "applications_job_owner_fkey"
            columns: ["user_id", "job_id"]
            isOneToOne: true
            referencedRelation: "jobs"
            referencedColumns: ["user_id", "id"]
          },
        ]
      }
      company_watch_overview: {
        Row: {
          active: boolean | null
          application_count: number | null
          board_providers: Database["public"]["Enums"]["ats_provider"][] | null
          boards: Json | null
          company_id: string | null
          company_name: string | null
          company_normalized_name: string | null
          company_notes: string | null
          created_at: string | null
          interest_level: number | null
          last_event_actor_type:
            | Database["public"]["Enums"]["actor_type"]
            | null
          last_event_at: string | null
          last_event_summary: string | null
          last_event_type:
            | Database["public"]["Enums"]["watch_event_type"]
            | null
          updated_at: string | null
          user_id: string | null
          version: number | null
          watch_id: string | null
          website_url: string | null
        }
        Relationships: [
          {
            foreignKeyName: "company_watches_company_owner_fkey"
            columns: ["user_id", "company_id"]
            isOneToOne: true
            referencedRelation: "companies"
            referencedColumns: ["user_id", "id"]
          },
        ]
      }
    }
    Functions: {
      add_application_note: {
        Args: {
          p_actor: string
          p_command: Json
          p_owner_id: string
          p_request_id: string
          p_today?: string
        }
        Returns: Json
      }
      create_application: {
        Args: {
          p_actor: string
          p_command: Json
          p_owner_id: string
          p_request_id: string
          p_today?: string
        }
        Returns: Json
      }
      create_company_watch: {
        Args: {
          p_actor: string
          p_command: Json
          p_owner_id: string
          p_request_id: string
        }
        Returns: Json
      }
      import_applications: {
        Args: {
          p_actor: string
          p_command: Json
          p_owner_id: string
          p_request_id: string
        }
        Returns: Json
      }
      save_candidate_profile: {
        Args: { p_command: Json; p_owner_id: string }
        Returns: Json
      }
      delete_company_watch: {
        Args: {
          p_actor: string
          p_command: Json
          p_owner_id: string
          p_request_id: string
        }
        Returns: Json
      }
      set_company_watch_active: {
        Args: {
          p_actor: string
          p_command: Json
          p_owner_id: string
          p_request_id: string
        }
        Returns: Json
      }
      update_application_details: {
        Args: {
          p_actor: string
          p_command: Json
          p_owner_id: string
          p_request_id: string
          p_today?: string
        }
        Returns: Json
      }
      update_application_note: {
        Args: {
          p_actor: string
          p_command: Json
          p_owner_id: string
          p_request_id: string
          p_today?: string
        }
        Returns: Json
      }
      update_application_status: {
        Args: {
          p_actor: string
          p_command: Json
          p_owner_id: string
          p_request_id: string
          p_today?: string
        }
        Returns: Json
      }
      update_company_watch: {
        Args: {
          p_actor: string
          p_command: Json
          p_owner_id: string
          p_request_id: string
        }
        Returns: Json
      }
    }
    Enums: {
      activity_type:
        | "CREATED"
        | "STATUS_CHANGED"
        | "DETAILS_UPDATED"
        | "NOTE_ADDED"
        | "NOTE_UPDATED"
        | "IMPORTED"
      actor_type: "USER" | "CODEX" | "IMPORT" | "SYSTEM"
      application_priority: "LOW" | "MEDIUM" | "HIGH"
      application_status:
        | "SAVED"
        | "RESEARCHING"
        | "READY_TO_APPLY"
        | "APPLIED"
        | "OA"
        | "INTERVIEW"
        | "FINAL"
        | "OFFER"
        | "REJECTED"
        | "WITHDRAWN"
      ats_provider: "GREENHOUSE" | "LEVER" | "ASHBY" | "OTHER"
      watch_event_type:
        | "WATCH_CREATED"
        | "WATCH_UPDATED"
        | "WATCH_ACTIVATED"
        | "WATCH_DEACTIVATED"
        | "WATCH_DELETED"
      work_arrangement: "UNKNOWN" | "REMOTE" | "HYBRID" | "ONSITE"
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      activity_type: [
        "CREATED",
        "STATUS_CHANGED",
        "DETAILS_UPDATED",
        "NOTE_ADDED",
        "NOTE_UPDATED",
        "IMPORTED",
      ],
      actor_type: ["USER", "CODEX", "IMPORT", "SYSTEM"],
      application_priority: ["LOW", "MEDIUM", "HIGH"],
      application_status: [
        "SAVED",
        "RESEARCHING",
        "READY_TO_APPLY",
        "APPLIED",
        "OA",
        "INTERVIEW",
        "FINAL",
        "OFFER",
        "REJECTED",
        "WITHDRAWN",
      ],
      ats_provider: ["GREENHOUSE", "LEVER", "ASHBY", "OTHER"],
      watch_event_type: [
        "WATCH_CREATED",
        "WATCH_UPDATED",
        "WATCH_ACTIVATED",
        "WATCH_DEACTIVATED",
        "WATCH_DELETED",
      ],
      work_arrangement: ["UNKNOWN", "REMOTE", "HYBRID", "ONSITE"],
    },
  },
} as const

