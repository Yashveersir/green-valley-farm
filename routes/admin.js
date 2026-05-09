const express = require('express');
const router = express.Router();
const store = require('../models/store');

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
  store.markNotificationRead(req.params.id);
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
  if (!status) return res.status(400).json({ success: false, error: 'Status required' });
  const result = await store.updateOrderStatus(req.params.orderId, status);
  if (result.error) return res.status(404).json({ success: false, error: result.error });
  res.json({ success: true, order: result });
});

// PUT /api/admin/reviews/:reviewId/status
router.put('/reviews/:reviewId/status', async (req, res) => {
  const { status, rejectionNote } = req.body;
  if (!status) return res.status(400).json({ success: false, error: 'Status required' });
  const result = await store.moderateReview(req.params.reviewId, status, req.user, rejectionNote);
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

// ── Coupon Management ──

// GET /api/admin/coupons
router.get('/coupons', async (req, res) => {
  res.json({ success: true, coupons: await store.getCoupons() });
});

// POST /api/admin/coupons
router.post('/coupons', async (req, res) => {
  const result = await store.createCoupon(req.body);
  if (result.error) return res.status(400).json({ success: false, error: result.error });
  res.json({ success: true, coupon: result.coupon });
});

// PUT /api/admin/coupons/:id
router.put('/coupons/:id', async (req, res) => {
  const result = await store.updateCoupon(req.params.id, req.body);
  if (result.error) return res.status(result.error === 'Coupon not found' ? 404 : 400).json({ success: false, error: result.error });
  res.json({ success: true, coupon: result.coupon });
});

// DELETE /api/admin/coupons/:id
router.delete('/coupons/:id', async (req, res) => {
  const result = await store.deleteCoupon(req.params.id);
  if (result.error) return res.status(404).json({ success: false, error: result.error });
  res.json({ success: true });
});

// ── Broadcast Offer Email ──

// POST /api/admin/broadcast-offer
router.post('/broadcast-offer', async (req, res) => {
  const { subject, message } = req.body;
  if (!subject || !message) return res.status(400).json({ success: false, error: 'Subject and message are required' });
  try {
    const result = await store.broadcastOfferEmail(subject, message);
    res.json({ success: true, sentCount: result.sentCount });
  } catch (err) {
    // ✅ Log full error server-side; return generic message to client (no stack traces or internal paths)
    console.error('[Admin] Broadcast offer error:', err);
    res.status(500).json({ success: false, error: 'Failed to send broadcast email. Please try again or check server logs.' });
  }
});

module.exports = router;
