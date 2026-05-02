const mongoose = require('mongoose');

let isConnected = false;
let connectPromise = null;
const DB_CONNECT_TIMEOUT_MS = Number(process.env.DB_CONNECT_TIMEOUT_MS) || 5000;

const schemaOptions = {
  strict: false,
  versionKey: false,
  timestamps: false
};

const userSchema = new mongoose.Schema({
  id: { type: String, required: true, index: true },
  name: { type: String, required: true, trim: true },
  email: { type: String, required: true, lowercase: true, trim: true, index: true },
  passwordHash: { type: String },
  phone: { type: String, default: '' },
  role: { type: String, enum: ['admin', 'customer'], default: 'customer' },
  createdAt: { type: String, required: true }
}, schemaOptions);

const productSchema = new mongoose.Schema({
  id: { type: String, required: true, index: true },
  name: { type: String, required: true, trim: true },
  category: { type: String, required: true, trim: true },
  description: { type: String, default: '' },
  price: { type: Number, required: true, min: 0 },
  unit: { type: String, default: 'per unit' },
  stock: { type: Number, default: 0, min: 0 },
  slug: { type: String, required: true, index: true }
}, schemaOptions);

const orderSchema = new mongoose.Schema({
  orderId: { type: String, required: true, index: true },
  userId: { type: String, required: true, index: true },
  items: { type: Array, default: [] },
  customer: { type: Object, required: true },
  totalPrice: { type: Number, required: true, min: 0 },
  status: { type: String, required: true },
  placedAt: { type: String, required: true }
}, schemaOptions);

const reviewSchema = new mongoose.Schema({
  id: { type: String, required: true, index: true },
  productId: { type: String, required: true, index: true },
  userId: { type: String, required: true, index: true },
  rating: { type: Number, required: true, min: 1, max: 5 },
  comment: { type: String, default: '' },
  status: { type: String, required: true },
  createdAt: { type: String, required: true }
}, schemaOptions);

const notificationSchema = new mongoose.Schema({
  id: { type: String, required: true, index: true },
  type: { type: String, required: true },
  title: { type: String, required: true },
  message: { type: String, default: '' },
  read: { type: Boolean, default: false },
  createdAt: { type: String, required: true }
}, schemaOptions);

const stateSchema = new mongoose.Schema({
  state: { type: mongoose.Schema.Types.Mixed, default: {} }
}, schemaOptions);

const collectionSchemas = {
  users: userSchema,
  products: productSchema,
  orders: orderSchema,
  reviews: reviewSchema,
  notifications: notificationSchema,
  carts: stateSchema,
  pendingOtps: stateSchema
};

function getModel(collectionName) {
  const modelName = `Gvf${collectionName.charAt(0).toUpperCase()}${collectionName.slice(1)}`;
  if (mongoose.models[modelName]) return mongoose.models[modelName];
  const schema = collectionSchemas[collectionName] || new mongoose.Schema({}, schemaOptions);
  return mongoose.model(modelName, schema, collectionName);
}

async function connectDB() {
  if (isConnected) return true;
  if (connectPromise) return connectPromise;
  if (!process.env.MONGODB_URI) {
    console.log('[MongoDB] URI not found in .env, using memory storage only.');
    return false;
  }
  connectPromise = connectWithTimeout();
  return connectPromise;
}

async function connectWithTimeout() {
  let timeoutId;
  try {
    const timeout = new Promise((_, reject) => {
      timeoutId = setTimeout(() => {
        reject(new Error(`MongoDB connection timed out after ${DB_CONNECT_TIMEOUT_MS}ms`));
      }, DB_CONNECT_TIMEOUT_MS);
    });

    // Fix compatibility issues and prevent endless hanging if IPs are not whitelisted
    await Promise.race([
      mongoose.connect(process.env.MONGODB_URI, {
        serverSelectionTimeoutMS: DB_CONNECT_TIMEOUT_MS,
        connectTimeoutMS: DB_CONNECT_TIMEOUT_MS,
        socketTimeoutMS: DB_CONNECT_TIMEOUT_MS,
        family: 4,
      }),
      timeout
    ]);

    isConnected = mongoose.connection.readyState === 1;
    console.log('✅ Connected to MongoDB Backend');
    return isConnected;
  } catch (err) {
    isConnected = false;
    console.error('❌ MongoDB Connection Error:', err.message);
    try {
      mongoose.connection.close(true).catch(disconnectErr => {
        console.error('[MongoDB] Disconnect cleanup failed:', disconnectErr.message);
      });
    } catch (disconnectErr) {
      console.error('[MongoDB] Disconnect cleanup failed:', disconnectErr.message);
    }
    return false;
  } finally {
    clearTimeout(timeoutId);
    if (!isConnected) connectPromise = null;
  }
}

async function loadData(collectionName) {
  if (!isConnected) return null;
  const Model = getModel(collectionName);
  const data = await Model.find({}).lean();
  
  if (collectionName === 'carts' || collectionName === 'pendingOtps') {
    // Restore raw Objects from standard arrays since MongoDB saves as Array of Docs
    if (!data.length) return null;
    return data[0].state || null;
  }
  
  if (!data || data.length === 0) return null;
  // Remove native mongodb _id wrapper fields when passing back to memory
  // If a doc has _id but no custom 'id', preserve _id as 'id'
  return data.map(({ _id, ...rest }) => {
    if (!rest.id && _id) rest.id = _id.toString();
    return rest;
  });
}

async function saveData(collectionName, data) {
  if (!isConnected) return;
  const Model = getModel(collectionName);
  
  if (collectionName === 'carts' || collectionName === 'pendingOtps') {
    // Carts and Otps are raw objects ({ userId: [...] }) - save as a single state document
    await Model.deleteMany({});
    await Model.create({ state: data }).catch(console.error);
    return;
  }

  // Check if data is array
  if (Array.isArray(data)) {
    // To make it viewable in Compass like a normal Database without complex diffing,
    // we mirror our synchronized memory array directly into the Atlas collection!
    for (const item of data) {
      const validationError = new Model(item).validateSync();
      if (validationError) {
        console.error(`[MongoDB] Validation failed for ${collectionName}:`, validationError.message);
        return;
      }
    }
    await Model.deleteMany({});
    if (data.length > 0) {
      await Model.insertMany(data).catch(console.error);
    }
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
