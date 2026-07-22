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
  const isProduction = process.env.NODE_ENV === 'production';
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
        // In dev, Vite (middlewareMode below) injects the @vitejs/plugin-react
        // react-refresh preamble as an INLINE <script> into index.html. With the
        // strict production script-src that inline script is blocked by the CSP
        // and the app renders a blank page ("@vitejs/plugin-react can't detect
        // preamble"). 'unsafe-inline' is therefore allowed ONLY outside
        // production; the production policy stays strict.
        scriptSrc: isProduction
          ? ["'self'", "https://auth.magic.link"]
          : ["'self'", "'unsafe-inline'", "https://auth.magic.link"],
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
              callback(null, false);
            }
          },
          credentials: true,
        }
      : process.env.NODE_ENV === 'production'
        ? { origin: false as const }
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

    // Only forward a wallet that looks like a Solana address (base58, 32–44
    // chars); otherwise drop it rather than HMAC-signing an arbitrary
    // attacker-supplied value into the MoonPay URL (audit B-N5).
    const rawWallet = typeof req.query.walletAddress === 'string' ? req.query.walletAddress.trim() : '';
    const walletAddress = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(rawWallet) ? rawWallet : '';
    const currencyCode = typeof req.query.currencyCode === 'string' ? req.query.currencyCode.trim().toLowerCase() : 'sol';
    const baseUrl = process.env.MOONPAY_WIDGET_URL || 'https://buy.moonpay.com';
    const url = new URL(baseUrl);
    url.searchParams.set('apiKey', apiKey);
    url.searchParams.set('currencyCode', currencyCode);
    if (walletAddress) url.searchParams.set('walletAddress', walletAddress);

    if (secretKey) {
      // MoonPay signs ONLY the query string (everything from "?" onward),
      // never the pathname. Signing `${url.pathname}${url.search}` produced
      // an extra leading "/" (e.g. "/?apiKey=...") that never matches the
      // signature MoonPay recomputes server-side, so the widget silently
      // rejected the URL whenever MOONPAY_SECRET_KEY was configured.
      const signature = createHmac('sha256', secretKey)
        .update(url.search)
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
      // Only forward safe headers to the backend proxy.
      // Explicitly exclude forwarding headers that could be spoofed or
      // that the frontend server should set itself.
      const SAFE_FORWARD_HEADERS = new Set([
        'accept', 'accept-language', 'content-type', 'authorization',
        'x-requested-with', 'x-client-version',
      ]);
      const BLOCKED_HEADERS = new Set([
        'connection', 'content-length', 'host',
        'x-forwarded-for', 'x-forwarded-host', 'x-forwarded-proto',
        'x-original-forwarded-for',
      ]);
      const headers = new Headers();
      for (const [key, value] of Object.entries(req.headers)) {
        if (!value) continue;
        const lower = key.toLowerCase();
        if (BLOCKED_HEADERS.has(lower)) continue;
        if (lower.startsWith('x-forwarded-')) continue;
        // Only forward headers that are in the safe allowlist
        if (!SAFE_FORWARD_HEADERS.has(lower)) continue;
        headers.set(key, Array.isArray(value) ? value.join(',') : value);
      }
      if (!headers.has('content-type') && !['GET', 'HEAD'].includes(req.method)) {
        headers.set('content-type', 'application/json');
      }
      // The frontend server sets X-Forwarded-Proto based on its own
      // trusted configuration, not from client-supplied headers.
      headers.set('x-forwarded-proto', req.secure ? 'https' : 'http');

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
  if (!isProduction) {
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
