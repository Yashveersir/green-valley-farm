const express = require('express');
const router = express.Router();
const store = require('../models/store');

// POST /api/orders
router.post('/', async (req, res) => {
  const userId = req.userId;
  if (!userId) return res.status(401).json({ success: false, error: 'Login required to place orders' });
  const { name, phone, address, paymentMethod, upiUtr, upiScreenshot } = req.body;
  if (!name || !phone || !address) return res.status(400).json({ success: false, error: 'Name, phone, and address required' });
  try {
    const result = await store.placeOrder(userId, { name, phone, address, paymentMethod, upiUtr, upiScreenshot });
    if (result.error) return res.status(400).json({ success: false, error: result.error });
    res.status(201).json({ success: true, order: result });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Failed to place order' });
  }
});

// GET /api/orders
router.get('/', async (req, res) => {
  const userId = req.userId;
  if (!userId) return res.status(401).json({ success: false, error: 'Login required' });
  const orders = await store.getOrders(userId);
  res.json({ success: true, count: orders.length, orders });
});

// GET /api/orders/:orderId
router.get('/:orderId', async (req, res) => {
  const userId = req.userId;
  if (!userId) return res.status(401).json({ success: false, error: 'Login required' });
  const order = await store.getOrderById(req.params.orderId);
  if (!order) return res.status(404).json({ success: false, error: 'Order not found' });
  if (order.userId !== userId) return res.status(403).json({ success: false, error: 'Access denied' });
  res.json({ success: true, order });
});

// PUT /api/orders/:orderId/cancel
router.put('/:orderId/cancel', async (req, res) => {
  const userId = req.userId;
  if (!userId) return res.status(401).json({ success: false, error: 'Login required' });
  const result = await store.cancelOrder(req.params.orderId, userId);
  if (result.error) return res.status(400).json({ success: false, error: result.error });
  res.json({ success: true, order: result });
});

module.exports = router;
