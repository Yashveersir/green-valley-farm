require('dotenv').config();
const mongoose = require('mongoose');
const { backupDatabase } = require('./backup-db');

const COLLECTIONS_TO_CLEAR = [
  'orders',
  'carts',
  'cartActivity',
  'notifications',
  'reviews',
  'pendingOtps'
];

async function resetOrderHistory() {
  const backup = await backupDatabase();

  if (!mongoose.connection.readyState) {
    await mongoose.connect(process.env.MONGODB_URI, {
      serverSelectionTimeoutMS: 15000
    });
  }

  const database = mongoose.connection.db;
  const deleted = {};

  for (const collectionName of COLLECTIONS_TO_CLEAR) {
    const exists = await database
      .listCollections({ name: collectionName })
      .hasNext();

    if (!exists) {
      deleted[collectionName] = 0;
      continue;
    }

    const result = await database.collection(collectionName).deleteMany({});
    deleted[collectionName] = result.deletedCount || 0;
  }

  return { backupPath: backup.outputPath, deleted };
}

if (require.main === module) {
  resetOrderHistory()
    .then(result => {
      console.log(`Backup created before reset: ${result.backupPath}`);
      console.log('Cleared collections:');
      console.log(JSON.stringify(result.deleted, null, 2));
    })
    .catch(err => {
      console.error(`Reset failed: ${err.message}`);
      process.exitCode = 1;
    })
    .finally(() => mongoose.disconnect());
}

module.exports = { resetOrderHistory };
