/**
 * LIFTED — Live Edge Function HTTP Verification Test
 * Runs against the live Supabase Edge Runtime at http://127.0.0.1:54321/functions/v1/companion-gateway
 */

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'http://127.0.0.1:54321';
const SERVICE_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';
const ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';
const GATEWAY_URL = `${SUPABASE_URL}/functions/v1/companion-gateway`;

const adminClient = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const anonClient = createClient(SUPABASE_URL, ANON_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

let testUser = null;
let userToken = null;
const results = [];

function assert(condition, message) {
  if (!condition) {
    console.error(`❌ FAILED: ${message}`);
    results.push({ test: message, status: 'FAIL' });
    throw new Error(message);
  } else {
    console.log(`✅ PASSED: ${message}`);
    results.push({ test: message, status: 'PASS' });
  }
}

async function run() {
  console.log('--- Setting up Test User in Supabase Auth ---');
  const testEmail = `gateway-live-${Date.now()}@lifted.app`;
  const testPassword = 'Password123!SecureLifted';

  const { data: created, error: createErr } = await adminClient.auth.admin.createUser({
    email: testEmail,
    password: testPassword,
    email_confirm: true,
  });

  if (createErr) {
    throw new Error(`Failed to create test user: ${createErr.message}`);
  }
  testUser = created.user;
  console.log(`Created test user: ${testUser.id} (${testEmail})`);

  // Sign in as this user to get a valid user JWT
  const { data: sessionData, error: signInErr } = await anonClient.auth.signInWithPassword({
    email: testEmail,
    password: testPassword,
  });
  if (signInErr || !sessionData.session) {
    throw new Error(`Failed to sign in test user: ${signInErr?.message}`);
  }
  userToken = sessionData.session.access_token;
  console.log(`Obtained user JWT session token.`);

  console.log('\n--- Running Live Edge Function HTTP Tests ---');

  // Test 1: OPTIONS Preflight
  {
    const res = await fetch(GATEWAY_URL, {
      method: 'OPTIONS',
      headers: { Origin: 'http://localhost:5173' },
    });
    console.log('OPTIONS status:', res.status);
    console.log('OPTIONS headers:', Object.fromEntries(res.headers.entries()));
    assert(res.status === 204, 'OPTIONS preflight returns 204');
    const allowOrigin = res.headers.get('access-control-allow-origin');
    assert(
      allowOrigin === 'http://localhost:5173' || allowOrigin === '*',
      'OPTIONS preflight returns access-control-allow-origin header'
    );
  }

  // Test 2: Method Not Allowed
  {
    const res = await fetch(GATEWAY_URL, {
      method: 'GET',
    });
    assert(res.status === 405, 'GET returns 405 Method Not Allowed');
    const data = await res.json();
    assert(data.error === 'METHOD_NOT_ALLOWED', 'Error code is METHOD_NOT_ALLOWED');
  }

  // Test 3: Missing Authentication
  {
    const res = await fetch(GATEWAY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'Hello guide' }),
    });
    assert(res.status === 401, 'Missing token returns 401 Unauthorized');
    const data = await res.json();
    assert(data.error === 'UNAUTHORIZED', 'Error code is UNAUTHORIZED');
  }

  // Test 4: Forged / Expired JWT
  {
    const res = await fetch(GATEWAY_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer forged.invalid.token',
      },
      body: JSON.stringify({ message: 'Hello guide' }),
    });
    assert(res.status === 401, 'Forged JWT returns 401 Unauthorized');
    const data = await res.json();
    assert(data.error === 'UNAUTHORIZED', 'Error code is UNAUTHORIZED for invalid token');
  }

  // Test 5: Missing Consent (Authenticated but no DB consent record)
  {
    const res = await fetch(GATEWAY_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${userToken}`,
      },
      body: JSON.stringify({ message: 'Hello guide' }),
    });
    assert(res.status === 403, 'Missing server-side consent returns 403 Forbidden');
    const data = await res.json();
    assert(data.error === 'CONSENT_REQUIRED', 'Error code is CONSENT_REQUIRED');
  }

  // Test 6: Forged Client Consent Claim (client sends consentGiven: true, but server has no record)
  {
    const res = await fetch(GATEWAY_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${userToken}`,
      },
      body: JSON.stringify({
        message: 'Hello guide',
        consentGiven: true, // Spoofed field
        userId: 'some-other-id',
      }),
    });
    assert(res.status === 403, 'Spoofed client consent claim is rejected with 403');
    const data = await res.json();
    assert(data.error === 'CONSENT_REQUIRED', 'Server authoritative check rejects spoofed claim');
  }

  // Test 7: Record Server-Side Consent via Authoritative RPC
  {
    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${userToken}` } },
    });
    const { data: recordRes, error: rpcErr } = await userClient.rpc('record_user_ai_consent', {
      p_version: 'v1.0',
    });
    if (rpcErr) {
      console.error('RPC Error details:', rpcErr);
    }
    console.log('Record consent RPC returned:', recordRes);
    assert(!rpcErr && recordRes === true, 'Successfully recorded authoritative user consent');
  }

  // Direct check of check_and_increment_ai_quota via REST API
  {
    console.log('Testing direct RPC call to check_and_increment_ai_quota...');
    const rpcRes = await fetch(`${SUPABASE_URL}/rest/v1/rpc/check_and_increment_ai_quota`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${SERVICE_KEY}`,
        apikey: SERVICE_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        p_user_id: testUser.id,
      }),
    });
    console.log('check_and_increment_ai_quota status:', rpcRes.status);
    console.log('check_and_increment_ai_quota body:', await rpcRes.text());
  }

  // Test 8: Valid Authenticated Request with Recorded Consent
  {
    const res = await fetch(GATEWAY_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${userToken}`,
        Origin: 'http://localhost:5173',
      },
      body: JSON.stringify({
        message: 'I am feeling overwhelmed with life today.',
      }),
    });
    const text = await res.text();
    console.log('Test 8 response status:', res.status);
    console.log('Test 8 response body:', text);
    let data;
    try { data = JSON.parse(text); } catch {}
    assert(res.status === 200, 'Authenticated request with consent returns 200 OK');
    assert(data.success === true, 'Response payload success is true');
    assert(data.isAiGenerated === true, 'Response isAiGenerated is true');
    assert(data.isCrisis === false, 'Non-crisis request isCrisis is false');
    assert(typeof data.text === 'string' && data.text.length > 0, 'Response text is returned');
  }

  // Test 9: Crisis Interception (Zero-Latency Barrier BEFORE external provider)
  {
    const res = await fetch(GATEWAY_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${userToken}`,
      },
      body: JSON.stringify({
        message: 'I want to kill myself, the pain is too much.',
      }),
    });
    assert(res.status === 200, 'Crisis request returns 200 OK with safety interception');
    const data = await res.json();
    assert(data.isCrisis === true, 'Crisis detected (isCrisis: true)');
    assert(data.shouldShowResources === true, 'Crisis resources flag is true');
    assert(data.isAiGenerated === false, 'Crisis response is hardcoded (isAiGenerated: false)');
    assert(data.text.includes('988'), 'Crisis response text contains 988 Lifeline');
    assert(data.text.includes('741741'), 'Crisis response text contains 741741 Crisis Text Line');
  }

  // Test 10: Revoke Consent and Verify Immediate Rejection
  {
    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${userToken}` } },
    });
    const { data: revokeRes, error: rpcErr } = await userClient.rpc('revoke_user_ai_consent');
    assert(!rpcErr && revokeRes === true, 'Successfully revoked user consent');

    const res = await fetch(GATEWAY_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${userToken}`,
      },
      body: JSON.stringify({ message: 'Hello again' }),
    });
    assert(res.status === 403, 'Post-revocation request is immediately rejected with 403');
    const data = await res.json();
    assert(data.error === 'CONSENT_REQUIRED', 'Revoked consent requires re-opt-in');
  }

  // Test 11: Re-grant Consent for Rate Limit & Input Validation Tests
  {
    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${userToken}` } },
    });
    await userClient.rpc('record_user_ai_consent', { p_version: 'v1.0' });
  }

  // Test 12: Input Validation — Oversized Payload (>32KB)
  {
    const largeMessage = 'A'.repeat(33000);
    const res = await fetch(GATEWAY_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${userToken}`,
      },
      body: JSON.stringify({ message: largeMessage }),
    });
    assert(res.status === 413, 'Payload > 32KB returns 413 Payload Too Large');
    const data = await res.json();
    assert(data.error === 'PAYLOAD_TOO_LARGE', 'Error code is PAYLOAD_TOO_LARGE');
  }

  // Test 13: Input Validation — Message Text Exceeds 1000 Chars
  {
    const longText = 'B'.repeat(1001);
    const res = await fetch(GATEWAY_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${userToken}`,
      },
      body: JSON.stringify({ message: longText }),
    });
    assert(res.status === 400, 'Message > 1000 chars returns 400 Bad Request');
    const data = await res.json();
    assert(data.error === 'INVALID_INPUT', 'Error code is INVALID_INPUT');
  }

  // Test 14: Rate Limit Exhaustion (Burst limit: 5 req/min)
  {
    console.log('Sending requests to test burst rate limiter (5 req/min)...');
    let burstRejected = false;
    for (let i = 0; i < 7; i++) {
      const res = await fetch(GATEWAY_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${userToken}`,
        },
        body: JSON.stringify({ message: `Burst test attempt ${i + 1}` }),
      });
      if (res.status === 429) {
        burstRejected = true;
        const data = await res.json();
        assert(data.error === 'RATE_LIMIT_EXCEEDED', 'Burst 429 error code is RATE_LIMIT_EXCEEDED');
        assert(
          data.quota?.rejectionReason === 'BURST_LIMIT_EXCEEDED',
          'Rejection reason is BURST_LIMIT_EXCEEDED'
        );
        assert(res.headers.get('retry-after') === '60', 'Retry-After header is 60s');
        break;
      }
    }
    assert(burstRejected, 'Burst limit properly tripped after 5 requests within the same minute');
  }

  // Test 15: Untrusted CORS Origin Rejection
  {
    const res = await fetch(GATEWAY_URL, {
      method: 'OPTIONS',
      headers: { Origin: 'http://malicious-phishing-domain.evil' },
    });
    assert(res.status === 204, 'OPTIONS preflight returns 204');
    const allowOrigin = res.headers.get('access-control-allow-origin');
    assert(
      allowOrigin !== 'http://malicious-phishing-domain.evil',
      'Untrusted origin is NOT in Access-Control-Allow-Origin'
    );
  }

  // Test 16: Cleanup Test User
  {
    await adminClient.auth.admin.deleteUser(testUser.id);
    console.log(`Cleaned up test user: ${testUser.id}`);
  }

  console.log(`\n🎉 All ${results.length} live Edge Function HTTP test assertions PASSED!`);
}

run().catch((err) => {
  console.error('Fatal error during test:', err);
  process.exit(1);
});
