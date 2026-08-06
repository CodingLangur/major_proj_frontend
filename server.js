require('dotenv').config();

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

const { GoogleGenAI } = require('@google/genai');

const PORT = process.env.PORT || 8080;
const API_BASE = process.env.API_BASE || 'http://20.119.77.54:9000';

function getGeminiClient() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;
  return new GoogleGenAI({ apiKey });
}

// Helper to parse request body safely across both standard Node HTTP and Vercel Serverless Functions
function parseRequestBody(req) {
  return new Promise((resolve) => {
    if (req.body) {
      if (typeof req.body === 'object') {
        return resolve(req.body);
      }
      try {
        return resolve(JSON.parse(req.body));
      } catch (_) {
        return resolve({});
      }
    }

    let body = '';
    req.on('data', chunk => {
      body += chunk;
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(body || '{}'));
      } catch (_) {
        resolve({});
      }
    });

    if (req.readableEnded) {
      try {
        resolve(JSON.parse(body || '{}'));
      } catch (_) {
        resolve({});
      }
    }
  });
}

function generateMockTrustHistory() {
  const now = Date.now();
  const list = [];
  for (let i = 20; i >= 0; i--) {
    const ts = new Date(now - i * 5000).toISOString();
    const trust = 0.75 + Math.sin(i) * 0.15;
    list.push({
      timestamp: ts,
      device_id: `DEV-${1000 + i}`,
      trust_after: parseFloat(trust.toFixed(4)),
      ema_anomaly: parseFloat((1 - trust).toFixed(4)),
      slow_burn_score: parseFloat((Math.random() * 15).toFixed(1)),
      anomaly_score: parseFloat((Math.random() * 0.2).toFixed(4)),
      decision: trust > 0.8 ? 'ALLOW' : (trust > 0.6 ? 'VERIFY' : 'BLOCK')
    });
  }
  return list;
}

function generateMockDecisionHistory() {
  const now = Date.now();
  const list = [];
  const decisions = ['ALLOW', 'ALLOW', 'VERIFY', 'ALLOW', 'BLOCK'];
  for (let i = 15; i >= 0; i--) {
    const ts = new Date(now - i * 6000).toISOString();
    const dec = decisions[i % decisions.length];
    list.push({
      timestamp: ts,
      device_id: `DEV-${2000 + i}`,
      decision: dec,
      trust_after: dec === 'ALLOW' ? 0.92 : (dec === 'VERIFY' ? 0.68 : 0.25),
      anomaly_score: dec === 'ALLOW' ? 0.05 : (dec === 'VERIFY' ? 0.35 : 0.85)
    });
  }
  return list;
}

function generateMockLiveEvent() {
  const trust = 0.82 + (Math.random() * 0.1 - 0.05);
  return {
    timestamp: new Date().toISOString(),
    device_id: `DEV-LIVE-${Math.floor(Math.random() * 100)}`,
    trust_after: parseFloat(trust.toFixed(4)),
    ema_anomaly: parseFloat((1 - trust).toFixed(4)),
    slow_burn_score: parseFloat((Math.random() * 10).toFixed(1)),
    anomaly_score: parseFloat((Math.random() * 0.15).toFixed(4)),
    decision: trust > 0.8 ? 'ALLOW' : (trust > 0.6 ? 'VERIFY' : 'BLOCK')
  };
}

const requestHandler = async (req, res) => {
  // CORS Headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  // Extract cleanest target URL path across standard Node and Vercel Serverless Function rewrites
  const rawPath = req.headers['x-forwarded-uri'] || req.url || '/';
  const cleanUrl = rawPath.split('?')[0];

  // Local route for Gemini telemetry summarization
  if (cleanUrl === '/api/summarize-telemetry') {
    if (req.method !== 'POST') {
      res.writeHead(405, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Method Not Allowed. Use POST.' }));
      return;
    }

    try {
      const ai = getGeminiClient();
      if (!ai) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'GEMINI_API_KEY is missing on server. Check environment variables in Vercel or .env file.' }));
        return;
      }

      const payload = await parseRequestBody(req);
      const prompt = `You are a cybersecurity expert embedded in a Zero Trust Architecture (ZTA) Security Operations Center (SOC) dashboard.
Analyze the following telemetry JSON log and provide a concise, natural language summary (2 to 3 sentences maximum).
Explain what happened, key metrics (such as device ID, trust score, anomaly score, slow burn score), and why the policy decision (ALLOW, VERIFY, BLOCK) was taken or recommended.
Keep the tone professional, direct, and actionable for security engineers.

Telemetry Log:
${JSON.stringify(payload, null, 2)}`;

      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: prompt
      });

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ summary: response.text }));
    } catch (err) {
      console.error('Error generating telemetry summary:', err);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Failed to generate telemetry summary', details: err.message }));
    }
    return;
  }

  // Check if it's an API request to proxy to external backend
  if (cleanUrl.startsWith('/api/')) {
    const targetUrl = API_BASE + cleanUrl;
    const client = targetUrl.startsWith('https:') ? https : http;

    let responded = false;
    const sendFallbackOrError = (statusCode, errMessage) => {
      if (responded) return;
      responded = true;

      // Provide seamless fallback data if external backend IP is unreachable
      if (cleanUrl === '/api/trust-history') {
        res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify(generateMockTrustHistory()));
        return;
      }
      if (cleanUrl === '/api/decision-history') {
        res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify(generateMockDecisionHistory()));
        return;
      }
      if (cleanUrl === '/api/live') {
        res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify(generateMockLiveEvent()));
        return;
      }

      res.writeHead(statusCode, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ error: 'Proxy request failed', details: errMessage }));
    };

    const proxyReq = client.get(targetUrl, { timeout: 3000 }, (apiRes) => {
      if (responded) return;
      responded = true;
      res.writeHead(apiRes.statusCode, {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      });
      apiRes.pipe(res);
    });

    proxyReq.on('timeout', () => {
      proxyReq.destroy();
      sendFallbackOrError(504, 'Backend API request timed out (20.119.77.54:9000 unreachable)');
    });

    proxyReq.on('error', (err) => {
      sendFallbackOrError(502, `Proxy connection error: ${err.message}`);
    });

    return;
  }

  // Serve static files (for local node server.js execution)
  let filePath = path.join(__dirname, cleanUrl === '/' ? 'index.html' : cleanUrl);
  
  if (!filePath.startsWith(__dirname)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  const ext = path.extname(filePath);
  let contentType = 'text/html';
  if (ext === '.js') contentType = 'text/javascript';
  else if (ext === '.css') contentType = 'text/css';
  else if (ext === '.png') contentType = 'image/png';
  else if (ext === '.jpg' || ext === '.jpeg') contentType = 'image/jpeg';
  else if (ext === '.json') contentType = 'application/json';

  fs.readFile(filePath, (err, content) => {
    if (err) {
      if (err.code === 'ENOENT') {
        res.writeHead(404);
        res.end('File not found');
      } else {
        res.writeHead(500);
        res.end('Server error: ' + err.code);
      }
    } else {
      res.writeHead(200, { 
        'Content-Type': contentType,
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0'
      });
      res.end(content, 'utf-8');
    }
  });
};

module.exports = requestHandler;

if (require.main === module) {
  const server = http.createServer(requestHandler);
  server.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}/`);
    console.log(`Proxying /api/* to ${API_BASE}/api/*`);
  });
}
