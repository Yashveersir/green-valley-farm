const express = require('express');
const router = express.Router();
const store = require('../models/store');

// GET /api/admin/dashboard
router.get('/dashboard', (req, res) => {
  res.json({ success: true, stats: store.getDashboardStats(), reviewAnalytics: store.getReviewAnalytics() });
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
router.get('/orders', (req, res) => {
  res.json({ success: true, orders: store.getAllOrders() });
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

module.exports = router;
