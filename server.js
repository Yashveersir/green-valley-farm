require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const store = require('./models/store');

const authRouter = require('./routes/auth');
const productsRouter = require('./routes/products');
const cartRouter = require('./routes/cart');
const ordersRouter = require('./routes/orders');
const adminRouter = require('./routes/admin');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Auth middleware — attaches userId to req if valid token present
function authMiddleware(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (token) {
    const user = store.verifyToken(token);
    if (user) { req.userId = user.id; req.userRole = user.role; req.user = user; }
  }
  next();
}

// Admin-only middleware
function adminOnly(req, res, next) {
  if (req.userRole !== 'admin') return res.status(403).json({ success: false, error: 'Admin access required' });
  next();
}

// Ensurer middleware — ensures store is initialized before any API request
let initPromise = null;
async function ensureInit(req, res, next) {
  if (!initPromise) initPromise = store.init();
  try {
    await initPromise;
    next();
  } catch (err) {
    console.error('Initialization Error:', err.message);
    next(); // Continue even if failed (will use memory fallback)
  }
}

app.use(ensureInit);
app.use(authMiddleware);

// Routes
app.use('/api/auth', authRouter);
app.use('/api/products', productsRouter);
app.use('/api/cart', cartRouter);
app.use('/api/orders', ordersRouter);
app.use('/api/admin', adminOnly, adminRouter);

// Protect admin product mutations
app.use('/api/products', (req, res, next) => {
  if (['POST', 'PUT', 'DELETE'].includes(req.method) && req.userRole !== 'admin') {
    return res.status(403).json({ success: false, error: 'Admin access required' });
  }
  next();
});

// Status & Diagnosis Route
app.get('/api/status', async (req, res) => {
  const uri = process.env.MONGODB_URI ? 'Present ✅' : 'NOT FOUND ❌';
  const connected = await db.connectDB();
  res.json({
    env_uri: uri,
    db_connected: connected ? 'Yes ✅' : 'No ❌',
    store_initialized: store.isInitialized ? 'Yes ✅' : 'No ❌',
    timestamp: new Date().toISOString()
  });
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

// SPA fallback
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));

// Removed the top-level store.init() to prevent race conditions on Vercel.
// The ensureInit middleware will perfectly handle the Cold Start connection!

// Start local server only if NOT running on Vercel
if (process.env.NODE_ENV !== 'production' && !process.env.VERCEL) {
  initPromise = store.init();
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
