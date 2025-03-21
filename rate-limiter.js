// rate-limiter.js - User-based rate limiting with different tiers

class RateLimiter {
    constructor() {
      // Store user requests with timestamps, separated by quality/speed setting
      this.userRequests = new Map();
      
      // Rate limit settings (in milliseconds)
    //   this.limits = {
    //     '1': 30 * 60 * 1000,  // Quality: 30 minutes
    //     '2': 60 * 1000,       // Balanced: 1 minute
    //     '3': 20 * 1000        // Speed: 20 seconds
    //   };

      this.limits = {
          '1': 15 * 1000,  // FOR TESTING
          '2': 15 * 1000,  // FOR TESTING
          '3': 15 * 1000   // FOR TESTING
      };
      
      // Cleanup old entries periodically (every hour)
      setInterval(() => this.cleanup(), 60 * 60 * 1000);
    }
    
    // Check if user can make a request
    canMakeRequest(userId, qualitySpeed) {
      // Use default rate limit if quality/speed not specified
      const limitMs = this.limits[qualitySpeed] || this.limits['2'];
      
      // Get current time
      const now = Date.now();
      
      // Get user's request history for this specific quality/speed setting
      if (!this.userRequests.has(userId)) {
        this.userRequests.set(userId, {
          '1': [],  // Quality
          '2': [],  // Balanced
          '3': []   // Speed
        });
      }
      
      const userRequestsMap = this.userRequests.get(userId);
      const requestsForSetting = userRequestsMap[qualitySpeed] || [];
      
      // Filter out requests older than the limit
      const recentRequests = requestsForSetting.filter(timestamp => (now - timestamp) < limitMs);
      
      // If there are no recent requests, the user can make a request
      return recentRequests.length === 0;
    }
    
    // Record a new request for a user with specific quality/speed setting
    recordRequest(userId, qualitySpeed) {
      // Default to balanced if not specified
      qualitySpeed = qualitySpeed || '2';
      
      // Get current time
      const now = Date.now();
      
      // Get user's request history or initialize it
      if (!this.userRequests.has(userId)) {
        this.userRequests.set(userId, {
          '1': [],  // Quality
          '2': [],  // Balanced
          '3': []   // Speed
        });
      }
      
      const userRequestsMap = this.userRequests.get(userId);
      
      // Ensure the array for this setting exists
      if (!userRequestsMap[qualitySpeed]) {
        userRequestsMap[qualitySpeed] = [];
      }
      
      // Add the new request timestamp for this specific setting
      userRequestsMap[qualitySpeed].push(now);
      
      // Update the user's request history
      this.userRequests.set(userId, userRequestsMap);
    }
    
    // Get time remaining until next allowed request
    getTimeRemaining(userId, qualitySpeed) {
      // Use default rate limit if quality/speed not specified
      const limitMs = this.limits[qualitySpeed] || this.limits['2'];
      
      // Get current time
      const now = Date.now();
      
      // If no requests yet, return 0
      if (!this.userRequests.has(userId)) {
        return 0;
      }
      
      const userRequestsMap = this.userRequests.get(userId);
      const requestsForSetting = userRequestsMap[qualitySpeed] || [];
      
      if (requestsForSetting.length === 0) {
        return 0;
      }
      
      // Find the most recent request
      const latestRequest = Math.max(...requestsForSetting);
      
      // Calculate time elapsed since the latest request
      const elapsed = now - latestRequest;
      
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
    
    // Clean up old entries to prevent memory leaks
    cleanup() {
      const now = Date.now();
      const maxLimit = this.limits['1']; // Use the longest limit (quality)
      
      // For each user
      for (const [userId, requestsMap] of this.userRequests.entries()) {
        let hasRecentRequests = false;
        
        // Check each quality/speed setting
        for (const qualitySpeed of Object.keys(requestsMap)) {
          const requests = requestsMap[qualitySpeed];
          
          // Filter out requests older than the max limit
          const recentRequests = requests.filter(timestamp => (now - timestamp) < maxLimit);
          
          if (recentRequests.length > 0) {
            hasRecentRequests = true;
          }
          
          // Update with only recent requests
          requestsMap[qualitySpeed] = recentRequests;
        }
        
        // If there are no recent requests for any setting, remove the user
        if (!hasRecentRequests) {
          this.userRequests.delete(userId);
        } else {
          // Update with only recent requests
          this.userRequests.set(userId, requestsMap);
        }
      }
    }
  }
  
  module.exports = new RateLimiter();