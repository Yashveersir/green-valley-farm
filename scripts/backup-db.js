require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');

const BACKUP_DIR = path.join(__dirname, '..', 'backups', 'mongodb');

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

async function backupDatabase() {
  if (!process.env.MONGODB_URI) {
    throw new Error('MONGODB_URI is required to create a database backup.');
  }

  await mongoose.connect(process.env.MONGODB_URI, {
    serverSelectionTimeoutMS: 15000
  });

  const database = mongoose.connection.db;
  const collections = await database.listCollections().toArray();
  const backup = {
    metadata: {
      database: database.databaseName,
      createdAt: new Date().toISOString(),
      collections: collections.map(collection => collection.name)
    },
    collections: {}
  };

  for (const collection of collections) {
    backup.collections[collection.name] = await database
      .collection(collection.name)
      .find({})
      .toArray();
  }

  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const filename = `${database.databaseName}-${timestamp()}.json`;
  const outputPath = path.join(BACKUP_DIR, filename);
  fs.writeFileSync(outputPath, JSON.stringify(backup, null, 2));

  return {
    outputPath,
    counts: Object.fromEntries(
      Object.entries(backup.collections).map(([name, docs]) => [name, docs.length])
    )
  };
}

if (require.main === module) {
  backupDatabase()
    .then(result => {
      console.log(`Backup created: ${result.outputPath}`);
      console.log(JSON.stringify(result.counts, null, 2));
    })
    .catch(err => {
      console.error(`Backup failed: ${err.message}`);
      process.exitCode = 1;
    })
    .finally(() => mongoose.disconnect());
}

module.exports = { backupDatabase };
