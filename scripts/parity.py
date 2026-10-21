#!/usr/bin/env python3
"""Contract parity check: run the same request script against two backends and diff the responses.

Usage: scripts/parity.py http://localhost:8080/api/v1 http://localhost:8081/api/v1

Both backends may share one database. Each run creates its own quotes (numbers prefixed per backend),
and responses are normalised before comparison:
  - random UUIDs become <uuid1>, <uuid2>, ... in order of appearance (fixed demo IDs are kept)
  - JWTs become <jwt>, timestamps become <timestamp>
  - the per-backend quote number prefix is removed
  - money keeps its exact text (201.50 vs 201.5 is a difference)
Exit code 1 if any step differs.
"""
import json
import re
import secrets
import sys
import time
import urllib.error
import urllib.request
from datetime import date, timedelta

DEMO_IDS = {
    "00000000-0000-4000-8000-000000000001",
    "00000000-0000-4000-8000-000000000002",
    "00000000-0000-4000-8000-000000000003",
}
UUID_RE = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")
JWT_RE = re.compile(r"^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$")
TIMESTAMP_RE = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$")


def request(base, method, path, token=None, body=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(base + path, data=data, method=method)
    req.add_header("Content-Type", "application/json")
    if token:
        req.add_header("Authorization", "Bearer " + token)
    try:
        with urllib.request.urlopen(req) as res:
            status, raw = res.status, res.read()
    except urllib.error.HTTPError as err:
        status, raw = err.code, err.read()
    # parse_float=str keeps money formatting ("201.50") so rendering differences are caught.
    return status, json.loads(raw, parse_float=str) if raw else None


class Normaliser:
    def __init__(self, prefix):
        self.prefix = prefix
        self.uuids = {}

    def __call__(self, value):
        if isinstance(value, dict):
            return {k: self(v) for k, v in value.items()}
        if isinstance(value, list):
            return [self(v) for v in value]
        if isinstance(value, str):
            if UUID_RE.match(value) and value not in DEMO_IDS:
                return self.uuids.setdefault(value, f"<uuid{len(self.uuids) + 1}>")
            if TIMESTAMP_RE.match(value):
                return "<timestamp>"
            if JWT_RE.match(value) and value.count(".") == 2 and len(value) > 40:
                return "<jwt>"
            return value.replace(self.prefix, "")
        return value


def scenario(base, prefix):
    """Yields (step name, status, body). The same steps run against each backend."""
    expiry = (date.today() + timedelta(days=30)).isoformat()
    login = {"email": "demo@swiftquote.dev", "password": "password"}

    def quote(number, **overrides):
        body = {
            "clientId": "00000000-0000-4000-8000-000000000003",
            "quoteNumber": prefix + number,
            "expiryDate": expiry,
            "items": [
                {"title": "Consulting", "quantity": 2, "unitPrice": 100, "discountPercent": 10},
                {"title": "Setup fee", "quantity": 1, "unitPrice": 1.5},
                {"title": "Rounding probe", "quantity": 3, "unitPrice": 33.33, "discountPercent": 15, "taxPercent": 7},
            ],
        }
        body.update(overrides)
        return body

    status, auth = request(base, "POST", "/auth/login", body=login)
    yield "login", status, auth
    token = auth["accessToken"]

    yield ("login wrong password", *request(base, "POST", "/auth/login", body={**login, "password": "nope"}))
    yield ("clients", *request(base, "GET", "/clients", token))

    status, created = request(base, "POST", "/quotes", token, quote("Q-1"))
    yield "create quote", status, created
    qid, access = created["id"], created["accessToken"]

    yield ("get quote", *request(base, "GET", f"/quotes/{qid}", token))
    status, rows = request(base, "GET", "/quotes", token)
    yield "list quotes (this run)", status, [r for r in rows if r["quoteNumber"].startswith(prefix)]
    yield ("list invalid status", *request(base, "GET", "/quotes?status=bogus", token))
    yield ("duplicate number", *request(base, "POST", "/quotes", token, quote("Q-1")))
    yield ("no items", *request(base, "POST", "/quotes", token, quote("Q-2", items=[])))
    yield ("past expiry", *request(base, "POST", "/quotes", token, quote("Q-2", expiryDate="2000-01-01")))
    yield ("missing fields", *request(base, "POST", "/quotes", token, {"quoteNumber": " ", "items": [{"title": ""}]}))
    yield ("invalid item values", *request(base, "POST", "/quotes", token, quote("Q-2", items=[
        {"title": "x", "quantity": 0.5, "unitPrice": -1, "discountPercent": 101}])))
    status, body = request(base, "POST", "/quotes", token, quote("Q-2", expiryDate="01/01/2099"))
    # Parser error text is library-specific; compare everything but the details.
    yield "bad date format", status, {k: v for k, v in (body or {}).items() if k != "details"}
    yield ("unknown quote id", *request(base, "GET", "/quotes/00000000-0000-4000-8000-0000000000ff", token))
    yield ("malformed quote id", *request(base, "GET", "/quotes/nope", token))
    yield ("no token", *request(base, "GET", "/quotes"))
    yield ("bad token", *request(base, "GET", "/quotes", "garbage"))
    yield ("unknown route", *request(base, "GET", "/nope"))

    yield ("public view", *request(base, "GET", f"/public/quotes/{access}"))
    yield ("public malformed token", *request(base, "GET", "/public/quotes/nope"))
    yield ("accept missing signature", *request(base, "POST", f"/public/quotes/{access}/accept", body={"signerName": " "}))
    sign = {"signerName": "Jane Buyer", "signatureDataUrl": "data:image/png;base64,AAAA"}
    yield ("accept", *request(base, "POST", f"/public/quotes/{access}/accept", body=sign))
    yield ("accept again", *request(base, "POST", f"/public/quotes/{access}/accept", body=sign))
    yield ("public view after accept", *request(base, "GET", f"/public/quotes/{access}"))


def main():
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    a_base, b_base = sys.argv[1].rstrip("/"), sys.argv[2].rstrip("/")
    # Unique per invocation: several parity runs may hit the same database within one second.
    run = f"{int(time.time())}{secrets.token_hex(2)}"
    a_prefix, b_prefix = f"PA{run}-", f"PB{run}-"
    a_norm, b_norm = Normaliser(a_prefix), Normaliser(b_prefix)

    failures = 0
    steps = zip(scenario(a_base, a_prefix), scenario(b_base, b_prefix))
    for (name, a_status, a_body), (_, b_status, b_body) in steps:
        a = {"status": a_status, "body": a_norm(a_body)}
        b = {"status": b_status, "body": b_norm(b_body)}
        if a == b:
            print(f"  ok    {name}")
            continue
        failures += 1
        print(f"  DIFF  {name}")
        print(f"        A {a_base}: {json.dumps(a, sort_keys=True)}")
        print(f"        B {b_base}: {json.dumps(b, sort_keys=True)}")

    print(f"\n{'PARITY OK' if failures == 0 else f'{failures} step(s) differ'}")
    sys.exit(1 if failures else 0)


if __name__ == "__main__":
    main()
