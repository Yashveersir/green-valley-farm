require('dotenv').config();
const mongoose = require('mongoose');
const store = require('../models/store');

async function fix() {
  await store.init();
  const db = mongoose.connection.db;
  
  const res = await db.collection('orders').updateMany(
    { userId: 'user-a0752c42' }, 
    { $set: { userId: 'user-730dcf34' } }
  );
  
  console.log('Fixed:', res);
  process.exit(0);
}

fix().catch(console.error);