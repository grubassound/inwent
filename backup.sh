#!/usr/bin/env bash
# Kopia bazy Rack Inventory: zrzut SQL do katalogu backups/, trzyma ostatnie 30 plików.
# Cron (codziennie o 2:15):  15 2 * * * bash /opt/rack-inventory/backup.sh >/dev/null 2>&1
set -euo pipefail
cd "$(dirname "$0")"
set -a; source .env; set +a
mkdir -p backups
FILE="backups/rack_$(date +%F_%H%M).sql.gz"
MYSQL_PWD="$DB_PASSWORD" mysqldump --single-transaction --no-tablespaces \
  -h "${DB_HOST:-localhost}" -P "${DB_PORT:-3306}" -u "$DB_USER" "$DB_NAME" | gzip > "$FILE"
ls -1t backups/rack_*.sql.gz | tail -n +31 | xargs -r rm --
echo "Zapisano $FILE"
