#!/usr/bin/env sh
# AP-22: Pre-migration backup script
# Runs pg_dump before prisma migrate deploy to create a restorable backup.
# Called by the migrate service in docker-compose.yml.
#
# The backup is written to /backups/ inside the container. Mount a host
# volume to persist backups across container removals:
#   volumes:
#     - ./backups:/backups

set -eu

DATABASE_URL="${DATABASE_URL:?DATABASE_URL is required}"

# Extract postgres connection details from DATABASE_URL
# Expected format: postgresql://user:password@host:5432/dbname?schema=public
DB_HOST=$(echo "$DATABASE_URL" | sed -n 's|.*@\([^:]*\):.*|\1|p')
DB_PORT=$(echo "$DATABASE_URL" | sed -n 's|.*@[^:]*:\([0-9]*\)/.*|\1|p')
DB_USER=$(echo "$DATABASE_URL" | sed -n 's|postgresql://\([^:]*\):.*|\1|p')
DB_NAME=$(echo "$DATABASE_URL" | sed -n 's|.*/\([^?]*\)?.*|\1|p')
DB_PASS=$(echo "$DATABASE_URL" | sed -n 's|postgresql://[^:]*:\([^@]*\)@.*|\1|p')

BACKUP_DIR="/backups"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="${BACKUP_DIR}/pre_migration_${TIMESTAMP}.sql"

echo "[pre-migration-backup] Starting backup of ${DB_NAME} at ${DB_HOST}:${DB_PORT}..."
mkdir -p "$BACKUP_DIR"

PGPASSWORD="$DB_PASS" pg_dump \
  -h "$DB_HOST" \
  -p "${DB_PORT:-5432}" \
  -U "$DB_USER" \
  -d "$DB_NAME" \
  --clean \
  --if-exists \
  -f "$BACKUP_FILE" \
  2>&1

if [ $? -eq 0 ]; then
  SIZE=$(du -h "$BACKUP_FILE" | cut -f1)
  echo "[pre-migration-backup] Backup completed: ${BACKUP_FILE} (${SIZE})"
else
  echo "[pre-migration-backup] WARNING: Backup failed! Proceeding with migration anyway."
  echo "[pre-migration-backup] Consider taking a manual backup before deploying."
fi

# Keep only the 5 most recent backups to prevent unbounded disk usage
ls -t "${BACKUP_DIR}"/pre_migration_*.sql 2>/dev/null | tail -n +6 | xargs -r rm --
echo "[pre-migration-backup] Old backups pruned (keeping latest 5)."