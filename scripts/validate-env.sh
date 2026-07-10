#!/usr/bin/env bash
set -euo pipefail

# ──────────────────────────────────────────────────────────────────────────────
# Lynx Market — Pre-deployment environment validation
# ──────────────────────────────────────────────────────────────────────────────
# Purpose: Verify that all required environment variables are set and non-empty
#          before running `docker compose up`. Catches configuration errors early.
#
# Usage:   ./scripts/validate-env.sh
# Exit:    0 (all required vars set), 1 (missing or empty var)
# ──────────────────────────────────────────────────────────────────────────────

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"

# Source the .env file if it exists
if [ -f "$ROOT_DIR/.env" ]; then
  # shellcheck disable=SC2086
  export $(grep -v '^#' "$ROOT_DIR/.env" | grep -v '^\s*$' | sed 's/\r$//')
else
  echo "❌ Error: .env file not found at $ROOT_DIR/.env"
  echo "   Run: cp .env.example .env"
  exit 1
fi

# ── Color codes for output ──────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# ── Required variables ──────────────────────────────────────────────────────────
REQUIRED_VARS=(
  "POSTGRES_PASSWORD"
  "JWT_SECRET"
  "REFRESH_SECRET"
  "CORS_ORIGIN"
  "ADMIN_WALLETS"
  "ADMIN_API_TOKEN"
  "TREASURY_WALLET"
  "TREASURY_SECRET_KEY"
  "MANAGED_WALLET_SEED"
  "APP_URL"
  "VITE_MAGIC_PUBLISHABLE_KEY"
  "VITE_MOONPAY_API_KEY"
  "MOONPAY_SECRET_KEY"
)

# ── Recommended but optional variables ──────────────────────────────────────────
OPTIONAL_VARS=(
  "RESEND_API_KEY"
  "EMAIL_FROM"
  "SENTRY_DSN"
  "VITE_SENTRY_DSN"
  "SOLANA_RPC_URL"
  "PROGRAM_ID"
  "LYNX_MINT"
)

errors=0
warnings=0

echo ""
echo "╭─ Lynx Market Environment Validation ─────────────────────────────╮"
echo ""

# ── Check required variables ────────────────────────────────────────────────────
echo "Required variables:"
for var in "${REQUIRED_VARS[@]}"; do
  value="${!var:-}"
  if [ -z "$value" ]; then
    echo -e "  ${RED}✗${NC} $var (missing or empty)"
    ((errors++))
  else
    # Show truncated value for long secrets
    if [ ${#value} -gt 20 ]; then
      display_value="${value:0:17}..."
    else
      display_value="$value"
    fi
    echo -e "  ${GREEN}✓${NC} $var"
  fi
done

echo ""
echo "Optional variables:"
for var in "${OPTIONAL_VARS[@]}"; do
  value="${!var:-}"
  if [ -z "$value" ]; then
    echo -e "  ${YELLOW}⚠${NC} $var (not set)"
    ((warnings++))
  else
    echo -e "  ${GREEN}✓${NC} $var"
  fi
done

echo ""

# ── Validation checks ──────────────────────────────────────────────────────────
echo "Validation checks:"

# Check JWT_SECRET length
if [ ${#JWT_SECRET} -lt 64 ]; then
  echo -e "  ${RED}✗${NC} JWT_SECRET must be at least 64 characters (current: ${#JWT_SECRET})"
  ((errors++))
else
  echo -e "  ${GREEN}✓${NC} JWT_SECRET length is valid"
fi

# Check REFRESH_SECRET length
if [ ${#REFRESH_SECRET} -lt 64 ]; then
  echo -e "  ${RED}✗${NC} REFRESH_SECRET must be at least 64 characters (current: ${#REFRESH_SECRET})"
  ((errors++))
else
  echo -e "  ${GREEN}✓${NC} REFRESH_SECRET length is valid"
fi

# Check CORS_ORIGIN is https
if [[ "$CORS_ORIGIN" != "https://"* ]] && [[ "$CORS_ORIGIN" != "http://localhost"* ]]; then
  echo -e "  ${YELLOW}⚠${NC} CORS_ORIGIN should be HTTPS in production: $CORS_ORIGIN"
  ((warnings++))
else
  echo -e "  ${GREEN}✓${NC} CORS_ORIGIN format is valid"
fi

# Check APP_URL is https
if [[ "$APP_URL" != "https://"* ]] && [[ "$APP_URL" != "http://localhost"* ]]; then
  echo -e "  ${YELLOW}⚠${NC} APP_URL should be HTTPS in production: $APP_URL"
  ((warnings++))
else
  echo -e "  ${GREEN}✓${NC} APP_URL format is valid"
fi

# Check admin count (at least 2 for production)
ADMIN_COUNT=$(echo "$ADMIN_WALLETS" | tr ',' '\n' | grep -c .)
if [ "$ADMIN_COUNT" -lt 2 ]; then
  echo -e "  ${YELLOW}⚠${NC} ADMIN_WALLETS should have at least 2 addresses for production (current: $ADMIN_COUNT)"
  ((warnings++))
else
  echo -e "  ${GREEN}✓${NC} ADMIN_WALLETS count is valid ($ADMIN_COUNT)"
fi

echo ""
echo "╰────────────────────────────────────────────────────────────────────╯"
echo ""

# ── Summary ─────────────────────────────────────────────────────────────────────
if [ $errors -eq 0 ]; then
  echo -e "${GREEN}✓ All required variables are set and valid${NC}"
  if [ $warnings -gt 0 ]; then
    echo -e "${YELLOW}⚠ $warnings warning(s) found${NC}"
  fi
  echo ""
  echo "Ready to deploy with: docker compose up -d"
  exit 0
else
  echo -e "${RED}✗ $errors error(s) found${NC}"
  echo ""
  echo "Fix the errors above and try again:"
  echo "  1. Edit .env"
  echo "  2. Run: ./scripts/validate-env.sh"
  echo ""
  exit 1
fi
