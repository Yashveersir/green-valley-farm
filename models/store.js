const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const nodemailer = require('nodemailer');
const db = require('./db');

const TOKEN_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';
const ACCESS_TOKEN_EXPIRES_IN = process.env.ACCESS_TOKEN_EXPIRES_IN || '15m';
const REFRESH_TOKEN_EXPIRES_IN = process.env.REFRESH_TOKEN_EXPIRES_IN || '30d';
const BCRYPT_ROUNDS = Number(process.env.BCRYPT_ROUNDS) || 12;

function getAuthSecret() {
  return process.env.JWT_SECRET || process.env.MONGODB_URI || 'greenvalley-dev-secret-change-me';
}

// Legacy stateless token helpers kept only so existing signed-in users are not forced out.
function createLegacyToken(userId) {
  const ts = Date.now();
  const secret = getAuthSecret();
  const sig = crypto.createHmac('sha256', secret).update(`${userId}:${ts}`).digest('hex').slice(0, 16);
  return Buffer.from(`${userId}:${ts}:${sig}`).toString('base64url');
}

function verifyLegacyToken(raw) {
  try {
    // Support both base64url (new) and base64 (old)
    const decoded = Buffer.from(raw, 'base64url').toString();
    const lastColon = decoded.lastIndexOf(':');
    const firstColon = decoded.indexOf(':');
    if (firstColon === -1 || firstColon === lastColon) return null;
    const userId = decoded.slice(0, firstColon);
    const middle = decoded.slice(firstColon + 1, lastColon);
    const sig = decoded.slice(lastColon + 1);
    const secret = getAuthSecret();
    const expected = crypto.createHmac('sha256', secret).update(`${userId}:${middle}`).digest('hex').slice(0, 16);
    if (sig !== expected) return null;
    // Token valid for 7 days
    if (Date.now() - parseInt(middle) > 7 * 24 * 60 * 60 * 1000) return null;
    return userId;
  } catch { return null; }
}

function createAuthToken(user) {
  return jwt.sign(
    { sub: user.id, role: user.role || 'customer', type: 'access' },
    getAuthSecret(),
    { expiresIn: ACCESS_TOKEN_EXPIRES_IN || TOKEN_EXPIRES_IN }
  );
}

function createRefreshToken(user, sessionId) {
  return jwt.sign(
    { sub: user.id, role: user.role || 'customer', type: 'refresh', sid: sessionId },
    getAuthSecret(),
    { expiresIn: REFRESH_TOKEN_EXPIRES_IN }
  );
}

function verifyJwtToken(raw, expectedType = 'access') {
  try {
    const payload = jwt.verify(raw, getAuthSecret());
    if (payload.type !== expectedType) return null;
    return payload.sub || payload.userId || null;
  } catch {
    return null;
  }
}

function decodeJwt(raw) {
  try {
    return jwt.verify(raw, getAuthSecret());
  } catch {
    return null;
  }
}

function isBcryptHash(value) {
  return /^\$2[aby]\$\d{2}\$/.test(String(value || ''));
}

async function hashPassword(password) {
  return bcrypt.hash(String(password || ''), BCRYPT_ROUNDS);
}

function hashRefreshToken(token) {
  return crypto.createHash('sha256').update(String(token || '')).digest('hex');
}

function safeUser(user) {
  if (!user) return null;
  const { password, passwordHash, ...safe } = user;
  return safe;
}

async function ensureUserPasswordHash(user, fallbackPassword = '') {
  if (!user) return false;
  const currentHash = user.passwordHash || '';
  const legacyPassword = user.password || fallbackPassword;

  if (isBcryptHash(currentHash)) {
    if (user.password) {
      delete user.password;
      return true;
    }
    return false;
  }

  if (isBcryptHash(legacyPassword)) {
    user.passwordHash = legacyPassword;
    delete user.password;
    return true;
  }

  if (!legacyPassword || String(legacyPassword).startsWith('google:')) {
    delete user.password;
    return Boolean(user.password);
  }

  user.passwordHash = await hashPassword(legacyPassword);
  delete user.password;
  return true;
}

async function ensureAllUserPasswordHashes(userList) {
  let changed = false;
  for (const user of userList) {
    const fallback = SEEDED_ADMIN_PASSWORDS[(user.email || '').toLowerCase().trim()] || '';
    if (await ensureUserPasswordHash(user, fallback)) changed = true;
  }
  return changed;
}

async function verifyPassword(user, candidatePassword) {
  if (!user) return false;
  if (isBcryptHash(user.passwordHash)) {
    return bcrypt.compare(String(candidatePassword || ''), user.passwordHash);
  }
  if (isBcryptHash(user.password)) {
    return bcrypt.compare(String(candidatePassword || ''), user.password);
  }
  return Boolean(user.password) && String(user.password) === String(candidatePassword || '');
}

function buildAuthResponse(user, refreshToken = null) {
  return {
    user: safeUser(user),
    token: createAuthToken(user),
    refreshToken
  };
}

function getRefreshSessions(user) {
  if (!user) return [];
  if (!Array.isArray(user.refreshSessions)) user.refreshSessions = [];
  return user.refreshSessions;
}

function pruneRefreshSessions(user) {
  const now = Date.now();
  user.refreshSessions = getRefreshSessions(user).filter(session => {
    const expiresAt = Date.parse(session.expiresAt || '');
    return session.tokenHash && !Number.isNaN(expiresAt) && expiresAt > now;
  });
}

async function issueRefreshSession(user) {
  pruneRefreshSessions(user);
  const sessionId = `session-${uuidv4().slice(0, 12)}`;
  const refreshToken = createRefreshToken(user, sessionId);
  const payload = decodeJwt(refreshToken);
  const expiresAt = payload?.exp ? new Date(payload.exp * 1000).toISOString() : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  getRefreshSessions(user).push({
    id: sessionId,
    tokenHash: hashRefreshToken(refreshToken),
    createdAt: new Date().toISOString(),
    expiresAt,
    lastUsedAt: null
  });
  return refreshToken;
}

async function revokeRefreshSession(user, refreshToken) {
  if (!user || !refreshToken) return false;
  const tokenHash = hashRefreshToken(refreshToken);
  const before = getRefreshSessions(user).length;
  user.refreshSessions = getRefreshSessions(user).filter(session => session.tokenHash !== tokenHash);
  return before !== user.refreshSessions.length;
}

const mailer = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp-relay.brevo.com',
  port: parseInt(process.env.SMTP_PORT) || 587,
  secure: false,
  auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
});

// Load products (using require ensures it is bundled by Vercel)
let products = require('../data/products.json');

// ── In-memory data ──
let carts = {};       // userId -> cart items[]
let orders = [];
let notifications = [];
let reviews = [];
let users = [
  {
    id: 'admin-001',
    name: 'Farm Admin',
    email: 'sales.greenvalleyfarm@gmail.com',
    password: 'REDACTED',
    phone: '+91 9471800046',
    role: 'admin',
    createdAt: new Date().toISOString()
  },
  {
    id: 'admin-002',
    name: 'Anjiv Singh',
    email: 'REDACTED@gmail.com',
    password: 'REDACTED',
    phone: '+91 9471800046',
    role: 'admin',
    createdAt: new Date().toISOString()
  }
];
let pendingOtps = {}; // email -> { otp, payload, expires }
const SEEDED_ADMIN_PASSWORDS = {
  'sales.greenvalleyfarm@gmail.com': 'REDACTED',
  'REDACTED@gmail.com': 'REDACTED'
};
const ORDER_STATUSES = ['confirmed', 'processing', 'dispatched', 'delivered', 'cancelled'];
const CUSTOMER_CANCELLABLE_STATUSES = ['confirmed', 'processing'];
const ORDER_CANCEL_WINDOW_MS = 2 * 60 * 60 * 1000;
const REVIEW_STATUSES = ['pending', 'approved', 'rejected'];
const REVIEW_SORTERS = {
  newest: (a, b) => new Date(b.updatedAt || b.createdAt) - new Date(a.updatedAt || a.createdAt),
  oldest: (a, b) => new Date(a.updatedAt || a.createdAt) - new Date(b.updatedAt || b.createdAt),
  highest: (a, b) => b.rating - a.rating || new Date(b.createdAt) - new Date(a.createdAt),
  lowest: (a, b) => a.rating - b.rating || new Date(b.createdAt) - new Date(a.createdAt)
};
const MAX_REVIEW_PHOTOS = 3;
const MAX_REVIEW_PHOTO_DATA_URL_LENGTH = 450000;

