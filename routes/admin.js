const express = require('express');
const router = express.Router();
const store = require('../models/store');

// Utility to enforce string types
const isStr = (val) => typeof val === 'string' && val.trim() !== '';

// GET /api/admin/dashboard
router.get('/dashboard', async (req, res) => {
  res.json({ success: true, stats: await store.getDashboardStats(), reviewAnalytics: store.getReviewAnalytics() });
});

// GET /api/admin/notifications
router.get('/notifications', (req, res) => {
  res.json({ success: true, notifications: store.getNotifications(), unread: store.getUnreadCount() });
});

// PUT /api/admin/notifications/:id/read
router.put('/notifications/:id/read', (req, res) => {
  store.markNotificationRead(String(req.params.id));
  res.json({ success: true });
});

// POST /api/admin/notifications/read-all
router.post('/notifications/read-all', (req, res) => {
  store.markAllRead();
  res.json({ success: true });
});

// GET /api/admin/orders
router.get('/orders', async (req, res) => {
  res.json({ success: true, orders: await store.getAllOrders() });
});

// GET /api/admin/reviews
router.get('/reviews', (req, res) => {
  res.json({
    success: true,
    reviews: store.getReviewQueue(req.query),
    analytics: store.getReviewAnalytics()
  });
});

// PUT /api/admin/orders/:orderId/status
router.put('/orders/:orderId/status', async (req, res) => {
  const { status } = req.body;
  if (!isStr(status)) return res.status(400).json({ success: false, error: 'Valid status required' });
  const result = await store.updateOrderStatus(String(req.params.orderId), status);
  if (result.error) return res.status(404).json({ success: false, error: result.error });
  res.json({ success: true, order: result });
});

// PUT /api/admin/reviews/:reviewId/status
router.put('/reviews/:reviewId/status', async (req, res) => {
  const { status, rejectionNote } = req.body;
  if (!isStr(status)) return res.status(400).json({ success: false, error: 'Valid status required' });
  if (rejectionNote !== undefined && typeof rejectionNote !== 'string') {
    return res.status(400).json({ success: false, error: 'Rejection note must be a string' });
  }
  const result = await store.moderateReview(String(req.params.reviewId), status, req.user, rejectionNote);
  if (result.error) {
    const statusCode = result.error.includes('not found') ? 404 : 400;
    return res.status(statusCode).json({ success: false, error: result.error });
  }
  res.json({ success: true, review: result.review, summary: result.summary, analytics: result.analytics });
});

// ── Customer Management ──
router.get('/customers', async (req, res) => {
  res.json({ success: true, customers: await store.getCustomers() });
});

// ── Admin Management ──
router.get('/admins', async (req, res) => {
  res.json({ success: true, admins: await store.getAdmins() });
});

router.post('/admins', async (req, res) => {
  const { name, email, password, phone } = req.body;
  if (!isStr(name) || !isStr(email) || !isStr(password)) {
    return res.status(400).json({ success: false, error: 'Name, email, and password are required and must be valid strings' });
  }
  const result = await store.addAdmin({ name, email, password, phone: String(phone || '') });
  if (result.error) return res.status(400).json({ success: false, error: result.error });
  res.status(201).json({ success: true, admin: result.admin });
});

router.delete('/admins/:id', async (req, res) => {
  const result = await store.deleteAdmin(String(req.params.id));
  if (result.error) return res.status(400).json({ success: false, error: result.error });
  res.json({ success: true });
});

// ── Coupon Management ──
router.get('/coupons', async (req, res) => {
  res.json({ success: true, coupons: await store.getCoupons() });
});

router.post('/coupons', async (req, res) => {
  if (typeof req.body !== 'object' || req.body === null) return res.status(400).json({ error: 'Invalid payload' });
  const result = await store.createCoupon(req.body);
  if (result.error) return res.status(400).json({ success: false, error: result.error });
  res.json({ success: true, coupon: result.coupon });
});

router.put('/coupons/:id', async (req, res) => {
  if (typeof req.body !== 'object' || req.body === null) return res.status(400).json({ error: 'Invalid payload' });
  const result = await store.updateCoupon(String(req.params.id), req.body);
  if (result.error) return res.status(result.error === 'Coupon not found' ? 404 : 400).json({ success: false, error: result.error });
  res.json({ success: true, coupon: result.coupon });
});

router.delete('/coupons/:id', async (req, res) => {
  const result = await store.deleteCoupon(String(req.params.id));
  if (result.error) return res.status(404).json({ success: false, error: result.error });
  res.json({ success: true });
});

// ── Broadcast Offer Email ──
router.post('/broadcast-offer', async (req, res) => {
  const { subject, message } = req.body;
  if (!isStr(subject) || !isStr(message)) {
    return res.status(400).json({ success: false, error: 'Valid subject and message are required' });
  }
  try {
    const result = await store.broadcastOfferEmail(subject, message);
    res.json({ success: true, sentCount: result.sentCount });
  } catch (err) {
    console.error('[Admin] Broadcast offer error:', err);
    res.status(500).json({ success: false, error: 'Failed to send broadcast email. Please try again or check server logs.' });
  }
});

module.exports = router;
