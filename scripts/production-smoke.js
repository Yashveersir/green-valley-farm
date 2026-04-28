const siteUrl = (process.env.SMOKE_SITE_URL || process.argv[2] || 'https://www.green-valley-farm.online').replace(/\/$/, '');

const checks = [];

function pass(name, detail = '') {
  checks.push({ name, ok: true, detail });
}

function fail(name, detail = '') {
  checks.push({ name, ok: false, detail });
}

async function fetchText(pathname) {
  const response = await fetch(`${siteUrl}${pathname}`, { cache: 'no-store' });
  const body = await response.text();
  return { response, body };
}

async function checkStatus(pathname, expectedContent = '') {
  try {
    const { response, body } = await fetchText(pathname);
    if (!response.ok) return fail(`${pathname} status`, `HTTP ${response.status}`);
    if (expectedContent && !body.includes(expectedContent)) {
      return fail(`${pathname} content`, `Missing ${expectedContent}`);
    }
    pass(`${pathname} status`, String(response.status));
  } catch (error) {
    fail(`${pathname} status`, error.message);
  }
}

async function main() {
  try {
    const { response, body } = await fetchText('/');
    const csp = response.headers.get('content-security-policy') || '';
    response.ok ? pass('/ status', String(response.status)) : fail('/ status', `HTTP ${response.status}`);
    body.includes('google-site-verification') ? pass('/ Google verification tag') : fail('/ Google verification tag');
    body.includes('msvalidate.01') ? pass('/ Bing verification tag') : fail('/ Bing verification tag');
    body.includes('/privacy.html') && body.includes('/terms.html')
      ? pass('/ legal footer links')
      : fail('/ legal footer links');
    csp.includes("script-src-attr") && csp.includes("'unsafe-inline'")
      ? pass('CSP allows existing inline click handlers')
      : fail('CSP allows existing inline click handlers', csp || 'Missing CSP header');
  } catch (error) {
    fail('/ status', error.message);
  }

  await checkStatus('/api/health', '"status":"ok"');
  await checkStatus('/api/products', '"products"');
  await checkStatus('/robots.txt', '/sitemap.xml');
  await checkStatus('/sitemap.xml', '<urlset');
  await checkStatus('/privacy.html', 'Privacy Policy');
  await checkStatus('/terms.html', 'Terms of Service');
  await checkStatus('/admin', 'Admin Access');

  try {
    const { body: apiJs } = await fetchText('/js/api.js');
    const { body: appJs } = await fetchText('/js/app.js');
    const { body: adminJs } = await fetchText('/js/admin.js');
    apiJs.includes('window.API = API') ? pass('API global export') : fail('API global export');
    appJs.includes('window.App = App') ? pass('App global export') : fail('App global export');
    adminJs.includes('window.AdminApp = AdminApp') ? pass('AdminApp global export') : fail('AdminApp global export');
  } catch (error) {
    fail('JS global exports', error.message);
  }

  const failed = checks.filter(check => !check.ok);
  for (const check of checks) {
    console.log(`${check.ok ? 'PASS' : 'FAIL'} ${check.name}${check.detail ? ` - ${check.detail}` : ''}`);
  }

  if (failed.length) {
    console.error(`\n${failed.length} production smoke check(s) failed for ${siteUrl}.`);
    process.exit(1);
  }

  console.log(`\nAll production smoke checks passed for ${siteUrl}.`);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
