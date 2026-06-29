# ── Stage 1: build ──────────────────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

# Install dependencies first (layer cache)
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts

# Copy source and compile TypeScript
COPY tsconfig.json ./
COPY src ./src
COPY prisma ./prisma

# Generate Prisma client and compile
RUN npx prisma generate && npm run build

# ── Stage 2: production image ────────────────────────────────────────────────
FROM node:20-alpine AS runner

# Security: run as non-root user
RUN addgroup -S lynx && adduser -S lynx -G lynx

WORKDIR /app

ENV NODE_ENV=production

# Install only production dependencies
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts

# Copy Prisma schema and generate client in runner context
COPY prisma ./prisma
RUN npx prisma generate

# Copy compiled output
COPY --from=builder /app/dist ./dist

# Switch to non-root
USER lynx

EXPOSE 4000

# Healthcheck so Docker / k8s knows when the container is ready
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -qO- http://localhost:4000/api/health || exit 1

CMD ["node", "dist/src/server.js"]
