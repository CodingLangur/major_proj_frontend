require('dotenv').config();

const http = require('http');
const fs = require('fs');
const path = require('path');

const { GoogleGenAI } = require('@google/genai');

const PORT = process.env.PORT || 8080;
const API_BASE = process.env.API_BASE || 'http://20.119.77.54:9000';
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

if (!GEMINI_API_KEY) {
  console.warn('WARNING: GEMINI_API_KEY is not set in environment or .env file!');
}

const ai = GEMINI_API_KEY ? new GoogleGenAI({ apiKey: GEMINI_API_KEY }) : null;

const server = http.createServer((req, res) => {
  // CORS Headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  const cleanUrl = req.url.split('?')[0];

  // Local route for Gemini telemetry summarization
  if (cleanUrl === '/api/summarize-telemetry') {
    if (req.method !== 'POST') {
      res.writeHead(405, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Method Not Allowed. Use POST.' }));
      return;
    }

    let body = '';
    req.on('data', chunk => {
      body += chunk;
    });

    req.on('end', async () => {
      try {
        if (!ai) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'GEMINI_API_KEY is missing on server. Check .env file.' }));
          return;
        }
        const payload = JSON.parse(body || '{}');
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
    });
    return;
  }

  // Check if it's an API request to proxy to external backend
  if (cleanUrl.startsWith('/api/')) {
    const targetUrl = API_BASE + req.url;
    
    http.get(targetUrl, (apiRes) => {
      res.writeHead(apiRes.statusCode, {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      });
      apiRes.pipe(res);
    }).on('error', (err) => {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Proxy request failed', details: err.message }));
    });
    return;
  }

  // Serve static files
  let filePath = path.join(__dirname, cleanUrl === '/' ? 'index.html' : cleanUrl);
  
  // Basic security check to prevent directory traversal
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
});

server.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}/`);
  console.log(`Proxying /api/* to ${API_BASE}/api/*`);
});
