#!/usr/bin/env bash
# End-to-end smoke test against a running backend (Go or Spring):
# login -> create quote -> list -> public view -> accept.
# Usage: scripts/smoke.sh [base_url]   (default http://localhost:8080/api/v1)
set -euo pipefail

BASE="${1:-http://localhost:8080/api/v1}"
JSON='Content-Type: application/json'

step() { printf '\n\033[1m== %s\033[0m\n' "$*"; }
field() { python3 -c "import sys, json; print(json.load(sys.stdin)['$1'])"; }

step "Waiting for ${BASE%/api/v1}/healthz"
curl -sf --retry 30 --retry-all-errors --retry-delay 1 "${BASE%/api/v1}/healthz"; echo

step "POST /auth/login"
LOGIN=$(curl -sf -X POST "$BASE/auth/login" -H "$JSON" \
  -d '{"email":"demo@swiftquote.dev","password":"password"}')
echo "$LOGIN"
TOKEN=$(echo "$LOGIN" | field accessToken)

step "POST /quotes"
NUMBER="SMOKE-$(date +%s)"
EXPIRY=$(python3 -c 'import datetime; print(datetime.date.today() + datetime.timedelta(days=30))')
QUOTE=$(curl -sf -X POST "$BASE/quotes" -H "$JSON" -H "Authorization: Bearer $TOKEN" -d @- <<EOF
{
  "clientId": "00000000-0000-4000-8000-000000000003",
  "quoteNumber": "$NUMBER",
  "expiryDate": "$EXPIRY",
  "items": [
    {"title": "Website redesign", "quantity": 1, "unitPrice": 45000, "discountPercent": 5},
    {"title": "Hosting (months)", "quantity": 12, "unitPrice": 350}
  ]
}
EOF
)
echo "$QUOTE"
ACCESS=$(echo "$QUOTE" | field accessToken)
GRAND=$(echo "$QUOTE" | field grandTotal)
[ "$GRAND" = "50236.5" ] || { echo "unexpected grandTotal $GRAND, want 50236.50"; exit 1; }

step "GET /quotes"
curl -sf "$BASE/quotes" -H "Authorization: Bearer $TOKEN"; echo

step "GET /public/quotes/$ACCESS"
curl -sf "$BASE/public/quotes/$ACCESS"; echo

step "POST /public/quotes/$ACCESS/accept"
curl -sf -X POST "$BASE/public/quotes/$ACCESS/accept" -H "$JSON" \
  -d '{"signerName":"Smoke Tester","signatureDataUrl":"data:image/png;base64,AA"}'; echo

step "Second accept must be 409"
STATUS=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/public/quotes/$ACCESS/accept" -H "$JSON" \
  -d '{"signerName":"Smoke Tester","signatureDataUrl":"data:image/png;base64,AA"}')
[ "$STATUS" = "409" ] || { echo "got $STATUS"; exit 1; }
echo 409

printf '\n\033[32mSmoke test passed\033[0m\n'
