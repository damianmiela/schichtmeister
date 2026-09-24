#!/bin/bash
# Nightly demo reset: puts the database back to the anonymized snapshot, so every
# visitor starts from the same demo data, whatever the previous visitor changed.
#
# The snapshot is restored and migrated into a spare database first. The live one is
# only swapped out once that worked, so a failed night leaves yesterday's demo running.
#
# One-time setup on the server, after deploy/demo-anonymize.sql has run:
#   cd /srv/schichtmeister && set -a && source .env && set +a
#   docker exec schichtmeister-postgres pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" > /srv/schichtmeister-demo-snapshot.sql
#   crontab -e, then add this line (every night at 03:30 server time):
#   30 3 * * * bash /srv/schichtmeister/deploy/demo-reset.sh >> /var/log/schichtmeister-demo-reset.log 2>&1
set -eo pipefail

APP_DIR="/srv/schichtmeister"
SNAPSHOT="/srv/schichtmeister-demo-snapshot.sql"
APP_CONTAINER="schichtmeister-app"
DB_CONTAINER="schichtmeister-postgres"
NETWORK="schichtmeister_network"

echo ">>> Demo reset start: $(date)"
# pg_dump ends every complete dump with this line; a cut-off file must never replace the demo.
tail -n 5 "$SNAPSHOT" 2>/dev/null | grep -q "PostgreSQL database dump complete" \
  || { echo "Snapshot $SNAPSHOT is missing or incomplete, nothing changed"; exit 1; }

cd "$APP_DIR"
set -a
# shellcheck disable=SC1091
source .env
set +a
NEXT_DB="${POSTGRES_DB}_next"
pg() { local tool=$1; shift; docker exec -i "$DB_CONTAINER" "$tool" -U "$POSTGRES_USER" "$@"; }

# 1. Build tonight's demo next to the live one.
pg dropdb --if-exists "$NEXT_DB"
pg createdb "$NEXT_DB"
pg psql -q -v ON_ERROR_STOP=1 -d "$NEXT_DB" < "$SNAPSHOT" >/dev/null
# Migrations deployed after the snapshot was taken (same command as deploy/post-receive).
docker run --rm --network "$NETWORK" -v "${APP_DIR}/prisma:/prisma" -w /prisma \
  -e DATABASE_URL="postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@${DB_CONTAINER}:5432/${NEXT_DB}" \
  node:22-alpine \
  sh -lc 'apk add --no-cache openssl libc6-compat >/dev/null && npx -y prisma@5.22.0 migrate deploy --schema=./schema.prisma'

# 2. Swap it in. Only this takes the app offline, for a few seconds.
docker stop "$APP_CONTAINER" >/dev/null
trap 'docker start "$APP_CONTAINER" >/dev/null' EXIT # the app comes back even if the swap fails
pg dropdb --force "$POSTGRES_DB"
pg psql -q -v ON_ERROR_STOP=1 -d postgres -c "ALTER DATABASE \"$NEXT_DB\" RENAME TO \"$POSTGRES_DB\""

echo ">>> Demo reset done: $(date)"
