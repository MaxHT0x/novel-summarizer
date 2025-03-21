// rate-limiter.js - MongoDB-based rate limiting
const Request = require('./models/Request');

class RateLimiter {
  constructor() {
    // Rate limit settings (in milliseconds)
    this.limits = {
      '1': 30 * 60 * 1000,  // Quality: 30 minutes
      '2': 60 * 1000,       // Balanced: 1 minute
      '3': 30 * 1000        // Speed: 20 seconds
    };
    
    // For testing if needed
    // this.limits = {
    //   '1': 15 * 1000,  // FOR TESTING
    //   '2': 15 * 1000,  // FOR TESTING
    //   '3': 15 * 1000   // FOR TESTING
    // };
  }
  
  // Check if user can make a request
  async canMakeRequest(userId, qualitySpeed) {
    // Use default rate limit if quality/speed not specified
    const limitMs = this.limits[qualitySpeed] || this.limits['2'];
    
    // Get current time
    const now = new Date();
    
    // Calculate the earliest time a previous request could be made and still block
    const earliestBlockingTime = new Date(now.getTime() - limitMs);
    
    // Find most recent request for this user and setting
    const recentRequest = await Request.findOne({
      user: userId,
      qualitySpeed: qualitySpeed,
      timestamp: { $gt: earliestBlockingTime }
    }).sort({ timestamp: -1 });
    
    // If there are no recent requests, the user can make a request
    return !recentRequest;
  }
  
  // Record a new request
  async recordRequest(userId, qualitySpeed, chapterTitle = "", novelTitle = "", contentLength = 0, ip = "") {
    // Default to balanced if not specified
    qualitySpeed = qualitySpeed || '2';
    
    // Create new request record
    await Request.create({
      user: userId,
      qualitySpeed,
      novelTitle,
      chapterTitle,
      contentLength,
      ip,
      timestamp: new Date()
    });
  }
  
  // Get time remaining until next allowed request
  async getTimeRemaining(userId, qualitySpeed) {
    // Use default rate limit if quality/speed not specified
    const limitMs = this.limits[qualitySpeed] || this.limits['2'];
    
    // Get current time
    const now = new Date();
    
    // Find most recent request for this user and setting
    const recentRequest = await Request.findOne({
      user: userId,
      qualitySpeed: qualitySpeed
    }).sort({ timestamp: -1 });
    
    // If no requests yet, return 0
    if (!recentRequest) {
      return 0;
    }
    
    // Calculate time elapsed since the latest request
    const elapsed = now - recentRequest.timestamp;
    
    // If enough time has passed, return 0
    if (elapsed >= limitMs) {
      return 0;
    }
    
    // Return time remaining in milliseconds
    return limitMs - elapsed;
  }
  
  // Format time remaining for display
  formatTimeRemaining(timeMs) {
    if (timeMs <= 0) {
      return "now";
    }
    
    const seconds = Math.ceil(timeMs / 1000);
    
    if (seconds < 60) {
      return `${seconds} second${seconds !== 1 ? 's' : ''}`;
    }
    
    const minutes = Math.ceil(seconds / 60);
    
    if (minutes < 60) {
      return `${minutes} minute${minutes !== 1 ? 's' : ''}`;
    }
    
    const hours = Math.ceil(minutes / 60);
    return `${hours} hour${hours !== 1 ? 's' : ''}`;
  }
  
  // Get summary statistics for a user
  async getUserStats(userId) {
    const stats = {
      totalRequests: 0,
      requestsByType: {
        '1': 0, // Quality
        '2': 0, // Balanced
        '3': 0  // Speed
      },
      lastRequest: null,
      mostRequestedNovel: null
    };
    
    // Get total requests count
    stats.totalRequests = await Request.countDocuments({ user: userId });
    
    // Get counts by type
    for (const type of ['1', '2', '3']) {
      stats.requestsByType[type] = await Request.countDocuments({ 
        user: userId, 
        qualitySpeed: type 
      });
    }
    
    // Get last request time
    const lastRequest = await Request.findOne({ user: userId })
      .sort({ timestamp: -1 })
      .limit(1);
      
    if (lastRequest) {
      stats.lastRequest = lastRequest.timestamp;
    }
    
    // Find most requested novel (if tracking novel titles)
    const novelAggregation = await Request.aggregate([
      { $match: { user: userId, novelTitle: { $exists: true, $ne: '' } } },
      { $group: { _id: '$novelTitle', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 1 }
    ]);
    
    if (novelAggregation.length > 0) {
      stats.mostRequestedNovel = {
        title: novelAggregation[0]._id,
        count: novelAggregation[0].count
      };
    }
    
    return stats;
  }
}

module.exports = new RateLimiter();