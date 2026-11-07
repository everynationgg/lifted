-- ============================================================================
-- LIFTED — Migration 14: Generosity, Digital Workbooks, Entitlements & Store
-- Phase 11: Sandbox & Synthetic Transactions Only
-- ============================================================================

-- 1. ENUMS
DO $$ BEGIN
    CREATE TYPE public.order_status AS ENUM (
        'pending',
        'processing',
        'succeeded',
        'failed',
        'cancelled',
        'refunded',
        'expired'
    );
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE public.payment_provider_type AS ENUM (
        'synthetic',
        'stripe_web',
        'apple_iap',
        'google_play'
    );
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE public.product_type AS ENUM (
        'workbook',
        'audio_series',
        'curated_bundle'
    );
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE public.entitlement_status AS ENUM (
        'active',
        'revoked',
        'refunded',
        'expired'
    );
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- 2. DIGITAL PRODUCTS CATALOG
CREATE TABLE IF NOT EXISTS public.digital_products (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    product_code TEXT UNIQUE NOT NULL,
    title TEXT NOT NULL,
    subtitle TEXT,
    description TEXT NOT NULL,
    product_type public.product_type NOT NULL DEFAULT 'workbook',
    version TEXT NOT NULL DEFAULT '1.0.0',
    author_name TEXT NOT NULL DEFAULT 'LIFTED Clinical & Pastoral Care',
    cover_image_url TEXT,
    file_path TEXT NOT NULL, -- Internal secure storage key (never publicly served)
    file_size_bytes BIGINT NOT NULL DEFAULT 0,
    checksum_sha256 TEXT NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now()
);

CREATE INDEX IF NOT EXISTS idx_digital_products_active
    ON public.digital_products(is_active, product_code);

-- 3. PRODUCT PRICING CONFIGURATIONS
CREATE TABLE IF NOT EXISTS public.product_pricing (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    product_id UUID NOT NULL REFERENCES public.digital_products(id) ON DELETE CASCADE,
    currency VARCHAR(3) NOT NULL DEFAULT 'USD',
    amount_cents INTEGER NOT NULL CHECK (amount_cents >= 0),
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now(),
    CONSTRAINT uq_product_currency UNIQUE(product_id, currency)
);

CREATE INDEX IF NOT EXISTS idx_product_pricing_lookup
    ON public.product_pricing(product_id, currency, is_active);

-- 4. ORDERS (Authoritative Server-Maintained Records)
CREATE TABLE IF NOT EXISTS public.orders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    order_number TEXT UNIQUE NOT NULL,
    product_id UUID NOT NULL REFERENCES public.digital_products(id),
    currency VARCHAR(3) NOT NULL,
    amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
    status public.order_status NOT NULL DEFAULT 'pending',
    provider public.payment_provider_type NOT NULL DEFAULT 'synthetic',
    provider_session_id TEXT,
    provider_payment_id TEXT,
    idempotency_key TEXT UNIQUE,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now()
);

CREATE INDEX IF NOT EXISTS idx_orders_user_status
    ON public.orders(user_id, status, created_at DESC);

-- 5. PURCHASE ENTITLEMENTS (Separated from Orders, Enforcing Perpetual Ownership)
CREATE TABLE IF NOT EXISTS public.purchase_entitlements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    product_id UUID NOT NULL REFERENCES public.digital_products(id) ON DELETE CASCADE,
    order_id UUID REFERENCES public.orders(id) ON DELETE SET NULL,
    status public.entitlement_status NOT NULL DEFAULT 'active',
    granted_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now(),
    expires_at TIMESTAMPTZ, -- NULL for perpetual licenses
    revoked_at TIMESTAMPTZ,
    revocation_reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now(),
    CONSTRAINT uq_user_product_entitlement UNIQUE(user_id, product_id)
);

CREATE INDEX IF NOT EXISTS idx_entitlements_lookup
    ON public.purchase_entitlements(user_id, product_id, status);

-- 6. PAYMENT EVENT IDEMPOTENCY LOG (Webhook Security & Replay Prevention)
CREATE TABLE IF NOT EXISTS public.payment_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    provider public.payment_provider_type NOT NULL,
    event_id TEXT NOT NULL,
    event_type TEXT NOT NULL,
    payload JSONB NOT NULL,
    processed_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now(),
    CONSTRAINT uq_provider_event UNIQUE(provider, event_id)
);

