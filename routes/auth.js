const express = require('express');
const router = express.Router();
const store = require('../models/store');

async function verifyGoogleCredential(credential) {
  if (!process.env.GOOGLE_CLIENT_ID) {
    return { error: 'Google sign-in is not configured' };
  }
  if (!credential) {
    return { error: 'Google credential is required' };
  }

  const url = `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(credential)}`;
  const response = await fetch(url);
  const payload = await response.json().catch(() => ({}));

  if (!response.ok) return { error: payload.error_description || 'Invalid Google credential' };
  if (payload.aud !== process.env.GOOGLE_CLIENT_ID) return { error: 'Google credential was issued for another app' };
  if (!['accounts.google.com', 'https://accounts.google.com'].includes(payload.iss)) return { error: 'Invalid Google issuer' };
  if (Number(payload.exp) * 1000 <= Date.now()) return { error: 'Google credential has expired' };

  return { payload };
}

// GET /api/auth/config
router.get('/config', (req, res) => {
  res.json({
    success: true,
    googleClientId: process.env.GOOGLE_CLIENT_ID || '',
    razorpayKeyId: process.env.RAZORPAY_KEY_ID || '' // ✅ Publishable key — intentionally exposed to frontend (not a secret)
  });
});

// POST /api/auth/send-otp
router.post('/send-otp', async (req, res) => {
  const { email, action, userData } = req.body;
  if (!email || !action) return res.status(400).json({ success: false, error: 'Email and action required' });
  const result = await store.sendAuthOtp(email, { action, userData });
  if (result.error) return res.status(400).json({ success: false, error: result.error });
  res.json({ success: true, otpToken: result.otpToken });
});

// POST /api/auth/verify-otp
router.post('/verify-otp', async (req, res) => {
  const { email, otp, otpToken } = req.body;
  if (!email || !otp) return res.status(400).json({ success: false, error: 'Email and OTP required' });
  const result = await store.verifyAuthOtp(email, otp, otpToken);
  if (result.error) return res.status(400).json({ success: false, error: result.error });
  res.json({ success: true, ...result });
});

// POST /api/auth/reset-password
router.post('/reset-password', async (req, res) => {
  const { email, otp, newPassword, otpToken } = req.body;
  if (!email || !otp || !newPassword) return res.status(400).json({ success: false, error: 'Email, OTP, and new Password required' });
  
  if (newPassword.length < 8) return res.status(400).json({ success: false, error: 'Password must be at least 8 characters' });

  // Leverage the existing logic; we verify the OTP the exact same way
  const result = await store.verifyAuthOtp(email, otp, otpToken);
  if (result.error) return res.status(400).json({ success: false, error: result.error });
  
  // Actually execute the password mutation on the validated user entity
  const updateResult = await store.resetUserPassword(email, newPassword);
  if (updateResult.error) return res.status(400).json({ success: false, error: updateResult.error });
  
  res.json({ success: true });
});


// POST /api/auth/register
router.post('/register', async (req, res) => {
  const { name, email, password, phone } = req.body;
  const result = await store.registerUser({ name, email, password, phone });
  if (result.error) return res.status(400).json({ success: false, error: result.error });
  res.status(201).json({ success: true, ...result });
});

// POST /api/auth/login
router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ success: false, error: 'Email and password required' });
  const result = await store.loginUser(email, password);
  if (result.error) return res.status(401).json({ success: false, error: result.error });
  res.json({ success: true, ...result });
});

// POST /api/auth/google
router.post('/google', async (req, res) => {
  try {
    const verified = await verifyGoogleCredential(req.body.credential);
    if (verified.error) return res.status(401).json({ success: false, error: verified.error });

    const result = await store.loginWithGoogle(verified.payload);
    if (result.error) return res.status(400).json({ success: false, error: result.error });
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Unable to verify Google sign-in' });
  }
});

// GET /api/auth/me
router.get('/me', async (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ success: false, error: 'Not authenticated' });
  const user = await store.verifyToken(token);
  if (!user) return res.status(401).json({ success: false, error: 'Invalid token' });
  res.json({ success: true, user });
});

// POST /api/auth/refresh
router.post('/refresh', async (req, res) => {
  const { refreshToken } = req.body || {};
  if (!refreshToken) return res.status(401).json({ success: false, error: 'Refresh token required' });
  const result = await store.refreshAuthToken(refreshToken);
  if (result.error) return res.status(401).json({ success: false, error: result.error });
  res.json({ success: true, ...result });
});

// POST /api/auth/logout
router.post('/logout', async (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  const { refreshToken } = req.body || {};
  if (token) store.logoutUser(token);
  await store.logoutSession(refreshToken);
  res.json({ success: true });
});

// PUT /api/auth/profile
router.put('/profile', async (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ success: false, error: 'Not authenticated' });
  const user = await store.verifyToken(token);
  if (!user) return res.status(401).json({ success: false, error: 'Invalid token' });
  
  const { name, phone, newPassword } = req.body;
  if (!name || !phone) return res.status(400).json({ success: false, error: 'Name and phone required' });
  if (newPassword && newPassword.length < 8) return res.status(400).json({ success: false, error: 'Password must be at least 8 characters' });
  
  const result = await store.updateUserProfile(user.id, { name, phone, newPassword });
  if (result.error) return res.status(400).json({ success: false, error: result.error });
  res.json({ success: true, user: result.user });
});

module.exports = router;
