#!/usr/bin/env bash
# Rough throughput comparison of the backends with ApacheBench (ab, ships with macOS).
# Backends run one at a time, each warmed up first (JIT for Spring/Node), against the same database.
# Usage: scripts/bench.sh [name:port ...]   (default go:8080 spring:8081 node:8082)
#   N=3000 C=20 scripts/bench.sh            requests per endpoint / concurrency
# Numbers are for comparing on one machine, not capacity planning: client, DB and backends share the CPU.
set -uo pipefail

N=${N:-3000}
C=${C:-20}
LOGIN_N=${LOGIN_N:-200}
TARGETS=("$@")
[ ${#TARGETS[@]} -eq 0 ] && TARGETS=(go:8080 spring:8081 node:8082)
ENDPOINTS=(/healthz /api/v1/quotes /api/v1/dashboard/summary)

command -v ab >/dev/null || { echo "ab (ApacheBench) not found; install apache2-utils / httpd-tools"; exit 1; }
BODY=$(mktemp)
trap 'rm -f "$BODY"' EXIT
echo '{"email":"woc@swiftquote.dev","password":"password"}' > "$BODY"

# ab prints "Requests per second:    1234.56 [#/sec] (mean)" and a percentile table ("  50%      3").
stat() { awk -v k="$2" '$0 ~ k {print $'"$3"'; exit}' <<<"$1"; }
row() { printf "%-8s %-28s %10s req/s   p50 %4s ms   p99 %4s ms   %s\n" "$@"; }

echo "N=$N requests per endpoint, C=$C concurrent (login: N=$LOGIN_N, C=10)"
for target in "${TARGETS[@]}"; do
  name=${target%%:*}
  base="http://127.0.0.1:${target##*:}"
  # 127.0.0.1, not localhost: ab tries IPv6 first and some backends listen on IPv4 only.
  if ! curl -sf --retry 30 --retry-all-errors --retry-delay 1 "$base/healthz" >/dev/null; then
    echo "$name: $base/healthz not reachable, skipped"
    continue
  fi
  token=$(curl -s -X POST "$base/api/v1/auth/login" -H 'Content-Type: application/json' -d @"$BODY" |
    python3 -c 'import sys, json; print(json.load(sys.stdin)["accessToken"])')
  auth="Authorization: Bearer $token"

  for path in "${ENDPOINTS[@]}"; do
    ab -q -k -n 2000 -c "$C" -H "$auth" "$base$path" >/dev/null 2>&1
  done
  echo
  for path in "${ENDPOINTS[@]}"; do
    out=$(ab -q -k -n "$N" -c "$C" -H "$auth" "$base$path" 2>&1)
    failed=$(stat "$out" "Failed requests" 3)
    non2xx=$(stat "$out" "Non-2xx" 3)
    errors=$(( ${failed:-0} + ${non2xx:-0} ))
    row "$name" "GET $path" "$(stat "$out" "Requests per second" 4)" "$(stat "$out" " 50%" 2)" "$(stat "$out" " 99%" 2)" \
      "$([ "$errors" -gt 0 ] && echo "ERRORS $errors")"
  done
  out=$(ab -q -n "$LOGIN_N" -c 10 -p "$BODY" -T application/json "$base/api/v1/auth/login" 2>&1)
  row "$name" "POST /auth/login (bcrypt)" "$(stat "$out" "Requests per second" 4)" "$(stat "$out" " 50%" 2)" "$(stat "$out" " 99%" 2)" ""
  mem=$(docker stats --no-stream --format '{{.MemUsage}}' "swiftquote-backend-$name" 2>/dev/null | cut -d/ -f1)
  [ -n "$mem" ] && echo "$name memory: $mem"
done
