require('dotenv').config();
const express = require('express');
require('express-async-errors');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const { ipKeyGenerator } = require('express-rate-limit');
const store = require('./models/store');
const db = require('./models/db');

const authRouter = require('./routes/auth');
const productsRouter = require('./routes/products');
const cartRouter = require('./routes/cart');
const ordersRouter = require('./routes/orders');
const adminRouter = require('./routes/admin');
const paymentsRouter = require('./routes/payments');

const app = express();
const PORT = process.env.PORT || 3000;
const SITE_URL = process.env.SITE_URL || 'https://www.green-valley-farm.online';
const GOOGLE_SITE_VERIFICATION = process.env.GOOGLE_SITE_VERIFICATION || '';
const BING_SITE_VERIFICATION = process.env.BING_SITE_VERIFICATION || '';
const BING_XML_VERIFICATION = process.env.BING_XML_VERIFICATION || '';
const INDEXNOW_KEY = process.env.INDEXNOW_KEY || '';

// ── Security Headers (Helmet) ──
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'", "https://accounts.google.com", "https://accounts.google.com/gsi/client", "https://checkout.razorpay.com", "https://cdn.razorpay.com", "https://checkout-static-next.razorpay.com", "https://www.googletagmanager.com", "https://www.google-analytics.com", "https://unpkg.com"],
      scriptSrcAttr: ["'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com", "https://accounts.google.com", "https://accounts.google.com/gsi/style", "https://unpkg.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      imgSrc: ["'self'", "data:", "blob:", "https:", "http:", "https://*.tile.openstreetmap.org"],
      connectSrc: ["'self'", "https://accounts.google.com", "https://accounts.google.com/gsi/", "https://api.razorpay.com", "https://lux-gateway.razorpay.com", "https://lumberjack.razorpay.com", "https://cdn.razorpay.com", "https://checkout-static-next.razorpay.com", "https://www.google-analytics.com", "https://oauth2.googleapis.com", "https://nominatim.openstreetmap.org"],
      frameSrc: ["'self'", "https://accounts.google.com", "https://accounts.google.com/gsi/", "https://api.razorpay.com"],
      objectSrc: ["'none'"],
      upgradeInsecureRequests: [],
    },
  },
  crossOriginEmbedderPolicy: false,
  crossOriginResourcePolicy: { policy: "cross-origin" },
  crossOriginOpenerPolicy: { policy: "same-origin-allow-popups" },
}));

// ── Gzip/Brotli Compression ──
app.use(compression());

// ── CORS — restrict to your domain in production ──
const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',')
  : ['https://www.green-valley-farm.online', 'https://green-valley-farm.online'];
app.use(cors({
  origin: process.env.NODE_ENV === 'production'
    ? (origin, cb) => {
        if (!origin || allowedOrigins.includes(origin)) cb(null, true);
        else cb(new Error('CORS not allowed'));
      }
    : true,
  credentials: true,
}));

// ── Rate Limiting — auth endpoints ──
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20,                   // 20 requests per window
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Too many requests. Please try again in 15 minutes.' },
});

// ── Rate Limiting — payment endpoints ──
const paymentLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Too many payment requests. Please try again later.' },
});

// ── Global rate limit (generous) ──
const globalLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,  // 1 minute
  max: 200,                  // 200 req/min per IP
  standardHeaders: true,
  legacyHeaders: false,
});

const reviewLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 12,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Too many review requests. Please slow down and try again shortly.' },
  keyGenerator: (req) => `${ipKeyGenerator(req.ip)}:${req.userId || 'guest'}:${req.params.id || 'review'}`
});

