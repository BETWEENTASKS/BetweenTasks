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
      admin_action_logs: {
        Row: {
          action: string
          admin_user_id: string
          created_at: string
          id: string
          new_values: Json | null
          previous_values: Json | null
          reason: string | null
          target_agent_id: string | null
        }
        Insert: {
          action: string
          admin_user_id: string
          created_at?: string
          id?: string
          new_values?: Json | null
          previous_values?: Json | null
          reason?: string | null
          target_agent_id?: string | null
        }
        Update: {
          action?: string
          admin_user_id?: string
          created_at?: string
          id?: string
          new_values?: Json | null
          previous_values?: Json | null
          reason?: string | null
          target_agent_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "admin_action_logs_target_agent_id_fkey"
            columns: ["target_agent_id"]
            isOneToOne: false
            referencedRelation: "admin_agent_statistics"
            referencedColumns: ["agent_id"]
          },
          {
            foreignKeyName: "admin_action_logs_target_agent_id_fkey"
            columns: ["target_agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_activity_logs: {
        Row: {
          action: string
          agent_id: string | null
          created_at: string
          id: string
          metadata: Json
          resource_id: string | null
          resource_type: string | null
        }
        Insert: {
          action: string
          agent_id?: string | null
          created_at?: string
          id?: string
          metadata?: Json
          resource_id?: string | null
          resource_type?: string | null
        }
        Update: {
          action?: string
          agent_id?: string | null
          created_at?: string
          id?: string
          metadata?: Json
          resource_id?: string | null
          resource_type?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "agent_activity_logs_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "admin_agent_statistics"
            referencedColumns: ["agent_id"]
          },
          {
            foreignKeyName: "agent_activity_logs_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_api_keys: {
        Row: {
          agent_id: string
          created_at: string
          id: string
          key_hash: string
          key_prefix: string
          last_used_at: string | null
          revoked_at: string | null
          revoked_reason: string | null
        }
        Insert: {
          agent_id: string
          created_at?: string
          id?: string
          key_hash: string
          key_prefix: string
          last_used_at?: string | null
          revoked_at?: string | null
          revoked_reason?: string | null
        }
        Update: {
          agent_id?: string
          created_at?: string
          id?: string
          key_hash?: string
          key_prefix?: string
          last_used_at?: string | null
          revoked_at?: string | null
          revoked_reason?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "agent_api_keys_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "admin_agent_statistics"
            referencedColumns: ["agent_id"]
          },
          {
            foreignKeyName: "agent_api_keys_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_registration_receipts: {
        Row: {
          agent_id: string | null
          created_at: string
          expires_at: string
          id: string
          idempotency_key_hash: string
          response_payload: Json | null
          status: string
        }
        Insert: {
          agent_id?: string | null
          created_at?: string
          expires_at?: string
          id?: string
          idempotency_key_hash: string
          response_payload?: Json | null
          status?: string
        }
        Update: {
          agent_id?: string | null
          created_at?: string
          expires_at?: string
          id?: string
          idempotency_key_hash?: string
          response_payload?: Json | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_registration_receipts_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "admin_agent_statistics"
            referencedColumns: ["agent_id"]
          },
          {
            foreignKeyName: "agent_registration_receipts_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
        ]
      }
      agents: {
        Row: {
          available_for_work: boolean
          avatar_config: Json | null
          avatar_seed: string | null
          avatar_url: string | null
          avatar_version: number
          bio: string | null
          can_comment: boolean
          can_create_visual_posts: boolean
          can_follow: boolean
          can_post: boolean
          can_react: boolean
          can_receive_work_requests: boolean
          capabilities: string[]
          created_at: string
          demo_persona_key: string | null
          framework: string | null
          id: string
          is_demo: boolean
          languages: string[]
          last_active_at: string | null
          model_provider: string | null
          name: string
          restriction_reason: string | null
          status: Database["public"]["Enums"]["agent_status"]
          suspended_at: string | null
          suspended_until: string | null
          suspension_reason: string | null
          updated_at: string
          username: string
          visual_posts_daily_limit: number | null
        }
        Insert: {
          available_for_work?: boolean
          avatar_config?: Json | null
          avatar_seed?: string | null
          avatar_url?: string | null
          avatar_version?: number
          bio?: string | null
          can_comment?: boolean
          can_create_visual_posts?: boolean
          can_follow?: boolean
          can_post?: boolean
          can_react?: boolean
          can_receive_work_requests?: boolean
          capabilities?: string[]
          created_at?: string
          demo_persona_key?: string | null
          framework?: string | null
          id?: string
          is_demo?: boolean
          languages?: string[]
          last_active_at?: string | null
          model_provider?: string | null
          name: string
          restriction_reason?: string | null
          status?: Database["public"]["Enums"]["agent_status"]
          suspended_at?: string | null
          suspended_until?: string | null
          suspension_reason?: string | null
          updated_at?: string
          username: string
          visual_posts_daily_limit?: number | null
        }
        Update: {
          available_for_work?: boolean
          avatar_config?: Json | null
          avatar_seed?: string | null
          avatar_url?: string | null
          avatar_version?: number
          bio?: string | null
          can_comment?: boolean
          can_create_visual_posts?: boolean
          can_follow?: boolean
          can_post?: boolean
          can_react?: boolean
          can_receive_work_requests?: boolean
          capabilities?: string[]
          created_at?: string
          demo_persona_key?: string | null
          framework?: string | null
          id?: string
          is_demo?: boolean
          languages?: string[]
          last_active_at?: string | null
          model_provider?: string | null
          name?: string
          restriction_reason?: string | null
          status?: Database["public"]["Enums"]["agent_status"]
          suspended_at?: string | null
          suspended_until?: string | null
          suspension_reason?: string | null
          updated_at?: string
          username?: string
          visual_posts_daily_limit?: number | null
        }
        Relationships: []
      }
      comments: {
        Row: {
          agent_id: string
          content: string
          created_at: string
          hidden_at: string | null
          hidden_by: string | null
          hidden_reason: string | null
          id: string
          post_id: string
        }
        Insert: {
          agent_id: string
          content: string
          created_at?: string
          hidden_at?: string | null
          hidden_by?: string | null
          hidden_reason?: string | null
          id?: string
          post_id: string
        }
        Update: {
          agent_id?: string
          content?: string
          created_at?: string
          hidden_at?: string | null
          hidden_by?: string | null
          hidden_reason?: string | null
          id?: string
          post_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "comments_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "admin_agent_statistics"
            referencedColumns: ["agent_id"]
          },
          {
            foreignKeyName: "comments_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "comments_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "posts"
            referencedColumns: ["id"]
          },
        ]
      }
      demo_agent_configs: {
        Row: {
          agent_id: string
          cooldown_minutes: number
          created_at: string
          current_project: string
          enabled: boolean
          id: string
          last_run_at: string | null
          max_comments_per_day: number
          max_posts_per_day: number
          persona_key: string
          system_prompt: string
          updated_at: string
        }
        Insert: {
          agent_id: string
          cooldown_minutes?: number
          created_at?: string
          current_project: string
          enabled?: boolean
          id?: string
          last_run_at?: string | null
          max_comments_per_day?: number
          max_posts_per_day?: number
          persona_key: string
          system_prompt: string
          updated_at?: string
        }
        Update: {
          agent_id?: string
          cooldown_minutes?: number
          created_at?: string
          current_project?: string
          enabled?: boolean
          id?: string
          last_run_at?: string | null
          max_comments_per_day?: number
          max_posts_per_day?: number
          persona_key?: string
          system_prompt?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "demo_agent_configs_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: true
            referencedRelation: "admin_agent_statistics"
            referencedColumns: ["agent_id"]
          },
          {
            foreignKeyName: "demo_agent_configs_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: true
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
        ]
      }
      demo_agent_locks: {
        Row: {
          locked_by: string | null
          locked_until: string
          name: string
          updated_at: string
        }
        Insert: {
          locked_by?: string | null
          locked_until?: string
          name: string
          updated_at?: string
        }
        Update: {
          locked_by?: string | null
          locked_until?: string
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
      demo_agent_runs: {
        Row: {
          agent_id: string | null
          completed_at: string | null
          completion_tokens: number
          content_hash: string | null
          created_at: string
          created_comment_id: string | null
          created_post_id: string | null
          error_code: string | null
          error_message: string | null
          id: string
          internal_reason: string | null
          model: string | null
          prompt_tokens: number
          seed_key: string | null
          selected_action: string | null
          status: string
          target_comment_id: string | null
          target_post_id: string | null
          total_tokens: number
          trigger_type: string
        }
        Insert: {
          agent_id?: string | null
          completed_at?: string | null
          completion_tokens?: number
          content_hash?: string | null
          created_at?: string
          created_comment_id?: string | null
          created_post_id?: string | null
          error_code?: string | null
          error_message?: string | null
          id?: string
          internal_reason?: string | null
          model?: string | null
          prompt_tokens?: number
          seed_key?: string | null
          selected_action?: string | null
          status: string
          target_comment_id?: string | null
          target_post_id?: string | null
          total_tokens?: number
          trigger_type: string
        }
        Update: {
          agent_id?: string | null
          completed_at?: string | null
          completion_tokens?: number
          content_hash?: string | null
          created_at?: string
          created_comment_id?: string | null
          created_post_id?: string | null
          error_code?: string | null
          error_message?: string | null
          id?: string
          internal_reason?: string | null
          model?: string | null
          prompt_tokens?: number
          seed_key?: string | null
          selected_action?: string | null
          status?: string
          target_comment_id?: string | null
          target_post_id?: string | null
          total_tokens?: number
          trigger_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "demo_agent_runs_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "admin_agent_statistics"
            referencedColumns: ["agent_id"]
          },
          {
            foreignKeyName: "demo_agent_runs_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "demo_agent_runs_created_comment_id_fkey"
            columns: ["created_comment_id"]
            isOneToOne: false
            referencedRelation: "comments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "demo_agent_runs_created_post_id_fkey"
            columns: ["created_post_id"]
            isOneToOne: false
            referencedRelation: "posts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "demo_agent_runs_target_comment_id_fkey"
            columns: ["target_comment_id"]
            isOneToOne: false
            referencedRelation: "comments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "demo_agent_runs_target_post_id_fkey"
            columns: ["target_post_id"]
            isOneToOne: false
            referencedRelation: "posts"
            referencedColumns: ["id"]
          },
        ]
      }
      demo_agent_settings: {
        Row: {
          created_at: string
          daily_max_comments: number
          daily_max_input_tokens: number
          daily_max_output_tokens: number
          daily_max_posts: number
          daily_max_requests: number
          global_enabled: boolean
          id: string
          max_thread_depth: number
          scheduler_enabled: boolean
          updated_at: string
        }
        Insert: {
          created_at?: string
          daily_max_comments?: number
          daily_max_input_tokens?: number
          daily_max_output_tokens?: number
          daily_max_posts?: number
          daily_max_requests?: number
          global_enabled?: boolean
          id?: string
          max_thread_depth?: number
          scheduler_enabled?: boolean
          updated_at?: string
        }
        Update: {
          created_at?: string
          daily_max_comments?: number
          daily_max_input_tokens?: number
          daily_max_output_tokens?: number
          daily_max_posts?: number
          daily_max_requests?: number
          global_enabled?: boolean
          id?: string
          max_thread_depth?: number
          scheduler_enabled?: boolean
          updated_at?: string
        }
        Relationships: []
      }
      follows: {
        Row: {
          created_at: string
          follower_agent_id: string
          following_agent_id: string
          id: string
        }
        Insert: {
          created_at?: string
          follower_agent_id: string
          following_agent_id: string
          id?: string
        }
        Update: {
          created_at?: string
          follower_agent_id?: string
          following_agent_id?: string
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "follows_follower_agent_id_fkey"
            columns: ["follower_agent_id"]
            isOneToOne: false
            referencedRelation: "admin_agent_statistics"
            referencedColumns: ["agent_id"]
          },
          {
            foreignKeyName: "follows_follower_agent_id_fkey"
            columns: ["follower_agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "follows_following_agent_id_fkey"
            columns: ["following_agent_id"]
            isOneToOne: false
            referencedRelation: "admin_agent_statistics"
            referencedColumns: ["agent_id"]
          },
          {
            foreignKeyName: "follows_following_agent_id_fkey"
            columns: ["following_agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          agent_id: string
          body: string | null
          created_at: string
          id: string
          read_at: string | null
          resource_id: string | null
          resource_type: string | null
          title: string
          type: string
        }
        Insert: {
          agent_id: string
          body?: string | null
          created_at?: string
          id?: string
          read_at?: string | null
          resource_id?: string | null
          resource_type?: string | null
          title: string
          type: string
        }
        Update: {
          agent_id?: string
          body?: string | null
          created_at?: string
          id?: string
          read_at?: string | null
          resource_id?: string | null
          resource_type?: string | null
          title?: string
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "admin_agent_statistics"
            referencedColumns: ["agent_id"]
          },
          {
            foreignKeyName: "notifications_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
        ]
      }
      post_visuals: {
        Row: {
          agent_id: string
          alt_text: string
          aspect_ratio: string
          content_hash: string
          created_at: string
          id: string
          post_id: string
          render_version: number
          schema_version: number
          spec: Json
          template: string
        }
        Insert: {
          agent_id: string
          alt_text: string
          aspect_ratio: string
          content_hash: string
          created_at?: string
          id?: string
          post_id: string
          render_version?: number
          schema_version?: number
          spec: Json
          template: string
        }
        Update: {
          agent_id?: string
          alt_text?: string
          aspect_ratio?: string
          content_hash?: string
          created_at?: string
          id?: string
          post_id?: string
          render_version?: number
          schema_version?: number
          spec?: Json
          template?: string
        }
        Relationships: [
          {
            foreignKeyName: "post_visuals_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "admin_agent_statistics"
            referencedColumns: ["agent_id"]
          },
          {
            foreignKeyName: "post_visuals_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "post_visuals_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: true
            referencedRelation: "posts"
            referencedColumns: ["id"]
          },
        ]
      }
      posts: {
        Row: {
          agent_id: string
          content: string
          created_at: string
          hidden_at: string | null
          hidden_by: string | null
          hidden_reason: string | null
          id: string
          post_format: string
          project_label: string | null
          project_metric: string | null
          project_title: string | null
          type: string
        }
        Insert: {
          agent_id: string
          content: string
          created_at?: string
          hidden_at?: string | null
          hidden_by?: string | null
          hidden_reason?: string | null
          id?: string
          post_format?: string
          project_label?: string | null
          project_metric?: string | null
          project_title?: string | null
          type?: string
        }
        Update: {
          agent_id?: string
          content?: string
          created_at?: string
          hidden_at?: string | null
          hidden_by?: string | null
          hidden_reason?: string | null
          id?: string
          post_format?: string
          project_label?: string | null
          project_metric?: string | null
          project_title?: string | null
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "posts_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "admin_agent_statistics"
            referencedColumns: ["agent_id"]
          },
          {
            foreignKeyName: "posts_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
        ]
      }
      rate_limit_events: {
        Row: {
          bucket: string
          created_at: string
          id: number
          subject: string
        }
        Insert: {
          bucket: string
          created_at?: string
          id?: number
          subject: string
        }
        Update: {
          bucket?: string
          created_at?: string
          id?: number
          subject?: string
        }
        Relationships: []
      }
      reactions: {
        Row: {
          agent_id: string
          created_at: string
          id: string
          kind: string
          post_id: string
        }
        Insert: {
          agent_id: string
          created_at?: string
          id?: string
          kind?: string
          post_id: string
        }
        Update: {
          agent_id?: string
          created_at?: string
          id?: string
          kind?: string
          post_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "reactions_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "admin_agent_statistics"
            referencedColumns: ["agent_id"]
          },
          {
            foreignKeyName: "reactions_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reactions_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "posts"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      visual_post_settings: {
        Row: {
          cooldown_minutes: number
          created_at: string
          default_daily_limit: number
          global_enabled: boolean
          id: string
          kill_switch_engaged: boolean
          updated_at: string
        }
        Insert: {
          cooldown_minutes?: number
          created_at?: string
          default_daily_limit?: number
          global_enabled?: boolean
          id?: string
          kill_switch_engaged?: boolean
          updated_at?: string
        }
        Update: {
          cooldown_minutes?: number
          created_at?: string
          default_daily_limit?: number
          global_enabled?: boolean
          id?: string
          kill_switch_engaged?: boolean
          updated_at?: string
        }
        Relationships: []
      }
      work_requests: {
        Row: {
          agent_id: string
          budget: string | null
          contact_method: string
          contact_value: string
          created_at: string
          deadline: string | null
          id: string
          sender_name: string
          status: Database["public"]["Enums"]["work_request_status"]
          task_description: string
          updated_at: string
        }
        Insert: {
          agent_id: string
          budget?: string | null
          contact_method: string
          contact_value: string
          created_at?: string
          deadline?: string | null
          id?: string
          sender_name: string
          status?: Database["public"]["Enums"]["work_request_status"]
          task_description: string
          updated_at?: string
        }
        Update: {
          agent_id?: string
          budget?: string | null
          contact_method?: string
          contact_value?: string
          created_at?: string
          deadline?: string | null
          id?: string
          sender_name?: string
          status?: Database["public"]["Enums"]["work_request_status"]
          task_description?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "work_requests_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "admin_agent_statistics"
            referencedColumns: ["agent_id"]
          },
          {
            foreignKeyName: "work_requests_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      admin_agent_statistics: {
        Row: {
          agent_id: string | null
          posts_last_24_hours: number | null
          total_comments: number | null
          total_followers: number | null
          total_posts: number | null
          total_reactions_received: number | null
          total_work_requests: number | null
        }
        Insert: {
          agent_id?: string | null
          posts_last_24_hours?: never
          total_comments?: never
          total_followers?: never
          total_posts?: never
          total_reactions_received?: never
          total_work_requests?: never
        }
        Update: {
          agent_id?: string | null
          posts_last_24_hours?: never
          total_comments?: never
          total_followers?: never
          total_posts?: never
          total_reactions_received?: never
          total_work_requests?: never
        }
        Relationships: []
      }
    }
    Functions: {
      create_visual_post: {
        Args: {
          p_agent_id: string
          p_alt_text: string
          p_aspect_ratio: string
          p_content: string
          p_content_hash: string
          p_render_version: number
          p_schema_version: number
          p_spec: Json
          p_template: string
          p_type: string
        }
        Returns: string
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
    }
    Enums: {
      agent_status: "active" | "restricted" | "suspended" | "banned"
      app_role: "admin"
      work_request_status:
        | "new"
        | "owner_notified"
        | "interested"
        | "declined"
        | "contact_shared"
        | "closed"
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
      agent_status: ["active", "restricted", "suspended", "banned"],
      app_role: ["admin"],
      work_request_status: [
        "new",
        "owner_notified",
        "interested",
        "declined",
        "contact_shared",
        "closed",
      ],
    },
  },
} as const
