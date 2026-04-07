const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const nodemailer = require('nodemailer');
const db = require('./db');

// LAZY secret getter - ensures env vars are loaded before use
function getHmacSecret() {
  return process.env.MONGODB_URI ? process.env.MONGODB_URI.slice(-20) : 'greenvalley-secret-2024';
}

// Stateless token helpers (base64-encoded userId:timestamp:signature)
function createStatelessToken(userId) {
  const ts = Date.now();
  const secret = getHmacSecret();
  const sig = crypto.createHmac('sha256', secret).update(`${userId}:${ts}`).digest('hex').slice(0, 16);
  return Buffer.from(`${userId}:${ts}:${sig}`).toString('base64url');
}
function verifyStatelessToken(raw) {
  try {
    // Support both base64url (new) and base64 (old)
    const decoded = Buffer.from(raw, 'base64url').toString();
    const lastColon = decoded.lastIndexOf(':');
    const firstColon = decoded.indexOf(':');
    if (firstColon === -1 || firstColon === lastColon) return null;
    const userId = decoded.slice(0, firstColon);
    const middle = decoded.slice(firstColon + 1, lastColon);
    const sig = decoded.slice(lastColon + 1);
    const secret = getHmacSecret();
    const expected = crypto.createHmac('sha256', secret).update(`${userId}:${middle}`).digest('hex').slice(0, 16);
    if (sig !== expected) return null;
    // Token valid for 7 days
    if (Date.now() - parseInt(middle) > 7 * 24 * 60 * 60 * 1000) return null;
    return userId;
  } catch { return null; }
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
let users = [
  {
    id: 'admin-001',
    name: 'Farm Admin',
    email: 'sales.greenvalleyfarm@gmail.com',
    password: 'Yashveer@2003',
    phone: '+91 9471800046',
    role: 'admin',
    createdAt: new Date().toISOString()
  },
  {
    id: 'admin-002',
    name: 'Anjiv Singh',
    email: 'anjivsir@gmail.com',
    password: 'anjivsir',
    phone: '+91 9471800046',
    role: 'admin',
    createdAt: new Date().toISOString()
  }
];
let pendingOtps = {}; // email -> { otp, payload, expires }
let tokens = {}; // token -> userId

const store = {
  isInitialized: false,
  // ══════ DATABASE INIT ══════
  async init() {
    if (this.isInitialized && this.dbConnected) return true;
    try {
      const connected = await db.connectDB();
      if (connected) {
        console.log('[Store] MongoDB connected, loading data...');
        await db.bootstrapCollections(['users', 'orders', 'carts', 'notifications', 'products', 'pendingOtps']);

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
            uniqueUsers[adminIndex].password = 'Yashveer@2003';
          } else {
            uniqueUsers.push(users[0]);
            needsSave = true;
          }
          
          const anjivIndex = uniqueUsers.findIndex(u => (u.email || '').toLowerCase() === 'anjivsir@gmail.com');
          if (anjivIndex !== -1) {
            uniqueUsers[anjivIndex].password = 'anjivsir';
          } else {
            uniqueUsers.push(users[1]);
            needsSave = true;
          }

          users = uniqueUsers;
          if (needsSave) {
            await db.saveData('users', users);
          }
        } else {
          await db.saveData('users', users);
        }
        
        const savedOrders = await db.loadData('orders');
        if (savedOrders) orders = savedOrders;

        const savedCarts = await db.loadData('carts');
        if (savedCarts) carts = savedCarts;

        const savedNotifs = await db.loadData('notifications');
        if (savedNotifs) notifications = savedNotifs;
        
        const savedProducts = await db.loadData('products');
        if (savedProducts && savedProducts.length > 0) {
          products = savedProducts;
        } else {
          await db.saveData('products', products);
        }
        console.log('[Store] All data loaded from MongoDB ✅');
        this.dbConnected = true;
      } else {
        console.log('[Store] MongoDB not available, using in-memory defaults (admins + products.json)');
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
    return crypto.createHmac('sha256', getHmacSecret()).update(`${email}:${otp}:${expires}`).digest('hex');
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
    if (payload.action === 'register') {
      return await this.registerUser(payload.userData);
    } else if (payload.action === 'login') {
      const user = users.find(u => u.email.toLowerCase() === cleanEmail);
      if (!user) return { error: 'No account found with this email' };
      const token = createStatelessToken(user.id);
      const { password: _, ...safe } = user;
      return { user: safe, token };
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
    user.password = newPassword;
    await db.saveData('users', users);
    return { success: true };
  },

  async registerUser({ name, email, password, phone }) {
    const cleanEmail = (email || '').trim().toLowerCase();
    if (!name || !cleanEmail || !password) return { error: 'Name, email, and password are required' };
    if (users.find(u => (u.email || '').toLowerCase().trim() === cleanEmail)) return { error: 'Email already registered' };
    const user = {
      id: `user-${uuidv4().slice(0, 8)}`,
      name, email: cleanEmail, password, phone: phone || '',
      role: 'customer',
      createdAt: new Date().toISOString()
    };
    users.push(user);
    await db.saveData('users', users);
    const token = createStatelessToken(user.id);
    const { password: _, ...safe } = user;
    return { user: safe, token };
  },

  async updateUserProfile(userId, data) {
    const user = users.find(u => u.id === userId);
    if (!user) return { error: 'User not found' };
    if (data.name) user.name = data.name;
    if (data.phone) user.phone = data.phone;
    if (data.newPassword) user.password = data.newPassword;
    await db.saveData('users', users);
    const { password: _, ...safe } = user;
    return { user: safe };
  },

  loginUser(email, password) {
    const user = users.find(u => u.email === email && u.password === password);
    if (!user) return { error: 'Invalid email or password' };
    const token = createStatelessToken(user.id);
    const { password: _, ...safe } = user;
    return { user: safe, token };
  },

  async verifyToken(token) {
    // Try stateless HMAC token first
    const userId = verifyStatelessToken(token);
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
        const { password: _, ...safe } = user;
        return safe;
      }
    }
    // Fallback: old in-memory tokens (for same-instance requests)
    const oldUserId = tokens[token];
    if (oldUserId) {
      let user = users.find(u => u.id === oldUserId);
      if (!user && this.dbConnected) {
        const freshUsers = await db.loadData('users');
        if (freshUsers) {
          users = freshUsers;
          user = users.find(u => u.id === oldUserId);
        }
      }
      if (user) {
        const { password: _, ...safe } = user;
        return safe;
      }
    }
    return null;
  },

  logoutUser(token) {
    delete tokens[token];
  },

  // ══════ PRODUCTS ══════
  getAllProducts(category = null) {
    if (category && category !== 'all') return products.filter(p => p.category === category);
    return products;
  },

  getProductById(id) {
    return products.find(p => p.id === id) || null;
  },

  searchProducts(query) {
    const q = query.toLowerCase();
    return products.filter(p =>
      p.name.toLowerCase().includes(q) ||
      p.description.toLowerCase().includes(q) ||
      p.tags.some(t => t.toLowerCase().includes(q))
    );
  },

  async addProduct(data) {
    const product = {
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
      farmOrigin: data.farmOrigin || 'Green Valley Farm'
    };
    products.push(product);
    await db.saveData('products', products);
    return product;
  },

  async updateProduct(id, data) {
    const p = products.find(p => p.id === id);
    if (!p) return { error: 'Product not found' };
    const originalName = p.name;
    Object.assign(p, data);
    await db.saveData('products', products);

    this.addNotification({ 
      title: 'Product Updated', 
      message: `Admin updated product details for ${originalName}`,
      type: 'system' 
    });
    return p;
  },

  async deleteProduct(id) {
    const idx = products.findIndex(p => p.id === id);
    if (idx === -1) return { error: 'Product not found' };
    products.splice(idx, 1);
    await db.saveData('products', products);
    return { success: true };
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
    const { name, phone, address, paymentMethod, upiUtr, upiScreenshot } = customerInfo;
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
      customer: { name, phone, address },
      status: 'confirmed',
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
    const paymentLine = order.paymentMethod === 'UPI'
      ? `UPI (UTR: ${order.upiUtr || 'Pending Verification'})`
      : `Cash on Delivery`;

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
      <a href="http://localhost:3000/admin.html" style="background:#d4a745;color:#000;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:bold;display:inline-block">View in Admin Dashboard</a>
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

  getOrders(userId) {
    if (userId) return orders.filter(o => o.userId === userId);
    return orders;
  },

  getAllOrders() { return orders; },

  getOrderById(orderId) {
    return orders.find(o => o.orderId === orderId) || null;
  },

  async updateOrderStatus(orderId, status) {
    const order = orders.find(o => o.orderId === orderId);
    if (!order) return { error: 'Order not found' };
    order.status = status;
    await db.saveData('orders', orders); // Explicitly lock update into MongoDB!
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
    const totalRevenue = orders.reduce((s, o) => s + o.totalPrice, 0);
    const todayOrders = orders.filter(o => {
      const d = new Date(o.placedAt).toDateString();
      return d === new Date().toDateString();
    });
    return {
      totalProducts: products.length,
      totalOrders: orders.length,
      totalRevenue,
      totalCustomers: users.filter(u => u.role === 'customer').length,
      todayOrders: todayOrders.length,
      todayRevenue: todayOrders.reduce((s, o) => s + o.totalPrice, 0),
      lowStockProducts: products.filter(p => p.stock <= 10).length,
      unreadNotifications: this.getUnreadCount()
    };
  }
};

module.exports = store;
