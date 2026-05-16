const express = require('express');
const router = express.Router();
const Razorpay = require('razorpay');
const crypto = require('crypto');
const store = require('../models/store');

let razorpayInstance = null;
try {
  razorpayInstance = new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID || 'mock_key_id',
    key_secret: process.env.RAZORPAY_KEY_SECRET || 'mock_key_secret',
  });
} catch (err) {
  console.warn('Razorpay initialization failed:', err.message);
}

function razorpayConfigured() {
  return Boolean(razorpayInstance && process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET);
}

// POST /api/payments/create-order
router.post('/create-order', async (req, res) => {
  const userId = req.userId;
  if (!razorpayConfigured()) {
    return res.status(503).json({ success: false, error: 'Online payment is not configured' });
  }

  const { amount, currency = 'INR', receipt } = req.body;
  if (!amount || amount < 100) return res.status(400).json({ success: false, error: 'Invalid amount, minimum 100 paise required' });

  try {
    const options = {
      amount,
      currency,
      receipt: receipt || `rcpt_${Date.now()}`
    };
    
    const order = await razorpayInstance.orders.create(options);
    res.json({ success: true, order_id: order.id, amount: order.amount, currency: order.currency });
  } catch (err) {
    console.error('Razorpay Create Order Error:', err);
    res.status(500).json({ success: false, error: 'Failed to create payment order' });
  }
});

// POST /api/payments/verify-payment
router.post('/verify-payment', async (req, res) => {
  const userId = req.userId;
  if (!process.env.RAZORPAY_KEY_SECRET) {
    return res.status(503).json({ success: false, error: 'Online payment is not configured' });
  }

  const { razorpay_order_id, razorpay_payment_id, razorpay_signature, orderDetails } = req.body;
  
  if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
    return res.status(400).json({ success: false, error: 'Missing payment verification details' });
  }

  try {
    const body = razorpay_order_id + "|" + razorpay_payment_id;
    const expectedSignature = crypto
      .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
      .update(body.toString())
      .digest('hex');

    if (expectedSignature !== razorpay_signature) {
      return res.status(400).json({ success: false, error: 'Invalid payment signature' });
    }

    // Payment successful! Create order in our system if orderDetails are provided
    if (orderDetails) {
      const { name, phone, address } = orderDetails;
      const result = await store.placeOrder(userId, { 
        name, phone, address, 
        paymentMethod: 'Razorpay Online',
        upiUtr: razorpay_payment_id, // Keeping this for backward compatibility or generic ID tracking
        razorpayOrderId: razorpay_order_id,
        razorpayPaymentId: razorpay_payment_id
      });
      
      if (result.error) return res.status(400).json({ success: false, error: result.error });
      return res.json({ success: true, order: result });
    }

    res.json({ success: true, message: 'Payment verified successfully' });
  } catch (err) {
    console.error('Verify Payment Error:', err);
    res.status(500).json({ success: false, error: 'Failed to verify payment' });
  }
});

module.exports = router;
