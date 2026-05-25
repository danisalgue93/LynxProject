import express from 'express';
import 'dotenv/config';
import path from 'path';
import cors from 'cors';
import { createHmac } from 'crypto';
import { createServer as createViteServer } from 'vite';

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT || 3000);
  const BACKEND_URL = (process.env.BACKEND_URL || process.env.VITE_API_URL || 'http://127.0.0.1:4000').replace(/\/$/, '');

  app.use(cors());
  app.use(express.json());

  app.get('/integrations/moonpay/onramp-url', (req, res) => {
    const apiKey = process.env.MOONPAY_API_KEY || process.env.VITE_MOONPAY_API_KEY;
    const secretKey = process.env.MOONPAY_SECRET_KEY;

    if (!apiKey) {
      res.status(500).json({ error: 'MoonPay API key is not configured' });
      return;
    }

    const walletAddress = typeof req.query.walletAddress === 'string' ? req.query.walletAddress.trim() : '';
    const currencyCode = typeof req.query.currencyCode === 'string' ? req.query.currencyCode.trim().toLowerCase() : 'sol';
    const baseUrl = process.env.MOONPAY_WIDGET_URL || 'https://buy.moonpay.com';
    const url = new URL(baseUrl);
    url.searchParams.set('apiKey', apiKey);
    url.searchParams.set('currencyCode', currencyCode);
    if (walletAddress) url.searchParams.set('walletAddress', walletAddress);

    if (secretKey) {
      const signature = createHmac('sha256', secretKey)
        .update(`${url.pathname}${url.search}`)
        .digest('base64');
      url.searchParams.set('signature', signature);
    }

    res.json({ url: url.toString(), signed: Boolean(secretKey) });
  });

  app.use('/api', async (req, res) => {
    try {
      const headers = new Headers();
      for (const [key, value] of Object.entries(req.headers)) {
        if (!value || ['connection', 'content-length', 'host'].includes(key.toLowerCase())) continue;
        headers.set(key, Array.isArray(value) ? value.join(',') : value);
      }

      if (!headers.has('content-type') && !['GET', 'HEAD'].includes(req.method)) {
        headers.set('content-type', 'application/json');
      }

      const upstream = await fetch(`${BACKEND_URL}${req.originalUrl}`, {
        method: req.method,
        headers,
        body: ['GET', 'HEAD'].includes(req.method) ? undefined : JSON.stringify(req.body ?? {}),
      });

      res.status(upstream.status);
      const contentType = upstream.headers.get('content-type');
      if (contentType) res.setHeader('content-type', contentType);
      res.send(Buffer.from(await upstream.arrayBuffer()));
    } catch (error: any) {
      console.error('Backend proxy error:', error);
      res.status(502).json({ error: error.message || 'Backend unavailable' });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on port ${PORT}`);
  });
}

startServer();
