#!/usr/bin/env bash
# 業務DBの日次バックアップ（VPSのcronから実行する）
# 例（毎日3時）: 0 3 * * * /opt/chem/scripts/backup-db.sh >> /var/log/chem-backup.log 2>&1
#
# 復元例:
#   gunzip -c /var/backups/chem/chem_YYYYMMDD_HHMMSS.sql.gz | \
#     docker compose -f compose.prod.yml --env-file .env.prod exec -T db psql -U chem chem
set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/chem}"
KEEP_DAYS="${KEEP_DAYS:-14}"
COMPOSE="docker compose -f $REPO_DIR/compose.prod.yml --env-file $REPO_DIR/.env.prod"

mkdir -p "$BACKUP_DIR"
STAMP=$(date +%Y%m%d_%H%M%S)
FILE="$BACKUP_DIR/chem_$STAMP.sql.gz"

$COMPOSE exec -T db pg_dump -U chem chem | gzip > "$FILE"
find "$BACKUP_DIR" -name 'chem_*.sql.gz' -mtime +"$KEEP_DAYS" -delete
echo "backup done: $FILE ($(du -h "$FILE" | cut -f1))"

# ── オフサイト保管（強く推奨）────────────────────────────
# rclone を設定（例: Backblaze B2 / Cloudflare R2）したら以下を有効化:
# rclone copy "$FILE" remote:chem-backups/
