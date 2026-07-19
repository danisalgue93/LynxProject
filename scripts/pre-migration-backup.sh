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

# A failed backup MUST stop the deployment: `set -eu` above aborts this script,
# and docker-compose runs it as `pre-migration-backup.sh && prisma migrate deploy`,
# so a non-zero exit here means the migration never runs. That is the intended
# safety property — never migrate a database you have no restore point for.
#
# This block previously read:
#     pg_dump ...
#     if [ $? -eq 0 ]; then ... else
#       echo "WARNING: Backup failed! Proceeding with migration anyway."
#     fi
# which was both dead and wrong: under `set -e` the script exits on the pg_dump
# line itself, so the else branch was unreachable and the migration was already
# being blocked. The only thing it achieved was telling whoever read this script
# that a failed backup is survivable. It is not.
if ! PGPASSWORD="$DB_PASS" pg_dump \
  -h "$DB_HOST" \
  -p "${DB_PORT:-5432}" \
  -U "$DB_USER" \
  -d "$DB_NAME" \
  --clean \
  --if-exists \
  -f "$BACKUP_FILE" 2>&1
then
  echo "[pre-migration-backup] FATAL: pg_dump failed — refusing to migrate without a backup." >&2
  echo "[pre-migration-backup] Take a manual backup, confirm it restores, then re-run the deploy." >&2
  exit 1
fi

# Guard against pg_dump exiting 0 with an empty/truncated file (e.g. disk full).
if [ ! -s "$BACKUP_FILE" ]; then
  echo "[pre-migration-backup] FATAL: backup file ${BACKUP_FILE} is empty — refusing to migrate." >&2
  exit 1
fi

SIZE=$(du -h "$BACKUP_FILE" | cut -f1)
echo "[pre-migration-backup] Backup completed: ${BACKUP_FILE} (${SIZE})"

# Keep only the 5 most recent backups to prevent unbounded disk usage
ls -t "${BACKUP_DIR}"/pre_migration_*.sql 2>/dev/null | tail -n +6 | xargs -r rm --
echo "[pre-migration-backup] Old backups pruned (keeping latest 5)."