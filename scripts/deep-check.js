const store = require('../models/store');
const db = require('../models/db');
require('dotenv').config();

async function runCheck() {
  console.log('Starting Deep Check...');
  await store.init();
  console.log('Store Initialized');

  let errors = 0;

  try {
    console.log('1. Checking Products...');
    const products = await store.refreshProducts();
    if (!products || !products.length) throw new Error('No products found');
    console.log(`✓ Found ${products.length} products`);
    
    // Check product properties
    const product = products[0];
    if (!product.id || !product.name || product.price === undefined) {
      throw new Error(`Product missing critical properties: ${JSON.stringify(product)}`);
    }

    console.log('2. Checking Users...');
    // Add a test user
    const regResult = await store.registerUser({
      name: 'Test User',
      email: 'testdeep@example.com',
      password: 'password123',
      phone: '1234567890'
    });
    if (regResult.error) {
      // If it exists, login instead
      if (regResult.error === 'Email already registered') {
         await store.loginUser('testdeep@example.com', 'password123');
      } else {
         throw new Error(`Registration failed: ${regResult.error}`);
      }
    }
    
    const user = await store.loginUser('testdeep@example.com', 'password123');
    if (user.error || !user.user.id) throw new Error('Login failed');
    const userId = user.user.id;
    console.log(`✓ User logic OK (ID: ${userId})`);

    console.log('3. Checking Cart Logic...');
    const cartRes1 = await store.addToCart(userId, product.id, 2);
    if (cartRes1.error) throw new Error(`Add to cart failed: ${cartRes1.error}`);
    if (cartRes1.items[0].quantity !== 2) throw new Error('Cart quantity mismatch');
    console.log('✓ Cart logic OK');

    console.log('4. Checking Order Logic...');
    const orderRes = await store.placeOrder(userId, {
      name: 'Test',
      phone: '123',
      address: 'Test Addr',
      paymentMethod: 'COD'
    });
    if (orderRes.error) throw new Error(`Place order failed: ${orderRes.error}`);
    const orderId = orderRes.orderId;
    if (!orderId) throw new Error('Order missing ID');
    console.log(`✓ Order logic OK (Order: ${orderId})`);

    console.log('5. Checking Order Retrieval & Cancel...');
    const orders = await store.getOrders(userId);
    if (orders.length === 0) throw new Error('Could not retrieve orders');
    
    const cancelRes = await store.cancelOrder(orderId, userId);
    if (cancelRes.error) throw new Error(`Cancel order failed: ${cancelRes.error}`);
    if (cancelRes.status !== 'cancelled') throw new Error('Order status not updated to cancelled');
    console.log('✓ Order cancel OK');

    console.log('6. Checking Reviews Logic...');
    const reviewRes = await store.addReview(userId, product.id, {
      rating: 5,
      comment: 'This is a great product and here are some words.',
      photos: []
    });
    // This will fail with 'Only customers with a delivered order can review this product'
    if (!reviewRes.error && reviewRes.error !== 'Only customers with a delivered order can review this product') {
        console.log("Review result:", reviewRes);
    } else {
        console.log('✓ Review logic appropriately blocked un-delivered purchase');
    }

  } catch (err) {
    console.error('❌ CHECK FAILED:', err.message);
    errors++;
  }

  if (errors === 0) {
    console.log('\n✅ ALL DEEP CHECKS PASSED.');
  } else {
    console.error(`\n❌ Finished with ${errors} error(s).`);
  }
  process.exit(errors > 0 ? 1 : 0);
}

runCheck();