function reviewPayloadGuard(req, res, next) {
  if (!['POST', 'PUT'].includes(req.method) || !/^\/api\/products\/[^/]+\/reviews$/.test(req.path)) {
    return next();
  }

  const photos = Array.isArray(req.body?.photos) ? req.body.photos : [];
  if (photos.length > 3) {
    return res.status(413).json({ success: false, error: 'A maximum of 3 review photos is allowed.' });
  }

  const serialized = JSON.stringify(req.body || {});
  if (serialized.length > 900000) {
    return res.status(413).json({ success: false, error: 'Review payload is too large.' });
  }

  const oversizedPhoto = photos.find(photo => String(photo || '').length > 450000);
  if (oversizedPhoto) {
    return res.status(413).json({ success: false, error: 'Each review photo must stay under the allowed upload size.' });
  }

  next();
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeJson(value) {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}

function getVerificationMetaTags() {
  let tags = '';
  if (GOOGLE_SITE_VERIFICATION) {
    tags += `<meta name="google-site-verification" content="${escapeHtml(GOOGLE_SITE_VERIFICATION)}">`;
  }
  if (BING_SITE_VERIFICATION) {
    tags += `<meta name="msvalidate.01" content="${escapeHtml(BING_SITE_VERIFICATION)}">`;
  }
  return tags;
}

async function buildSitemapXml() {
  const staticPaths = ['/', '/privacy.html', '/terms.html'];
  await store.refreshProducts();
  const productPaths = store.getAllProducts().map(product => `/products/${product.slug}`);
  const urls = [...staticPaths, ...productPaths];
  const lastmod = new Date().toISOString();
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map(url => `  <url>
    <loc>${SITE_URL}${url}</loc>
    <lastmod>${lastmod}</lastmod>
    <changefreq>${url === '/' ? 'daily' : 'weekly'}</changefreq>
    <priority>${url === '/' ? '1.0' : '0.8'}</priority>
  </url>`).join('\n')}
</urlset>`;
}

app.use(globalLimiter);
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(reviewPayloadGuard);

app.get('/service-worker.js', (req, res) => {
  res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.type('application/javascript').sendFile(path.join(__dirname, 'public', 'service-worker.js'));
});

app.get('/manifest.json', (req, res) => {
  res.set('Cache-Control', 'no-cache');
  res.type('application/manifest+json').sendFile(path.join(__dirname, 'public', 'manifest.json'));
});

// ── Static files with caching headers ──
app.use(express.static(path.join(__dirname, 'public'), {
  maxAge: process.env.NODE_ENV === 'production' ? '7d' : 0,
  etag: true,
  lastModified: true,
  index: false,
}));

// ── Store initialization (Blocking for ALL API Routes) ──
// CRITICAL: This must run before authMiddleware so customer users are loaded from DB
// before token verification is attempted. Without this, customer tokens always fail.
let initPromise = null;
async function ensureInit(req, res, next) {
  if (!initPromise) initPromise = store.init();
  try {
    await initPromise;
  } catch (err) {
    console.error('Store init error (non-fatal):', err.message);
  }
  next();
}

// Auth middleware — attaches userId to req if valid token present
async function authMiddleware(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '') || req.query.token;
  if (token) {
    const user = await store.verifyToken(token);
    if (user) { req.userId = user.id; req.userRole = user.role; req.user = user; }
  }
  next();
}

// Admin-only middleware
function adminOnly(req, res, next) {
  if (!req.user) return res.status(401).json({ success: false, error: 'Authentication required' });
  if (req.userRole !== 'admin') return res.status(403).json({ success: false, error: 'Admin access required' });
  next();
}

function requireAuth(req, res, next) {
  if (!req.userId) return res.status(401).json({ success: false, error: 'Login required' });
  next();
}

function adminProductMutationsOnly(req, res, next) {
  if (['POST', 'PUT', 'DELETE'].includes(req.method) && req.userRole !== 'admin') {
    return res.status(403).json({ success: false, error: 'Admin access required' });
  }
  next();
}

// Apply ensureInit THEN authMiddleware to ALL /api routes (order matters!)
app.use('/api', ensureInit, authMiddleware);

// Routes (with rate limiters on sensitive endpoints)
app.use('/api/auth', authLimiter, authRouter);
app.use('/api/products/:id/reviews', reviewLimiter);
app.use('/api/products', adminProductMutationsOnly);
app.use('/api/products', productsRouter);
app.use('/api/cart', cartRouter);
app.use('/api/orders', requireAuth, ordersRouter);
app.use('/api/payments', paymentLimiter, requireAuth, paymentsRouter);

// Public coupon validation (authenticated users)
app.get('/api/coupons/validate', async (req, res) => {
  const code = req.query.code;
  if (!code) return res.status(400).json({ error: 'Coupon code required' });
  const userId = req.user?.id || req.user?._id;
  const result = await store.validateCoupon(code, userId);
  if (result.error) return res.json({ error: result.error });
  res.json({ success: true, coupon: result.coupon });
});

async function runAbandonedCartJob(req, res) {
  const cronSecret = process.env.CRON_SECRET || '';
  const authHeader = req.headers.authorization || '';

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return res.status(401).json({ success: false, error: 'Unauthorized job request' });
  }

  if (process.env.NODE_ENV === 'production' && !cronSecret) {
    return res.status(503).json({ success: false, error: 'CRON_SECRET is required in production' });
  }

  try {
    const result = await store.processAbandonedCarts({
      dryRun: req.query.dryRun === 'true',
      hours: req.query.hours,
      limit: req.query.limit
    });
    res.json(result);
  } catch (err) {
    console.error('[Abandoned Cart Job Error]:', err.message);
    res.status(500).json({ success: false, error: 'Abandoned cart job failed' });
  }
}

app.get('/api/jobs/abandoned-carts', runAbandonedCartJob);
app.post('/api/jobs/abandoned-carts', runAbandonedCartJob);

app.use('/api/admin', adminOnly, adminRouter);

// ── Health Check (for uptime monitoring) ──
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    uptime: Math.floor(process.uptime()),
    timestamp: new Date().toISOString(),
    memory: Math.round(process.memoryUsage().rss / 1024 / 1024) + 'MB',
  });
});

// Status & Diagnosis Route — admin-only to prevent env var info leak
app.get('/api/status', adminOnly, (req, res) => {
  res.json({
    server: 'Running ✅',
    env_mongodb_uri: process.env.MONGODB_URI ? 'Present ✅' : 'NOT FOUND ❌',
    env_jwt_secret: process.env.JWT_SECRET ? 'Present ✅' : 'Using fallback ⚠️',
    env_smtp_user: process.env.SMTP_USER ? 'Present ✅' : 'NOT FOUND ❌',
    env_smtp_pass: process.env.SMTP_PASS ? 'Present ✅' : 'NOT FOUND ❌',
    env_smtp_host: process.env.SMTP_HOST ? 'Present ✅' : 'NOT FOUND ❌',
    env_allowed_origins: process.env.ALLOWED_ORIGINS ? 'Present ✅' : 'Using defaults ℹ️',
    env_razorpay: process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET ? 'Present ✅' : 'NOT FOUND ❌',
    store_initialized: store.isInitialized ? 'Yes ✅' : 'No ❌',
    db_connected: store.dbConnected ? 'Yes ✅' : 'No ❌',
    timestamp: new Date().toISOString()
  });
});

// DB Test endpoint — admin-only to prevent raw MongoDB error info from leaking publicly
app.get('/api/db-test', adminOnly, async (req, res) => {
  try {
    const mongoose = require('mongoose');
    if (mongoose.connection.readyState === 1) {
      return res.json({ status: 'Already connected ✅', readyState: mongoose.connection.readyState });
    }
    await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 5000 });
    res.json({ status: 'Connected successfully ✅' });
  } catch (err) {
    // Log full error server-side only — do not change the response (admin already authenticated)
    console.error('[DB Test] Connection error:', err.message);
    res.json({ 
      status: 'FAILED ❌', 
      error: err.message,
      hint: err.message.includes('ENOTFOUND') ? 'DNS issue - check MongoDB URI spelling' :
            err.message.includes('authentication') ? 'Wrong password in MongoDB URI' :
            err.message.includes('connect ECONNREFUSED') ? 'MongoDB Atlas IP whitelist blocking Vercel' :
            err.message.includes('Server selection timed out') ? 'MongoDB Atlas IP whitelist BLOCKING Vercel - Add 0.0.0.0/0 in Network Access' :
            'Unknown error - check MongoDB Atlas dashboard'
    });
  }
});

// Farm info
app.get('/api/farm', (req, res) => {
  res.json({
    success: true,
    farm: {
      name: 'Green Valley Poultry Farm',
      tagline: 'Farm-Fresh Poultry, Delivered with Care',
      established: 2018,
      location: 'Tengrahan, Minapur, Muzaffarpur, Bihar - 843117',
      phone: '+91 9471800046',
      email: 'sales.greenvalleyfarm@gmail.com',
      hours: 'Mon-Sat: 6:00 AM - 8:00 PM, Sun: 7:00 AM - 2:00 PM',
      certifications: ['Organic Certified', 'Free-Range', 'FSSAI Licensed'],
      description: 'At Green Valley Poultry Farm, we raise our birds the traditional way — free-range, naturally fed, and with genuine care. Established in 2018, our farm spans 25 acres of lush green pastures where our poultry roam freely.'
    }
  });
});

const indexHtmlPath = path.join(__dirname, 'public', 'index.html');

function renderHomePage() {
  const baseHtml = fs.readFileSync(indexHtmlPath, 'utf8');
  return baseHtml.replace('</head>', `${getVerificationMetaTags()}</head>`);
}

function renderProductPage(product) {
  const baseHtml = fs.readFileSync(indexHtmlPath, 'utf8');
  const approvedReviews = store.getProductReviews(product.id, { sort: 'newest' }).slice(0, 5);
  const canonicalUrl = `${SITE_URL}/products/${product.slug}`;
  const title = `${product.name} | Green Valley Poultry Farm`;
  const description = `${product.description || `Buy ${product.name} from Green Valley Poultry Farm.`}`.slice(0, 160);
  const image = product.imageUrl?.startsWith('http')
    ? product.imageUrl
    : `${SITE_URL}${product.imageUrl || '/images/logo.png'}`;
  const productSchema = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: product.name,
    description,
    image: [image],
    sku: product.id,
    brand: { '@type': 'Brand', name: 'Green Valley Poultry Farm' },
    offers: {
      '@type': 'Offer',
      priceCurrency: 'INR',
      price: product.price,
      availability: product.stock > 0 ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock',
      url: canonicalUrl
    },
    aggregateRating: product.reviewCount ? {
      '@type': 'AggregateRating',
      ratingValue: product.averageRating,
      reviewCount: product.reviewCount
    } : undefined,
    review: approvedReviews.map(review => ({
      '@type': 'Review',
      author: { '@type': 'Person', name: review.userName },
      reviewRating: { '@type': 'Rating', ratingValue: review.rating, bestRating: 5 },
      reviewBody: review.comment,
      datePublished: review.createdAt
    }))
  };

  return baseHtml
    .replace(/<title>[\s\S]*?<\/title>/, `<title>${escapeHtml(title)}</title>`)
    .replace(/<meta name="description" content="[^"]*">/, `<meta name="description" content="${escapeHtml(description)}">`)
    .replace(/<link rel="canonical" href="[^"]*">/, `<link rel="canonical" href="${canonicalUrl}">`)
    .replace(/<meta property="og:url" content="[^"]*">/, `<meta property="og:url" content="${canonicalUrl}">`)
    .replace(/<meta property="og:title" content="[^"]*">/, `<meta property="og:title" content="${escapeHtml(title)}">`)
    .replace(/<meta property="og:description" content="[^"]*">/, `<meta property="og:description" content="${escapeHtml(description)}">`)
    .replace(/<meta property="og:image" content="[^"]*">/, `<meta property="og:image" content="${image}">`)
    .replace(/<meta name="twitter:title" content="[^"]*">/, `<meta name="twitter:title" content="${escapeHtml(title)}">`)
    .replace(/<meta name="twitter:description" content="[^"]*">/, `<meta name="twitter:description" content="${escapeHtml(description)}">`)
    .replace(/<meta name="twitter:image" content="[^"]*">/, `<meta name="twitter:image" content="${image}">`)
    .replace('</head>', `${getVerificationMetaTags()}<script type="application/ld+json">${escapeJson(productSchema)}</script><script>window.__GVF_PRODUCT_SLUG=${escapeJson(product.slug)};</script></head>`);
}

app.get('/robots.txt', (req, res) => {
  res.type('text/plain').send([
    'User-agent: *',
    'Allow: /',
    'Disallow: /admin',
    'Disallow: /api/',
    `Sitemap: ${SITE_URL}/sitemap.xml`
  ].join('\n'));
});

app.get('/sitemap.xml', async (req, res) => {
  res.type('application/xml').send(await buildSitemapXml());
});

app.get('/BingSiteAuth.xml', (req, res) => {
  if (!BING_XML_VERIFICATION) return res.status(404).send('Not configured');
  res.type('application/xml').send(BING_XML_VERIFICATION);
});

app.get(`/${INDEXNOW_KEY || '__indexnow_not_configured__'}.txt`, (req, res) => {
  if (!INDEXNOW_KEY) return res.status(404).send('Not configured');
  res.type('text/plain').send(INDEXNOW_KEY);
});

// SPA fallback
app.get('/products/:slug', (req, res) => {
  const product = store.getProductBySlug(req.params.slug);
  if (!product) return res.status(404).sendFile(indexHtmlPath);
  res.send(renderProductPage(product));
});
app.get('/', (req, res) => res.send(renderHomePage()));
app.get('/admin', (req, res) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.sendFile(path.join(__dirname, 'public', 'admin2.html'));
});

app.get('/api/debug-deploy', (req, res) => {
  res.json({
    version: '2026-05-16-v3',
    message: 'If you see this, the latest server.js is deployed.',
    adminFile: 'admin2.html'
  });
});

// ── Global Error Handling Middleware ──
app.use((err, req, res, next) => {
  console.error('[Global Error]:', err.stack || err.message);
  
  if (req.path.startsWith('/api/')) {
    return res.status(err.status || 500).json({
      success: false,
      error: process.env.NODE_ENV === 'production' ? 'Internal Server Error' : err.message
    });
  }
  
  res.status(500).send('Something went wrong. Please try again later.');
});

// Start local server only if NOT running on Vercel
if (!process.env.VERCEL) {
  if (!initPromise) initPromise = store.init();
  initPromise.then(() => {
    app.listen(PORT, () => {
      console.log(`\n  🐔  Green Valley Poultry Farm Server`);
      console.log(`  ──────────────────────────────────────`);
      console.log(`  🌐  Local: http://localhost:${PORT}`);
      console.log(`  ──────────────────────────────────────\n`);
    });
  }).catch(err => console.error('Local init failed:', err.message));
}

// CRITICAL for Vercel: Export the express app as a module
module.exports = app;
