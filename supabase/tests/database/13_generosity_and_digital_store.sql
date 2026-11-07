-- ============================================================================
-- LIFTED — Test Suite 13: Generosity, Digital Workbooks, Entitlements & Store
-- Phase 11: Sandbox & Synthetic Transactions Security Verification
-- ============================================================================

BEGIN;
SELECT plan(23);

-- Setup test users
INSERT INTO auth.users (id, email) VALUES
    ('10101010-1010-1010-1010-101010101010', 'buyer.a@lifted.app'),
    ('20202020-2020-2020-2020-202020202020', 'buyer.b@lifted.app')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.user_roles (user_id, role) VALUES
    ('10101010-1010-1010-1010-101010101010', 'member'),
    ('20202020-2020-2020-2020-202020202020', 'member')
ON CONFLICT (user_id, role) DO NOTHING;

-- Test 1: Anonymous can query active digital products catalog
SET LOCAL ROLE anon;
SELECT isnt_empty(
    'SELECT * FROM public.digital_products WHERE is_active = true',
    '1. Anonymous visitor can browse active digital workbooks'
);

-- Test 2: Anonymous can query product pricing
SELECT isnt_empty(
    'SELECT * FROM public.product_pricing WHERE is_active = true',
    '2. Anonymous visitor can view pricing configuration'
);

-- Test 3: Authenticated buyer cannot directly insert into orders table (RLS fail-closed)
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claim.sub" = '10101010-1010-1010-1010-101010101010';
SELECT throws_ok(
    $$INSERT INTO public.orders (
        user_id, order_number, product_id, currency, amount_cents
    ) VALUES (
        '10101010-1010-1010-1010-101010101010', 'ORD-HACK-01',
        '11111111-2222-3333-4444-555555555551', 'USD', 100
    )$$,
    '42501',
    NULL,
    '3. Authenticated buyer cannot directly INSERT into orders via REST'
);

-- Test 4: Authenticated buyer cannot directly insert into purchase_entitlements table
SELECT throws_ok(
    $$INSERT INTO public.purchase_entitlements (
        user_id, product_id, status
    ) VALUES (
        '10101010-1010-1010-1010-101010101010',
        '11111111-2222-3333-4444-555555555551',
        'active'
    )$$,
    '42501',
    NULL,
    '4. Authenticated buyer cannot forge purchase entitlements directly'
);

-- Test 5: Buyer creates order via authoritative RPC
SELECT lives_ok(
    $$SELECT public.store_create_order(
        'wb-trauma-healing-v1',
        'USD',
        'idem-key-test-01'
    )$$,
    '5. Buyer successfully creates order via authoritative store_create_order RPC'
);

-- Test 6: Verify order amount was set authoritatively from product_pricing ($14.99 = 1499 cents)
SELECT results_eq(
    $$SELECT amount_cents, currency::text, status::text FROM public.orders WHERE idempotency_key = 'idem-key-test-01'$$,
    $$VALUES (1499, 'USD', 'pending')$$,
    '6. Order amount and currency match authoritative catalog pricing'
);

-- Test 7: Idempotent replay of order creation returns existing order
SELECT results_eq(
    $$SELECT (public.store_create_order('wb-trauma-healing-v1', 'USD', 'idem-key-test-01'))->>'is_idempotent_replay'$$,
    $$VALUES ('true')$$,
    '7. Replaying same idempotency key returns existing order with is_idempotent_replay = true'
);

-- Test 8: Simulate failed checkout: status becomes failed, no entitlement granted
SELECT lives_ok(
    $$SELECT public.store_process_synthetic_checkout(
        (SELECT id FROM public.orders WHERE idempotency_key = 'idem-key-test-01'),
        'failed',
        'sig_mock_failed'
    )$$,
    '8. Synthetic checkout processes simulated failure'
);

SELECT results_eq(
    $$SELECT status::text FROM public.orders WHERE idempotency_key = 'idem-key-test-01'$$,
    $$VALUES ('failed')$$,
    '8b. Order status transitioned to failed'
);

-- Test 9: Create new order for successful purchase
SELECT lives_ok(
    $$SELECT public.store_create_order(
        'wb-trauma-healing-v1',
        'USD',
        'idem-key-test-02'
    )$$,
    '9. Buyer creates fresh order for successful checkout'
);

