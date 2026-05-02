const express = require('express');
const router = express.Router();
const store = require('../models/store');

// GET /api/cart
router.get('/', (req, res) => {
  const userId = req.userId || 'guest';
  res.json({ success: true, cart: store.getCart(userId) });
});

// POST /api/cart
router.post('/', async (req, res) => {
  const userId = req.userId || 'guest';
  const { productId, quantity } = req.body;
  if (!productId) return res.status(400).json({ success: false, error: 'productId is required' });
  await store.refreshProducts();
  const result = await store.addToCart(userId, productId, quantity || 1);
  if (result.error) return res.status(400).json({ success: false, error: result.error });
  res.json({ success: true, cart: result });
});

// PUT /api/cart/:cartItemId
router.put('/:cartItemId', async (req, res) => {
  const userId = req.userId || 'guest';
  const { quantity } = req.body;
  if (typeof quantity !== 'number') return res.status(400).json({ success: false, error: 'quantity required' });
  await store.refreshProducts();
  const result = await store.updateCartItem(userId, req.params.cartItemId, quantity);
  if (result.error) return res.status(400).json({ success: false, error: result.error });
  res.json({ success: true, cart: result });
});

// DELETE /api/cart/:cartItemId
router.delete('/:cartItemId', async (req, res) => {
  const userId = req.userId || 'guest';
  const result = await store.removeCartItem(userId, req.params.cartItemId);
  if (result.error) return res.status(404).json({ success: false, error: result.error });
  res.json({ success: true, cart: result });
});

// DELETE /api/cart
router.delete('/', async (req, res) => {
  const userId = req.userId || 'guest';
  res.json({ success: true, cart: await store.clearCart(userId) });
});

module.exports = router;