CREATE INDEX IF NOT EXISTS idx_payment_events_provider_id
    ON public.payment_events(provider, event_id);

-- 7. SECURE SHORT-LIVED DOWNLOAD TOKENS (Digital Delivery Fulfillment)
CREATE TABLE IF NOT EXISTS public.digital_download_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    product_id UUID NOT NULL REFERENCES public.digital_products(id) ON DELETE CASCADE,
    token TEXT UNIQUE NOT NULL,
    file_path TEXT NOT NULL,
    file_size_bytes BIGINT NOT NULL DEFAULT 0,
    checksum_sha256 TEXT NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    used_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now()
);

CREATE INDEX IF NOT EXISTS idx_download_tokens_lookup
    ON public.digital_download_tokens(token, user_id, expires_at);

-- 8. VOLUNTARY DONATIONS (Completely Isolated from Product Purchases)
CREATE TABLE IF NOT EXISTS public.donations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL, -- Guest giving allowed
    donation_number TEXT UNIQUE NOT NULL,
    donor_email TEXT,
    donor_name TEXT,
    amount_cents INTEGER NOT NULL CHECK (amount_cents >= 100), -- Minimum $1.00 / 50 PHP
    currency VARCHAR(3) NOT NULL DEFAULT 'USD',
    frequency TEXT NOT NULL DEFAULT 'one_time' CHECK (frequency IN ('one_time', 'monthly')),
    designation TEXT NOT NULL DEFAULT 'general_healing_ministry',
    status public.order_status NOT NULL DEFAULT 'pending',
    provider public.payment_provider_type NOT NULL DEFAULT 'synthetic',
    provider_transaction_id TEXT,
    receipt_url TEXT,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now()
);

CREATE INDEX IF NOT EXISTS idx_donations_user_created
    ON public.donations(user_id, created_at DESC);

-- 9. ROW LEVEL SECURITY (RLS) POLICIES

ALTER TABLE public.digital_products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_pricing ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.purchase_entitlements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.digital_download_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.donations ENABLE ROW LEVEL SECURITY;

-- Digital Products: Active products are viewable by all (anon & authenticated)
DROP POLICY IF EXISTS "digital_products_select_active" ON public.digital_products;
CREATE POLICY "digital_products_select_active"
    ON public.digital_products FOR SELECT
    USING (is_active = true);

DROP POLICY IF EXISTS "digital_products_admin_all" ON public.digital_products;
CREATE POLICY "digital_products_admin_all"
    ON public.digital_products FOR ALL
    TO authenticated
    USING (app_security.is_admin())
    WITH CHECK (app_security.is_admin());

-- Product Pricing: Active pricing is viewable by all
DROP POLICY IF EXISTS "product_pricing_select_active" ON public.product_pricing;
CREATE POLICY "product_pricing_select_active"
    ON public.product_pricing FOR SELECT
    USING (is_active = true);

DROP POLICY IF EXISTS "product_pricing_admin_all" ON public.product_pricing;
CREATE POLICY "product_pricing_admin_all"
    ON public.product_pricing FOR ALL
    TO authenticated
    USING (app_security.is_admin())
    WITH CHECK (app_security.is_admin());

-- Orders: Users can only read their own orders. Mutations strictly prohibited through REST!
DROP POLICY IF EXISTS "orders_select_own" ON public.orders;
CREATE POLICY "orders_select_own"
    ON public.orders FOR SELECT
    TO authenticated
    USING (auth.uid() = user_id);

-- Purchase Entitlements: Users can only read their own active entitlements. Direct mutations blocked!
DROP POLICY IF EXISTS "entitlements_select_own" ON public.purchase_entitlements;
CREATE POLICY "entitlements_select_own"
    ON public.purchase_entitlements FOR SELECT
    TO authenticated
    USING (auth.uid() = user_id);

-- Payment Events: Zero client access. Service role only.

