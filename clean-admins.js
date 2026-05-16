require('dotenv').config();
const mongoose = require('mongoose');

async function clean() {
  try {
    console.log('Connecting to MongoDB...', process.env.MONGODB_URI ? 'URI exists' : 'No URI');
    await mongoose.connect(process.env.MONGODB_URI, {
      serverSelectionTimeoutMS: 15000,
    });
    console.log('Connected to MongoDB');
    const db = mongoose.connection.useDb('test'); // Or whatever DB name, let's use default
    const Model = mongoose.model('User', new mongoose.Schema({}, {strict: false}), 'users');
    const users = await Model.find({}).lean();
    console.log(`Found ${users.length} users in DB`);
    
    const seen = new Set();
    for (const u of users) {
      const email = (u.email || '').toLowerCase().trim();
      if (seen.has(email)) {
        console.log(`Deleting duplicate: ${email} (ID: ${u.id})`);
        await Model.deleteOne({ _id: u._id });
      } else {
        seen.add(email);
      }
    }
    console.log('Clean up complete');
    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

clean();
