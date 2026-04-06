const mongoose = require('mongoose');

let isConnected = false;

async function connectDB() {
  if (isConnected) return true;
  if (!process.env.MONGODB_URI) {
    console.log('[MongoDB] URI not found in .env, using memory storage only.');
    return false;
  }
  try {
    // Fix compatibility issues by removing deprecated options if they exist
    await mongoose.connect(process.env.MONGODB_URI);
    isConnected = true;
    console.log('✅ Connected to MongoDB Backend');
    return true;
  } catch (err) {
    console.error('❌ MongoDB Connection Error:', err.message);
    return false;
  }
}

async function loadData(collectionName) {
  if (!isConnected) return null;
  // Read array/object directly from its dedicated MongoDB collection
  const data = await mongoose.connection.db.collection(collectionName).find({}).toArray();
  
  if (collectionName === 'carts' || collectionName === 'pendingOtps') {
    // Restore raw Objects from standard arrays since MongoDB saves as Array of Docs
    if (!data.length) return null;
    return data[0].state || null;
  }
  
  if (!data || data.length === 0) return null;
  // Remove native mongodb _id wrapper fields when passing back to memory
  return data.map(({ _id, ...rest }) => rest);
}

async function saveData(collectionName, data) {
  if (!isConnected) return;
  const col = mongoose.connection.db.collection(collectionName);
  
  if (collectionName === 'carts' || collectionName === 'pendingOtps') {
    // Carts and Otps are raw objects ({ userId: [...] }) - save as a single state document
    await col.deleteMany({});
    await col.insertOne({ state: data }).catch(console.error);
    return;
  }

  // Check if data is array
  if (Array.isArray(data) && data.length > 0) {
    // To make it viewable in Compass like a normal Database without complex diffing,
    // we mirror our synchronized memory array directly into the Atlas collection!
    await col.deleteMany({});
    await col.insertMany(data).catch(console.error);
  }
}

async function bootstrapCollections(collectionsArray) {
  if (!isConnected) return;
  for (const c of collectionsArray) {
    try {
      await mongoose.connection.db.createCollection(c);
      console.log(`[MongoDB] Instantiated missing collection folder: ${c}`);
    } catch (err) {
      // Ignore if collection already exists
    }
  }
}

module.exports = { connectDB, loadData, saveData, bootstrapCollections };
