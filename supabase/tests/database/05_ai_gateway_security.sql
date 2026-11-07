-- ============================================================================
-- LIFTED Phase 7 pgTAP Test Suite: AI Gateway Quota Management, Server-Side Consent & Safety
-- File: supabase/tests/database/05_ai_gateway_security.sql
-- ============================================================================

BEGIN;
SELECT plan(19);

-- 1. Table existence and structure checks
SELECT has_table('public', 'user_ai_consents', 'public.user_ai_consents table exists');
SELECT has_table('public', 'ai_usage_quotas', 'public.ai_usage_quotas table exists');
SELECT has_table('public', 'ai_request_idempotency', 'public.ai_request_idempotency table exists');

-- Setup synthetic users in auth.users
INSERT INTO auth.users (id, email)
VALUES
    ('33333333-3333-3333-3333-333333333333', 'gateway_alice@test.lifted.app'),
    ('44444444-4444-4444-4444-444444444444', 'gateway_bob@test.lifted.app');

-- 2. Initial Consent Verification: Must be false for unconsented users
SELECT is(
    app_security.check_user_ai_consent('33333333-3333-3333-3333-333333333333', 'v1.0'),
    FALSE,
    'Unconsented user check_user_ai_consent returns FALSE'
);

-- 3. Alice records consent via app_security
SELECT lives_ok(
    $$ SELECT app_security.record_user_ai_consent('33333333-3333-3333-3333-333333333333', 'v1.0'); $$,
    'record_user_ai_consent executes cleanly'
);

SELECT is(
    app_security.check_user_ai_consent('33333333-3333-3333-3333-333333333333', 'v1.0'),
    TRUE,
    'check_user_ai_consent returns TRUE after valid consent recorded'
);

-- 4. RLS Isolation on user_ai_consents
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claim.sub" = '33333333-3333-3333-3333-333333333333';

SELECT results_eq(
    'SELECT consent_version FROM public.user_ai_consents WHERE user_id = ''33333333-3333-3333-3333-333333333333''',
    ARRAY['v1.0'],
    'Alice can read her own consent record'
);

-- Bob attempts to read Alice's consent record
SET LOCAL "request.jwt.claim.sub" = '44444444-4444-4444-4444-444444444444';
SELECT is_empty(
    'SELECT * FROM public.user_ai_consents WHERE user_id = ''33333333-3333-3333-3333-333333333333''',
    'Bob CANNOT read Alice''s consent record (RLS isolation)'
);

-- 5. Revocation of Consent
RESET ROLE;
SELECT lives_ok(
    $$ SELECT app_security.revoke_user_ai_consent('33333333-3333-3333-3333-333333333333'); $$,
    'revoke_user_ai_consent executes cleanly'
);

SELECT is(
    app_security.check_user_ai_consent('33333333-3333-3333-3333-333333333333', 'v1.0'),
    FALSE,
    'check_user_ai_consent returns FALSE immediately after revocation'
);

-- 6. Client Role Quota Manipulation Defense (Least Privilege)
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claim.sub" = '33333333-3333-3333-3333-333333333333';

SELECT throws_ok(
    $$ INSERT INTO public.ai_usage_quotas (user_id, window_type, window_start, request_count) 
       VALUES ('33333333-3333-3333-3333-333333333333', 'minute', now(), 1); $$,
    '42501',
    NULL,
    'Authenticated client is forbidden from direct INSERT into ai_usage_quotas'
);

SELECT throws_ok(
    $$ DELETE FROM public.ai_usage_quotas WHERE user_id = '33333333-3333-3333-3333-333333333333'; $$,
    '42501',
    NULL,
    'Authenticated client is forbidden from direct DELETE on ai_usage_quotas'
);

-- 7. Atomic Quota Increments via service_role / app_security
RESET ROLE;

-- 1st request: allowed
SELECT results_eq(
    $$ SELECT allowed, rejection_reason, minute_count, day_count 
       FROM app_security.check_and_increment_ai_quota('33333333-3333-3333-3333-333333333333', 5, 30, 50, 1000); $$,
    $$ VALUES (TRUE, 'ALLOWED'::TEXT, 1, 1); $$,
    'First request allowed with count 1'
);

-- 2nd, 3rd, 4th, 5th requests: allowed
SELECT lives_ok(
    $$ DO $blk$
       BEGIN
         PERFORM app_security.check_and_increment_ai_quota('33333333-3333-3333-3333-333333333333', 5, 30, 50, 1000);
         PERFORM app_security.check_and_increment_ai_quota('33333333-3333-3333-3333-333333333333', 5, 30, 50, 1000);
         PERFORM app_security.check_and_increment_ai_quota('33333333-3333-3333-3333-333333333333', 5, 30, 50, 1000);
         PERFORM app_security.check_and_increment_ai_quota('33333333-3333-3333-3333-333333333333', 5, 30, 50, 1000);
       END;
       $blk$; $$,
    'Requests 2 to 5 execute cleanly'
);

-- 6th request within minute: burst limit exceeded
SELECT results_eq(
    $$ SELECT allowed, rejection_reason, minute_count, day_count 
       FROM app_security.check_and_increment_ai_quota('33333333-3333-3333-3333-333333333333', 5, 30, 50, 1000); $$,
    $$ VALUES (FALSE, 'BURST_LIMIT_EXCEEDED'::TEXT, 5, 5); $$,
    '6th request rejected with BURST_LIMIT_EXCEEDED'
);

-- 8. Daily Quota Boundary
SELECT results_eq(
    $$ SELECT allowed, rejection_reason, minute_count, day_count 
       FROM app_security.check_and_increment_ai_quota('33333333-3333-3333-3333-333333333333', 100, 5, 50, 1000); $$,
    $$ VALUES (FALSE, 'DAILY_QUOTA_EXCEEDED'::TEXT, 5, 5); $$,
    'Request rejected with DAILY_QUOTA_EXCEEDED when daily max is 5'
);

-- 9. Global Usage / Spending Ceiling Boundary
SELECT results_eq(
    $$ SELECT allowed, rejection_reason, minute_count, day_count 
       FROM app_security.check_and_increment_ai_quota('44444444-4444-4444-4444-444444444444', 100, 100, 50, 5); $$,
    $$ VALUES (FALSE, 'GLOBAL_CEILING_EXCEEDED'::TEXT, 0, 0); $$,
    'Bob request rejected with GLOBAL_CEILING_EXCEEDED when total daily system requests reach ceiling'
);

-- 10. Multi-User Concurrency Across Distinct Users Enforces Global Ceiling
SELECT results_eq(
    $$ SELECT allowed, rejection_reason 
       FROM app_security.check_and_increment_ai_quota('44444444-4444-4444-4444-444444444444', 100, 100, 50, 4); $$,
    $$ VALUES (FALSE, 'GLOBAL_CEILING_EXCEEDED'::TEXT); $$,
    'Concurrent request from second distinct user is blocked when global ceiling is 4 and 5 requests already logged'
);

-- 11. Pruning routine executes safely
SELECT lives_ok(
    $$ SELECT app_security.prune_expired_ai_quotas(); $$,
    'prune_expired_ai_quotas executes cleanly'
);

SELECT * FROM finish();
ROLLBACK;
