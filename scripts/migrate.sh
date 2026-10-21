#!/usr/bin/env bash
# Apply SQL migrations in order against a running Postgres (docker compose service "postgres")
set -euo pipefail
for f in $(ls db/migrations/V*.sql | sort -V); do
  echo "Applying $f"
  docker compose exec -T postgres psql -U postgres -d swiftquote < "$f"
done