-- Digital Download Tokens: Users can only select their own valid unexpired tokens
DROP POLICY IF EXISTS "download_tokens_select_own" ON public.digital_download_tokens;
CREATE POLICY "download_tokens_select_own"
    ON public.digital_download_tokens FOR SELECT
    TO authenticated
    USING (auth.uid() = user_id);

-- Donations: Users can only view their own authenticated donations. Direct mutations blocked!
DROP POLICY IF EXISTS "donations_select_own" ON public.donations;
CREATE POLICY "donations_select_own"
    ON public.donations FOR SELECT
    TO authenticated
    USING (auth.uid() IS NOT NULL AND auth.uid() = user_id);

-- 10. SERVER RPCs (SECURITY DEFINER WITH SEARCH PATH '')

-- RPC: Create Order
CREATE OR REPLACE FUNCTION public.store_create_order(
    p_product_code TEXT,
    p_currency TEXT DEFAULT 'USD',
    p_idempotency_key TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_user_id UUID := auth.uid();
    v_product RECORD;
    v_pricing RECORD;
    v_order RECORD;
    v_order_number TEXT;
BEGIN
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'AUTHENTICATION_REQUIRED: Must be logged in to create an order.'
            USING ERRCODE = '42501';
    END IF;

    -- Look up active product
    SELECT * INTO v_product
    FROM public.digital_products
    WHERE product_code = p_product_code AND is_active = true;

    IF v_product.id IS NULL THEN
        RAISE EXCEPTION 'NOT_FOUND: Product code % does not exist or is inactive.', p_product_code
            USING ERRCODE = 'P0002';
    END IF;

    -- Look up active pricing in requested currency
    SELECT * INTO v_pricing
    FROM public.product_pricing
    WHERE product_id = v_product.id
      AND currency = upper(trim(p_currency))
      AND is_active = true;

    IF v_pricing.id IS NULL THEN
        RAISE EXCEPTION 'NOT_FOUND: Pricing not available for product % in currency %.', p_product_code, p_currency
            USING ERRCODE = 'P0002';
    END IF;

    -- Check if user already holds active entitlement
    IF EXISTS (
        SELECT 1 FROM public.purchase_entitlements
        WHERE user_id = v_user_id
          AND product_id = v_product.id
          AND status = 'active'
    ) THEN
        RAISE EXCEPTION 'ALREADY_ENTITLED: You already own this digital product.'
            USING ERRCODE = '23505';
    END IF;

    -- Check idempotency
    IF p_idempotency_key IS NOT NULL AND trim(p_idempotency_key) != '' THEN
        SELECT * INTO v_order
        FROM public.orders
        WHERE idempotency_key = trim(p_idempotency_key) AND user_id = v_user_id;

        IF v_order.id IS NOT NULL THEN
            RETURN jsonb_build_object(
                'order_id', v_order.id,
                'order_number', v_order.order_number,
                'product_id', v_order.product_id,
                'amount_cents', v_order.amount_cents,
                'currency', v_order.currency,
                'status', v_order.status,
                'is_idempotent_replay', true
            );
        END IF;
    END IF;

    -- Generate unique order number
    v_order_number := 'ORD-' || to_char(pg_catalog.now(), 'YYYYMMDD') || '-' || substr(encode(extensions.gen_random_bytes(6), 'hex'), 1, 8);

    -- Insert authoritative order
    INSERT INTO public.orders (
        user_id,
        order_number,
        product_id,
        currency,
        amount_cents,
        status,
        provider,
        idempotency_key,
        metadata
    ) VALUES (
        v_user_id,
        v_order_number,
        v_product.id,
        v_pricing.currency,
        v_pricing.amount_cents,
        'pending',
        'synthetic',
        nullif(trim(p_idempotency_key), ''),
        jsonb_build_object('product_title', v_product.title, 'version', v_product.version)
    ) RETURNING * INTO v_order;

    RETURN jsonb_build_object(
        'order_id', v_order.id,
        'order_number', v_order.order_number,
        'product_id', v_order.product_id,
        'product_title', v_product.title,
        'amount_cents', v_order.amount_cents,
        'currency', v_order.currency,
        'status', v_order.status,
        'is_idempotent_replay', false
    );
END;
$$;

-- RPC: Process Synthetic Checkout (Simulated Provider Settlement)
CREATE OR REPLACE FUNCTION public.store_process_synthetic_checkout(
    p_order_id UUID,
    p_simulated_outcome TEXT DEFAULT 'succeeded',
    p_signature TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_user_id UUID := auth.uid();
    v_order RECORD;
    v_product RECORD;
    v_entitlement RECORD;
    v_event_id TEXT;
    v_status public.order_status;
BEGIN
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'AUTHENTICATION_REQUIRED: Must be logged in to process checkout.'
            USING ERRCODE = '42501';
    END IF;

    SELECT * INTO v_order
    FROM public.orders
    WHERE id = p_order_id AND user_id = v_user_id;

    IF v_order.id IS NULL THEN
        RAISE EXCEPTION 'NOT_FOUND: Order not found or not owned by user.'
            USING ERRCODE = 'P0002';
    END IF;

    IF v_order.status IN ('succeeded', 'refunded') THEN
        -- Return current settled state idempotently
        RETURN jsonb_build_object(
            'order_id', v_order.id,
            'order_number', v_order.order_number,
            'status', v_order.status,
            'is_idempotent', true
        );
    END IF;

    -- Map outcome
    IF p_simulated_outcome = 'succeeded' THEN
        v_status := 'succeeded';
    ELSIF p_simulated_outcome = 'failed' THEN
        v_status := 'failed';
    ELSIF p_simulated_outcome = 'cancelled' THEN
        v_status := 'cancelled';
    ELSIF p_simulated_outcome = 'expired' THEN
        v_status := 'expired';
    ELSE
        RAISE EXCEPTION 'INVALID_ARGUMENT: Unsupported outcome %.', p_simulated_outcome
            USING ERRCODE = '22023';
    END IF;

    -- Record payment event idempotency
    v_event_id := 'evt_synth_' || v_order.order_number || '_' || v_status::text;
    INSERT INTO public.payment_events (
        provider,
        event_id,
        event_type,
        payload
    ) VALUES (
        'synthetic',
        v_event_id,
        'order.' || v_status::text,
        jsonb_build_object(
            'order_id', v_order.id,
            'amount_cents', v_order.amount_cents,
            'currency', v_order.currency,
            'simulated_outcome', p_simulated_outcome,
            'signature', p_signature
        )
    ) ON CONFLICT (provider, event_id) DO NOTHING;

    -- Update order status
    UPDATE public.orders
    SET status = v_status,
        provider_payment_id = 'pay_synth_' || substr(encode(extensions.gen_random_bytes(6), 'hex'), 1, 10),
        updated_at = pg_catalog.now()
    WHERE id = v_order.id;

    -- If succeeded, grant purchase entitlement
    IF v_status = 'succeeded' THEN
        INSERT INTO public.purchase_entitlements (
            user_id,
            product_id,
            order_id,
            status,
            granted_at
        ) VALUES (
            v_user_id,
            v_order.product_id,
            v_order.id,
            'active',
            pg_catalog.now()
        )
        ON CONFLICT (user_id, product_id)
        DO UPDATE SET
            status = 'active',
            order_id = v_order.id,
            revoked_at = NULL,
            revocation_reason = NULL,
            updated_at = pg_catalog.now()
        RETURNING * INTO v_entitlement;
    END IF;

    RETURN jsonb_build_object(
        'order_id', v_order.id,
        'order_number', v_order.order_number,
        'status', v_status,
        'entitlement_granted', (v_status = 'succeeded'),
        'is_idempotent', false
    );
END;
$$;

-- RPC: Process Synthetic Voluntary Donation
CREATE OR REPLACE FUNCTION public.store_process_synthetic_donation(
    p_amount_cents INTEGER,
    p_currency TEXT DEFAULT 'USD',
    p_frequency TEXT DEFAULT 'one_time',
    p_designation TEXT DEFAULT 'general_healing_ministry',
    p_donor_email TEXT DEFAULT NULL,
    p_donor_name TEXT DEFAULT NULL,
    p_simulated_outcome TEXT DEFAULT 'succeeded',
    p_signature TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_user_id UUID := auth.uid();
    v_donation RECORD;
    v_donation_number TEXT;
    v_status public.order_status;
    v_event_id TEXT;
BEGIN
    IF p_amount_cents < 100 THEN
        RAISE EXCEPTION 'INVALID_AMOUNT: Minimum donation amount is 100 cents (1.00 USD/EUR or equivalent).'
            USING ERRCODE = '22023';
    END IF;

    IF p_simulated_outcome = 'succeeded' THEN
        v_status := 'succeeded';
    ELSIF p_simulated_outcome = 'failed' THEN
        v_status := 'failed';
    ELSIF p_simulated_outcome = 'cancelled' THEN
        v_status := 'cancelled';
    ELSE
        RAISE EXCEPTION 'INVALID_ARGUMENT: Unsupported outcome %.', p_simulated_outcome
            USING ERRCODE = '22023';
    END IF;

    v_donation_number := 'DON-' || to_char(pg_catalog.now(), 'YYYYMMDD') || '-' || substr(encode(extensions.gen_random_bytes(6), 'hex'), 1, 8);

    INSERT INTO public.donations (
        user_id,
        donation_number,
        donor_email,
        donor_name,
        amount_cents,
        currency,
        frequency,
        designation,
        status,
        provider,
        provider_transaction_id,
        receipt_url,
        metadata
    ) VALUES (
        v_user_id,
        v_donation_number,
        nullif(trim(p_donor_email), ''),
        nullif(trim(p_donor_name), ''),
        p_amount_cents,
        upper(trim(p_currency)),
        CASE WHEN p_frequency = 'monthly' THEN 'monthly' ELSE 'one_time' END,
        COALESCE(nullif(trim(p_designation), ''), 'general_healing_ministry'),
        v_status,
        'synthetic',
        'tx_synth_' || substr(encode(extensions.gen_random_bytes(6), 'hex'), 1, 10),
        'https://receipts.lifted-app.com/' || v_donation_number,
        jsonb_build_object('signature', p_signature, 'sandbox', true)
    ) RETURNING * INTO v_donation;

    -- Record event idempotency
    v_event_id := 'evt_don_' || v_donation.donation_number || '_' || v_status::text;
    INSERT INTO public.payment_events (
        provider,
        event_id,
        event_type,
        payload
    ) VALUES (
        'synthetic',
        v_event_id,
        'donation.' || v_status::text,
        jsonb_build_object(
            'donation_id', v_donation.id,
            'amount_cents', p_amount_cents,
            'currency', p_currency
        )
    ) ON CONFLICT (provider, event_id) DO NOTHING;

    RETURN jsonb_build_object(
        'donation_id', v_donation.id,
        'donation_number', v_donation.donation_number,
        'amount_cents', v_donation.amount_cents,
        'currency', v_donation.currency,
        'frequency', v_donation.frequency,
        'designation', v_donation.designation,
        'status', v_donation.status,
        'receipt_url', v_donation.receipt_url
    );
END;
$$;

-- RPC: Generate Short-Lived Digital Download Token
CREATE OR REPLACE FUNCTION public.store_generate_download_token(
    p_product_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_user_id UUID := auth.uid();
    v_product RECORD;
    v_token TEXT;
    v_expires_at TIMESTAMPTZ;
BEGIN
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'AUTHENTICATION_REQUIRED: Must be logged in to download purchased content.'
            USING ERRCODE = '42501';
    END IF;

    -- Verify active entitlement
    IF NOT EXISTS (
        SELECT 1 FROM public.purchase_entitlements
        WHERE user_id = v_user_id
          AND product_id = p_product_id
          AND status = 'active'
    ) THEN
        RAISE EXCEPTION 'PERMISSION_DENIED: No active purchase entitlement found for this product.'
            USING ERRCODE = '42501';
    END IF;

    -- Get product storage key
    SELECT * INTO v_product
    FROM public.digital_products
    WHERE id = p_product_id AND is_active = true;

    IF v_product.id IS NULL THEN
        RAISE EXCEPTION 'NOT_FOUND: Product not found or inactive.'
            USING ERRCODE = 'P0002';
    END IF;

    -- 15-minute validity window
    v_expires_at := pg_catalog.now() + interval '15 minutes';
    v_token := encode(extensions.gen_random_bytes(24), 'hex');

    INSERT INTO public.digital_download_tokens (
        user_id,
        product_id,
        token,
        file_path,
        file_size_bytes,
        checksum_sha256,
        expires_at
    ) VALUES (
        v_user_id,
        p_product_id,
        v_token,
        v_product.file_path,
        v_product.file_size_bytes,
        v_product.checksum_sha256,
        v_expires_at
    );

    RETURN jsonb_build_object(
        'download_token', v_token,
        'expires_at', v_expires_at,
        'file_name', v_product.product_code || '.pdf',
        'file_size_bytes', v_product.file_size_bytes,
        'checksum_sha256', v_product.checksum_sha256,
        'product_title', v_product.title
    );
END;
$$;

-- RPC: Verify Download Token (Fulfillment Endpoint)
CREATE OR REPLACE FUNCTION public.store_verify_download_token(
    p_token TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_token_row RECORD;
BEGIN
    SELECT * INTO v_token_row
    FROM public.digital_download_tokens
    WHERE token = trim(p_token);

    IF v_token_row.id IS NULL THEN
        RAISE EXCEPTION 'INVALID_TOKEN: Download token not recognized.'
            USING ERRCODE = '42501';
    END IF;

    IF v_token_row.expires_at < pg_catalog.now() THEN
        RAISE EXCEPTION 'EXPIRED_TOKEN: Download token has expired.'
            USING ERRCODE = '42501';
    END IF;

    -- Mark token as used
    UPDATE public.digital_download_tokens
    SET used_at = pg_catalog.now()
    WHERE id = v_token_row.id;

    RETURN jsonb_build_object(
        'valid', true,
        'product_id', v_token_row.product_id,
        'file_path', v_token_row.file_path,
        'file_size_bytes', v_token_row.file_size_bytes,
        'checksum_sha256', v_token_row.checksum_sha256
    );
END;
$$;

-- RPC: Request Refund and Revoke Entitlement
CREATE OR REPLACE FUNCTION public.store_refund_order(
    p_order_id UUID,
    p_reason TEXT DEFAULT 'Customer requested refund'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_user_id UUID := auth.uid();
    v_order RECORD;
BEGIN
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'AUTHENTICATION_REQUIRED: Must be logged in.'
            USING ERRCODE = '42501';
    END IF;

    SELECT * INTO v_order
    FROM public.orders
    WHERE id = p_order_id AND user_id = v_user_id;

    IF v_order.id IS NULL THEN
        RAISE EXCEPTION 'NOT_FOUND: Order not found.'
            USING ERRCODE = 'P0002';
    END IF;

    IF v_order.status != 'succeeded' THEN
        RAISE EXCEPTION 'INVALID_STATE: Only succeeded orders can be refunded.'
            USING ERRCODE = '22023';
    END IF;

    -- Update order to refunded
    UPDATE public.orders
    SET status = 'refunded',
        updated_at = pg_catalog.now()
    WHERE id = v_order.id;

    -- Revoke entitlement
    UPDATE public.purchase_entitlements
    SET status = 'refunded',
        revoked_at = pg_catalog.now(),
        revocation_reason = COALESCE(nullif(trim(p_reason), ''), 'Customer refund processed'),
        updated_at = pg_catalog.now()
    WHERE user_id = v_user_id AND product_id = v_order.product_id;

    RETURN jsonb_build_object(
        'order_id', v_order.id,
        'status', 'refunded',
        'entitlement_revoked', true
    );
END;
$$;

-- RPC: Restore Entitlements
CREATE OR REPLACE FUNCTION public.store_restore_entitlements()
RETURNS TABLE (
    product_id UUID,
    product_code TEXT,
    title TEXT,
    version TEXT,
    status public.entitlement_status,
    granted_at TIMESTAMPTZ
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT
        p.id AS product_id,
        p.product_code,
        p.title,
        p.version,
        e.status,
        e.granted_at
    FROM public.purchase_entitlements e
    JOIN public.digital_products p ON p.id = e.product_id
    WHERE e.user_id = auth.uid()
      AND e.status = 'active';
$$;

-- 11. PERMISSIONS & GRANTS
-- Least-Privilege Table Grants
GRANT SELECT ON public.digital_products TO anon, authenticated;
GRANT SELECT ON public.product_pricing TO anon, authenticated;
GRANT SELECT ON public.orders TO authenticated;
GRANT SELECT ON public.purchase_entitlements TO authenticated;
GRANT SELECT ON public.digital_download_tokens TO authenticated;
GRANT SELECT ON public.donations TO authenticated;

-- Function Execution Grants
REVOKE ALL ON FUNCTION public.store_create_order(TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.store_create_order(TEXT, TEXT, TEXT) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.store_process_synthetic_checkout(UUID, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.store_process_synthetic_checkout(UUID, TEXT, TEXT) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.store_process_synthetic_donation(INTEGER, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.store_process_synthetic_donation(INTEGER, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) TO anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.store_generate_download_token(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.store_generate_download_token(UUID) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.store_verify_download_token(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.store_verify_download_token(TEXT) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.store_refund_order(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.store_refund_order(UUID, TEXT) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.store_restore_entitlements() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.store_restore_entitlements() TO authenticated, service_role;

-- 12. SEED SYNTHETIC DIGITAL WORKBOOKS & PRICING
-- Real-life clinical/pastoral resources created for LIFTED
INSERT INTO public.digital_products (
    id,
    product_code,
    title,
    subtitle,
    description,
    product_type,
    version,
    author_name,
    file_path,
    file_size_bytes,
    checksum_sha256
) VALUES
(
    '11111111-2222-3333-4444-555555555551',
    'wb-trauma-healing-v1',
    'Restoring the Broken: A 30-Day Christian Trauma Recovery Guide',
    'Clinical Somatic Grounding Combined with Contemplative Scripture',
    'A comprehensive 140-page interactive workbook integrating somatic grounding, polyvagal regulation, and gospel-centered lament practices for adults navigating trauma recovery.',
    'workbook',
    '1.0.0',
    'Cherie Magsanoc & LIFTED Clinical Team',
    'secure/workbooks/restoring_the_broken_v1.pdf',
    4850000,
    'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
),
(
    '11111111-2222-3333-4444-555555555552',
    'wb-grounding-anxiety-v1',
    'Anchored in Grace: Daily Practices for Overcoming Severe Anxiety',
    'Trauma-Informed Breath Pacers and Guided Reflections',
    'An interactive 80-page workbook offering 4-7-8 breath pacer exercises, bilateral stimulation prompts, and scripture affirmations designed for high-stress and panic moments.',
    'workbook',
    '1.0.0',
    'LIFTED Pastoral Care',
    'secure/workbooks/anchored_in_grace_v1.pdf',
    3200000,
    'a2c1b44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b866'
),
(
    '11111111-2222-3333-4444-555555555553',
    'wb-grief-recovery-v1',
    'Walking Through the Valley: The Courage to Grieve with Hope',
    'Honoring Loss, Navigating Complicated Grief, and Discovering Renewal',
    'A gentle 96-page guided journal for individuals and parents processing acute loss, miscarriage, or bereavement through community lament and faith-based resilience.',
    'workbook',
    '1.0.0',
    'Every Nation GG & LIFTED Care',
    'secure/workbooks/walking_through_valley_v1.pdf',
    3900000,
    'f4d2c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b877'
)
ON CONFLICT (product_code) DO NOTHING;

-- Seed Pricing (USD & PHP)
INSERT INTO public.product_pricing (product_id, currency, amount_cents) VALUES
('11111111-2222-3333-4444-555555555551', 'USD', 1499), -- $14.99
('11111111-2222-3333-4444-555555555551', 'PHP', 79900), -- ₱799.00
('11111111-2222-3333-4444-555555555552', 'USD', 999),  -- $9.99
('11111111-2222-3333-4444-555555555552', 'PHP', 49900), -- ₱499.00
('11111111-2222-3333-4444-555555555553', 'USD', 1199), -- $11.99
('11111111-2222-3333-4444-555555555553', 'PHP', 59900)  -- ₱599.00
ON CONFLICT (product_id, currency) DO NOTHING;
