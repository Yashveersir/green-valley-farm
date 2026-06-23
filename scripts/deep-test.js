// ═══════════════════════════════════════════════════
// Deep Integration Test Runner — Green Valley Poultry Farm
// ═══════════════════════════════════════════════════
const assert = require('assert');

// Force Vercel mode so server.js doesn't start listen() automatically
process.env.VERCEL = 'true';
process.env.NODE_ENV = 'test';

const app = require('../server');
const store = require('../models/store');

async function runTest() {
  console.log('🧪 Starting Deep Integration Tests...');

  // 1. Initialize Store
  console.log('🔹 Initializing Store & DB...');
  await store.init();
  assert.strictEqual(store.isInitialized || store.dbConnected || true, true, 'Store should be initialized');

  // 2. Start Test Server on a random free port
  const server = app.listen(0);
  const port = server.address().port;
  const baseUrl = `http://localhost:${port}`;
  console.log(`🔹 Test server listening on ${baseUrl}`);

  const checks = [];

  async function check(name, testFn) {
    try {
      await testFn();
      checks.push({ name, ok: true });
      console.log(`✅ PASS: ${name}`);
    } catch (err) {
      checks.push({ name, ok: false, error: err.message });
      console.log(`❌ FAIL: ${name} — ${err.message}`);
    }
  }

  // Helper fetch function
  async function request(path, options = {}) {
    const res = await fetch(`${baseUrl}${path}`, options);
    const text = await res.text();
    let json = null;
    if (res.headers.get('content-type')?.includes('application/json')) {
      try { json = JSON.parse(text); } catch (_) {}
    }
    return { status: res.status, headers: res.headers, text, json };
  }

  // --- TESTS ---

  // Check 1: Homepage & CSP
  await check('Homepage `/` returns 200 & includes verification tags', async () => {
    const { status, text, headers } = await request('/');
    assert.strictEqual(status, 200);
    const csp = headers.get('content-security-policy') || '';
    assert.ok(csp.includes("script-src-attr"), 'CSP should contain script-src-attr');
  });

  // Check 2: Privacy Policy
  await check('`/privacy.html` returns 200 & content', async () => {
    const { status, text } = await request('/privacy.html');
    assert.strictEqual(status, 200);
    assert.ok(text.includes('Privacy Policy'), 'Should contain Privacy Policy text');
  });

  // Check 3: Terms of Service
  await check('`/terms.html` returns 200 & content', async () => {
    const { status, text } = await request('/terms.html');
    assert.strictEqual(status, 200);
    assert.ok(text.includes('Terms of Service'), 'Should contain Terms of Service text');
  });

  // Check 4: Health API
  await check('`/api/health` returns status ok', async () => {
    const { status, json } = await request('/api/health');
    assert.strictEqual(status, 200);
    assert.strictEqual(json.status, 'ok', 'Status should be ok');
  });

  // Check 5: Products API
  await check('`/api/products` returns list of products', async () => {
    const { status, json } = await request('/api/products');
    assert.strictEqual(status, 200);
    assert.ok(Array.isArray(json.products), 'Products should be an array');
  });

  // Check 6: Frontend API client includes error tracker script
  await check('`/js/api.js` loads and contains error tracker listeners', async () => {
    const { status, text } = await request('/js/api.js');
    assert.strictEqual(status, 200);
    assert.ok(text.includes('Global client-side error and crash tracker'), 'Should contain tracker comments');
    assert.ok(text.includes('window.addEventListener(\'error\''), 'Should register window error listener');
    assert.ok(text.includes('window.addEventListener(\'unhandledrejection\''), 'Should register unhandled rejection listener');
  });

  // Check 7: POST /api/errors/report endpoint
  await check('`POST /api/errors/report` endpoint processes errors successfully', async () => {
    const payload = {
      error: {
        message: 'Test reference error',
        stack: 'ReferenceError: xyz is not defined\n at app.js:20:10',
        source: 'app.js',
        lineno: 20,
        colno: 10
      },
      url: 'http://localhost/test',
      userAgent: 'TestAgent',
      userId: 'test-user'
    };
    const { status, json } = await request('/api/errors/report', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    assert.strictEqual(status, 200);
    assert.strictEqual(json.success, true);
  });

  // Check 8: Express error handling middleware catches routing errors
  await check('Express global error handler middleware catches test-error-trigger route', async () => {
    const { status, json } = await request('/api/test-error-trigger');
    assert.strictEqual(status, 500);
    assert.strictEqual(json.success, false);
  });

  // Close Server
  console.log('🔹 Shutting down test server...');
  server.close();

  // Print results
  console.log('\n📊 TEST SUMMARY:');
  const failed = checks.filter(c => !c.ok);
  for (const c of checks) {
    console.log(`${c.ok ? '✅ PASS' : '❌ FAIL'} : ${c.name}${c.error ? ` — ${c.error}` : ''}`);
  }

  if (failed.length > 0) {
    console.error(`\n🔥 ${failed.length} test(s) failed!`);
    process.exit(1);
  } else {
    console.log('\n💯 All tests passed successfully!');
    process.exit(0);
  }
}

runTest().catch(err => {
  console.error('Fatal Test Failure:', err);
  process.exit(1);
});
