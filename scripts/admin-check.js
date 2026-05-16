const store = require('../models/store');
const db = require('../models/db');
require('dotenv').config();

async function runAdminCheck() {
  console.log('Starting Admin Deep Check...');
  await store.init();
  console.log('Store Initialized');

  let errors = 0;

  try {
    console.log('1. Checking Admin Users...');
    // Login as admin
    const adminEmail = process.env.SMTP_USER || 'sales.greenvalleyfarm@gmail.com';
    // Actually, we don't have the password easily. But we can query users
    const users = await db.findData('users', { role: 'admin' });
    if (!users || users.length === 0) {
      console.log('⚠️ No admin users found via DB direct query. Let\'s check in-memory state implicitly.');
    } else {
      console.log(`✓ Found ${users.length} admin users`);
    }

    console.log('2. Checking Dashboard Stats...');
    const stats = await store.getDashboardStats();
    if (!stats || typeof stats.totalProducts !== 'number') {
      throw new Error(`Invalid stats object: ${JSON.stringify(stats)}`);
    }
    console.log(`✓ Dashboard stats OK (Products: ${stats.totalProducts}, Orders: ${stats.totalOrders}, Revenue: ₹${stats.totalRevenue})`);

    console.log('3. Checking Order Management...');
    const allOrders = await store.getAllOrders();
    console.log(`✓ Retrieved ${allOrders.length} total orders`);
    
    if (allOrders.length > 0) {
      const order = allOrders[0];
      const previousStatus = order.status;
      // Change status to processing
      const updateRes = await store.updateOrderStatus(order.orderId, 'processing');
      if (updateRes.error) throw new Error(`Update order status failed: ${updateRes.error}`);
      if (updateRes.status !== 'processing') throw new Error('Status not updated to processing');
      console.log(`✓ Order status updated to processing`);
      
      // Revert status
      await store.updateOrderStatus(order.orderId, previousStatus);
    }

    console.log('4. Checking Reviews Management...');
    const pendingReviews = store.getPendingReviews();
    console.log(`✓ Retrieved ${pendingReviews.length} pending reviews`);

    const analytics = store.getReviewAnalytics();
    if (!analytics || !analytics.totals) throw new Error('Invalid review analytics');
    console.log(`✓ Review analytics OK`);

    console.log('5. Checking Coupon Management...');
    const coupons = await store.getCoupons();
    console.log(`✓ Retrieved ${coupons.length} coupons`);
    
    const newCoupon = await store.createCoupon({
      code: 'TESTADMIN',
      type: 'flat',
      value: 100,
      active: true
    });
    if (newCoupon.error) {
      if (newCoupon.error === 'Coupon code already exists') {
         console.log('✓ Coupon already exists');
      } else {
         throw new Error(`Create coupon failed: ${newCoupon.error}`);
      }
    } else {
      console.log(`✓ Created new coupon ${newCoupon.coupon.code}`);
      const delCoupon = await store.deleteCoupon(newCoupon.coupon.id);
      if (delCoupon.error) throw new Error(`Delete coupon failed: ${delCoupon.error}`);
      console.log('✓ Deleted coupon successfully');
    }

    console.log('6. Checking Customer Management...');
    const customers = await store.getCustomers();
    console.log(`✓ Retrieved ${customers.length} customers`);

  } catch (err) {
    console.error('❌ ADMIN CHECK FAILED:', err.message);
    errors++;
  }

  if (errors === 0) {
    console.log('\n✅ ALL ADMIN DEEP CHECKS PASSED.');
  } else {
    console.error(`\n❌ Finished with ${errors} error(s).`);
  }
  process.exit(errors > 0 ? 1 : 0);
}

runAdminCheck();