require('dotenv').config();

const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const fetch = require('node-fetch');
const app = express();
const port = process.env.PORT || 3000;

// Import database connection
const connectDB = require('./db');

// Connect to MongoDB
connectDB();

// Add this function at the top of server.js, before your routes
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

// Import auth routes
const auth = require('./auth');

// Import rate limiter
const rateLimiter = require('./rate-limiter');

// Middleware setup
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Origin']
}));
app.use(bodyParser.json({ limit: '50mb' }));

// Register auth routes
app.use('/auth', auth.router);

// Authentication middleware
const authenticate = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ 
        success: false, 
        message: 'Authentication required' 
      });
    }
    
    const token = authHeader.split(' ')[1];
    
    // Get user from token
    const user = await auth.getUserFromToken(token);
    
    if (!user) {
      return res.status(401).json({ 
        success: false, 
        message: 'Invalid or expired token' 
      });
    }
    
    // Attach user and client IP to request
    req.user = user;
    req.token = token;
    req.clientIp = getClientIp(req);
    
    next();
  } catch (error) {
    console.error('Authentication error:', error);
    return res.status(500).json({ 
      success: false, 
      message: 'Authentication error: ' + error.message 
    });
  }
};

// Health check endpoint
app.get('/', (req, res) => {
  res.send('Novel Summarizer API is running');
});

// Update in server.js
app.post('/summarize', authenticate, async (req, res) => {
  try {
    // Extract content and settings
    const { chapterContent, chapterTitle, qualitySpeed } = req.body;
    
    if (!chapterContent) {
      return res.status(400).json({ 
        success: false, 
        message: 'No chapter content provided' 
      });
    }

    // Get user ID for rate limiting
    const userId = req.user._id;
    const clientIp = req.clientIp;
    
    // Check rate limit with enhanced IP check
    const rateCheckResult = await rateLimiter.canMakeRequest(userId, qualitySpeed, clientIp);
    
    if (!rateCheckResult.canRequest) {
      const timeRemaining = rateCheckResult.timeRemaining || 0;
      const formattedTime = rateLimiter.formatTimeRemaining(timeRemaining);
      
      let message = 'Rate limit exceeded. Please try again later.';
      
      if (rateCheckResult.reason === 'ip_daily_limit') {
        message = 'Daily request limit reached from your IP address. Please try again tomorrow.';
      } else if (rateCheckResult.reason === 'ip_rate_limit') {
        message = `IP-based rate limit exceeded. Please try again in ${formattedTime}.`;
      } else {
        message = `Rate limit exceeded. Please try again in ${formattedTime}.`;
      }
      
      return res.status(429).json({
        success: false,
        message: message,
        timeRemaining,
        reason: rateCheckResult.reason
      });
    }
    
    // Extract novel title if available (from first line or chapter title)
    let novelTitle = "";
    if (chapterTitle) {
      // Try to extract novel name from chapter title (often in format "Novel Name - Chapter X")
      const titleParts = chapterTitle.split('-');
      if (titleParts.length > 1) {
        novelTitle = titleParts[0].trim();
      }
    }
    
    // Record the request with details
    await rateLimiter.recordRequest(
      userId, 
      qualitySpeed, 
      chapterTitle || 'Untitled Chapter',
      novelTitle,
      chapterContent.length,
      clientIp
    );

    console.log(`Received request to summarize chapter: ${chapterTitle || 'Untitled'}`);
    console.log(`Content length: ${chapterContent.length} characters`);
    console.log(`Quality/Speed setting: ${qualitySpeed || 'Not specified, using default'}`);
    
    // Set headers for streaming response
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('Access-Control-Allow-Origin', '*');
    
    // Send initial message
    res.write(`data: ${JSON.stringify({ type: 'start', message: 'Starting summary generation...' })}\n\n`);
    
    // Prepare the prompt for the AI
    const prompt = `${chapterContent}`;

    // Stream the summary from OpenRouter
    await streamSummaryFromOpenRouter(prompt, res, qualitySpeed);
    
    // End the response when complete
    res.write(`data: ${JSON.stringify({ type: 'complete', message: 'Summary complete' })}\n\n`);
    res.end();
    
  } catch (error) {
    console.error('Error processing summary request:', error);
    res.write(`data: ${JSON.stringify({ type: 'error', message: 'Failed to generate summary: ' + error.message })}\n\n`);
    res.end();
  }
});

// Add an endpoint to check rate limit status
app.get('/rate-limit-status', authenticate, async (req, res) => {
  const userId = req.user._id;
  const clientIp = req.clientIp;
  
  // Check all tiers with IP
  const status = {
    quality: {
      timeRemaining: await rateLimiter.getTimeRemaining(userId, '1', clientIp),
      formattedTime: rateLimiter.formatTimeRemaining(await rateLimiter.getTimeRemaining(userId, '1', clientIp)),
      canMakeRequest: (await rateLimiter.canMakeRequest(userId, '1', clientIp)).canRequest
    },
    balanced: {
      timeRemaining: await rateLimiter.getTimeRemaining(userId, '2', clientIp),
      formattedTime: rateLimiter.formatTimeRemaining(await rateLimiter.getTimeRemaining(userId, '2', clientIp)),
      canMakeRequest: (await rateLimiter.canMakeRequest(userId, '2', clientIp)).canRequest
    },
    speed: {
      timeRemaining: await rateLimiter.getTimeRemaining(userId, '3', clientIp),
      formattedTime: rateLimiter.formatTimeRemaining(await rateLimiter.getTimeRemaining(userId, '3', clientIp)),
      canMakeRequest: (await rateLimiter.canMakeRequest(userId, '3', clientIp)).canRequest
    }
  };
  
  res.json({
    success: true,
    status
  });
});

