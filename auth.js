// auth.js - Google Authentication Routes with MongoDB
const express = require('express');
const router = express.Router();
const fetch = require('node-fetch');
const crypto = require('crypto');

// Import MongoDB models
const User = require('./models/User');
const Token = require('./models/Token');

// Token expiration settings
const TOKEN_EXPIRATION_MS = 7 * 24 * 60 * 60 * 1000; // 7 days in milliseconds

function getClientIp(req) {
  // Get IP from X-Forwarded-For header (most common proxy header)
  const xForwardedFor = req.headers['x-forwarded-for'];
  if (xForwardedFor) {
    // Extract the first IP in case of multiple entries (client,proxy1,proxy2,...)
    const ips = xForwardedFor.split(',');
    return ips[0].trim();
  }
  
  // Try other common headers
  const xRealIp = req.headers['x-real-ip'];
  if (xRealIp) {
    return xRealIp;
  }
  
  // Fallback to remote address from socket
  return req.socket.remoteAddress;
}

// Google authentication endpoint
router.post('/google', async (req, res) => {
  try {
    const { token, email, name, picture } = req.body;
    const clientIp = getClientIp(req);

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
      
      // Basic validation
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

    // Find or create user in database
let user = await User.findOne({ email });

if (!user) {
  // Create new user
  user = new User({
    email,
    displayName: name,
    profilePicture: picture,
    ipAddresses: clientIp ? [{ 
      ip: clientIp,
      firstSeen: new Date(),
      lastUsed: new Date(),
      requestCount: 1
    }] : []
  });
} else {
  // Update existing user
  user.lastLogin = new Date();
  user.displayName = name;
  user.profilePicture = picture;
  
  // Update IP address using the method we added
  user.updateIpAddress(clientIp);
}

await user.save();

    // Generate a session token
    const sessionToken = crypto.randomBytes(64).toString('hex');
    
    // Calculate expiration time
    const now = new Date();
    const expiresAt = new Date(now.getTime() + TOKEN_EXPIRATION_MS);
    
    // Store the token
    await Token.create({
      token: sessionToken,
      user: user._id,
      created: now,
      expiresAt
    });

    // Return the session token, user info, and expiration time
    return res.status(200).json({
      success: true,
      message: 'Authentication successful',
      sessionToken,
      user: {
        id: user._id,
        email: user.email,
        displayName: user.displayName,
        profilePicture: user.profilePicture,
        tier: user.tier
      },
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
router.post('/verify-token', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ 
        success: false, 
        message: 'No token provided' 
      });
    }
    
    const tokenStr = authHeader.split(' ')[1];
    
    // Check if token exists
    const tokenData = await Token.findOne({ token: tokenStr }).populate('user');
    
    if (!tokenData) {
      return res.status(401).json({ 
        success: false, 
        message: 'Invalid or expired token' 
      });
    }
    
    // Check token expiration
    const now = new Date();
    if (now >= tokenData.expiresAt) {
      // Remove expired token
      await Token.deleteOne({ _id: tokenData._id });
      
      return res.status(401).json({
        success: false,
        message: 'Token has expired',
        expired: true
      });
    }
    
    // Token is valid, return user data
    return res.status(200).json({
      success: true,
      message: 'Token is valid',
      user: {
        id: tokenData.user._id,
        email: tokenData.user.email,
        displayName: tokenData.user.displayName,
        profilePicture: tokenData.user.profilePicture,
        tier: tokenData.user.tier
      },
      expiresAt: tokenData.expiresAt
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
router.post('/refresh-token', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ 
        success: false, 
        message: 'No token provided' 
      });
    }
    
    const tokenStr = authHeader.split(' ')[1];
    
    // Find token
    const tokenData = await Token.findOne({ token: tokenStr }).populate('user');
    
    if (!tokenData) {
      return res.status(401).json({ 
        success: false, 
        message: 'Invalid or expired token' 
      });
    }
    
    // Check if token is not too old to be refreshed
    const now = new Date();
    const tokenAge = now - tokenData.created;
    const MAX_REFRESH_AGE = 30 * 24 * 60 * 60 * 1000; // 30 days
    
    if (tokenAge > MAX_REFRESH_AGE) {
      await Token.deleteOne({ _id: tokenData._id });
      
      return res.status(401).json({
        success: false,
        message: 'Token is too old to refresh',
        expired: true
      });
    }
    
    // Generate a new session token
    const newSessionToken = crypto.randomBytes(64).toString('hex');
    
    // Calculate new expiration time
    const expiresAt = new Date(now.getTime() + TOKEN_EXPIRATION_MS);
    
    // Store the new token
    await Token.create({
      token: newSessionToken,
      user: tokenData.user._id,
      created: now,
      expiresAt
    });
    
    // Remove the old token
    await Token.deleteOne({ _id: tokenData._id });
    
    // Return the new session token and user info
    return res.status(200).json({
      success: true,
      message: 'Token refreshed successfully',
      sessionToken: newSessionToken,
      user: {
        id: tokenData.user._id,
        email: tokenData.user.email,
        displayName: tokenData.user.displayName,
        profilePicture: tokenData.user.profilePicture,
        tier: tokenData.user.tier
      },
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

// Logout endpoint
router.post('/logout', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(200).json({ 
        success: true, 
        message: 'No token to invalidate' 
      });
    }
    
    const tokenStr = authHeader.split(' ')[1];
    
    // Remove token from database
    await Token.deleteOne({ token: tokenStr });
    
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

// Helper functions for other parts of the app to verify tokens
const getUserFromToken = async (tokenStr) => {
  if (!tokenStr) return null;
  
  const tokenData = await Token.findOne({ token: tokenStr }).populate('user');
  if (!tokenData) return null;
  
  // Check expiration
  const now = new Date();
  if (now >= tokenData.expiresAt) {
    await Token.deleteOne({ _id: tokenData._id });
    return null;
  }
  
  return tokenData.user;
};

module.exports = {
  router,
  getUserFromToken
};