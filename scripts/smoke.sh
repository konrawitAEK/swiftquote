#!/usr/bin/env bash
# End-to-end smoke test of the approval workflow against a running backend (Go, Spring or Node):
# RM creates (products, amount discount) -> submits -> WO approves -> RM sends -> customer downloads the PDF,
# opens the link and signs.
# Usage: scripts/smoke.sh [base_url]   (default http://localhost:8080/api/v1)
set -euo pipefail

BASE="${1:-http://localhost:8080/api/v1}"
JSON='Content-Type: application/json'

step() { printf '\n\033[1m== %s\033[0m\n' "$*"; }
field() { python3 -c "import sys, json; print(json.load(sys.stdin)['$1'])"; }
login() {
  curl -sf -X POST "$BASE/auth/login" -H "$JSON" -d "{\"email\":\"$1\",\"password\":\"password\"}" | field accessToken
}
action() { # token, quote id, action
  curl -sf -X POST "$BASE/quotes/$2/$3" -H "$JSON" -H "Authorization: Bearer $1" -d '{}' | field status
}

step "Waiting for ${BASE%/api/v1}/healthz"
curl -sf --retry 30 --retry-all-errors --retry-delay 1 "${BASE%/api/v1}/healthz"; echo

RM=$(login rm1@swiftquote.dev)
WO=$(login wo@swiftquote.dev)

step "RM creates a draft"
NUMBER="SMOKE-$(date +%s)-$RANDOM"
EXPIRY=$(python3 -c 'import datetime; print(datetime.date.today() + datetime.timedelta(days=30))')
QUOTE=$(curl -sf -X POST "$BASE/quotes" -H "$JSON" -H "Authorization: Bearer $RM" -d @- <<EOF
{
  "clientId": "00000000-0000-4000-8000-000000000003",
  "quoteNumber": "$NUMBER",
  "expiryDate": "$EXPIRY",
  "items": [
    {"productId": "00000000-0000-4000-8000-000000000042", "quantity": 1,
     "discountType": "amount", "discountValue": 2250},
    {"productId": "00000000-0000-4000-8000-000000000041", "quantity": 12}
  ]
}
EOF
)
ID=$(echo "$QUOTE" | field id)
ACCESS=$(echo "$QUOTE" | field accessToken)
GRAND=$(echo "$QUOTE" | field grandTotal)
[ "$GRAND" = "50236.5" ] || { echo "unexpected grandTotal $GRAND, want 50236.50"; exit 1; }
echo "$NUMBER draft, grand total $GRAND"

step "Share link is closed until the quote is sent"
STATUS=$(curl -s -o /dev/null -w '%{http_code}' "$BASE/public/quotes/$ACCESS")
[ "$STATUS" = "404" ] || { echo "got $STATUS"; exit 1; }
echo 404

step "RM submits, WO approves, RM sends"
echo "submit  -> $(action "$RM" "$ID" submit)"
echo "approve -> $(action "$WO" "$ID" approve)"
echo "send    -> $(action "$RM" "$ID" send)"

step "Customer downloads the PDF"
CT=$(curl -sf -o /tmp/swiftquote-smoke.pdf -w '%{content_type}' "$BASE/public/quotes/$ACCESS/pdf")
[ "$CT" = "application/pdf" ] && [ "$(head -c 5 /tmp/swiftquote-smoke.pdf)" = "%PDF-" ] || { echo "got $CT"; exit 1; }
echo "PDF $(wc -c < /tmp/swiftquote-smoke.pdf | tr -d ' ') bytes"; rm -f /tmp/swiftquote-smoke.pdf

step "Customer opens the link"
curl -sf "$BASE/public/quotes/$ACCESS" | field status

step "Customer signs"
curl -sf -X POST "$BASE/public/quotes/$ACCESS/accept" -H "$JSON" \
  -d '{"signerName":"Smoke Tester","signatureDataUrl":"data:image/png;base64,AA"}' | field status

step "Second accept must be 409"
STATUS=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/public/quotes/$ACCESS/accept" -H "$JSON" \
  -d '{"signerName":"Smoke Tester","signatureDataUrl":"data:image/png;base64,AA"}')
[ "$STATUS" = "409" ] || { echo "got $STATUS"; exit 1; }
echo 409

printf '\n\033[32mSmoke test passed\033[0m\n'