-- Test 10: Simulate successful checkout: status becomes succeeded and entitlement is granted
SELECT lives_ok(
    $$SELECT public.store_process_synthetic_checkout(
        (SELECT id FROM public.orders WHERE idempotency_key = 'idem-key-test-02'),
        'succeeded',
        'sig_mock_success_valid'
    )$$,
    '10. Synthetic checkout processes simulated success'
);

-- Test 11: Verify active entitlement granted in purchase_entitlements
SELECT results_eq(
    $$SELECT status::text FROM public.purchase_entitlements
      WHERE user_id = '10101010-1010-1010-1010-101010101010'
        AND product_id = '11111111-2222-3333-4444-555555555551'$$,
    $$VALUES ('active')$$,
    '11. Purchase entitlement is active for buyer A'
);

-- Test 12: Cannot create another order for already-owned product
SELECT throws_ok(
    $$SELECT public.store_create_order(
        'wb-trauma-healing-v1',
        'USD',
        'idem-key-test-03'
    )$$,
    '23505',
    NULL,
    '12. System rejects order creation for already-entitled product'
);

-- Test 13: Buyer A generates short-lived secure download token
SELECT isnt_empty(
    $$SELECT (public.store_generate_download_token('11111111-2222-3333-4444-555555555551'))->>'download_token'$$,
    '13. Entitled buyer A successfully generates short-lived download token'
);

-- Test 14: Buyer B (different account) cannot generate download token for product they do not own
SET LOCAL "request.jwt.claim.sub" = '20202020-2020-2020-2020-202020202020';
SELECT throws_ok(
    $$SELECT public.store_generate_download_token('11111111-2222-3333-4444-555555555551')$$,
    '42501',
    NULL,
    '14. Account isolation: Unentitled Buyer B is blocked from generating download token'
);

-- Test 15: Buyer B receives ZERO rows when querying Buyer A's orders
SELECT is_empty(
    $$SELECT * FROM public.orders WHERE user_id = '10101010-1010-1010-1010-101010101010'$$,
    '15. Account isolation: Buyer B cannot read Buyer A orders'
);

-- Test 16: Buyer B receives ZERO rows when querying Buyer A's entitlements
SELECT is_empty(
    $$SELECT * FROM public.purchase_entitlements WHERE user_id = '10101010-1010-1010-1010-101010101010'$$,
    '16. Account isolation: Buyer B cannot read Buyer A entitlements'
);

-- Test 17: Buyer A refunds order
SET LOCAL "request.jwt.claim.sub" = '10101010-1010-1010-1010-101010101010';
SELECT lives_ok(
    $$SELECT public.store_refund_order(
        (SELECT id FROM public.orders WHERE idempotency_key = 'idem-key-test-02'),
        'Accidental duplicate purchase'
    )$$,
    '17. Buyer A requests refund on succeeded order'
);

-- Test 18: Entitlement is revoked after refund
SELECT results_eq(
    $$SELECT status::text FROM public.purchase_entitlements
      WHERE user_id = '10101010-1010-1010-1010-101010101010'
        AND product_id = '11111111-2222-3333-4444-555555555551'$$,
    $$VALUES ('refunded')$$,
    '18. Entitlement status transitioned to refunded'
);

-- Test 19: Download token generation blocked after entitlement is revoked
SELECT throws_ok(
    $$SELECT public.store_generate_download_token('11111111-2222-3333-4444-555555555551')$$,
    '42501',
    NULL,
    '19. Download token generation blocked after refund revocation'
);

-- Test 20: Voluntary donation: rejects amount below 100 cents ($1.00)
SELECT throws_ok(
    $$SELECT public.store_process_synthetic_donation(
        50, 'USD', 'one_time', 'general_healing_ministry', 'donor@example.com', 'Donor', 'succeeded'
    )$$,
    '22023',
    NULL,
    '20. Voluntary donation rejects amount under 100 cents'
);

-- Test 21: Voluntary donation: processes valid donation
SELECT lives_ok(
    $$SELECT public.store_process_synthetic_donation(
        2500, 'USD', 'one_time', 'trauma_workbook_scholarships', 'donor@example.com', 'Generous Giver', 'succeeded'
    )$$,
    '21. Voluntary donation of $25.00 processes successfully'
);

-- Test 22: Voluntary donation does NOT grant digital workbook entitlement
SELECT is_empty(
    $$SELECT * FROM public.purchase_entitlements
      WHERE user_id = '10101010-1010-1010-1010-101010101010'
        AND status = 'active'$$,
    '22. Voluntary donation does NOT grant commercial digital workbook entitlement'
);

SELECT * FROM finish();
ROLLBACK;
