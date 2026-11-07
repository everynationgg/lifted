-- LIFTED Master Roadmap Phase 6: Core PostgreSQL Schema
-- Migration: 20261101000001_core_schema.sql
-- Description: Creates core domains: profiles, user_roles, encrypted private records,
-- community testimonies, and content catalogs.

-- Ensure UUID extension and private security schema are available
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE SCHEMA IF NOT EXISTS app_security;

--------------------------------------------------------------------------------
-- 1. ENUMS
--------------------------------------------------------------------------------
DO $$ BEGIN
    CREATE TYPE public.app_role AS ENUM ('admin', 'moderator', 'member');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE public.moderation_status AS ENUM ('pending', 'approved', 'rejected', 'archived');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE public.prayer_status_type AS ENUM ('active', 'answered', 'archived');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE public.platform_type AS ENUM ('android', 'ios', 'web');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

--------------------------------------------------------------------------------
-- 2. USER PROFILES
--------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    display_name TEXT,
    avatar_url TEXT,
    timezone TEXT NOT NULL DEFAULT 'UTC',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_profiles_display_name ON public.profiles(display_name);

--------------------------------------------------------------------------------
-- 3. USER ROLES (Server-Controlled RBAC)
--------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.user_roles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    role public.app_role NOT NULL DEFAULT 'member',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by UUID REFERENCES auth.users(id),
    CONSTRAINT user_roles_user_id_role_key UNIQUE (user_id, role)
);

CREATE INDEX IF NOT EXISTS idx_user_roles_user_id ON public.user_roles(user_id);
CREATE INDEX IF NOT EXISTS idx_user_roles_role ON public.user_roles(role);

--------------------------------------------------------------------------------
-- 4. PRIVATE JOURNALS (Encrypted Envelope Only)
-- Note: Contains NO plaintext reflection text. Encrypted on-device prior to storage.
--------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.private_journals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    client_record_id TEXT NOT NULL,
    -- Encrypted envelope JSONB: { "v": 1, "iv": "...", "ciphertext": "...", "tag": "...", "kid": "..." }
    encrypted_envelope JSONB NOT NULL,
    schema_version INTEGER NOT NULL DEFAULT 1,
    sync_revision BIGINT NOT NULL DEFAULT 1,
    idempotency_key TEXT,
    client_updated_at BIGINT NOT NULL,
    is_deleted BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT private_journals_user_client_id_key UNIQUE (user_id, client_record_id)
);

CREATE INDEX IF NOT EXISTS idx_private_journals_user_updated ON public.private_journals(user_id, client_updated_at);
CREATE INDEX IF NOT EXISTS idx_private_journals_sync ON public.private_journals(user_id, sync_revision);

--------------------------------------------------------------------------------
-- 5. MOOD CHECK-INS
--------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.mood_checkins (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    client_record_id TEXT NOT NULL,
    mood_score INTEGER NOT NULL CHECK (mood_score BETWEEN 1 AND 5),
    selected_emotions TEXT[] NOT NULL DEFAULT '{}',
    encrypted_note JSONB,
    schema_version INTEGER NOT NULL DEFAULT 1,
    sync_revision BIGINT NOT NULL DEFAULT 1,
    idempotency_key TEXT,
    checkin_timestamp BIGINT NOT NULL,
    is_deleted BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT mood_checkins_user_client_id_key UNIQUE (user_id, client_record_id)
);

CREATE INDEX IF NOT EXISTS idx_mood_checkins_user_timestamp ON public.mood_checkins(user_id, checkin_timestamp);

--------------------------------------------------------------------------------
-- 6. PRAYER REQUESTS
--------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.prayer_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    client_record_id TEXT NOT NULL,
    is_private BOOLEAN NOT NULL DEFAULT true,
    encrypted_payload JSONB NOT NULL,
    prayer_status public.prayer_status_type NOT NULL DEFAULT 'active',
    followup_due_at TIMESTAMPTZ,
    followup_completed_at TIMESTAMPTZ,
    schema_version INTEGER NOT NULL DEFAULT 1,
    sync_revision BIGINT NOT NULL DEFAULT 1,
    idempotency_key TEXT,
    client_updated_at BIGINT NOT NULL,
    is_deleted BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT prayer_requests_user_client_id_key UNIQUE (user_id, client_record_id)
);

CREATE INDEX IF NOT EXISTS idx_prayer_requests_user_status ON public.prayer_requests(user_id, prayer_status);

--------------------------------------------------------------------------------
-- 7. COMMUNITY TESTIMONIES (Moderated Content)
--------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.community_testimonies (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    author_name TEXT NOT NULL CHECK (char_length(trim(author_name)) >= 2 AND char_length(author_name) <= 100),
    title TEXT NOT NULL CHECK (char_length(trim(title)) >= 3 AND char_length(title) <= 200),
    testimony_text TEXT NOT NULL CHECK (char_length(trim(testimony_text)) >= 20 AND char_length(testimony_text) <= 10000),
    category TEXT NOT NULL DEFAULT 'healing',
    status public.moderation_status NOT NULL DEFAULT 'pending',
    is_featured BOOLEAN NOT NULL DEFAULT false,
    reviewed_by UUID REFERENCES auth.users(id),
    reviewed_at TIMESTAMPTZ,
    moderation_note TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_community_testimonies_status_published ON public.community_testimonies(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_community_testimonies_user ON public.community_testimonies(user_id);

--------------------------------------------------------------------------------
-- 8. CONTENT CATALOGS (Read-Heavy, Staff-Curated)
--------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.devotional_catalog (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title TEXT NOT NULL,
    scripture_reference TEXT NOT NULL,
    scripture_text TEXT NOT NULL,
    reflection TEXT NOT NULL,
    prayer TEXT NOT NULL,
    day_number INTEGER,
    category TEXT NOT NULL DEFAULT 'daily',
    audio_url TEXT,
    is_published BOOLEAN NOT NULL DEFAULT false,
    published_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_devotional_published ON public.devotional_catalog(is_published, day_number);

CREATE TABLE IF NOT EXISTS public.article_catalog (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title TEXT NOT NULL,
    summary TEXT NOT NULL,
    content TEXT NOT NULL,
    category TEXT NOT NULL,
    read_time_minutes INTEGER NOT NULL DEFAULT 3,
    is_published BOOLEAN NOT NULL DEFAULT false,
    published_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_article_published ON public.article_catalog(is_published, category);

CREATE TABLE IF NOT EXISTS public.video_catalog (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    video_url TEXT NOT NULL,
    thumbnail_url TEXT,
    duration_seconds INTEGER,
    category TEXT NOT NULL,
    is_published BOOLEAN NOT NULL DEFAULT false,
    published_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_video_published ON public.video_catalog(is_published, category);

--------------------------------------------------------------------------------
-- 9. SYNC METADATA (Device Registration & Future Sync State)
--------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.sync_metadata (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    device_id TEXT NOT NULL,
    device_platform public.platform_type NOT NULL,
    last_synced_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    client_app_version TEXT NOT NULL,
    schema_version INTEGER NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT sync_metadata_user_device_key UNIQUE (user_id, device_id)
);

CREATE INDEX IF NOT EXISTS idx_sync_metadata_user ON public.sync_metadata(user_id);
