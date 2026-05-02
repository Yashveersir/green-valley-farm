const express = require('express');
const router = express.Router();
const store = require('../models/store');

function preventProductCache(res) {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
}

// GET /api/products
router.get('/', async (req, res) => {
  preventProductCache(res);
  await store.refreshProducts();
  const { category, search, sort, minRating } = req.query;
  const products = search
    ? store.searchProducts(search)
    : store.getAllProducts(category, { search, sort, minRating });
  res.json({ success: true, count: products.length, products });
});

// GET /api/products/:id
router.get('/:id', async (req, res) => {
  preventProductCache(res);
  await store.refreshProducts();
  const product = store.getProductById(req.params.id);
  if (!product) return res.status(404).json({ success: false, error: 'Product not found' });
  res.json({ success: true, product });
});

// GET /api/products/:id/reviews
router.get('/:id/reviews', async (req, res) => {
  preventProductCache(res);
  await store.refreshProducts();
  const product = store.getProductById(req.params.id);
  if (!product) return res.status(404).json({ success: false, error: 'Product not found' });
  const reviews = store.getProductReviews(req.params.id, req.query);
  const eligibility = store.getReviewEligibility(req.params.id, req.userId);
  res.json({
    success: true,
    summary: store.getProductReviewSummary(req.params.id),
    reviews,
    eligibility: eligibility.error ? null : eligibility,
    filters: {
      sort: req.query.sort || 'newest',
      rating: Number(req.query.rating) || 0,
      withPhotos: String(req.query.withPhotos || '') === 'true'
    }
  });
});

// POST /api/products/:id/reviews
router.post('/:id/reviews', async (req, res) => {
  if (!req.userId) return res.status(401).json({ success: false, error: 'Login required to submit a review' });
  const result = await store.addReview(req.userId, req.params.id, req.body);
  if (result.error) {
    const statusCode = result.error.includes('not found') ? 404 : 400;
    return res.status(statusCode).json({ success: false, error: result.error });
  }
  res.status(201).json({ success: true, review: result.review, summary: result.summary });
});

// PUT /api/products/:id/reviews
router.put('/:id/reviews', async (req, res) => {
  if (!req.userId) return res.status(401).json({ success: false, error: 'Login required to update a review' });
  const result = await store.updateReview(req.userId, req.params.id, req.body);
  if (result.error) {
    const statusCode = result.error.includes('not found') ? 404 : 400;
    return res.status(statusCode).json({ success: false, error: result.error });
  }
  res.json({ success: true, review: result.review, summary: result.summary });
});

// DELETE /api/products/:id/reviews
router.delete('/:id/reviews', async (req, res) => {
  if (!req.userId) return res.status(401).json({ success: false, error: 'Login required to delete a review' });
  const result = await store.deleteReview(req.userId, req.params.id);
  if (result.error) {
    const statusCode = result.error.includes('not found') ? 404 : 400;
    return res.status(statusCode).json({ success: false, error: result.error });
  }
  res.json({ success: true, review: result.review, summary: result.summary });
});

// POST /api/products (admin only — auth checked in server.js middleware)
router.post('/', async (req, res) => {
  const product = await store.addProduct(req.body);
  res.status(201).json({ success: true, product });
});

// PUT /api/products/:id (admin only)
router.put('/:id', async (req, res) => {
  const result = await store.updateProduct(req.params.id, req.body);
  if (result.error) return res.status(404).json({ success: false, error: result.error });
  res.json({ success: true, product: result });
});

// DELETE /api/products/:id (admin only)
router.delete('/:id', async (req, res) => {
  const result = await store.deleteProduct(req.params.id);
  if (result.error) return res.status(404).json({ success: false, error: result.error });
  res.json({ success: true });
});

module.exports = router;
