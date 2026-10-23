#!/usr/bin/env bash
# Kopia bazy Rack Inventory: zrzut SQL do katalogu backups/, trzyma ostatnie 30 plików.
# Cron (codziennie o 2:15):  15 2 * * * bash /opt/rack-inventory/backup.sh >/dev/null 2>&1
set -euo pipefail
cd "$(dirname "$0")"
umask 077   # zrzut zawiera całą bazę, więc tylko dla właściciela

# .env czytamy tym samym parserem co aplikacja (dotenv), zamiast wykonywać go jako skrypt powłoki.
env_get(){ node -e 'require("dotenv").config({ path: ".env", quiet: true }); process.stdout.write(process.env[process.argv[1]] || "")' "$1"; }
DB_HOST="$(env_get DB_HOST)"
DB_PORT="$(env_get DB_PORT)"
DB_NAME="$(env_get DB_NAME)"
DB_USER="$(env_get DB_USER)"
DB_PASSWORD="$(env_get DB_PASSWORD)"
DB_SOCKET="$(env_get DB_SOCKET)"

CONN=(-u "${DB_USER:-rack}")
if [[ -n "$DB_SOCKET" ]]; then CONN+=(--socket="$DB_SOCKET"); else CONN+=(-h "${DB_HOST:-localhost}" -P "${DB_PORT:-3306}"); fi

mkdir -p backups
chmod 700 backups
FILE="backups/rack_$(date +%F_%H%M).sql.gz"
TMP="$FILE.part"
trap 'rm -f "$TMP"' EXIT
MYSQL_PWD="$DB_PASSWORD" mysqldump --single-transaction --no-tablespaces "${CONN[@]}" "${DB_NAME:-rack_inventory}" | gzip > "$TMP"
mv "$TMP" "$FILE"
chmod 600 backups/rack_*.sql.gz
ls -1t backups/rack_*.sql.gz | tail -n +31 | xargs -r rm --
echo "Zapisano $FILE"
