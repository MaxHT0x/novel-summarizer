// rate-limiter.js - MongoDB-based rate limiting
const Request = require('./models/Request');
const User = require('./models/User');

class RateLimiter {
    constructor() {
      // Use the same rate limits for both user and IP
      this.limits = {
        '1': 30 * 60 * 1000,  // Quality: 30 minutes
        '2': 60 * 1000,       // Balanced: 1 minute
        '3': 20 * 1000        // Speed: 20 seconds
      };
      
      // Maximum requests per day per IP (across all users)
      this.maxDailyRequestsPerIp = 100;
    }
    
    // Check if request is allowed based on EITHER user ID OR IP address
    async canMakeRequest(userId, qualitySpeed, ipAddress) {
      // Use default rate limit if quality/speed not specified
      const limitMs = this.limits[qualitySpeed] || this.limits['2'];
      
      // Get current time
      const now = new Date();
      
      // Calculate the earliest time a previous request could be made and still block
      const earliestBlockingTime = new Date(now.getTime() - limitMs);
      
      // First check: Any recent requests from this user ID?
      const recentUserRequest = await Request.findOne({
        user: userId,
        qualitySpeed: qualitySpeed,
        timestamp: { $gt: earliestBlockingTime }
      }).sort({ timestamp: -1 });
      
      // If there's a recent user request, they can't make another one yet
      if (recentUserRequest) {
        return {
          canRequest: false,
          reason: 'user_rate_limit',
          timeRemaining: (recentUserRequest.timestamp.getTime() + limitMs) - now.getTime()
        };
      }
      
      // Second check: Any recent requests from this IP for ANY user?
      if (ipAddress) {
        // Use the SAME time limit as for users
        const recentIpRequest = await Request.findOne({
          ip: ipAddress,
          qualitySpeed: qualitySpeed,
          timestamp: { $gt: earliestBlockingTime }
        }).sort({ timestamp: -1 });
        
        if (recentIpRequest) {
          return {
            canRequest: false,
            reason: 'ip_rate_limit',
            timeRemaining: (recentIpRequest.timestamp.getTime() + limitMs) - now.getTime()
          };
        }
        
        // Daily IP limit check
        const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
        const dailyIpCount = await Request.countDocuments({
          ip: ipAddress,
          timestamp: { $gt: oneDayAgo }
        });
        
        if (dailyIpCount >= this.maxDailyRequestsPerIp) {
          return {
            canRequest: false,
            reason: 'ip_daily_limit',
            timeRemaining: null // Will reset after 24 hours from first request
          };
        }
      }
      
      // If we get here, both user and IP checks passed
      return {
        canRequest: true,
        reason: null,
        timeRemaining: 0
      };
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
    
    // Also update the user's IP record
    if (ip) {
      try {
        const user = await User.findById(userId);
        if (user) {
          // Check if updateIpAddress method exists (we added this method in User.js)
          if (typeof user.updateIpAddress === 'function') {
            user.updateIpAddress(ip);
          } else {
            // Fallback in case the method doesn't exist
            const existingIp = user.ipAddresses?.find(entry => entry.ip === ip);
            if (existingIp) {
              existingIp.lastUsed = new Date();
              existingIp.requestCount = (existingIp.requestCount || 0) + 1;
            } else {
              if (!user.ipAddresses) user.ipAddresses = [];
              user.ipAddresses.push({
                ip: ip,
                firstSeen: new Date(),
                lastUsed: new Date(),
                requestCount: 1
              });
            }
          }
          await user.save();
        }
      } catch (error) {
        console.error('Error updating user IP address:', error);
        // Continue execution even if IP update fails
      }
    }
  }
  
  // Get time remaining until next allowed request
  async getTimeRemaining(userId, qualitySpeed, ipAddress) {
    const result = await this.canMakeRequest(userId, qualitySpeed, ipAddress);
    return result.canRequest ? 0 : (result.timeRemaining || 0);
  }
  
  // Format time remaining for display
  formatTimeRemaining(timeMs) {
    if (timeMs <= 0 || !timeMs) {
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
      mostRequestedNovel: null,
      ipAddresses: []
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
    
    // Get IP addresses used
    const user = await User.findById(userId);
    if (user && user.ipAddresses) {
      stats.ipAddresses = user.ipAddresses;
    }
    
    return stats;
  }
  
  // Get suspicious IPs (high request counts or multiple users)
  async getSuspiciousIps() {
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    
    // Find IPs with high request counts
    const highVolumeIps = await Request.aggregate([
      { $match: { timestamp: { $gt: oneDayAgo }, ip: { $exists: true, $ne: "" } } },
      { $group: { _id: "$ip", count: { $sum: 1 }, users: { $addToSet: "$user" } } },
      { $match: { $or: [
        { count: { $gt: this.maxDailyRequestsPerIp * 0.7 } }, // Over 70% of limit
        { "users.1": { $exists: true } }  // More than 1 user (index 1 exists)
      ]}},
      { $sort: { count: -1 } }
    ]);
    
    return highVolumeIps;
  }
}

module.exports = new RateLimiter();