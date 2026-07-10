# Lynx Market — Deployment Guide

> Complete production deployment instructions for Lynx Market on Solana.

---

## Overview

Lynx Market runs on Docker Compose with:
- **Frontend** (React/Vite): Static build served via nginx
- **Backend** (Express/Node.js): REST + Socket.IO API
- **Database** (PostgreSQL): Persistent state via Prisma
- **Cache** (Redis): Distributed rate limiting across instances
- **Reverse Proxy** (nginx): TLS termination, gzip, security headers
- **TLS** (Let's Encrypt): Automatic certificate management via Certbot

---

## Pre-Deployment Checklist

Before deploying to production, ensure you have:

- [ ] A domain name (for TLS certificates)
- [ ] A Linux/Unix server with Docker and Docker Compose installed
- [ ] External PostgreSQL instance OR local postgres service (included in compose)
- [ ] Solana mainnet RPC endpoint (Helius, QuickNode, or self-hosted)
- [ ] Sentry DSN for error tracking (optional but recommended)
- [ ] Resend API key for email verification
- [ ] Magic Link account and publishable key
- [ ] MoonPay account and API keys
- [ ] Anchor program deployed to mainnet with PROGRAM_ID and LYNX_MINT known

---

## Step 1: Clone and configure

```bash
# Clone the repository
git clone https://github.com/yourorg/lynx-market.git
cd lynx-market

# Create environment file
cp .env.example .env

# Edit .env with your production values
nano .env  # or your preferred editor
```

### Required .env values

| Variable | Purpose | Where to get |
|----------|---------|--------------|
| `POSTGRES_PASSWORD` | Database password | Generate: `openssl rand -hex 32` |
| `JWT_SECRET` | Auth token signing | Generate: `openssl rand -hex 64` |
| `REFRESH_SECRET` | Refresh token signing | Generate: `openssl rand -hex 64` (different!) |
| `CORS_ORIGIN` | Frontend URL | Your domain: `https://yourdomain.com` |
| `ADMIN_WALLETS` | Admin wallet addresses | Your Solana pubkeys (min 2, comma-separated) |
| `ADMIN_API_TOKEN` | Machine token for backend scripts | Generate: `openssl rand -hex 32` |
| `TREASURY_WALLET` | On-chain deposit wallet | Your Solana public key |
| `TREASURY_SECRET_KEY` | On-chain withdrawal key | Base58-encoded secret (keep secure!) |
| `MANAGED_WALLET_SEED` | Magic wallet derivation | Generate: `openssl rand -hex 32` |
| `APP_URL` | Backend absolute URL | Same as CORS_ORIGIN domain |
| `VITE_MAGIC_PUBLISHABLE_KEY` | Magic Link auth | From magic.link dashboard |
| `VITE_MOONPAY_API_KEY` | MoonPay widget | From moonpay.com dashboard |
| `MOONPAY_SECRET_KEY` | MoonPay signing | From moonpay.com dashboard (server-side only!) |
| `SOLANA_CLUSTER` | Network | `mainnet-beta` (or `devnet` for testing) |
| `SOLANA_RPC_URL` | RPC endpoint | Helius/QuickNode/other provider |
| `PROGRAM_ID` | Anchor program | From your on-chain deployment |
| `LYNX_MINT` | LYNX token mint | From your SPL mint |
| `RESEND_API_KEY` | Email delivery | From resend.com dashboard |
| `EMAIL_FROM` | Sender address | `Lynx Market <noreply@yourdomain.com>` |
| `SENTRY_DSN` | Error tracking (optional) | From sentry.io |
| `VITE_SENTRY_DSN` | Frontend errors (optional) | From sentry.io (React project) |

### Secret management best practices

```bash
# Store secrets securely:
# 1. Use your cloud provider's secrets manager (AWS Secrets Manager, HashiCorp Vault, etc.)
# 2. Rotate TREASURY_SECRET_KEY regularly
# 3. Never commit .env to version control
# 4. Use .env in .gitignore (already set)
# 5. Keep a backup of critical secrets in a separate secure location

# Generate cryptographically secure random strings:
openssl rand -hex 64  # JWT secrets (64 chars)
openssl rand -hex 32  # Other secrets (32 chars)
```

---

## Step 2: Validate configuration

Before deploying, validate that all required environment variables are set:

```bash
# Make scripts executable
chmod +x scripts/*.sh

# Validate environment
./scripts/validate-env.sh
```

If validation passes, you'll see:
```
✓ All required variables are set and valid
Ready to deploy with: docker compose up -d
```

---

## Step 3: Obtain TLS certificates (first deploy only)

The first time you deploy, you need to provision Let's Encrypt certificates:

```bash
# Set your domain and email
export DOMAIN=yourdomain.com
export EMAIL=admin@yourdomain.com

# Obtain certificates (generates them on the host, mounted into nginx)
chmod +x nginx/init-certs.sh
./nginx/init-certs.sh

# This creates:
# - /etc/letsencrypt/live/yourdomain.com/cert.pem
# - /etc/letsencrypt/live/yourdomain.com/privkey.pem
# - /etc/letsencrypt/live/yourdomain.com/chain.pem
```

If you're deploying in a container/VPS:

```bash
# The script will use certbot in Docker if it's available
# Otherwise, run certbot directly on your host:
certbot certonly --standalone -d yourdomain.com -m admin@yourdomain.com
```

---

## Step 4: Deploy services

```bash
# Start all services (with validation)
./scripts/deploy.sh up

# Or manually:
docker compose up -d
```

Services started:
- **nginx** (port 80 → redirect HTTPS, port 443 → TLS)
- **backend** (internal :4000)
- **frontend** (internal :3000)
- **postgres** (internal :5432)
- **redis** (internal :6379)

---

## Step 5: Verify deployment

```bash
# Check all services are healthy
./scripts/deploy.sh status

# View logs (press Ctrl+C to exit)
./scripts/deploy.sh logs

# Test backend health
curl https://yourdomain.com/api/health

# Test frontend (should redirect to HTTPS)
curl http://yourdomain.com
```

### Expected responses

- Frontend: HTTP 301 redirect to HTTPS
- Backend: `{"status":"ok"}` with `Content-Type: application/json`
- nginx: Security headers present (X-Content-Type-Options, CSP, etc.)

---

## Step 6: Post-deployment tasks

### Database migrations

Migrations run automatically on every deployment via the `migrate` service in `docker-compose.yml`.

To check migration status:
```bash
docker compose logs migrate
```

### Initialize admin panel session

If using the embedded admin panel (cripto/admin-panel):

```bash
# Admin panel is only accessible on 127.0.0.1:3001
# Set initial admin session via SSH tunnel if needed:
ssh -L 3001:127.0.0.1:3001 user@yourdomain.com
# Then visit http://localhost:3001 in your browser
```

### Monitor errors

Set up Sentry alerts for the backend and frontend:
1. Log into your Sentry project
2. Create alert rules for:
   - Errors in the `lynx-backend` release
   - Errors in the `lynx-frontend` release
3. Configure notifications to your team's Slack/email

---

## Scaling

### Multiple backend instances

If you need to handle higher load:

```bash
# Scale backend to 3 instances (with Redis for shared rate limiting)
docker compose up -d --scale backend=3
```

Ensure:
- `REDIS_URL` is set to a shared Redis instance
- Backend services are behind a load balancer (nginx already does this)
- Database connection pool is sized appropriately

### Managed services

For production, consider:
- **Database**: AWS RDS PostgreSQL / Azure Database for PostgreSQL
- **Cache**: AWS ElastiCache / Azure Cache for Redis
- **Reverse Proxy**: AWS ALB / Azure Application Gateway
- **TLS**: AWS ACM certificates (instead of Let's Encrypt)

---

## Common operations

### View logs

```bash
# All services
docker compose logs -f

# Specific service
docker compose logs -f backend
docker compose logs -f postgres

# Last 100 lines
docker compose logs --tail=100
```

### Stop services

```bash
# Stop (containers remain, data persists)
./scripts/deploy.sh down

# Or manually:
docker compose down
```

### Restart a specific service

```bash
# Restart backend (preserves other services)
docker compose restart backend

# Full restart
./scripts/deploy.sh restart
```

### Update and redeploy

```bash
# Pull latest code
git pull origin main

# Rebuild images and restart
docker compose down
docker compose up -d --build

# Or use the helper:
./scripts/deploy.sh restart
```

### Backup database

```bash
# Backup PostgreSQL
docker compose exec postgres pg_dump -U lynx lynx_market > backup.sql

# Restore from backup
docker compose exec -T postgres psql -U lynx lynx_market < backup.sql
```

---

## Troubleshooting

### Backend won't start

```bash
# Check logs
docker compose logs backend

# Common issues:
# - DATABASE_URL is wrong or Postgres is not healthy
# - JWT_SECRET or REFRESH_SECRET is too short
# - PROGRAM_ID or other required vars are missing

# Validate:
./scripts/validate-env.sh
```

### Frontend shows blank page

```bash
# Check frontend logs
docker compose logs frontend

# Check VITE_API_URL is correctly set
curl "$VITE_API_URL/api/health"

# Clear browser cache and reload
```

### TLS certificate not renewing

```bash
# Certbot runs on a 12-hour schedule inside the compose stack
# To manually trigger renewal:
docker compose run --rm certbot renew

# Check renewal status
docker compose logs certbot
```

### High latency or timeouts

```bash
# Check database performance
docker compose exec postgres psql -U lynx -d lynx_market -c "SELECT count(*) FROM \"Market\";"

# Check Redis connectivity
docker compose exec redis redis-cli ping

# Scale backend if CPU is high
docker compose up -d --scale backend=3
```

---

## Security hardening

### Network isolation

```bash
# Ensure only nginx is exposed to the internet:
# - Backend on internal network only
# - Database on internal network only
# - Redis on internal network only

# Verify with:
docker compose ps --format "table {{.Service}}\t{{.Ports}}"
```

### Secrets rotation

```bash
# Rotate JWT_SECRET periodically (e.g., quarterly):
# 1. Generate new value: openssl rand -hex 64
# 2. Update .env
# 3. Restart backend: docker compose restart backend
# Note: Existing tokens will be invalidated (users re-login)

# Rotate TREASURY_SECRET_KEY annually
# Involves moving treasury funds to new wallet
```

### Firewall rules

```bash
# Allow only:
# - Port 80 (HTTP for ACME renewal)
# - Port 443 (HTTPS for users)
# Block all other inbound ports
```

### Regular backups

```bash
# Automated daily backups
cat > /etc/cron.daily/lynx-backup << 'EOF'
#!/bin/bash
cd /opt/lynx-market
docker compose exec -T postgres pg_dump -U lynx lynx_market > /backups/lynx_$(date +%Y%m%d).sql
# Keep last 30 days
find /backups -name "lynx_*.sql" -mtime +30 -delete
EOF
chmod +x /etc/cron.daily/lynx-backup
```

---

## Support

For deployment issues, check:
1. [PRODUCTION_READINESS.md](PRODUCTION_READINESS.md) — Architecture and component decisions
2. [README.md](README.md) — Quick start and architecture overview
3. Docker Compose logs: `docker compose logs -f`
4. Sentry dashboard: Error tracking and debugging
