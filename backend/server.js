require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const app = express();
// Google Cloud Run automatically sets PORT (defaults to 8080 in cloud, 3001 in local development)
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '15mb' }));
app.use(express.urlencoded({ extended: true, limit: '15mb' }));

// Initialize DB & hydrate from Google Cloud Firestore if configured
const db = require('./db');
db.initCloud().catch((err) => console.warn('Cloud DB init skipped:', err.message));

// API Routes
const authRoutes = require('./routes/auth');
const assetRoutes = require('./routes/assets');
const nomineeRoutes = require('./routes/nominees');
const dashboardRoutes = require('./routes/dashboard');
const geminiRoutes = require('./routes/gemini');
const storageRoutes = require('./routes/storage');
const verificationRoutes = require('./routes/verification');
const googleRoutes = require('./routes/googleDiscovery');

app.use('/api/auth', authRoutes);
app.use('/api/assets', assetRoutes);
app.use('/api/nominees', nomineeRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/gemini', geminiRoutes);
app.use('/api/storage', storageRoutes);
app.use('/api/verification', verificationRoutes);
app.use('/api/google', googleRoutes);

// Health check endpoint (for Cloud Run probes and monitoring)
app.get('/api/health', (req, res) => {
  res.json({
    success: true,
    data: {
      status: 'ok',
      service: 'HeirFlow API',
      cloud: process.env.K_SERVICE ? 'Google Cloud Run' : 'local',
      database: db.isCloudConnected() ? 'Google Cloud Firestore (6 behavioral collections)' : 'local_json_fallback',
      storage: process.env.GCS_BUCKET_NAME ? 'Google Cloud Storage' : 'local_fallback',
      ai: process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY !== 'your_gemini_api_key_here' ? 'Google Gemini 1.5 Flash' : 'mock_fallback',
      version: '1.0.0',
      timestamp: new Date().toISOString()
    }
  });
});

// Production: Serve compiled frontend build from Cloud Run container
const frontendDist = path.join(__dirname, '../frontend/dist');
if (fs.existsSync(frontendDist)) {
  console.log(`📦 Serving frontend static assets from: ${frontendDist}`);
  app.use(express.static(frontendDist));
  // Client-side routing fallback for single page app
  app.use((req, res, next) => {
    if (req.method === 'GET' && !req.path.startsWith('/api/')) {
      return res.sendFile(path.join(frontendDist, 'index.html'));
    }
    next();
  });
}

// 404 handler for API routes
app.use((req, res) => {
  res.status(404).json({ success: false, error: `Route ${req.method} ${req.path} not found` });
});

// Global error handler
app.use((err, req, res, next) => {
  console.error('Unhandled server error:', err);
  res.status(500).json({ success: false, error: 'Internal server error' });
});

app.listen(PORT, () => {
  console.log(`\n🚀 HeirFlow running on http://localhost:${PORT}`);
  console.log(`📋 Health check: http://localhost:${PORT}/api/health`);
  console.log(`☁️ Cloud Run environment: ${process.env.K_SERVICE ? 'ACTIVE' : 'LOCAL'}`);
  console.log(`🗄️ Google Cloud Storage: ${process.env.GCS_BUCKET_NAME || 'local fallback'}`);
  console.log(`🤖 Google Gemini API: ${process.env.GEMINI_API_KEY ? 'Configured' : 'Fallback active'}\n`);
});

module.exports = app;
