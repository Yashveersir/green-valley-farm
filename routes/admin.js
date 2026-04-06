const express = require('express');
const router = express.Router();
const store = require('../models/store');

// GET /api/admin/dashboard
router.get('/dashboard', (req, res) => {
  res.json({ success: true, stats: store.getDashboardStats() });
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

// PUT /api/admin/orders/:orderId/status
router.put('/orders/:orderId/status', (req, res) => {
  const { status } = req.body;
  if (!status) return res.status(400).json({ success: false, error: 'Status required' });
  const result = store.updateOrderStatus(req.params.orderId, status);
  if (result.error) return res.status(404).json({ success: false, error: result.error });
  res.json({ success: true, order: result });
});

module.exports = router;
