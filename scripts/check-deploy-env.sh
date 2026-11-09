#!/usr/bin/env bash
# Refuses a deploy env file that would point at a local machine or reuse the local dev secrets,
# and one that shares its project name with the other environment (they would overwrite each other).
# Usage: scripts/check-deploy-env.sh deploy/<env>.env
set -euo pipefail

FILE="${1:?usage: scripts/check-deploy-env.sh deploy/<env>.env}"
[ -f "$FILE" ] || { echo "$FILE not found: copy $FILE.example and fill it in" >&2; exit 1; }

get() { sed -n "s/^$1=//p" "$2" | tail -1; }
fail=0
err() { echo "$FILE: $*" >&2; fail=1; }

for key in COMPOSE_PROJECT_NAME COMPOSE_FILE COMPOSE_PROFILES PUBLIC_API_URL CORS_ORIGINS DB_PASSWORD JWT_SECRET; do
  [ -n "$(get "$key" "$FILE")" ] || err "$key is empty"
done

# Only the API URL matters: it is baked into the frontends, and every browser would call its own computer.
# A localhost entry in CORS_ORIGINS just lets a page opened on the server itself through.
if get PUBLIC_API_URL "$FILE" | grep -qiE 'localhost|127\.0\.0\.1|0\.0\.0\.0'; then
  err "PUBLIC_API_URL points at a local machine; browsers would call their own computer"
fi

[ "$(get DB_PASSWORD "$FILE")" != password ] || err "DB_PASSWORD is the local dev password"
jwt="$(get JWT_SECRET "$FILE")"
[ "$jwt" != swiftquote-dev-only-jwt-secret-change-me ] || err "JWT_SECRET is the local dev secret"
[ "${#jwt}" -ge 32 ] || err "JWT_SECRET must be at least 32 characters (HS256)"

# The other environment's file, if it is on this host too.
for other in "$(dirname "$FILE")"/*.env; do
  [ "$other" != "$FILE" ] && [ -f "$other" ] || continue
  name="$(get COMPOSE_PROJECT_NAME "$FILE")"
  [ "$name" != "$(get COMPOSE_PROJECT_NAME "$other")" ] || err "COMPOSE_PROJECT_NAME $name is also used by $other"
  [ "$jwt" != "$(get JWT_SECRET "$other")" ] || err "JWT_SECRET is also used by $other"
done

exit "$fail"