function sanitizeText(value, maxLength = 500) {
  return String(value || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

function sanitizeTags(tags) {
  if (!Array.isArray(tags)) return [];
  return [...new Set(
    tags
      .map(tag => sanitizeText(tag, 30).toLowerCase())
      .filter(Boolean)
  )];
}

function slugify(value) {
  const base = sanitizeText(value, 120)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return base || `product-${uuidv4().slice(0, 6)}`;
}

function buildUniqueProductSlug(name, currentId = null) {
  const base = slugify(name);
  let candidate = base;
  let suffix = 2;
  while (products.some(product => product.slug === candidate && product.id !== currentId)) {
    candidate = `${base}-${suffix++}`;
  }
  return candidate;
}

function sanitizePhotoUrl(photo, index = 0) {
  const value = String(typeof photo === 'object' && photo !== null ? (photo.url || '') : (photo || '')).trim();
  if (!value) return null;
  const isAllowed = value.startsWith('data:image/') || /^https?:\/\//i.test(value) || value.startsWith('/');
  if (!isAllowed) return null;
  return {
    id: typeof photo === 'object' && photo !== null && photo.id ? photo.id : `photo-${Date.now().toString(36)}-${index}`,
    url: value.slice(0, MAX_REVIEW_PHOTO_DATA_URL_LENGTH)
  };
}

function sanitizeReviewPhotos(photos) {
  if (!Array.isArray(photos)) return [];
  return photos
    .slice(0, MAX_REVIEW_PHOTOS)
    .map((photo, index) => sanitizePhotoUrl(photo, index))
    .filter(Boolean);
}

function normalizeProduct(product) {
  if (!product) return null;
  const normalized = {
    ...product,
    name: sanitizeText(product.name, 120),
    category: sanitizeText(product.category || 'live-birds', 40) || 'live-birds',
    description: sanitizeText(product.description, 1200),
    price: Number(product.price) || 0,
    unit: sanitizeText(product.unit || 'per unit', 40) || 'per unit',
    stock: Math.max(0, Number(product.stock) || 0),
    weight: sanitizeText(product.weight || 'N/A', 40) || 'N/A',
    emoji: sanitizeText(product.emoji || '🐔', 10) || '🐔',
    tags: sanitizeTags(product.tags || []),
    farmOrigin: sanitizeText(product.farmOrigin || 'Green Valley Farm', 120) || 'Green Valley Farm',
    imageUrl: sanitizeText(product.imageUrl || '', 500),
    slug: sanitizeText(product.slug || '', 160)
  };

  normalized.slug = normalized.slug || buildUniqueProductSlug(normalized.name, normalized.id);
  return normalized;
}

function normalizeReview(review) {
  return {
    ...review,
    rating: Math.max(1, Math.min(5, Number(review.rating) || 0)),
    comment: sanitizeText(review.comment, 500),
    status: REVIEW_STATUSES.includes(review.status) ? review.status : 'pending',
    rejectionNote: sanitizeText(review.rejectionNote, 280),
    photos: sanitizeReviewPhotos(review.photos || []),
    updatedAt: review.updatedAt || null,
    approvedAt: review.approvedAt || null,
    approvedBy: review.approvedBy || null,
    moderatedAt: review.moderatedAt || null,
    moderatedBy: review.moderatedBy || null
  };
}

function summarizeReviews(productId) {
  const approved = reviews.filter(r => r.productId === productId && r.status === 'approved');
  const reviewCount = approved.length;
  const averageRating = reviewCount
    ? Number((approved.reduce((sum, review) => sum + review.rating, 0) / reviewCount).toFixed(1))
    : 0;
  const ratingBreakdown = approved.reduce((acc, review) => {
    acc[review.rating] = (acc[review.rating] || 0) + 1;
    return acc;
  }, { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 });
  return {
    averageRating,
    reviewCount,
    ratingBreakdown,
    photoReviewCount: approved.filter(review => (review.photos || []).length > 0).length
  };
}

function enrichProduct(product) {
  if (!product) return null;
  return { ...product, ...summarizeReviews(product.id) };
}

function enrichReview(review) {
  const product = products.find(entry => entry.id === review.productId);
  return {
    ...review,
    productName: product?.name || 'Unknown product',
    productSlug: product?.slug || null
  };
}

function restoreOrderStock(order) {
  if (!order || order.stockRestored) return;
  for (const item of order.items || []) {
    const product = products.find(p => p.id === item.productId);
    if (product) product.stock += item.quantity;
  }
  order.stockRestored = true;
}

function reserveOrderStock(order) {
  if (!order || !order.stockRestored) return;
  for (const item of order.items || []) {
    const product = products.find(p => p.id === item.productId);
    if (product) product.stock = Math.max(0, product.stock - item.quantity);
  }
  order.stockRestored = false;
}

function getCancelDeadline(order) {
  return new Date(new Date(order.placedAt).getTime() + ORDER_CANCEL_WINDOW_MS);
}

const store = {
  isInitialized: false,
  // ══════ DATABASE INIT ══════
  async init() {
    if (this.isInitialized && this.dbConnected) return true;
    try {
      const connected = await db.connectDB();
      if (connected) {
        console.log('[Store] MongoDB connected, loading data...');
        await db.bootstrapCollections(['users', 'orders', 'carts', 'notifications', 'products', 'pendingOtps', 'reviews']);

        const savedUsers = await db.loadData('users');
        if (savedUsers && savedUsers.length > 0) {
          let needsSave = false;

          // DEDUPLICATION: Clean up existing database duplicates
          const uniqueUsers = [];
          const seenEmails = new Set();
          for (const u of savedUsers) {
            const emailKey = (u.email || '').toLowerCase().trim();
            if (emailKey && !seenEmails.has(emailKey)) {
              seenEmails.add(emailKey);
              uniqueUsers.push(u);
            } else {
              needsSave = true; // Found a duplicate or empty email, will force a cleanup save
            }
          }

          const adminIndex = uniqueUsers.findIndex(u => (u.email || '').toLowerCase() === 'sales.greenvalleyfarm@gmail.com');
          if (adminIndex !== -1) {
            if (uniqueUsers[adminIndex].role !== 'admin') {
              uniqueUsers[adminIndex].role = 'admin';
              needsSave = true;
            }
            if (!uniqueUsers[adminIndex].password) {
              uniqueUsers[adminIndex].password = users[0].password;
              needsSave = true;
            }
          } else {
            uniqueUsers.push(users[0]);
            needsSave = true;
          }
          
          const anjivIndex = uniqueUsers.findIndex(u => (u.email || '').toLowerCase() === 'REDACTED@gmail.com');
          if (anjivIndex !== -1) {
            if (uniqueUsers[anjivIndex].role !== 'admin') {
              uniqueUsers[anjivIndex].role = 'admin';
              needsSave = true;
            }
            if (!uniqueUsers[anjivIndex].password) {
              uniqueUsers[anjivIndex].password = users[1].password;
              needsSave = true;
            }
          } else {
            uniqueUsers.push(users[1]);
            needsSave = true;
          }

          users = uniqueUsers;
          if (await ensureAllUserPasswordHashes(users)) {
            needsSave = true;
          }
          if (needsSave) {
            await db.saveData('users', users);
          }
        } else {
          await ensureAllUserPasswordHashes(users);
          await db.saveData('users', users);
        }
        
        const savedOrders = await db.loadData('orders');
        if (savedOrders) orders = savedOrders;

        const savedCarts = await db.loadData('carts');
        if (savedCarts) carts = savedCarts;

        const savedNotifs = await db.loadData('notifications');
        if (savedNotifs) notifications = savedNotifs;

        const savedReviews = await db.loadData('reviews');
        if (savedReviews) reviews = savedReviews.map(normalizeReview);
        
        const savedProducts = await db.loadData('products');
        if (savedProducts && savedProducts.length > 0) {
          products = savedProducts.map(normalizeProduct);
        } else {
          products = products.map(normalizeProduct);
          await db.saveData('products', products);
        }
        console.log('[Store] All data loaded from MongoDB ✅');
        this.dbConnected = true;
      } else {
        console.log('[Store] MongoDB not available, using in-memory defaults (admins + products.json)');
        await ensureAllUserPasswordHashes(users);
      }
    } catch (err) {
      console.error('[Store] Init error (non-fatal):', err.message);
    }
    // ALWAYS mark as initialized so we don't block requests
    this.isInitialized = true;
    return true;
  },

  // ══════ OTP & AUTH (Stateless HMAC - Works on Vercel Serverless) ══════
  _generateOtpHash(email, otp, expires) {
    // ALWAYS compute secret lazily so env vars are guaranteed loaded
    return crypto.createHmac('sha256', getAuthSecret()).update(`${email}:${otp}:${expires}`).digest('hex');
  },

  async sendAuthOtp(email, payload) {
    if (!email) return { error: 'Email address is required' };
    const cleanEmail = email.trim().toLowerCase();
    const otp = Math.floor(1000 + Math.random() * 9000).toString();
    const expires = Date.now() + 5 * 60000; // 5 minutes
    const hash = this._generateOtpHash(cleanEmail, otp, expires);
    
    // Also store in memory as fallback (works when same instance handles both requests)
    pendingOtps[cleanEmail] = { otp, payload, expires };
    
    const messageBody = `Your Green Valley Poultry Farm OTP is: ${otp}. It is valid for 5 minutes. Please do not share this code.`;
    
    if (process.env.SMTP_USER && process.env.SMTP_PASS) {
      try {
        await mailer.sendMail({
          from: `"Green Valley Farm" <${process.env.SMTP_FROM || process.env.SMTP_USER}>`,
          to: cleanEmail,
          subject: `${otp} is your Green Valley OTP`,
          text: messageBody
        });
        console.log(`[Nodemailer] Sent real Email OTP to ${cleanEmail}`);
      } catch (err) {
        console.error('[Nodemailer Email Error]:', err.message);
      }
    } else {
      console.log(`[MOCK EMAIL] OTP for ${cleanEmail}: ${otp}`);
    }
    // Return hash|expires|payload — use | as separator to avoid base64 colon issues
    const payloadEncoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
    return { success: true, otpToken: `${hash}|${expires}|${payloadEncoded}` };
  },

  async verifyAuthOtp(email, otp, otpToken) {
    const cleanEmail = (email || '').trim().toLowerCase();
    const cleanOtp = (otp || '').trim();
    
    // METHOD 1: Try in-memory first (same serverless instance)
    const record = pendingOtps[cleanEmail];
    if (record && record.otp === cleanOtp && record.expires > Date.now()) {
      const payload = record.payload;
      delete pendingOtps[cleanEmail];
      return await this._executeOtpAction(cleanEmail, payload);
    }
    
    // METHOD 2: Stateless HMAC verification (different serverless instance)
    if (otpToken) {
      // Use | as separator to avoid base64 colon ambiguity
      const parts = otpToken.split('|');
      if (parts.length === 3) {
        const [hash, expiresStr, payloadEncoded] = parts;
        const expires = parseInt(expiresStr);
        
        if (Date.now() > expires) return { error: 'OTP has expired. Please request a new one.' };
        
        const expectedHash = this._generateOtpHash(cleanEmail, cleanOtp, expires);
        if (hash === expectedHash) {
          const payload = JSON.parse(Buffer.from(payloadEncoded, 'base64url').toString());
          return await this._executeOtpAction(cleanEmail, payload);
        }
      }
    }
    
    return { error: 'Invalid or expired OTP' };
  },

  async _executeOtpAction(cleanEmail, payload) {
    // Robust sync before actions to prevent duplicates/missing users on serverless
    if (this.dbConnected) {
      const freshUsers = await db.loadData('users');
      if (freshUsers) users = freshUsers;
    }
    if (payload.action === 'register') {
      return await this.registerUser(payload.userData);
    } else if (payload.action === 'login') {
      const user = users.find(u => (u.email || '').toLowerCase() === cleanEmail);
      if (!user) return { error: 'No account found with this email' };
      const refreshToken = await issueRefreshSession(user);
      await db.saveData('users', users);
      return buildAuthResponse(user, refreshToken);
    } else if (payload.action === 'reset-password') {
      const user = users.find(u => u.email.toLowerCase() === cleanEmail);
      if (!user) return { error: 'No account found with this email' };
      return { success: true, email: cleanEmail };
    }
    return { error: 'Invalid OTP action' };
  },

  async resetUserPassword(email, newPassword) {
    const user = users.find(u => u.email.toLowerCase() === (email || '').trim().toLowerCase());
    if (!user) return { error: 'User not found' };
    user.passwordHash = await hashPassword(newPassword);
    delete user.password;
    await db.saveData('users', users);
    return { success: true };
  },

  async registerUser({ name, email, password, phone }) {
    const cleanEmail = (email || '').trim().toLowerCase();
    if (!name || !cleanEmail || !password) return { error: 'Name, email, and password are required' };
    
    if (this.dbConnected) {
      const freshUsers = await db.loadData('users');
      if (freshUsers) users = freshUsers;
    }
    
    if (users.find(u => (u.email || '').toLowerCase().trim() === cleanEmail)) return { error: 'Email already registered' };
    const user = {
      id: `user-${uuidv4().slice(0, 8)}`,
      name,
      email: cleanEmail,
      passwordHash: await hashPassword(password),
      phone: phone || '',
      role: 'customer',
      createdAt: new Date().toISOString()
    };
    users.push(user);
    await db.saveData('users', users);
    const refreshToken = await issueRefreshSession(user);
    await db.saveData('users', users);
    return buildAuthResponse(user, refreshToken);
  },

  async updateUserProfile(userId, data) {
    const user = users.find(u => u.id === userId);
    if (!user) return { error: 'User not found' };
    if (data.name) user.name = data.name;
    if (data.phone) user.phone = data.phone;
    if (data.newPassword) {
      user.passwordHash = await hashPassword(data.newPassword);
      delete user.password;
    }
    await db.saveData('users', users);
    return { user: safeUser(user) };
  },

  async loginWithGoogle(profile) {
    const cleanEmail = (profile.email || '').trim().toLowerCase();
    if (!profile.sub || !cleanEmail) return { error: 'Invalid Google profile' };
    if (profile.email_verified === false) return { error: 'Google email is not verified' };

    if (this.dbConnected) {
      const freshUsers = await db.loadData('users');
      if (freshUsers) users = freshUsers;
    }

    let user = users.find(u => u.googleId === profile.sub);

    if (!user) {
      user = users.find(u => (u.email || '').toLowerCase().trim() === cleanEmail);
      if (user) {
        user.googleId = profile.sub;
        user.authProvider = user.authProvider || 'google';
        user.avatar = profile.picture || user.avatar || '';
        user.emailVerified = true;
      }
    }

    if (!user) {
      user = {
        id: `user-${uuidv4().slice(0, 8)}`,
        name: profile.name || cleanEmail.split('@')[0],
        email: cleanEmail,
        phone: '',
        role: 'customer',
        authProvider: 'google',
        googleId: profile.sub,
        avatar: profile.picture || '',
        emailVerified: true,
        createdAt: new Date().toISOString()
      };
      users.push(user);
    }

    await db.saveData('users', users);
    const refreshToken = await issueRefreshSession(user);
    await db.saveData('users', users);
    return buildAuthResponse(user, refreshToken);
  },

  async loginUser(email, password) {
    const cleanEmail = (email || '').trim().toLowerCase();
    const cleanPassword = String(password || '');
    if (this.dbConnected) {
      const freshUsers = await db.loadData('users');
      if (freshUsers) users = freshUsers;
    }
    const user = users.find(u => (u.email || '').trim().toLowerCase() === cleanEmail);
    if (!user) return { error: 'Invalid email or password' };
    const passwordOk = await verifyPassword(user, cleanPassword);
    if (!passwordOk) return { error: 'Invalid email or password' };
    if (await ensureUserPasswordHash(user)) {
      await db.saveData('users', users);
    }
    const refreshToken = await issueRefreshSession(user);
    await db.saveData('users', users);
    return buildAuthResponse(user, refreshToken);
  },

  async verifyToken(token) {
    // Try JWT first. Legacy HMAC tokens are accepted temporarily for active sessions.
    const userId = verifyJwtToken(token, 'access') || verifyLegacyToken(token);
    if (userId) {
      let user = users.find(u => u.id === userId);
      
      // SERVERLESS STALE-MEMORY FIX: If user not in RAM, they might have been created/updated 
      // on a different lambda instance. Reload users from DB to be absolutely sure!
      if (!user && this.dbConnected) {
        const freshUsers = await db.loadData('users');
        if (freshUsers) {
          users = freshUsers; // Sync RAM
          user = users.find(u => u.id === userId);
        }
      }

      if (user) {
        return safeUser(user);
      }
    }
    return null;
  },

  logoutUser(token) {
    return Boolean(token);
  },

  async refreshAuthToken(refreshToken) {
    const payload = decodeJwt(refreshToken);
    if (!payload || payload.type !== 'refresh' || !payload.sub || !payload.sid) {
      return { error: 'Invalid refresh token' };
    }

    if (this.dbConnected) {
      const freshUsers = await db.loadData('users');
      if (freshUsers) users = freshUsers;
    }

    const user = users.find(u => u.id === payload.sub);
    if (!user) return { error: 'User not found' };

    pruneRefreshSessions(user);
    const tokenHash = hashRefreshToken(refreshToken);
    const session = getRefreshSessions(user).find(entry => entry.id === payload.sid && entry.tokenHash === tokenHash);
    if (!session) {
      await db.saveData('users', users);
      return { error: 'Refresh session expired. Please login again.' };
    }

    const rotatedRefreshToken = await issueRefreshSession(user);
    user.refreshSessions = getRefreshSessions(user).filter(entry => entry.id !== session.id);
    const replacement = getRefreshSessions(user).find(entry => entry.tokenHash === hashRefreshToken(rotatedRefreshToken));
    if (replacement) replacement.lastUsedAt = new Date().toISOString();
    await db.saveData('users', users);

    return buildAuthResponse(user, rotatedRefreshToken);
  },

  async logoutSession(refreshToken) {
    if (!refreshToken) return { success: true };

    const payload = decodeJwt(refreshToken);
    if (!payload?.sub) return { success: true };

    if (this.dbConnected) {
      const freshUsers = await db.loadData('users');
      if (freshUsers) users = freshUsers;
    }

    const user = users.find(u => u.id === payload.sub);
    if (!user) return { success: true };
    pruneRefreshSessions(user);
    await revokeRefreshSession(user, refreshToken);
    await db.saveData('users', users);
    return { success: true };
  },

  // ══════ PRODUCTS ══════
  getAllProducts(category = null, options = {}) {
    const search = sanitizeText(options.search || '', 120).toLowerCase();
    const sort = sanitizeText(options.sort || 'featured', 20);
    const minRating = Math.max(0, Number(options.minRating) || 0);
    let filtered = category && category !== 'all'
      ? products.filter(p => p.category === category)
      : [...products];

    if (search) {
      filtered = filtered.filter(p =>
        p.name.toLowerCase().includes(search) ||
        p.description.toLowerCase().includes(search) ||
        (p.tags || []).some(tag => tag.toLowerCase().includes(search))
      );
    }

    filtered = filtered.map(enrichProduct).filter(product => (product.averageRating || 0) >= minRating);

    if (sort === 'price-asc') filtered.sort((a, b) => a.price - b.price);
    else if (sort === 'price-desc') filtered.sort((a, b) => b.price - a.price);
    else if (sort === 'rating') filtered.sort((a, b) => (b.averageRating - a.averageRating) || (b.reviewCount - a.reviewCount));
    else if (sort === 'reviews') filtered.sort((a, b) => (b.reviewCount - a.reviewCount) || (b.averageRating - a.averageRating));
    else if (sort === 'name') filtered.sort((a, b) => a.name.localeCompare(b.name));

    return filtered;
  },

  getProductById(id) {
    return enrichProduct(products.find(p => p.id === id) || null);
  },

  getProductBySlug(slug) {
    return enrichProduct(products.find(product => product.slug === sanitizeText(slug, 160)) || null);
  },

  searchProducts(query) {
    return this.getAllProducts(null, { search: query });
  },

  async addProduct(data) {
    const product = normalizeProduct({
      id: `prod-${uuidv4().slice(0, 6)}`,
      name: data.name,
      category: data.category || 'live-birds',
      description: data.description || '',
      price: Number(data.price) || 0,
      unit: data.unit || 'per unit',
      stock: Number(data.stock) || 0,
      weight: data.weight || 'N/A',
      emoji: data.emoji || '🐔',
      tags: data.tags || [],
      farmOrigin: data.farmOrigin || 'Green Valley Farm',
      imageUrl: data.imageUrl || '',
      slug: data.slug || buildUniqueProductSlug(data.name)
    });
    products.push(product);
    await db.saveData('products', products);
    return enrichProduct(product);
  },

  async updateProduct(id, data) {
    const p = products.find(p => p.id === id);
    if (!p) return { error: 'Product not found' };
    const originalName = p.name;
    const nextProduct = normalizeProduct({
      ...p,
      ...data,
      slug: data.slug || (data.name && data.name !== p.name ? buildUniqueProductSlug(data.name, id) : p.slug)
    });
    Object.assign(p, nextProduct);
    await db.saveData('products', products);

    this.addNotification({ 
      title: 'Product Updated', 
      message: `Admin updated product details for ${originalName}`,
      type: 'system' 
    });
    return enrichProduct(p);
  },

  async deleteProduct(id) {
    const idx = products.findIndex(p => p.id === id);
    if (idx === -1) return { error: 'Product not found' };
    products.splice(idx, 1);
    await db.saveData('products', products);
    return { success: true };
  },

  // ══════ REVIEWS ══════
  getProductReviews(productId, options = {}) {
    const sort = sanitizeText(options.sort || 'newest', 20);
    const rating = Number(options.rating) || 0;
    const withPhotos = String(options.withPhotos || '') === 'true';
    let filtered = reviews.filter(review => review.productId === productId && review.status === 'approved');
    if (rating >= 1 && rating <= 5) filtered = filtered.filter(review => review.rating === rating);
    if (withPhotos) filtered = filtered.filter(review => (review.photos || []).length > 0);
    filtered.sort(REVIEW_SORTERS[sort] || REVIEW_SORTERS.newest);
    return filtered.map(enrichReview);
  },

  getProductReviewSummary(productId) {
    return summarizeReviews(productId);
  },

  getReviewEligibility(productId, userId) {
    const product = products.find(p => p.id === productId);
    if (!product) return { error: 'Product not found' };
    if (!userId) {
      return {
        eligible: false,
        reason: 'Login required to review this product',
        hasDeliveredPurchase: false,
        existingReview: null
      };
    }

    const deliveredOrders = orders
      .filter(order => order.userId === userId && order.status === 'delivered')
      .sort((a, b) => new Date(b.placedAt) - new Date(a.placedAt));

    const matchedOrder = deliveredOrders.find(order =>
      (order.items || []).some(item => item.productId === productId)
    );

    const existingReview = reviews.find(review => review.productId === productId && review.userId === userId) || null;

    if (existingReview) {
      const statusReason = existingReview.status === 'approved'
        ? 'You have already reviewed this product'
        : existingReview.status === 'pending'
          ? 'Your review is pending admin approval'
          : 'Your previous review was rejected';
      return {
        eligible: false,
        reason: statusReason,
        hasDeliveredPurchase: Boolean(matchedOrder),
        orderId: matchedOrder?.orderId || existingReview.orderId || null,
        existingReview
      };
    }

    if (!matchedOrder) {
      return {
        eligible: false,
        reason: 'Only customers with a delivered order can review this product',
        hasDeliveredPurchase: false,
        existingReview: null
      };
    }

    return {
      eligible: true,
      reason: '',
      hasDeliveredPurchase: true,
      orderId: matchedOrder.orderId,
      existingReview: null
    };
  },

  getUserReview(productId, userId) {
    return reviews.find(review => review.productId === productId && review.userId === userId) || null;
  },

  validateReviewPayload(data) {
    const rating = Number(data.rating);
    const comment = sanitizeText(data.comment, 500);
    const photos = sanitizeReviewPhotos(data.photos || []);
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
      return { error: 'Rating must be a whole number between 1 and 5' };
    }
    if (comment.length < 10) return { error: 'Review comment must be at least 10 characters' };
    if (comment.length > 500) return { error: 'Review comment must be 500 characters or less' };
    return { rating, comment, photos };
  },

  async addReview(userId, productId, data) {
    const user = users.find(entry => entry.id === userId);
    if (!user) return { error: 'User not found' };

    const product = products.find(entry => entry.id === productId);
    if (!product) return { error: 'Product not found' };

    const eligibility = this.getReviewEligibility(productId, userId);
    if (eligibility.error) return { error: eligibility.error };
    if (!eligibility.eligible) return { error: eligibility.reason || 'You are not allowed to review this product' };

    const validated = this.validateReviewPayload(data);
    if (validated.error) return { error: validated.error };

    const review = normalizeReview({
      id: `review-${uuidv4().slice(0, 8)}`,
      productId,
      userId,
      userName: user.name || 'Customer',
      orderId: eligibility.orderId,
      rating: validated.rating,
      comment: validated.comment,
      photos: validated.photos,
      status: 'pending',
      createdAt: new Date().toISOString(),
      approvedAt: null,
      approvedBy: null,
      rejectionNote: ''
    });

    reviews.unshift(review);
    await db.saveData('reviews', reviews);

    this.addNotification({
      type: 'review-pending',
      title: 'Review Awaiting Approval',
      message: `${review.userName} submitted a ${review.rating}-star review for ${product.name}`,
      data: { reviewId: review.id, productId, productName: product.name }
    });

    return { review: enrichReview(review), summary: this.getProductReviewSummary(productId) };
  },

  async updateReview(userId, productId, data) {
    const review = reviews.find(entry => entry.productId === productId && entry.userId === userId);
    if (!review) return { error: 'Review not found' };

    const validated = this.validateReviewPayload(data);
    if (validated.error) return { error: validated.error };

    review.rating = validated.rating;
    review.comment = validated.comment;
    review.photos = validated.photos;
    review.updatedAt = new Date().toISOString();
    review.status = 'pending';
    review.approvedAt = null;
    review.approvedBy = null;
    review.rejectionNote = '';
    review.moderatedAt = null;
    review.moderatedBy = null;
    await db.saveData('reviews', reviews);

    const product = products.find(entry => entry.id === productId);
    this.addNotification({
      type: 'review-pending',
      title: 'Updated Review Awaiting Approval',
      message: `${review.userName} updated a review for ${product?.name || 'a product'}`,
      data: { reviewId: review.id, productId, productName: product?.name || 'Unknown product' }
    });

    return { review: enrichReview(review), summary: this.getProductReviewSummary(productId) };
  },

  async deleteReview(userId, productId) {
    const reviewIndex = reviews.findIndex(entry => entry.productId === productId && entry.userId === userId);
    if (reviewIndex === -1) return { error: 'Review not found' };
    const [removedReview] = reviews.splice(reviewIndex, 1);
    await db.saveData('reviews', reviews);
    return { review: enrichReview(removedReview), summary: this.getProductReviewSummary(productId) };
  },

  getPendingReviews(filters = {}) {
    return this.getReviewQueue({ ...filters, status: 'pending' });
  },

  getReviewQueue(filters = {}) {
    const status = sanitizeText(filters.status || 'all', 20);
    const sort = sanitizeText(filters.sort || 'newest', 20);
    const productId = sanitizeText(filters.productId || '', 40);
    const search = sanitizeText(filters.search || '', 120).toLowerCase();
    const rating = Number(filters.rating) || 0;

    let filtered = [...reviews];
    if (status !== 'all' && REVIEW_STATUSES.includes(status)) filtered = filtered.filter(review => review.status === status);
    if (productId) filtered = filtered.filter(review => review.productId === productId);
    if (rating >= 1 && rating <= 5) filtered = filtered.filter(review => review.rating === rating);
    if (search) {
      filtered = filtered.filter(review =>
        review.comment.toLowerCase().includes(search) ||
        review.userName.toLowerCase().includes(search) ||
        (products.find(product => product.id === review.productId)?.name || '').toLowerCase().includes(search)
      );
    }

    filtered.sort(REVIEW_SORTERS[sort] || REVIEW_SORTERS.newest);
    return filtered.map(enrichReview);
  },

  getReviewAnalytics() {
    const byStatus = reviews.reduce((acc, review) => {
      acc[review.status] = (acc[review.status] || 0) + 1;
      return acc;
    }, { pending: 0, approved: 0, rejected: 0 });
    const byRating = reviews.reduce((acc, review) => {
      acc[review.rating] = (acc[review.rating] || 0) + 1;
      return acc;
    }, { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 });
    const topRatedProducts = products
      .map(product => enrichProduct(product))
      .filter(product => product.reviewCount > 0)
      .sort((a, b) => (b.averageRating - a.averageRating) || (b.reviewCount - a.reviewCount))
      .slice(0, 5)
      .map(product => ({
        id: product.id,
        slug: product.slug,
        name: product.name,
        averageRating: product.averageRating,
        reviewCount: product.reviewCount
      }));

    return {
      totals: {
        total: reviews.length,
        withPhotos: reviews.filter(review => (review.photos || []).length > 0).length,
        avgPendingHours: reviews.filter(review => review.status === 'pending').length
          ? Number((reviews
            .filter(review => review.status === 'pending')
            .reduce((sum, review) => sum + ((Date.now() - new Date(review.createdAt).getTime()) / 36e5), 0) / reviews.filter(review => review.status === 'pending').length).toFixed(1))
          : 0
      },
      byStatus,
      byRating,
      topRatedProducts
    };
  },

  async moderateReview(reviewId, status, adminUser, rejectionNote = '') {
    if (!['approved', 'rejected'].includes(status)) return { error: 'Invalid review status' };
    const review = reviews.find(entry => entry.id === reviewId);
    if (!review) return { error: 'Review not found' };
    const cleanNote = sanitizeText(rejectionNote, 280);
    if (status === 'rejected' && cleanNote.length < 10) {
      return { error: 'Rejection note must be at least 10 characters' };
    }

    review.status = status;
    review.approvedAt = status === 'approved' ? new Date().toISOString() : null;
    review.approvedBy = status === 'approved' ? (adminUser?.id || 'admin') : null;
    review.rejectionNote = status === 'rejected' ? cleanNote : '';
    review.moderatedAt = new Date().toISOString();
    review.moderatedBy = adminUser?.id || 'admin';
    await db.saveData('reviews', reviews);

    return {
      review: enrichReview(review),
      summary: this.getProductReviewSummary(review.productId),
      analytics: this.getReviewAnalytics()
    };
  },

  // ══════ CART (per user) ══════
  getCart(userId) {
    const items = carts[userId] || [];
    return {
      items,
      totalItems: items.reduce((s, i) => s + i.quantity, 0),
      totalPrice: items.reduce((s, i) => s + i.price * i.quantity, 0)
    };
  },

  async addToCart(userId, productId, quantity = 1) {
    const product = this.getProductById(productId);
    if (!product) return { error: 'Product not found' };
    if (product.stock < quantity) return { error: 'Insufficient stock' };
    if (!carts[userId]) carts[userId] = [];
    const existing = carts[userId].find(i => i.productId === productId);
    if (existing) {
      if (product.stock < existing.quantity + quantity) return { error: 'Insufficient stock' };
      existing.quantity += quantity;
      existing.subtotal = existing.quantity * product.price;
    } else {
      carts[userId].push({
        cartItemId: uuidv4(), productId: product.id, name: product.name,
        price: product.price, unit: product.unit, emoji: product.emoji,
        quantity, subtotal: product.price * quantity
      });
    }
    await db.saveData('carts', carts);
    return this.getCart(userId);
  },

  async updateCartItem(userId, cartItemId, quantity) {
    if (!carts[userId]) return this.getCart(userId);
    const item = carts[userId].find(i => i.cartItemId === cartItemId);
    if (!item) return { error: 'Cart item not found' };
    if (quantity <= 0) return await this.removeCartItem(userId, cartItemId);
    const product = this.getProductById(item.productId);
    if (product && product.stock < quantity) return { error: 'Insufficient stock' };
    item.quantity = quantity;
    item.subtotal = item.price * quantity;
    await db.saveData('carts', carts);
    return this.getCart(userId);
  },

  async removeCartItem(userId, cartItemId) {
    if (carts[userId]) carts[userId] = carts[userId].filter(i => i.cartItemId !== cartItemId);
    await db.saveData('carts', carts);
    return this.getCart(userId);
  },

  async clearCart(userId) {
    carts[userId] = [];
    await db.saveData('carts', carts);
    return this.getCart(userId);
  },

  // ══════ ORDERS ══════
  async placeOrder(userId, customerInfo) {
    const cart = carts[userId] || [];
    if (!cart.length) return { error: 'Cart is empty' };
    const { name, phone, address, paymentMethod, upiUtr, upiScreenshot, razorpayOrderId, razorpayPaymentId } = customerInfo;
    if (!name || !phone || !address) return { error: 'Name, phone, and address are required' };

    for (const item of cart) {
      const product = this.getProductById(item.productId);
      if (product) product.stock -= item.quantity;
    }

    const order = {
      orderId: `ORD-${Date.now().toString(36).toUpperCase()}-${uuidv4().slice(0, 4).toUpperCase()}`,
      userId,
      items: [...cart],
      totalItems: cart.reduce((s, i) => s + i.quantity, 0),
      totalPrice: cart.reduce((s, i) => s + i.subtotal, 0),
      paymentMethod: paymentMethod || 'COD',
      upiUtr: upiUtr || null,
      upiScreenshot: upiScreenshot || null,
      razorpayOrderId: razorpayOrderId || null,
      razorpayPaymentId: razorpayPaymentId || null,
      customer: { name, phone, address },
      status: 'confirmed',
      statusHistory: [{ status: 'confirmed', at: new Date().toISOString(), by: 'system' }],
      stockRestored: false,
      placedAt: new Date().toISOString(),
      estimatedDelivery: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
    };
    orders.push(order);
    carts[userId] = [];
    await db.saveData('orders', orders);
    await db.saveData('carts', carts);
    await db.saveData('products', products);

    // Notify admin
    this.addNotification({
      type: 'new-order',
      title: 'New Order Received!',
      message: `${name} placed an order for ${order.totalItems} items — ₹${order.totalPrice}`,
      orderId: order.orderId,
      data: { customerName: name, total: order.totalPrice, items: order.totalItems }
    });

    // Send Email Notification to Customer
    const user = users.find(u => u.id === userId);
    const resolvedEmail = user ? user.email : customerInfo.email || `${name.replace(/\s+/g,'').toLowerCase()}@mock.com`;
    await this.sendEmailNotification(resolvedEmail, order);

    return { ...order, emailSent: true };
  },

  async sendEmailNotification(email, order) {
    let paymentLine = order.paymentMethod || 'Cash on Delivery';
    if (order.paymentMethod === 'UPI') {
      paymentLine = `UPI (UTR: ${order.upiUtr || 'Pending Verification'})`;
    } else if (order.paymentMethod === 'Razorpay Online' || order.paymentMethod === 'Razorpay') {
      paymentLine = `Razorpay Online ${order.upiUtr ? `(ID: ${order.upiUtr})` : ''}`;
    } else if (order.paymentMethod === 'COD') {
      paymentLine = 'Cash on Delivery';
    }

    const itemRows = order.items.map(i =>
      `<tr><td style="padding:8px;border-bottom:1px solid #f0f0f0">${i.name}</td><td style="padding:8px;border-bottom:1px solid #f0f0f0;text-align:center">x${i.quantity}</td><td style="padding:8px;border-bottom:1px solid #f0f0f0;text-align:right">&#8377;${i.subtotal}</td></tr>`
    ).join('');

    // ── HTML Customer Email ──
    const customerHtml = `<!DOCTYPE html><html><body style="margin:0;padding:0;font-family:Arial,sans-serif;background:#f4f4f4">
<table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
<table width="600" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08)">
  <tr><td style="background:#2d5a27;padding:32px;text-align:center">
    <h1 style="color:#fff;margin:0;font-size:24px">Green Valley Poultry Farm</h1>
    <p style="color:#a8d5a2;margin:8px 0 0">Order Confirmed!</p>
  </td></tr>
  <tr><td style="padding:32px">
    <p style="font-size:16px;color:#333">Hi <strong>${order.customer.name}</strong>,</p>
    <p style="color:#555">Your order has been successfully placed. We will deliver your farm-fresh products soon!</p>
    <table width="100%" style="background:#f9f9f9;border-radius:8px;padding:16px;margin:20px 0" cellpadding="0" cellspacing="0">
      <tr><td style="padding:6px 0;color:#888;font-size:13px">Order ID</td><td style="padding:6px 0;font-weight:bold;text-align:right">${order.orderId}</td></tr>
      <tr><td style="padding:6px 0;color:#888;font-size:13px">Payment</td><td style="padding:6px 0;text-align:right">${paymentLine}</td></tr>
      <tr><td style="padding:6px 0;color:#888;font-size:13px">Est. Delivery</td><td style="padding:6px 0;text-align:right">${order.estimatedDelivery}</td></tr>
    </table>
    <table width="100%" cellpadding="0" cellspacing="0" style="margin:20px 0">
      <tr style="background:#f0f0f0"><th style="padding:8px;text-align:left">Item</th><th style="padding:8px;text-align:center">Qty</th><th style="padding:8px;text-align:right">Price</th></tr>
      ${itemRows}
      <tr><td colspan="2" style="padding:12px 8px;font-weight:bold">Total</td><td style="padding:12px 8px;font-weight:bold;text-align:right;color:#2d5a27">&#8377;${order.totalPrice}</td></tr>
    </table>
    <p style="color:#555;font-size:14px">Delivery to: <strong>${order.customer.address}</strong></p>
    <p style="color:#888;font-size:13px;margin-top:32px">Thank you for choosing Green Valley Poultry Farm. For questions, reply to this email.</p>
  </td></tr>
  <tr><td style="background:#f9f9f9;padding:16px;text-align:center;color:#aaa;font-size:12px">
    Green Valley Poultry Farm &mdash; Farm-fresh, delivered with care
  </td></tr>
</table></td></tr></table></body></html>`;

    // ── HTML Admin Alert Email ──
    const adminHtml = `<!DOCTYPE html><html><body style="margin:0;padding:0;font-family:Arial,sans-serif;background:#f4f4f4">
<table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
<table width="600" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08)">
  <tr><td style="background:#1a1a2e;padding:32px;text-align:center">
    <h1 style="color:#d4a745;margin:0;font-size:22px">New Order Received</h1>
    <p style="color:#888;margin:8px 0 0;font-size:14px">${order.orderId}</p>
  </td></tr>
  <tr><td style="padding:32px">
    <table width="100%" style="background:#f9f9f9;border-radius:8px;padding:16px;margin-bottom:20px" cellpadding="0" cellspacing="0">
      <tr><td style="padding:6px 0;color:#888;font-size:13px">Customer</td><td style="padding:6px 0;font-weight:bold;text-align:right">${order.customer.name}</td></tr>
      <tr><td style="padding:6px 0;color:#888;font-size:13px">Phone</td><td style="padding:6px 0;text-align:right">${order.customer.phone}</td></tr>
      <tr><td style="padding:6px 0;color:#888;font-size:13px">Address</td><td style="padding:6px 0;text-align:right">${order.customer.address}</td></tr>
      <tr><td style="padding:6px 0;color:#888;font-size:13px">Payment</td><td style="padding:6px 0;text-align:right;color:${order.paymentMethod==='UPI'?'#2d5a27':'#333'};font-weight:bold">${paymentLine}</td></tr>
      <tr><td style="padding:6px 0;color:#888;font-size:13px">Total</td><td style="padding:6px 0;font-size:20px;font-weight:bold;text-align:right;color:#d4a745">&#8377;${order.totalPrice}</td></tr>
    </table>
    <table width="100%" cellpadding="0" cellspacing="0">
      <tr style="background:#f0f0f0"><th style="padding:8px;text-align:left">Item</th><th style="padding:8px;text-align:center">Qty</th><th style="padding:8px;text-align:right">Price</th></tr>
      ${itemRows}
    </table>
    <div style="margin-top:24px;text-align:center">
      <a href="https://www.green-valley-farm.online/admin.html" style="background:#d4a745;color:#000;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:bold;display:inline-block">View in Admin Dashboard</a>
    </div>
  </td></tr>
</table></td></tr></table></body></html>`;

    if (process.env.SMTP_USER && process.env.SMTP_PASS) {
      // Use the verified Brevo sender as FROM, and set Reply-To to the farm email
      const verifiedSender = process.env.SMTP_FROM || process.env.SMTP_USER;
      const fromAddr = `"Green Valley Farm" <${verifiedSender}>`;
      const replyTo = verifiedSender;
      try {
        await mailer.sendMail({
          from: fromAddr,
          replyTo,
          to: email,
          subject: `Order Confirmed - ${order.orderId}`,
          html: customerHtml
        });
        console.log(`[Nodemailer] Sent HTML Confirmation to customer ${email}`);
      } catch (err) {
        console.error('[Nodemailer Customer Email Error]:', err.message);
      }

      // Find ALL admins and notify them
      const admins = users.filter(u => u.role === 'admin');
      const adminEmails = admins.length > 0 ? admins.map(u => u.email) : [replyTo];

      for (const adminMail of adminEmails) {
        try {
          await mailer.sendMail({
            from: fromAddr,
            replyTo,
            to: adminMail,
            subject: `New Order ${order.orderId} - Rs.${order.totalPrice} (${order.paymentMethod})`,
            html: adminHtml
          });
          console.log(`[Nodemailer] Sent admin alert to ${adminMail}`);
        } catch (err) {
          console.error(`[Nodemailer Admin Email Error to ${adminMail}]:`, err.message);
        }
      }
    } else {
      console.log(`[MOCK EMAIL] Order confirmation for ${email} — Order ${order.orderId}`);
    }
  },

  async sendCancellationEmail(email, order) {
    const itemRows = order.items.map(i =>
      `<tr><td style="padding:8px;border-bottom:1px solid #f0f0f0">${i.name}</td><td style="padding:8px;border-bottom:1px solid #f0f0f0;text-align:center">x${i.quantity}</td><td style="padding:8px;border-bottom:1px solid #f0f0f0;text-align:right">&#8377;${i.subtotal}</td></tr>`
    ).join('');

    // ── HTML Customer Email ──
    const customerHtml = `<!DOCTYPE html><html><body style="margin:0;padding:0;font-family:Arial,sans-serif;background:#f4f4f4">
<table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
<table width="600" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08)">
  <tr><td style="background:#e74c3c;padding:32px;text-align:center">
    <h1 style="color:#fff;margin:0;font-size:24px">Green Valley Poultry Farm</h1>
    <p style="color:#fce4e4;margin:8px 0 0">Order Cancelled</p>
  </td></tr>
  <tr><td style="padding:32px">
    <p style="font-size:16px;color:#333">Hi <strong>${order.customer.name}</strong>,</p>
    <p style="color:#555">Your order <strong>${order.orderId}</strong> has been cancelled successfully.</p>
    <table width="100%" style="background:#f9f9f9;border-radius:8px;padding:16px;margin:20px 0" cellpadding="0" cellspacing="0">
      <tr><td style="padding:6px 0;color:#888;font-size:13px">Order ID</td><td style="padding:6px 0;font-weight:bold;text-align:right">${order.orderId}</td></tr>
      <tr><td style="padding:6px 0;color:#888;font-size:13px">Total Amount</td><td style="padding:6px 0;text-align:right">&#8377;${order.totalPrice}</td></tr>
    </table>
    <p style="color:#888;font-size:13px;margin-top:32px">If you paid online (UPI or Razorpay), any applicable refund will be processed according to our policy. For questions, reply to this email.</p>
  </td></tr>
  <tr><td style="background:#f9f9f9;padding:16px;text-align:center;color:#aaa;font-size:12px">
    Green Valley Poultry Farm &mdash; Farm-fresh, delivered with care
  </td></tr>
</table></td></tr></table></body></html>`;

    // ── HTML Admin Alert Email ──
    const adminHtml = `<!DOCTYPE html><html><body style="margin:0;padding:0;font-family:Arial,sans-serif;background:#f4f4f4">
<table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
<table width="600" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08)">
  <tr><td style="background:#1a1a2e;padding:32px;text-align:center">
    <h1 style="color:#e74c3c;margin:0;font-size:22px">Order Cancelled</h1>
    <p style="color:#888;margin:8px 0 0;font-size:14px">${order.orderId}</p>
  </td></tr>
  <tr><td style="padding:32px">
    <table width="100%" style="background:#f9f9f9;border-radius:8px;padding:16px;margin-bottom:20px" cellpadding="0" cellspacing="0">
      <tr><td style="padding:6px 0;color:#888;font-size:13px">Customer</td><td style="padding:6px 0;font-weight:bold;text-align:right">${order.customer.name}</td></tr>
      <tr><td style="padding:6px 0;color:#888;font-size:13px">Phone</td><td style="padding:6px 0;text-align:right">${order.customer.phone}</td></tr>
      <tr><td style="padding:6px 0;color:#888;font-size:13px">Cancelled By</td><td style="padding:6px 0;text-align:right">${order.cancelledBy || 'System/Admin'}</td></tr>
      <tr><td style="padding:6px 0;color:#888;font-size:13px">Total</td><td style="padding:6px 0;font-size:20px;font-weight:bold;text-align:right;color:#e74c3c">&#8377;${order.totalPrice}</td></tr>
    </table>
    <table width="100%" cellpadding="0" cellspacing="0">
      <tr style="background:#f0f0f0"><th style="padding:8px;text-align:left">Item</th><th style="padding:8px;text-align:center">Qty</th><th style="padding:8px;text-align:right">Price</th></tr>
      ${itemRows}
    </table>
    <div style="margin-top:24px;text-align:center">
      <a href="https://www.green-valley-farm.online/admin.html" style="background:#d4a745;color:#000;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:bold;display:inline-block">View in Admin Dashboard</a>
    </div>
  </td></tr>
</table></td></tr></table></body></html>`;

    if (process.env.SMTP_USER && process.env.SMTP_PASS) {
      const verifiedSender = process.env.SMTP_FROM || process.env.SMTP_USER;
      const fromAddr = `"Green Valley Farm" <${verifiedSender}>`;
      const replyTo = verifiedSender;
      try {
        await mailer.sendMail({
          from: fromAddr,
          replyTo,
          to: email,
          subject: `Order Cancelled - ${order.orderId}`,
          html: customerHtml
        });
        console.log(`[Nodemailer] Sent HTML Cancellation to customer ${email}`);
      } catch (err) {
        console.error('[Nodemailer Customer Cancel Email Error]:', err.message);
      }

      // Find ALL admins and notify them
      const admins = users.filter(u => u.role === 'admin');
      const adminEmails = admins.length > 0 ? admins.map(u => u.email) : [replyTo];

      for (const adminMail of adminEmails) {
        try {
          await mailer.sendMail({
            from: fromAddr,
            replyTo,
            to: adminMail,
            subject: `Order Cancelled ${order.orderId} - Rs.${order.totalPrice}`,
            html: adminHtml
          });
          console.log(`[Nodemailer] Sent admin cancel alert to ${adminMail}`);
        } catch (err) {
          console.error(`[Nodemailer Admin Cancel Email Error to ${adminMail}]:`, err.message);
        }
      }
    } else {
      console.log(`[MOCK EMAIL] Order cancellation for ${email} — Order ${order.orderId}`);
    }
  },

  getOrders(userId) {
    const list = userId ? orders.filter(o => o.userId === userId) : orders;
    return list.map(o => ({
      ...o,
      cancelDeadline: getCancelDeadline(o).toISOString(),
      canCancel: this.canCancelOrder(o)
    }));
  },

  getAllOrders() { return orders; },

  getOrderById(orderId) {
    const order = orders.find(o => o.orderId === orderId) || null;
    if (!order) return null;
    return {
      ...order,
      cancelDeadline: getCancelDeadline(order).toISOString(),
      canCancel: this.canCancelOrder(order)
    };
  },

  canCancelOrder(order) {
    if (!order) return false;
    if (!CUSTOMER_CANCELLABLE_STATUSES.includes(order.status)) return false;
    return Date.now() <= getCancelDeadline(order).getTime();
  },

  async cancelOrder(orderId, userId) {
    const order = orders.find(o => o.orderId === orderId);
    if (!order) return { error: 'Order not found' };
    if (order.userId !== userId) return { error: 'You can only cancel your own order' };
    if (!this.canCancelOrder(order)) return { error: 'Cancellation is only available within 2 hours of placing the order and before dispatch' };

    order.status = 'cancelled';
    order.cancelledAt = new Date().toISOString();
    order.cancelledBy = 'customer';
    order.statusHistory = order.statusHistory || [];
    order.statusHistory.push({ status: 'cancelled', at: order.cancelledAt, by: 'customer' });
    restoreOrderStock(order);
    await db.saveData('orders', orders);
    await db.saveData('products', products);

    this.addNotification({
      type: 'order-cancelled',
      title: 'Order Cancelled',
      message: `${order.customer.name} cancelled order ${order.orderId}`,
      orderId: order.orderId,
      data: { customerName: order.customer.name, total: order.totalPrice }
    });

    const user = users.find(u => u.id === userId);
    const resolvedEmail = user ? user.email : order.customer.email || `${order.customer.name.replace(/\s+/g,'').toLowerCase()}@mock.com`;
    await this.sendCancellationEmail(resolvedEmail, order);

    return {
      ...order,
      cancelDeadline: getCancelDeadline(order).toISOString(),
      canCancel: false
    };
  },

  async updateOrderStatus(orderId, status) {
    if (!ORDER_STATUSES.includes(status)) return { error: 'Invalid order status' };
    const order = orders.find(o => o.orderId === orderId);
    if (!order) return { error: 'Order not found' };
    const previousStatus = order.status;

    if (status === 'cancelled') {
      if (previousStatus !== 'cancelled') {
        restoreOrderStock(order);
        order.cancelledAt = order.cancelledAt || new Date().toISOString();
        order.cancelledBy = order.cancelledBy || 'admin';
        
        const user = users.find(u => u.id === order.userId);
        const resolvedEmail = user ? user.email : order.customer.email || `${order.customer.name.replace(/\s+/g,'').toLowerCase()}@mock.com`;
        await this.sendCancellationEmail(resolvedEmail, order);
      }
    } else if (previousStatus === 'cancelled' && order.stockRestored) {
      reserveOrderStock(order);
      order.cancelledAt = null;
      order.cancelledBy = null;
    }

    order.status = status;
    order.statusHistory = order.statusHistory || [];
    order.statusHistory.push({ status, at: new Date().toISOString(), by: 'admin' });
    await db.saveData('orders', orders); // Explicitly lock update into MongoDB!
    await db.saveData('products', products);
    return order;
  },

  // ══════ NOTIFICATIONS ══════
  addNotification({ type, title, message, orderId, data }) {
    notifications.unshift({
      id: `notif-${uuidv4().slice(0, 8)}`,
      type, title, message, orderId, data,
      read: false,
      createdAt: new Date().toISOString()
    });
    db.saveData('notifications', notifications);
  },

  getNotifications() { return notifications; },

  getUnreadCount() { return notifications.filter(n => !n.read).length; },

  markNotificationRead(id) {
    const n = notifications.find(n => n.id === id);
    if (n) n.read = true;
    return n;
  },

  markAllRead() {
    notifications.forEach(n => n.read = true);
  },

  // ══════ DASHBOARD STATS ══════
  getDashboardStats() {
    const activeOrders = orders.filter(o => o.status !== 'cancelled');
    const totalRevenue = activeOrders.reduce((s, o) => s + o.totalPrice, 0);
    const todayOrders = activeOrders.filter(o => {
      const d = new Date(o.placedAt).toDateString();
      return d === new Date().toDateString();
    });
    const reviewAnalytics = this.getReviewAnalytics();
    return {
      totalProducts: products.length,
      totalOrders: orders.length,
      totalRevenue,
      totalCustomers: users.filter(u => u.role === 'customer').length,
      pendingReviews: reviews.filter(review => review.status === 'pending').length,
      rejectedReviews: reviews.filter(review => review.status === 'rejected').length,
      todayOrders: todayOrders.length,
      todayRevenue: todayOrders.reduce((s, o) => s + o.totalPrice, 0),
      lowStockProducts: products.filter(p => p.stock <= 10).length,
      unreadNotifications: this.getUnreadCount(),
      reviewsWithPhotos: reviewAnalytics.totals.withPhotos,
      avgReviewRating: reviews.filter(review => review.status === 'approved').length
        ? Number((reviews
          .filter(review => review.status === 'approved')
          .reduce((sum, review) => sum + review.rating, 0) / reviews.filter(review => review.status === 'approved').length).toFixed(1))
        : 0
    };
  }
};

module.exports = store;
