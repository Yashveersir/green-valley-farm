require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const store = require('./models/store');
const db = require('./models/db');

const authRouter = require('./routes/auth');
const productsRouter = require('./routes/products');
const cartRouter = require('./routes/cart');
const ordersRouter = require('./routes/orders');
const adminRouter = require('./routes/admin');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ── Store initialization (non-blocking) ──
// On Vercel, we fire-and-forget the init. It runs in the background.
// If it finishes before the first DB-dependent request, great.
// If not, the store falls back to in-memory defaults (hardcoded admins + products.json).
let initPromise = store.init().catch(err => {
  console.error('Store init error (non-fatal):', err.message);
});

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

// Status & Diagnosis Route (non-blocking, instant response)
app.get('/api/status', (req, res) => {
  res.json({
    server: 'Running ✅',
    env_mongodb_uri: process.env.MONGODB_URI ? 'Present ✅' : 'NOT FOUND ❌',
    env_smtp_user: process.env.SMTP_USER ? 'Present ✅' : 'NOT FOUND ❌',
    env_smtp_pass: process.env.SMTP_PASS ? 'Present ✅' : 'NOT FOUND ❌',
    env_smtp_host: process.env.SMTP_HOST ? 'Present ✅' : 'NOT FOUND ❌',
    store_initialized: store.isInitialized ? 'Yes ✅' : 'No ❌',
    db_connected: store.dbConnected ? 'Yes ✅' : 'No ❌',
    timestamp: new Date().toISOString()
  });
});

// DB Test endpoint - shows the exact MongoDB error
app.get('/api/db-test', async (req, res) => {
  try {
    const mongoose = require('mongoose');
    if (mongoose.connection.readyState === 1) {
      return res.json({ status: 'Already connected ✅', readyState: mongoose.connection.readyState });
    }
    await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 5000 });
    res.json({ status: 'Connected successfully ✅' });
  } catch (err) {
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

// SPA fallback
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));

// Start local server only if NOT running on Vercel
if (!process.env.VERCEL) {
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
