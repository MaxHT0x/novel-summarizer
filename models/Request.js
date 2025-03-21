const mongoose = require('mongoose');

const requestSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  qualitySpeed: {
    type: String,
    enum: ['1', '2', '3'], // 1: Quality, 2: Balanced, 3: Speed
    default: '2'
  },
  novelTitle: String,
  chapterTitle: String,
  contentLength: Number,
  ip: String,
  timestamp: {
    type: Date,
    default: Date.now
  }
});

// Create indexes for efficient querying
requestSchema.index({ user: 1, qualitySpeed: 1, timestamp: -1 });

const Request = mongoose.model('Request', requestSchema);
module.exports = Request;