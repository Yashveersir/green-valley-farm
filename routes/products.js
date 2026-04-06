const express = require('express');
const router = express.Router();
const store = require('../models/store');

// GET /api/products
router.get('/', (req, res) => {
  const { category, search } = req.query;
  if (search) {
    const results = store.searchProducts(search);
    return res.json({ success: true, count: results.length, products: results });
  }
  const products = store.getAllProducts(category);
  res.json({ success: true, count: products.length, products });
});

// GET /api/products/:id
router.get('/:id', (req, res) => {
  const product = store.getProductById(req.params.id);
  if (!product) return res.status(404).json({ success: false, error: 'Product not found' });
  res.json({ success: true, product });
});

// POST /api/products (admin only — auth checked in server.js middleware)
router.post('/', (req, res) => {
  const product = store.addProduct(req.body);
  res.status(201).json({ success: true, product });
});

// PUT /api/products/:id (admin only)
router.put('/:id', (req, res) => {
  const result = store.updateProduct(req.params.id, req.body);
  if (result.error) return res.status(404).json({ success: false, error: result.error });
  res.json({ success: true, product: result });
});

// DELETE /api/products/:id (admin only)
router.delete('/:id', (req, res) => {
  const result = store.deleteProduct(req.params.id);
  if (result.error) return res.status(404).json({ success: false, error: result.error });
  res.json({ success: true });
});

module.exports = router;
