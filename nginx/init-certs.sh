#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# nginx/init-certs.sh
#
# Run this ONCE on first deployment to obtain Let's Encrypt certificates.
# After this, the Certbot service in docker-compose handles renewals automatically.
#
# Usage:
#   chmod +x nginx/init-certs.sh
#   DOMAIN=lynxmarket.io EMAIL=admin@lynxmarket.io ./nginx/init-certs.sh
# ─────────────────────────────────────────────────────────────────────────────

set -euo pipefail

DOMAIN="${DOMAIN:?Please export DOMAIN=yourdomain.com}"
EMAIL="${EMAIL:?Please export EMAIL=you@example.com}"
STAGING="${STAGING:-0}"  # Set STAGING=1 to test with Let's Encrypt staging CA

echo "▶ Lynx Market — Let's Encrypt certificate bootstrap"
echo "  Domain : $DOMAIN"
echo "  Email  : $EMAIL"
echo "  Staging: $STAGING"
echo ""

# ── Step 1: Start nginx with a self-signed cert so it can serve the ACME challenge
echo "1/4  Starting nginx (HTTP only for ACME challenge)..."

# Replace cert paths with dummy placeholders that nginx accepts for startup
mkdir -p nginx/dummy-certs
openssl req -x509 -nodes -newkey rsa:2048 -days 1 \
  -keyout nginx/dummy-certs/privkey.pem \
  -out    nginx/dummy-certs/fullchain.pem \
  -subj "/CN=localhost" 2>/dev/null

# Create the volume directory structure expected by the nginx.conf
docker compose run --rm certbot \
  sh -c "mkdir -p /etc/letsencrypt/live/domain"

# Copy dummy certs into the certbot_conf volume so nginx can start
docker compose run --rm certbot \
  sh -c "cp /dev/null /etc/letsencrypt/live/domain/fullchain.pem; \
         cp /dev/null /etc/letsencrypt/live/domain/privkey.pem; \
         cp /dev/null /etc/letsencrypt/live/domain/chain.pem"

# Now overwrite with dummy content so nginx doesn't error on empty files
docker compose run --rm -v "$(pwd)/nginx/dummy-certs:/src:ro" certbot \
  sh -c "cp /src/fullchain.pem /etc/letsencrypt/live/domain/fullchain.pem; \
         cp /src/privkey.pem   /etc/letsencrypt/live/domain/privkey.pem; \
         cp /src/fullchain.pem /etc/letsencrypt/live/domain/chain.pem"

echo "2/4  Starting nginx to serve ACME challenge..."
docker compose up -d nginx

# Wait for nginx to be ready
sleep 3

# ── Step 2: Obtain real certificate via HTTP-01 challenge
echo "3/4  Requesting Let's Encrypt certificate..."

STAGING_FLAG=""
if [ "$STAGING" = "1" ]; then
  STAGING_FLAG="--staging"
  echo "     (Using Let's Encrypt STAGING CA — certificate will NOT be trusted by browsers)"
fi

docker compose run --rm certbot certbot certonly \
  --webroot \
  --webroot-path=/var/www/certbot \
  $STAGING_FLAG \
  --email "$EMAIL" \
  --agree-tos \
  --no-eff-email \
  -d "$DOMAIN" \
  -d "www.$DOMAIN"

# ── Step 3: Copy to the path nginx.conf expects
echo "4/4  Installing certificate..."
docker compose run --rm certbot \
  sh -c "cp /etc/letsencrypt/live/${DOMAIN}/fullchain.pem /etc/letsencrypt/live/domain/fullchain.pem && \
         cp /etc/letsencrypt/live/${DOMAIN}/privkey.pem   /etc/letsencrypt/live/domain/privkey.pem   && \
         cp /etc/letsencrypt/live/${DOMAIN}/chain.pem     /etc/letsencrypt/live/domain/chain.pem"

# Reload nginx to pick up the real certificate
docker compose exec nginx nginx -s reload

rm -rf nginx/dummy-certs

echo ""
echo "✅  Certificate issued and nginx reloaded."
echo "    Renewal: docker compose run --rm certbot certbot renew"
echo "    Or add to cron: 0 12 * * * cd $(pwd) && docker compose run --rm certbot certbot renew --quiet && docker compose exec nginx nginx -s reload"
