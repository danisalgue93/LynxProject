import express from 'express';
import 'dotenv/config';
import helmet from 'helmet';
import compression from 'compression';
import path from 'path';
import cors from 'cors';
import { createHmac } from 'crypto';
import { createServer as createViteServer } from 'vite';
import http from 'http';

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT || 3000);
  const BACKEND_URL = (process.env.BACKEND_URL || process.env.VITE_API_URL || 'http://127.0.0.1:4000').replace(/\/$/, '');
  const PROXY_TIMEOUT_MS = Number(process.env.PROXY_TIMEOUT_MS || 30_000);

  const allowedOrigins = (process.env.CORS_ORIGIN || '')
    .split(',')
    .map(o => o.trim())
    .filter(Boolean);

  // Compression before everything else
  app.use(compression());

  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "https://auth.magic.link"],
        connectSrc: [
          "'self'",
          "https://api.devnet.solana.com",
          "https://api.mainnet-beta.solana.com",
          "https://ipapi.co",
          "wss:",
          "ws:",
        ],
        imgSrc: ["'self'", "data:", "https://res.cloudinary.com"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        frameSrc: ["'none'"],
      },
    },
    crossOriginResourcePolicy: false,
  }));

  app.use(cors(
    allowedOrigins.length > 0
      ? {
          origin: (origin, callback) => {
            if (!origin || allowedOrigins.includes(origin)) {
              callback(null, true);
            } else {
              callback(new Error(`CORS: origin ${origin} not allowed`));
            }
          },
          credentials: true,
        }
      : undefined
  ));
  app.use(express.json());

  // ── Health check ─────────────────────────────────────────────────────────────
  // Independent of backend — reports only the frontend server's own liveness.
  app.get('/healthz', (_req, res) => {
    res.json({ status: 'ok', service: 'lynx-frontend', timestamp: new Date().toISOString() });
  });

  // ── MoonPay signed URL ───────────────────────────────────────────────────────
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

  // ── Backend proxy (with timeout) ─────────────────────────────────────────────
  // Shared proxy helper for /api and /auth — avoids duplicated try/catch blocks
  const proxyToBackend = async (req: express.Request, res: express.Response) => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), PROXY_TIMEOUT_MS);

    try {
      const headers = new Headers();
      for (const [key, value] of Object.entries(req.headers)) {
        if (!value || ['connection', 'content-length', 'host'].includes(key.toLowerCase())) continue;
        headers.set(key, Array.isArray(value) ? value.join(',') : value);
      }
      if (!headers.has('content-type') && !['GET', 'HEAD'].includes(req.method)) {
        headers.set('content-type', 'application/json');
      }
      // Forward X-Forwarded-Proto so the backend can enforce HTTPS in production.
      // Nginx sets this to 'https'; here we preserve it through the frontend→backend hop.
      if (!headers.has('x-forwarded-proto')) {
        const proto = req.headers['x-forwarded-proto'] as string | undefined;
        if (proto) headers.set('x-forwarded-proto', proto);
      }

      const upstream = await fetch(`${BACKEND_URL}${req.originalUrl}`, {
        method: req.method,
        headers,
        body: ['GET', 'HEAD'].includes(req.method) ? undefined : JSON.stringify(req.body ?? {}),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);
      res.status(upstream.status);
      const contentType = upstream.headers.get('content-type');
      if (contentType) res.setHeader('content-type', contentType);
      res.send(Buffer.from(await upstream.arrayBuffer()));
    } catch (error: any) {
      clearTimeout(timeoutId);
      if (error?.name === 'AbortError') {
        res.status(504).json({ error: 'Backend request timed out' });
      } else {
        console.error('Backend proxy error:', error);
        res.status(502).json({ error: 'Backend unavailable' });
      }
    }
  };

  app.use('/api', proxyToBackend);
  app.use('/auth', proxyToBackend);

  // ── Static file serving ───────────────────────────────────────────────────────
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');

    // Immutable cache for versioned assets (Vite hashes filenames)
    app.use('/assets', express.static(path.join(distPath, 'assets'), {
      maxAge: '1y',
      immutable: true,
    }));

    // Short cache for root-level files (index.html, robots.txt, etc.)
    app.use(express.static(distPath, { maxAge: '5m' }));

    // SPA fallback
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  // ── Start server ──────────────────────────────────────────────────────────────
  const server = http.createServer(app);

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`[lynx-frontend] Server running on port ${PORT}`);
  });

  // ── Graceful shutdown ─────────────────────────────────────────────────────────
  const gracefulShutdown = (signal: string) => {
    console.log(`[${signal}] Frontend server shutting down...`);
    server.close(() => {
      console.log('[shutdown] Frontend server closed.');
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  };

  process.once('SIGTERM', () => gracefulShutdown('SIGTERM'));
  process.once('SIGINT', () => gracefulShutdown('SIGINT'));
}

startServer().catch((err) => {
  console.error('Failed to start frontend server:', err);
  process.exit(1);
});
