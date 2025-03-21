// auth.js - Google Authentication Routes
const express = require('express');
const router = express.Router();
const fetch = require('node-fetch');
const crypto = require('crypto');

// In-memory token storage (replace with a database in production)
const userTokens = new Map();

// Token expiration settings
const TOKEN_EXPIRATION_MS = 7 * 24 * 60 * 60 * 1000; // 7 days in milliseconds

// Scheduled token cleanup (every hour)
setInterval(() => {
  cleanupExpiredTokens();
}, 60 * 60 * 1000);

// Helper function to clean up expired tokens
function cleanupExpiredTokens() {
  const now = Date.now();
  let expiredCount = 0;
  
  for (const [token, data] of userTokens.entries()) {
    if (now >= data.expiresAt) {
      userTokens.delete(token);
      expiredCount++;
    }
  }
  
  if (expiredCount > 0) {
    console.log(`Cleaned up ${expiredCount} expired tokens`);
  }
}

// Google authentication endpoint
router.post('/google', async (req, res) => {
  try {
    const { token, email, name, picture } = req.body;

    if (!token || !email) {
      return res.status(400).json({ 
        success: false, 
        message: 'Token and email are required' 
      });
    }

    // Verify token with Google (this is a basic implementation)
    try {
      const googleResponse = await fetch(`https://www.googleapis.com/oauth2/v3/tokeninfo?access_token=${token}`);
      
      if (!googleResponse.ok) {
        return res.status(401).json({ 
          success: false, 
          message: 'Invalid Google token' 
        });
      }
      
      const tokenInfo = await googleResponse.json();
      
      // Very basic validation - in production, verify more fields
      if (!tokenInfo.email || tokenInfo.email !== email) {
        return res.status(401).json({ 
          success: false, 
          message: 'Token email mismatch' 
        });
      }
    } catch (error) {
      console.error('Error verifying Google token:', error);
      return res.status(500).json({ 
        success: false, 
        message: 'Failed to verify token with Google' 
      });
    }

    // Create a user object (in production, store in database)
    const user = {
      id: email, // Using email as ID for simplicity
      email,
      displayName: name,
      profilePicture: picture,
      lastLogin: new Date()
    };

    // Generate a session token (in production, use a proper JWT library)
    const sessionToken = crypto.randomBytes(64).toString('hex');
    
    // Calculate expiration time
    const now = Date.now();
    const expiresAt = now + TOKEN_EXPIRATION_MS;
    
    // Store the token with expiration
    userTokens.set(sessionToken, {
      user,
      created: now,
      expiresAt
    });

    // Return the session token, user info, and expiration time
    return res.status(200).json({
      success: true,
      message: 'Authentication successful',
      sessionToken,
      user,
      expiresAt
    });
  } catch (error) {
    console.error('Auth error:', error);
    return res.status(500).json({ 
      success: false, 
      message: 'Authentication failed: ' + error.message 
    });
  }
});

// Verify token endpoint
router.post('/verify-token', (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ 
        success: false, 
        message: 'No token provided' 
      });
    }
    
    const token = authHeader.split(' ')[1];
    
    // Check if token exists in our storage
    if (!userTokens.has(token)) {
      return res.status(401).json({ 
        success: false, 
        message: 'Invalid or expired token' 
      });
    }
    
    // Get user data
    const userData = userTokens.get(token);
    
    // Check token expiration
    const now = Date.now();
    if (now >= userData.expiresAt) {
      // Remove expired token
      userTokens.delete(token);
      
      return res.status(401).json({
        success: false,
        message: 'Token has expired',
        expired: true
      });
    }
    
    // Token is valid, return user data and updated expiration time
    return res.status(200).json({
      success: true,
      message: 'Token is valid',
      user: userData.user,
      expiresAt: userData.expiresAt
    });
  } catch (error) {
    console.error('Token verification error:', error);
    return res.status(500).json({ 
      success: false, 
      message: 'Token verification failed: ' + error.message 
    });
  }
});

// Refresh token endpoint
router.post('/refresh-token', (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ 
        success: false, 
        message: 'No token provided' 
      });
    }
    
    const token = authHeader.split(' ')[1];
    
    // Check if token exists in our storage
    if (!userTokens.has(token)) {
      return res.status(401).json({ 
        success: false, 
        message: 'Invalid or expired token' 
      });
    }
    
    // Get user data
    const userData = userTokens.get(token);
    
    // Check if token is not too old (within 30 days) to be refreshed
    const now = Date.now();
    const tokenAge = now - userData.created;
    const MAX_REFRESH_AGE = 30 * 24 * 60 * 60 * 1000; // 30 days
    
    if (tokenAge > MAX_REFRESH_AGE) {
      userTokens.delete(token);
      
      return res.status(401).json({
        success: false,
        message: 'Token is too old to refresh',
        expired: true
      });
    }
    
    // Generate a new session token
    const newSessionToken = crypto.randomBytes(64).toString('hex');
    
    // Calculate new expiration time
    const expiresAt = now + TOKEN_EXPIRATION_MS;
    
    // Store the new token
    userTokens.set(newSessionToken, {
      user: userData.user,
      created: now,
      expiresAt
    });
    
    // Remove the old token
    userTokens.delete(token);
    
    // Return the new session token and user info
    return res.status(200).json({
      success: true,
      message: 'Token refreshed successfully',
      sessionToken: newSessionToken,
      user: userData.user,
      expiresAt
    });
  } catch (error) {
    console.error('Token refresh error:', error);
    return res.status(500).json({ 
      success: false, 
      message: 'Token refresh failed: ' + error.message 
    });
  }
});

// Logout endpoint (optional)
router.post('/logout', (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(200).json({ 
        success: true, 
        message: 'No token to invalidate' 
      });
    }
    
    const token = authHeader.split(' ')[1];
    
    // Remove token from storage
    userTokens.delete(token);
    
    return res.status(200).json({
      success: true,
      message: 'Logged out successfully'
    });
  } catch (error) {
    console.error('Logout error:', error);
    return res.status(500).json({ 
      success: false, 
      message: 'Logout failed: ' + error.message 
    });
  }
});

// Export userTokens so it can be accessed from server.js
module.exports = {
  router,
  userTokens
};