# ── Stage 1: build Vite SPA ─────────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts

COPY . .

# Build args injected at build time (not stored in runtime image)
ARG VITE_API_URL
ARG VITE_SOLANA_NETWORK
ARG VITE_SOLANA_RPC_URL
ARG VITE_MAGIC_PUBLISHABLE_KEY
ARG VITE_MOONPAY_API_KEY
ARG VITE_TREASURY_WALLET
ARG VITE_PROGRAM_ID
ARG VITE_LYNX_MINT
ARG VITE_SENTRY_DSN

# Create .env from build args so Vite can pick them up
RUN echo "VITE_API_URL=${VITE_API_URL:-}" > .env && \
    echo "VITE_SOLANA_NETWORK=${VITE_SOLANA_NETWORK:-mainnet-beta}" >> .env && \
    echo "VITE_SOLANA_RPC_URL=${VITE_SOLANA_RPC_URL:-}" >> .env && \
    echo "VITE_MAGIC_PUBLISHABLE_KEY=${VITE_MAGIC_PUBLISHABLE_KEY:-}" >> .env && \
    echo "VITE_MOONPAY_API_KEY=${VITE_MOONPAY_API_KEY:-}" >> .env && \
    echo "VITE_TREASURY_WALLET=${VITE_TREASURY_WALLET:-}" >> .env && \
    echo "VITE_PROGRAM_ID=${VITE_PROGRAM_ID:-}" >> .env && \
    echo "VITE_LYNX_MINT=${VITE_LYNX_MINT:-}" >> .env && \
    echo "VITE_SENTRY_DSN=${VITE_SENTRY_DSN:-}" >> .env

RUN npm run build

# ── Stage 2: production server ───────────────────────────────────────────────
FROM node:20-alpine AS runner

RUN addgroup -S lynx && adduser -S lynx -G lynx

WORKDIR /app

ENV NODE_ENV=production

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts

# Copy compiled server (dist/server.cjs) and built SPA
COPY --from=builder /app/dist ./dist

USER lynx

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:3000/healthz || exit 1

CMD ["node", "dist/server.cjs"]
