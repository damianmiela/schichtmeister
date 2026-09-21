#!/bin/bash
# Nightly demo reset: puts the database back to the anonymized snapshot, so every
# visitor starts from the same demo data, whatever the previous visitor changed.
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
[[ -s "$SNAPSHOT" ]] || { echo "Snapshot $SNAPSHOT is missing or empty, nothing changed"; exit 1; }

cd "$APP_DIR"
set -a
# shellcheck disable=SC1091
source .env
set +a
export DATABASE_URL="${DATABASE_URL:-postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@${DB_CONTAINER}:5432/${POSTGRES_DB}}"

docker stop "$APP_CONTAINER" >/dev/null
trap 'docker start "$APP_CONTAINER" >/dev/null' EXIT # the app comes back even if a step fails

docker exec "$DB_CONTAINER" dropdb -U "$POSTGRES_USER" --force "$POSTGRES_DB"
docker exec "$DB_CONTAINER" createdb -U "$POSTGRES_USER" "$POSTGRES_DB"
docker exec -i "$DB_CONTAINER" psql -q -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" < "$SNAPSHOT" >/dev/null

# Migrations deployed after the snapshot was taken (same command as deploy/post-receive).
docker run --rm --network "$NETWORK" -v "${APP_DIR}/prisma:/prisma" -w /prisma -e DATABASE_URL node:20-alpine \
  sh -lc 'apk add --no-cache openssl libc6-compat >/dev/null && npx -y prisma@5.22.0 migrate deploy --schema=./schema.prisma'

echo ">>> Demo reset done: $(date)"
