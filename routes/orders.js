const express = require('express');
const router = express.Router();
const store = require('../models/store');

// POST /api/orders
router.post('/', async (req, res) => {
  const userId = req.userId;
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
  const orders = await store.getOrders(userId);
  res.json({ success: true, count: orders.length, orders });
});

// GET /api/orders/:orderId
router.get('/:orderId', async (req, res) => {
  const userId = req.userId;
  const order = await store.getOrderById(req.params.orderId);
  if (!order) return res.status(404).json({ success: false, error: 'Order not found' });
  if (order.userId !== userId) return res.status(403).json({ success: false, error: 'Access denied' });
  res.json({ success: true, order });
});

// PUT /api/orders/:orderId/cancel
router.put('/:orderId/cancel', async (req, res) => {
  const userId = req.userId;
  const result = await store.cancelOrder(req.params.orderId, userId);
  if (result.error) return res.status(400).json({ success: false, error: result.error });
  res.json({ success: true, order: result });
});

// GET /api/orders/:orderId/invoice
router.get('/:orderId/invoice', async (req, res) => {
  const userId = req.userId;
  const order = await store.getOrderById(req.params.orderId);
  if (!order) return res.status(404).send('Order not found');
  if (order.userId !== userId && req.userRole !== 'admin') return res.status(403).send('Access denied');

  const itemRows = order.items.map(i =>
    `<tr>
      <td style="padding:12px;border-bottom:1px solid #eee;">${i.name}</td>
      <td style="padding:12px;border-bottom:1px solid #eee;text-align:center;">x${i.quantity}</td>
      <td style="padding:12px;border-bottom:1px solid #eee;text-align:right;">₹${i.subtotal}</td>
    </tr>`
  ).join('');

  const html = `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <title>Invoice - ${order.orderId}</title>
      <style>
        body { font-family: 'Segoe UI', system-ui, sans-serif; background: #f6f9f4; color: #333; margin: 0; padding: 40px 20px; }
        .invoice-box { max-width: 800px; margin: 0 auto; background: #fff; padding: 40px; border-radius: 12px; box-shadow: 0 8px 30px rgba(0,0,0,0.08); }
        .header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 40px; padding-bottom: 20px; border-bottom: 2px solid #1a4d2e; }
        .header h1 { margin: 0 0 8px 0; color: #1a4d2e; font-size: 28px; }
        .details { display: flex; justify-content: space-between; margin-bottom: 30px; line-height: 1.6; }
        .table { width: 100%; border-collapse: collapse; margin-bottom: 30px; }
        .table th { background: #f0fdf4; padding: 12px; text-align: left; color: #1a4d2e; border-bottom: 2px solid #cce8d6; }
        .table th:nth-child(2) { text-align: center; }
        .table th:last-child { text-align: right; }
        .total-row { font-weight: 800; font-size: 18px; color: #1a4d2e; }
        .footer { text-align: center; margin-top: 40px; font-size: 14px; color: #666; padding-top: 20px; border-top: 1px solid #eee; }
        .print-btn { display: block; width: fit-content; margin: 30px auto 0; padding: 12px 24px; background: #1a4d2e; color: #fff; border: none; border-radius: 6px; font-size: 16px; font-weight: 600; cursor: pointer; text-transform: uppercase; letter-spacing: 1px; }
        .print-btn:hover { background: #2d7a4a; }
        @media print {
          body { background: #fff; padding: 0; }
          .invoice-box { box-shadow: none; padding: 0; }
          .print-btn { display: none; }
        }
      </style>
    </head>
    <body>
      <div class="invoice-box">
        <div class="header">
          <div>
            <h1>🌿 Green Valley Farm</h1>
            <p style="margin:0;color:#666;">Tengrahan, Minapur<br>Muzaffarpur, Bihar - 843117</p>
            <p style="margin:4px 0 0;color:#666;">Phone: +91 9471800046</p>
          </div>
          <div style="text-align: right;">
            <h2 style="margin: 0 0 8px 0; color: #555; font-size: 32px; letter-spacing: 2px;">INVOICE</h2>
            <p style="margin: 0;"><strong>Order ID:</strong> ${order.orderId}</p>
            <p style="margin: 4px 0 0;"><strong>Date:</strong> ${new Date(order.placedAt).toLocaleDateString('en-IN', { year: 'numeric', month: 'long', day: 'numeric' })}</p>
          </div>
        </div>
        
        <div class="details">
          <div>
            <h3 style="margin:0 0 8px;font-size:16px;color:#888;text-transform:uppercase;">Billed To</h3>
            <p style="margin:0;font-weight:600;font-size:16px;">${order.customer.name}</p>
            <p style="margin:4px 0 0;color:#555;max-width:250px;">${order.customer.address}</p>
            <p style="margin:4px 0 0;color:#555;">Phone: ${order.customer.phone}</p>
          </div>
          <div style="text-align: right;">
            <h3 style="margin:0 0 8px;font-size:16px;color:#888;text-transform:uppercase;">Payment Info</h3>
            <p style="margin:0;"><strong>Method:</strong> ${order.paymentMethod || 'COD'}</p>
            ${order.upiUtr ? `<p style="margin:4px 0 0;"><strong>Transaction ID:</strong> ${order.upiUtr}</p>` : ''}
            <p style="margin:4px 0 0;"><strong>Status:</strong> <span style="color:#1a4d2e;font-weight:700;">${order.status.toUpperCase()}</span></p>
          </div>
        </div>

        <table class="table">
          <tr>
            <th>Item Description</th>
            <th>Quantity</th>
            <th>Price</th>
          </tr>
          ${itemRows}
          <tr>
            <td colspan="2" style="text-align: right; padding: 16px 12px;" class="total-row">Grand Total</td>
            <td style="text-align: right; padding: 16px 12px;" class="total-row">₹${order.totalPrice}</td>
          </tr>
        </table>

        <div class="footer">
          <p style="margin:0;">Thank you for choosing farm-fresh quality! 🌿</p>
        </div>
        
        <button class="print-btn" onclick="window.print()">🖨️ Print / Save PDF</button>
      </div>
    </body>
    </html>
  `;
  res.send(html);
});

module.exports = router;
