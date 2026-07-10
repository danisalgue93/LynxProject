#!/usr/bin/env bash
set -euo pipefail

# ──────────────────────────────────────────────────────────────────────────────
# Lynx Market — Docker Compose deployment helper
# ──────────────────────────────────────────────────────────────────────────────
# Purpose: Safely manage Docker Compose deployments with validation and health checks
#
# Usage:   ./scripts/deploy.sh [up|down|restart|logs|validate]
# ──────────────────────────────────────────────────────────────────────────────

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"

# ── Color codes ─────────────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# ── Helper functions ────────────────────────────────────────────────────────────
info() {
  echo -e "${BLUE}ℹ${NC} $*"
}

success() {
  echo -e "${GREEN}✓${NC} $*"
}

warning() {
  echo -e "${YELLOW}⚠${NC} $*"
}

error() {
  echo -e "${RED}✗${NC} $*"
}

# ── Main script logic ──────────────────────────────────────────────────────────
cd "$ROOT_DIR"

ACTION="${1:-up}"

case "$ACTION" in
  validate)
    info "Validating environment configuration..."
    bash "$SCRIPT_DIR/validate-env.sh"
    ;;

  up)
    info "Starting Lynx Market stack..."
    bash "$SCRIPT_DIR/validate-env.sh" || exit 1
    
    info "Starting Docker Compose services..."
    docker compose up -d
    
    success "Services starting..."
    echo ""
    info "Waiting for backend health check..."
    sleep 5
    
    max_attempts=30
    attempt=0
    while [ $attempt -lt $max_attempts ]; do
      if curl -sf http://localhost:4000/api/health >/dev/null 2>&1; then
        success "Backend is healthy"
        break
      fi
      ((attempt++))
      if [ $attempt -lt $max_attempts ]; then
        echo -n "."
        sleep 2
      fi
    done
    
    if [ $attempt -eq $max_attempts ]; then
      warning "Backend health check timeout (still starting, check logs with: docker compose logs backend)"
    fi
    
    echo ""
    success "Lynx Market deployment complete"
    echo ""
    echo "Service URLs:"
    echo "  Frontend:  http://localhost or https://yourdomain.com"
    echo "  Backend:   http://localhost:4000"
    echo "  Admin:     http://localhost:3001 (127.0.0.1 only)"
    echo ""
    echo "Useful commands:"
    echo "  View logs:     docker compose logs -f"
    echo "  Stop services: docker compose down"
    echo "  Restart:       $0 restart"
    ;;

  down)
    info "Stopping Lynx Market stack..."
    docker compose down
    success "Services stopped"
    ;;

  restart)
    info "Restarting Lynx Market stack..."
    docker compose down
    sleep 2
    bash "$SCRIPT_DIR/validate-env.sh" || exit 1
    docker compose up -d
    success "Services restarted"
    ;;

  logs)
    info "Showing Docker Compose logs (press Ctrl+C to exit)..."
    docker compose logs -f
    ;;

  status)
    info "Service status:"
    docker compose ps
    ;;

  *)
    echo "Lynx Market — Deployment Helper"
    echo ""
    echo "Usage: $0 [COMMAND]"
    echo ""
    echo "Commands:"
    echo "  up         Start all services (default)"
    echo "  down       Stop all services"
    echo "  restart    Restart all services"
    echo "  logs       Show live logs"
    echo "  status     Show service status"
    echo "  validate   Check environment configuration only"
    echo ""
    echo "Examples:"
    echo "  $0 validate    # Check .env before deploying"
    echo "  $0 up          # Start the full stack"
    echo "  $0 logs        # Watch logs as they happen"
    exit 1
    ;;
esac
