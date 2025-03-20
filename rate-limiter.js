// rate-limiter.js - User-based rate limiting with different tiers

class RateLimiter {
    constructor() {
      // Store user requests with timestamps
      this.userRequests = new Map();
      
      // Rate limit settings (in milliseconds)
      this.limits = {
        '1': 30 * 60 * 1000,  // Quality: 30 minutes
        '2': 60 * 1000,       // Balanced: 1 minute
        '3': 20 * 1000        // Speed: 20 seconds
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
      
      // Get user's request history
      if (!this.userRequests.has(userId)) {
        this.userRequests.set(userId, []);
      }
      
      const requests = this.userRequests.get(userId);
      
      // Filter out requests older than the limit
      const recentRequests = requests.filter(timestamp => (now - timestamp) < limitMs);
      
      // If there are no recent requests, the user can make a request
      return recentRequests.length === 0;
    }
    
    // Record a new request for a user
    recordRequest(userId) {
      // Get current time
      const now = Date.now();
      
      // Get user's request history or initialize it
      if (!this.userRequests.has(userId)) {
        this.userRequests.set(userId, []);
      }
      
      const requests = this.userRequests.get(userId);
      
      // Add the new request timestamp
      requests.push(now);
      
      // Update the user's request history
      this.userRequests.set(userId, requests);
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
      
      const requests = this.userRequests.get(userId);
      
      if (requests.length === 0) {
        return 0;
      }
      
      // Find the most recent request
      const latestRequest = Math.max(...requests);
      
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
      for (const [userId, requests] of this.userRequests.entries()) {
        // Filter out requests older than the max limit
        const recentRequests = requests.filter(timestamp => (now - timestamp) < maxLimit);
        
        // If there are no recent requests, remove the user
        if (recentRequests.length === 0) {
          this.userRequests.delete(userId);
        } else {
          // Update with only recent requests
          this.userRequests.set(userId, recentRequests);
        }
      }
    }
  }
  
  module.exports = new RateLimiter();