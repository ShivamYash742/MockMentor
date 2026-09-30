import mongoose from 'mongoose';

const MONGODB_URI = process.env.MONGODB_URI!;

if (!MONGODB_URI) {
  throw new Error('Please define the MONGODB_URI environment variable');
}

/**
 * Global is used here to maintain a cached connection across hot reloads
 * in development. This prevents connections growing exponentially
 * during API Route usage.
 */
let cached = global.mongoose;

if (!cached) {
  cached = global.mongoose = { conn: null, promise: null };
}

async function dbConnect() {
  if (cached.conn) {
    return cached.conn;
  }

  if (!cached.promise) {
    // Mongoose's default command buffering stays on. Models are defined when their modules load,
    // before this connection exists, and their index builds wait for it through that buffer —
    // including the unique indexes on interviewId that keep one session and one report per
    // interview. With `bufferCommands: false` those builds failed silently and never ran.
    cached.promise = mongoose.connect(MONGODB_URI).then((mongoose) => {
      console.log('✅ Connected to MongoDB');
      return mongoose;
    });
  }

  try {
    cached.conn = await cached.promise;
  } catch (e) {
    cached.promise = null;
    console.error('❌ MongoDB connection error:', e);
    
    // Provide more helpful error messages
    if (e instanceof Error) {
      if (e.message.includes('IP')) {
        console.error('💡 Solution: Add your IP address to MongoDB Atlas IP whitelist');
      } else if (e.message.includes('authentication')) {
        console.error('💡 Solution: Check your MongoDB username and password');
      } else if (e.message.includes('MONGODB_URI')) {
        console.error('💡 Solution: Set MONGODB_URI environment variable in .env');
      }
    }
    
    throw e;
  }

  return cached.conn;
}

export default dbConnect;
