/**
 * LIFTED Cloud Database TypeScript Definitions
 * Phase 6: Supabase PostgreSQL Schema Contracts
 *
 * Generated to match migrations in supabase/migrations/
 */

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type AppRole = 'admin' | 'moderator' | 'editor' | 'member';
export type ModerationStatus = 'pending' | 'approved' | 'rejected' | 'archived';
export type ContentStatus = 'draft' | 'in_review' | 'approved' | 'published' | 'archived';
export type PrayerStatusType = 'active' | 'answered' | 'archived';
export type PlatformType = 'android' | 'ios' | 'web';
export type OrderStatus = 'pending' | 'processing' | 'succeeded' | 'failed' | 'cancelled' | 'refunded' | 'expired';
export type PaymentProviderType = 'synthetic' | 'stripe_web' | 'apple_iap' | 'google_play';
export type ProductType = 'workbook' | 'audio_series' | 'curated_bundle';
export type EntitlementStatus = 'active' | 'revoked' | 'refunded' | 'expired';

export interface EncryptedEnvelopePayload {
  v: number;
  iv: string;
  ciphertext: string;
  tag?: string;
  kid?: string;
  algorithm?: string;
}

export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string;
          display_name: string | null;
          avatar_url: string | null;
          timezone: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          display_name?: string | null;
          avatar_url?: string | null;
          timezone?: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          display_name?: string | null;
          avatar_url?: string | null;
          timezone?: string;
          created_at?: string;
          updated_at?: string;
        };
      };
      user_roles: {
        Row: {
          id: string;
          user_id: string;
          role: AppRole;
          created_at: string;
          created_by: string | null;
        };
        Insert: {
          id?: string;
          user_id: string;
          role?: AppRole;
          created_at?: string;
          created_by?: string | null;
        };
        Update: {
          id?: string;
          user_id?: string;
          role?: AppRole;
          created_at?: string;
          created_by?: string | null;
        };
      };
      private_journals: {
        Row: {
          id: string;
          user_id: string;
          client_record_id: string;
          encrypted_envelope: Json;
          schema_version: number;
          sync_revision: number;
          idempotency_key: string | null;
          client_updated_at: number;
          is_deleted: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          client_record_id: string;
          encrypted_envelope: Json;
          schema_version?: number;
          sync_revision?: number;
          idempotency_key?: string | null;
          client_updated_at: number;
          is_deleted?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          client_record_id?: string;
          encrypted_envelope?: Json;
          schema_version?: number;
          sync_revision?: number;
          idempotency_key?: string | null;
          client_updated_at?: number;
          is_deleted?: boolean;
          created_at?: string;
          updated_at?: string;
        };
      };
      mood_checkins: {
        Row: {
          id: string;
          user_id: string;
          client_record_id: string;
          mood_score: number;
          selected_emotions: string[];
          encrypted_note: Json | null;
          schema_version: number;
          sync_revision: number;
          idempotency_key: string | null;
          checkin_timestamp: number;
          is_deleted: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          client_record_id: string;
          mood_score: number;
          selected_emotions?: string[];
          encrypted_note?: Json | null;
          schema_version?: number;
          sync_revision?: number;
          idempotency_key?: string | null;
          checkin_timestamp: number;
          is_deleted?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          client_record_id?: string;
          mood_score?: number;
          selected_emotions?: string[];
          encrypted_note?: Json | null;
          schema_version?: number;
          sync_revision?: number;
          idempotency_key?: string | null;
          checkin_timestamp?: number;
          is_deleted?: boolean;
          created_at?: string;
          updated_at?: string;
        };
      };
      prayer_requests: {
        Row: {
          id: string;
          user_id: string;
          client_record_id: string;
          is_private: boolean;
          encrypted_payload: Json;
          prayer_status: PrayerStatusType;
          followup_due_at: string | null;
          followup_completed_at: string | null;
          schema_version: number;
          sync_revision: number;
          idempotency_key: string | null;
          client_updated_at: number;
          is_deleted: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          client_record_id: string;
          is_private?: boolean;
          encrypted_payload: Json;
          prayer_status?: PrayerStatusType;
          followup_due_at?: string | null;
          followup_completed_at?: string | null;
          schema_version?: number;
          sync_revision?: number;
          idempotency_key?: string | null;
          client_updated_at: number;
          is_deleted?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          client_record_id?: string;
          is_private?: boolean;
          encrypted_payload?: Json;
          prayer_status?: PrayerStatusType;
          followup_due_at?: string | null;
          followup_completed_at?: string | null;
          schema_version?: number;
          sync_revision?: number;
          idempotency_key?: string | null;
          client_updated_at?: number;
          is_deleted?: boolean;
          created_at?: string;
          updated_at?: string;
        };
      };
      community_testimonies: {
        Row: {
          id: string;
          user_id: string;
          author_name: string;
          title: string;
          testimony_text: string;
          category: string;
          status: ModerationStatus;
          is_featured: boolean;
          reviewed_by: string | null;
          reviewed_at: string | null;
          moderation_note: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          author_name: string;
          title: string;
          testimony_text: string;
          category?: string;
          status?: ModerationStatus;
          is_featured?: boolean;
          reviewed_by?: string | null;
          reviewed_at?: string | null;
          moderation_note?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          author_name?: string;
          title?: string;
          testimony_text?: string;
          category?: string;
          status?: ModerationStatus;
          is_featured?: boolean;
          reviewed_by?: string | null;
          reviewed_at?: string | null;
          moderation_note?: string | null;
          created_at?: string;
          updated_at?: string;
        };
      };
      devotional_catalog: {
        Row: {
          id: string;
          content_id: string;
          version: number;
          language: string;
          title: string;
          scripture_reference: string;
          scripture_text: string;
          reflection: string;
          prayer: string;
          day_number: number | null;
          category: string;
          topics: string[];
          tags: string[];
          content_status: ContentStatus;
          audio_url: string | null;
          author_name: string | null;
          editor_name: string | null;
          reviewer_name: string | null;
          reviewed_at: string | null;
          source_name: string | null;
          copyright_owner: string | null;
          license_type: string;
          attribution_text: string | null;
          last_reviewed_at: string | null;
          is_published: boolean;
          published_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          content_id?: string;
          version?: number;
          language?: string;
          title: string;
          scripture_reference: string;
          scripture_text: string;
          reflection: string;
          prayer: string;
          day_number?: number | null;
          category?: string;
          topics?: string[];
          tags?: string[];
          content_status?: ContentStatus;
          audio_url?: string | null;
          author_name?: string | null;
          editor_name?: string | null;
          reviewer_name?: string | null;
          reviewed_at?: string | null;
          source_name?: string | null;
          copyright_owner?: string | null;
          license_type?: string;
          attribution_text?: string | null;
          last_reviewed_at?: string | null;
          is_published?: boolean;
          published_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          content_id?: string;
          version?: number;
          language?: string;
          title?: string;
          scripture_reference?: string;
          scripture_text?: string;
          reflection?: string;
          prayer?: string;
          day_number?: number | null;
          category?: string;
          topics?: string[];
          tags?: string[];
          content_status?: ContentStatus;
          audio_url?: string | null;
          author_name?: string | null;
          editor_name?: string | null;
          reviewer_name?: string | null;
          reviewed_at?: string | null;
          source_name?: string | null;
          copyright_owner?: string | null;
          license_type?: string;
          attribution_text?: string | null;
          last_reviewed_at?: string | null;
          is_published?: boolean;
          published_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
      };
      article_catalog: {
        Row: {
          id: string;
          content_id: string;
          version: number;
          language: string;
          title: string;
          subtitle: string | null;
          summary: string;
          content: string;
          category: string;
          topics: string[];
          tags: string[];
          content_status: ContentStatus;
          read_time_minutes: number;
          author_name: string | null;
          author_credentials: string | null;
          editor_name: string | null;
          reviewer_name: string | null;
          reviewed_at: string | null;
          source_name: string | null;
          copyright_owner: string | null;
          license_type: string;
          attribution_text: string | null;
          last_reviewed_at: string | null;
          practical_exercise: Json | null;
          is_published: boolean;
          published_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          content_id?: string;
          version?: number;
          language?: string;
          title: string;
          subtitle?: string | null;
          summary: string;
          content: string;
          category: string;
          topics?: string[];
          tags?: string[];
          content_status?: ContentStatus;
          read_time_minutes?: number;
          author_name?: string | null;
          author_credentials?: string | null;
          editor_name?: string | null;
          reviewer_name?: string | null;
          reviewed_at?: string | null;
          source_name?: string | null;
          copyright_owner?: string | null;
          license_type?: string;
          attribution_text?: string | null;
          last_reviewed_at?: string | null;
          practical_exercise?: Json | null;
          is_published?: boolean;
          published_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          content_id?: string;
          version?: number;
          language?: string;
          title?: string;
          subtitle?: string | null;
          summary?: string;
          content?: string;
          category?: string;
          topics?: string[];
          tags?: string[];
          content_status?: ContentStatus;
          read_time_minutes?: number;
          author_name?: string | null;
          author_credentials?: string | null;
          editor_name?: string | null;
          reviewer_name?: string | null;
          reviewed_at?: string | null;
          source_name?: string | null;
          copyright_owner?: string | null;
          license_type?: string;
          attribution_text?: string | null;
          last_reviewed_at?: string | null;
          practical_exercise?: Json | null;
          is_published?: boolean;
          published_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
      };
      video_catalog: {
        Row: {
          id: string;
          content_id: string;
          version: number;
          language: string;
          title: string;
          description: string;
          video_url: string;
          thumbnail_url: string | null;
          duration_seconds: number | null;
          category: string;
          topics: string[];
          tags: string[];
          content_status: ContentStatus;
          creator: string | null;
          author_name: string | null;
          editor_name: string | null;
          reviewer_name: string | null;
          reviewed_at: string | null;
          source_name: string | null;
          copyright_owner: string | null;
          license_type: string;
          attribution_text: string | null;
          last_reviewed_at: string | null;
          views_count: number;
          likes_count: number;
          is_published: boolean;
          published_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          content_id?: string;
          version?: number;
          language?: string;
          title: string;
          description: string;
          video_url: string;
          thumbnail_url?: string | null;
          duration_seconds?: number | null;
          category?: string;
          topics?: string[];
          tags?: string[];
          content_status?: ContentStatus;
          creator?: string | null;
          author_name?: string | null;
          editor_name?: string | null;
          reviewer_name?: string | null;
          reviewed_at?: string | null;
          source_name?: string | null;
          copyright_owner?: string | null;
          license_type?: string;
          attribution_text?: string | null;
          last_reviewed_at?: string | null;
          views_count?: number;
          likes_count?: number;
          is_published?: boolean;
          published_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          content_id?: string;
          version?: number;
          language?: string;
          title?: string;
          description?: string;
          video_url?: string;
          thumbnail_url?: string | null;
          duration_seconds?: number | null;
          category?: string;
          topics?: string[];
          tags?: string[];
          content_status?: ContentStatus;
          creator?: string | null;
          author_name?: string | null;
          editor_name?: string | null;
          reviewer_name?: string | null;
          reviewed_at?: string | null;
          source_name?: string | null;
          copyright_owner?: string | null;
          license_type?: string;
          attribution_text?: string | null;
          last_reviewed_at?: string | null;
          views_count?: number;
          likes_count?: number;
          is_published?: boolean;
          published_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
      };
      content_revisions: {
        Row: {
          id: string;
          content_table: string;
          content_id: string;
          version: number;
          status: ContentStatus;
          content_snapshot: Json;
          change_summary: string | null;
          created_by: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          content_table: string;
          content_id: string;
          version: number;
          status: ContentStatus;
          content_snapshot: Json;
          change_summary?: string | null;
          created_by: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          content_table?: string;
          content_id?: string;
          version?: number;
          status?: ContentStatus;
          content_snapshot?: Json;
          change_summary?: string | null;
          created_by?: string;
          created_at?: string;
        };
      };
      sync_metadata: {
        Row: {
          id: string;
          user_id: string;
          device_id: string;
          device_platform: PlatformType;
          last_synced_at: string;
          client_app_version: string;
          schema_version: number;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          device_id: string;
          device_platform: PlatformType;
          last_synced_at?: string;
          client_app_version: string;
          schema_version?: number;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          device_id?: string;
          device_platform?: PlatformType;
          last_synced_at?: string;
          client_app_version?: string;
          schema_version?: number;
          created_at?: string;
          updated_at?: string;
        };
      };
      digital_products: {
        Row: {
          id: string;
          product_code: string;
          title: string;
          subtitle: string | null;
          description: string;
          product_type: ProductType;
          version: string;
          author_name: string;
          cover_image_url: string | null;
          file_path: string;
          file_size_bytes: number;
          checksum_sha256: string;
          is_active: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          product_code: string;
          title: string;
          subtitle?: string | null;
          description: string;
          product_type?: ProductType;
          version?: string;
          author_name?: string;
          cover_image_url?: string | null;
          file_path: string;
          file_size_bytes?: number;
          checksum_sha256: string;
          is_active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          product_code?: string;
          title?: string;
          subtitle?: string | null;
          description?: string;
          product_type?: ProductType;
          version?: string;
          author_name?: string;
          cover_image_url?: string | null;
          file_path?: string;
          file_size_bytes?: number;
          checksum_sha256?: string;
          is_active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
      };
      product_pricing: {
        Row: {
          id: string;
          product_id: string;
          currency: string;
          amount_cents: number;
          is_active: boolean;
          created_at: string;
        };
        Insert: {
          id?: string;
          product_id: string;
          currency?: string;
          amount_cents: number;
          is_active?: boolean;
          created_at?: string;
        };
        Update: {
          id?: string;
          product_id?: string;
          currency?: string;
          amount_cents?: number;
          is_active?: boolean;
          created_at?: string;
        };
      };
      orders: {
        Row: {
          id: string;
          user_id: string;
          order_number: string;
          product_id: string;
          currency: string;
          amount_cents: number;
          status: OrderStatus;
          provider: PaymentProviderType;
          provider_session_id: string | null;
          provider_payment_id: string | null;
          idempotency_key: string | null;
          metadata: Json;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          order_number: string;
          product_id: string;
          currency: string;
          amount_cents: number;
          status?: OrderStatus;
          provider?: PaymentProviderType;
          provider_session_id?: string | null;
          provider_payment_id?: string | null;
          idempotency_key?: string | null;
          metadata?: Json;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          order_number?: string;
          product_id?: string;
          currency?: string;
          amount_cents?: number;
          status?: OrderStatus;
          provider?: PaymentProviderType;
          provider_session_id?: string | null;
          provider_payment_id?: string | null;
          idempotency_key?: string | null;
          metadata?: Json;
          created_at?: string;
          updated_at?: string;
        };
      };
      purchase_entitlements: {
        Row: {
          id: string;
          user_id: string;
          product_id: string;
          order_id: string | null;
          status: EntitlementStatus;
          granted_at: string;
          expires_at: string | null;
          revoked_at: string | null;
          revocation_reason: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          product_id: string;
          order_id?: string | null;
          status?: EntitlementStatus;
          granted_at?: string;
          expires_at?: string | null;
          revoked_at?: string | null;
          revocation_reason?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          product_id?: string;
          order_id?: string | null;
          status?: EntitlementStatus;
          granted_at?: string;
          expires_at?: string | null;
          revoked_at?: string | null;
          revocation_reason?: string | null;
          created_at?: string;
          updated_at?: string;
        };
      };
      payment_events: {
        Row: {
          id: string;
          provider: PaymentProviderType;
          event_id: string;
          event_type: string;
          payload: Json;
          processed_at: string;
        };
        Insert: {
          id?: string;
          provider: PaymentProviderType;
          event_id: string;
          event_type: string;
          payload: Json;
          processed_at?: string;
        };
        Update: {
          id?: string;
          provider?: PaymentProviderType;
          event_id?: string;
          event_type?: string;
          payload?: Json;
          processed_at?: string;
        };
      };
      digital_download_tokens: {
        Row: {
          id: string;
          user_id: string;
          product_id: string;
          token: string;
          file_path: string;
          file_size_bytes: number;
          checksum_sha256: string;
          expires_at: string;
          used_at: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          product_id: string;
          token: string;
          file_path: string;
          file_size_bytes?: number;
          checksum_sha256: string;
          expires_at: string;
          used_at?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          product_id?: string;
          token?: string;
          file_path?: string;
          file_size_bytes?: number;
          checksum_sha256?: string;
          expires_at?: string;
          used_at?: string | null;
          created_at?: string;
        };
      };
      donations: {
        Row: {
          id: string;
          user_id: string | null;
          donation_number: string;
          donor_email: string | null;
          donor_name: string | null;
          amount_cents: number;
          currency: string;
          frequency: string;
          designation: string;
          status: OrderStatus;
          provider: PaymentProviderType;
          provider_transaction_id: string | null;
          receipt_url: string | null;
          metadata: Json;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id?: string | null;
          donation_number: string;
          donor_email?: string | null;
          donor_name?: string | null;
          amount_cents: number;
          currency?: string;
          frequency?: string;
          designation?: string;
          status?: OrderStatus;
          provider?: PaymentProviderType;
          provider_transaction_id?: string | null;
          receipt_url?: string | null;
          metadata?: Json;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string | null;
          donation_number?: string;
          donor_email?: string | null;
          donor_name?: string | null;
          amount_cents?: number;
          currency?: string;
          frequency?: string;
          designation?: string;
          status?: OrderStatus;
          provider?: PaymentProviderType;
          provider_transaction_id?: string | null;
          receipt_url?: string | null;
          metadata?: Json;
          created_at?: string;
          updated_at?: string;
        };
      };
    };
    Functions: {
      check_is_admin: {
        Args: Record<PropertyKey, never>;
        Returns: boolean;
      };
      is_staff: {
        Args: Record<PropertyKey, never>;
        Returns: boolean;
      };
      has_role: {
        Args: {
          required_role: AppRole;
        };
        Returns: boolean;
      };
      record_user_ai_consent: {
        Args: {
          p_version: string;
        };
        Returns: boolean;
      };
      revoke_user_ai_consent: {
        Args: Record<PropertyKey, never>;
        Returns: boolean;
      };
      cms_create_draft: {
        Args: {
          p_table: string;
          p_payload: Json;
        };
        Returns: Json;
      };
      cms_submit_for_review: {
        Args: {
          p_table: string;
          p_id: string;
          p_change_summary?: string;
        };
        Returns: Json;
      };
      cms_approve_content: {
        Args: {
          p_table: string;
          p_id: string;
          p_notes?: string;
        };
        Returns: Json;
      };
      cms_publish_content: {
        Args: {
          p_table: string;
          p_id: string;
        };
        Returns: Json;
      };
      cms_unpublish_content: {
        Args: {
          p_table: string;
          p_id: string;
          p_archive?: boolean;
        };
        Returns: Json;
      };
      cms_create_new_revision: {
        Args: {
          p_table: string;
          p_id: string;
          p_changes: Json;
          p_change_summary?: string;
        };
        Returns: Json;
      };
      store_create_order: {
        Args: {
          p_product_code: string;
          p_currency?: string;
          p_idempotency_key?: string | null;
        };
        Returns: Json;
      };
      store_process_synthetic_checkout: {
        Args: {
          p_order_id: string;
          p_simulated_outcome?: string;
          p_signature?: string | null;
        };
        Returns: Json;
      };
      store_process_synthetic_donation: {
        Args: {
          p_amount_cents: number;
          p_currency?: string;
          p_frequency?: string;
          p_designation?: string;
          p_donor_email?: string | null;
          p_donor_name?: string | null;
          p_simulated_outcome?: string;
          p_signature?: string | null;
        };
        Returns: Json;
      };
      store_generate_download_token: {
        Args: {
          p_product_id: string;
        };
        Returns: Json;
      };
      store_verify_download_token: {
        Args: {
          p_token: string;
        };
        Returns: Json;
      };
      store_refund_order: {
        Args: {
          p_order_id: string;
          p_reason?: string;
        };
        Returns: Json;
      };
      store_restore_entitlements: {
        Args: Record<PropertyKey, never>;
        Returns: Array<{
          product_id: string;
          product_code: string;
          title: string;
          version: string;
          status: EntitlementStatus;
          granted_at: string;
        }>;
      };
    };
  };
}
