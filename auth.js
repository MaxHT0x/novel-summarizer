// auth.js - Google Authentication Routes
const express = require('express');
const router = express.Router();
const fetch = require('node-fetch');
const crypto = require('crypto');

// In-memory token storage (replace with a database in production)
const userTokens = new Map();

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
    
    // Store the token (in production, store in database with expiration)
    userTokens.set(sessionToken, {
      user,
      created: new Date()
    });

    // Return the session token and user info
    return res.status(200).json({
      success: true,
      message: 'Authentication successful',
      sessionToken,
      user
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
    
    // In production, check token expiration here
    // For now, simple validation that token exists
    
    return res.status(200).json({
      success: true,
      message: 'Token is valid',
      user: userData.user
    });
  } catch (error) {
    console.error('Token verification error:', error);
    return res.status(500).json({ 
      success: false, 
      message: 'Token verification failed: ' + error.message 
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