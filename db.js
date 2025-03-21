// db.js
require('dotenv').config();
const mongoose = require('mongoose');

const connectDB = async () => {
  try {
    // Get MongoDB connection string from environment variables
    const mongoURI = process.env.MONGO_URI;
    
    if (!mongoURI) {
      throw new Error('MongoDB connection string is missing');
    }
    
    const conn = await mongoose.connect(mongoURI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    
    console.log(`MongoDB Connected: ${conn.connection.host}`);
    
    // Setup periodic cleanup of expired tokens
    setupTokenCleanup();
    
    return conn;
  } catch (error) {
    console.error(`Error connecting to MongoDB: ${error.message}`);
    process.exit(1);
  }
};

// Function to periodically clean up expired tokens
// This is a backup in case the TTL index doesn't work as expected
const setupTokenCleanup = () => {
  const Token = require('./models/Token');
  
  // Run cleanup every hour
  setInterval(async () => {
    try {
      const now = new Date();
      const result = await Token.deleteMany({ expiresAt: { $lt: now } });
      
      if (result.deletedCount > 0) {
        console.log(`Cleaned up ${result.deletedCount} expired tokens`);
      }
    } catch (error) {
      console.error('Error cleaning up tokens:', error);
    }
  }, 60 * 60 * 1000); // every hour
};

module.exports = connectDB;