// Add user stats endpoint
app.get('/user-stats', authenticate, async (req, res) => {
  try {
    const userId = req.user._id;
    const stats = await rateLimiter.getUserStats(userId);
    
    res.json({
      success: true,
      stats
    });
  } catch (error) {
    console.error('Error fetching user stats:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch user statistics'
    });
  }
});

// Function to stream summary from OpenRouter API
async function streamSummaryFromOpenRouter(prompt, res, qualitySpeed = '2') {
  try {
    // Get API key from environment variable
    const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
    
    if (!OPENROUTER_API_KEY) {
      throw new Error('OPENROUTER_API_KEY environment variable is not set');
    }
    
    // Select model based on quality/speed preference
    // 1 = High Quality (slower), 2 = Balanced, 3 = Fast Speed (lower quality)
    let model;
    let modelName;
    
    switch (qualitySpeed) {
      case '1': // Quality focused
        model = "openai/chatgpt-4o-latest";
        modelName = "chatgpt-4o (High Quality)";
        break;
      case '3': // Speed focused
        model = "google/gemini-2.0-flash-001";
        modelName = "Gemini 2.0 Flash (High Speed)";
        break;
      case '2': // Balanced (default)
      default:
        model = "google/gemini-2.5-pro-exp-03-25:free";
        modelName = "Gemini 2.5 Pro (Balanced)";
        break;
    }
    
    console.log(`Using model: ${modelName}`);
    
    // Call to OpenRouter API with streaming
    console.log("Sending request to OpenRouter API...");
    
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${OPENROUTER_API_KEY}`,
        "HTTP-Referer": "http://localhost:3000", // Update with your actual site when deployed
        "X-Title": "Novel Chapter Summarizer",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        "model": model,
        "messages": [
  {
    "role": "system",
    "content": `You are an expert novel chapter summarizer. Your task is to create concise but comprehensive summaries that capture all critical plot points, character development, and narrative elements.

SUMMARIZATION GUIDELINES:

1. Write in a narrative style that reads like the original text, just more concise. Do not use meta-language like "In this chapter" or "The summary is..."

2. Focus on:
   - Plot progression and key events
   - Dialogue and revelations
   - Character development and relationships
   - Setting details when significant
   - Foreshadowing elements

3. Maintain the original:
   - Tone and writing style
   - Cultural references and terminology
   - Character names and perspectives

4. Include:
   - All crucial plot developments
   - Character decisions and motivations
   - Significant conversations (ESPECIALLY those containing subtle revelations)
   - Details that may become important in future chapters

5. Formatting:
   - Use paragraph breaks as appropriate
   - Keep dialogue concise where possible, but meaningful
   - Maintain the original tense and narrative voice
   - Use the original writing style

Your summary should be approximately 30-45% the length of the original chapter while preserving all essential content.`
  },
  {
    "role": "user",
    "content": `Please summarize the following novel chapter:

${prompt}`
  }
],
        "stream": true  // Enable streaming
      })
    });
    
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ error: { message: 'Unknown error' } }));
      throw new Error(`API error: ${errorData.error?.message || response.statusText || 'Unknown error'}`);
    }
    
    // With node-fetch, we need to handle the stream differently than browser fetch
    if (!response.body) {
      throw new Error('Response body is undefined');
    }
    
    console.log("Stream response received, processing...");
    
    // Process the streaming response
    response.body.on('data', (chunk) => {
      // Decode the chunk
      const text = chunk.toString();
      console.log("Received chunk:", text.slice(0, 50) + "..."); // Log first 50 chars of each chunk
      
      // OpenRouter sends data in the format: data: {...}\n\n
      const lines = text.split('\n').filter(line => line.trim() !== '');
      
      for (const line of lines) {
        if (line.startsWith('data: ')) {
          try {
            // Extract the JSON part
            const jsonStr = line.substring(6).trim();
            
            // Handle "[DONE]" message
            if (jsonStr === '[DONE]') continue;
            
            const data = JSON.parse(jsonStr);
            
            // Process content deltas
            if (data.choices && data.choices[0]?.delta?.content) {
              const contentDelta = data.choices[0].delta.content;
              console.log("Sending delta:", contentDelta.slice(0, 30) + "..."); // Log first 30 chars of content
              
              // Send the content delta to the client
              res.write(`data: ${JSON.stringify({ type: 'chunk', content: contentDelta })}\n\n`);
            }
          } catch (e) {
            console.error('Error parsing streaming response:', e, line);
          }
        }
      }
    });
    
    // Handle end of stream
    return new Promise((resolve, reject) => {
      response.body.on('end', () => {
        console.log("Stream ended");
        resolve();
      });
      
      response.body.on('error', (err) => {
        console.error('Stream error:', err);
        reject(err);
      });
    });
    
  } catch (error) {
    console.error('Error streaming from OpenRouter API:', error);
    res.write(`data: ${JSON.stringify({ type: 'error', message: 'Error in streaming: ' + error.message })}\n\n`);
  }
}

// Add this endpoint to server.js (with proper admin authentication)
app.get('/admin/suspicious-ips', authenticate, async (req, res) => {
  try {
    // Check if user is admin
    if (req.user.tier !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Admin access required'
      });
    }
    
    const suspiciousIps = await rateLimiter.getSuspiciousIps();
    
    res.json({
      success: true,
      suspiciousIps
    });
  } catch (error) {
    console.error('Error fetching suspicious IPs:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch suspicious IP data'
    });
  }
});

// Start server
app.listen(port, () => {
  console.log(`Novel Summarizer backend listening at http://localhost:${port}`);
});