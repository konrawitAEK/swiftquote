#!/usr/bin/env python3
"""Contract parity check: run the same request script against two backends and diff the responses.

Usage: scripts/parity.py http://localhost:8080/api/v1 http://localhost:8081/api/v1

Both backends may share one database. Each run creates its own quotes, users, teams and categories
(names prefixed per backend), and responses are normalised before comparison:
  - random UUIDs become <uuid1>, <uuid2>, ... in order of appearance (seeded IDs are kept)
  - JWTs become <jwt>, timestamps become <timestamp>
  - the per-backend prefix is removed
  - money keeps its exact text (201.50 vs 201.5 is a difference)
  - lists of shared rows keep only the seed data and this run's own rows
Once both scenarios finish, the shared views (dashboard, admin lists) are read from both backends at
the same moment and must match exactly. Exit code 1 if any step differs.
"""
import json
import re
import secrets
import sys
import time
import urllib.error
import urllib.request
from datetime import date, timedelta

SEED_ID_RE = re.compile(r"^00000000-0000-4000-8000-0000000000[0-9a-f]{2}$")
UUID_RE = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")
JWT_RE = re.compile(r"^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$")
TIMESTAMP_RE = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$")

ACME = "00000000-0000-4000-8000-000000000003"
TEAM_ALPHA = "00000000-0000-4000-8000-000000000020"
WO2 = "00000000-0000-4000-8000-000000000014"
SOFTWARE, SERVICES, HARDWARE = (f"00000000-0000-4000-8000-0000000000{n}" for n in (30, 31, 32))
SIGNATURE = {"signerName": "Jane Buyer", "signatureDataUrl": "data:image/png;base64,AAAA"}


def request(base, method, path, token=None, body=None, raw=None):
    data = raw if raw is not None else json.dumps(body).encode() if body is not None else None
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
    def __init__(self, prefix=""):
        self.prefixes = [prefix, prefix.lower()] if prefix else []
        self.uuids = {}

    def __call__(self, value):
        if isinstance(value, dict):
            return {k: self(v) for k, v in value.items()}
        if isinstance(value, list):
            return [self(v) for v in value]
        if isinstance(value, str):
            if UUID_RE.match(value) and not SEED_ID_RE.match(value):
                return self.uuids.setdefault(value, f"<uuid{len(self.uuids) + 1}>")
            if TIMESTAMP_RE.match(value):
                return "<timestamp>"
            if JWT_RE.match(value) and len(value) > 40:
                return "<jwt>"
            for p in self.prefixes:
                value = value.replace(p, "")
            return value
        return value


def without_details(result):
    """Parser error text is library-specific; compare everything but the details."""
    status, body = result
    return status, {k: v for k, v in (body or {}).items() if k != "details"}


def scenario(base, prefix):
    """Yields (step name, status, body). The same steps run against each backend."""
    expiry = (date.today() + timedelta(days=30)).isoformat()
    lower = prefix.lower()

    def mine(rows, key):
        """Seed rows plus this run's own rows; drops rows other runs created in the shared database."""
        return [r for r in rows if SEED_ID_RE.match(r["id"]) or key(r).startswith((prefix, lower))]

    def quote(number, **overrides):
        body = {
            "clientId": ACME,
            "quoteNumber": prefix + number,
            "expiryDate": expiry,
            "notes": "Parity run",
            "items": [
                {"title": "Consulting", "categoryId": SERVICES, "quantity": 2, "unitPrice": 100, "discountPercent": 10},
                {"title": "Setup fee", "categoryId": SOFTWARE, "quantity": 1, "unitPrice": 1.5},
                {"title": "Rounding probe", "categoryId": HARDWARE, "quantity": 3, "unitPrice": 33.33,
                 "discountPercent": 15, "taxPercent": 7},
            ],
        }
        body.update(overrides)
        return body

    tokens = {}
    for who in ("demo", "woc", "wo", "wo2", "rm1", "rm3"):
        status, auth = request(base, "POST", "/auth/login", body={"email": f"{who}@swiftquote.dev", "password": "password"})
        tokens[who] = auth and auth.get("accessToken")
        yield f"login {who}", status, auth
    for who in ("acme", "globex"):
        status, auth = request(base, "POST", "/auth/login", body={"email": f"buyer@{who}.example", "password": "password"})
        tokens[who] = auth and auth.get("accessToken")
        yield f"login {who}", status, auth
    admin, woc, wo, wo2, rm, rm3, acme, globex = (tokens[k] for k in ("demo", "woc", "wo", "wo2", "rm1", "rm3", "acme", "globex"))

    yield ("login wrong password", *request(base, "POST", "/auth/login", body={"email": "rm1@swiftquote.dev", "password": "nope"}))
    yield ("login unknown email", *request(base, "POST", "/auth/login", body={"email": "x@y.z", "password": "password"}))
    yield ("no token", *request(base, "GET", "/quotes"))
    yield ("bad token", *request(base, "GET", "/quotes", "garbage"))
    yield ("unknown route", *request(base, "GET", "/nope"))

    # Reference data.
    yield ("clients as rm", *request(base, "GET", "/clients", rm))
    yield ("clients as wo", *request(base, "GET", "/clients", wo))
    status, rows = request(base, "GET", "/categories", rm)
    yield "categories as rm", status, mine(rows or [], lambda r: r["name"])
    yield ("categories as customer", *request(base, "GET", "/categories", acme))
    status, retired = request(base, "POST", "/admin/categories", admin, {"name": prefix + "Retired"})
    yield "admin creates category", status, retired
    yield ("category duplicate name", *request(base, "POST", "/admin/categories", admin, {"name": prefix + "Retired"}))
    yield ("category blank name", *request(base, "POST", "/admin/categories", admin, {"name": " "}))
    yield ("category as rm", *request(base, "POST", "/admin/categories", rm, {"name": prefix + "Nope"}))
    yield ("category retire", *request(base, "PUT", f"/admin/categories/{retired['id']}", admin, {"name": prefix + "Retired", "active": False}))
    yield ("category update without active", *request(base, "PUT", f"/admin/categories/{retired['id']}", admin, {"name": prefix + "Retired"}))
    yield ("category unknown id", *request(base, "PUT", "/admin/categories/00000000-0000-4000-8000-0000000000ff", admin, {"name": "x", "active": True}))

    # Create and validation.
    status, created = request(base, "POST", "/quotes", rm, quote("Q-1"))
    yield "rm creates quote", status, created
    qid, access = created["id"], created["accessToken"]
    yield ("wo cannot create", *request(base, "POST", "/quotes", wo, quote("Q-WO")))
    yield ("customer cannot create", *request(base, "POST", "/quotes", acme, quote("Q-C")))
    yield ("duplicate number", *request(base, "POST", "/quotes", rm, quote("Q-1")))
    yield ("no items", *request(base, "POST", "/quotes", rm, quote("Q-2", items=[])))
    yield ("past expiry", *request(base, "POST", "/quotes", rm, quote("Q-2", expiryDate="2000-01-01")))
    yield ("missing fields", *request(base, "POST", "/quotes", rm, {"quoteNumber": " ", "items": [{"title": ""}]}))
    yield ("invalid item values", *request(base, "POST", "/quotes", rm, quote("Q-2", items=[
        {"title": "x", "categoryId": SOFTWARE, "quantity": 0.5, "unitPrice": -1, "discountPercent": 101}])))
    yield ("retired category", *request(base, "POST", "/quotes", rm, quote("Q-2", items=[
        {"title": "x", "categoryId": retired["id"], "quantity": 1, "unitPrice": 1}])))
    yield ("unknown client", *request(base, "POST", "/quotes", rm, quote("Q-2", clientId="00000000-0000-4000-8000-0000000000ff")))
    yield ("bad date format", *without_details(request(base, "POST", "/quotes", rm, quote("Q-2", expiryDate="01/01/2099"))))
    yield ("malformed json", *without_details(request(base, "POST", "/quotes", rm, raw=b"{nope")))

    # Visibility before sending.
    yield ("rm gets own quote", *request(base, "GET", f"/quotes/{qid}", rm))
    yield ("wo sees team quote", *request(base, "GET", f"/quotes/{qid}", wo))
    yield ("woc sees any quote", *request(base, "GET", f"/quotes/{qid}", woc))
    yield ("rm of other team", *request(base, "GET", f"/quotes/{qid}", rm3))
    yield ("wo of other team", *request(base, "GET", f"/quotes/{qid}", wo2))
    yield ("customer before sent", *request(base, "GET", f"/quotes/{qid}", acme))
    yield ("admin cannot read quotes", *request(base, "GET", f"/quotes/{qid}", admin))
    yield ("unknown quote id", *request(base, "GET", "/quotes/00000000-0000-4000-8000-0000000000ff", rm))
    yield ("malformed quote id", *request(base, "GET", "/quotes/nope", rm))
    yield ("share link before sent", *request(base, "GET", f"/public/quotes/{access}"))
    yield ("public malformed token", *request(base, "GET", "/public/quotes/nope"))

    # Approval round trip with a return to draft and an edit.
    yield ("approve a draft", *request(base, "POST", f"/quotes/{qid}/approve", wo, {}))
    yield ("send a draft", *request(base, "POST", f"/quotes/{qid}/send", rm, {}))
    yield ("submit", *request(base, "POST", f"/quotes/{qid}/submit", rm, {"comment": "Please review"}))
    yield ("submit again", *request(base, "POST", f"/quotes/{qid}/submit", rm, {}))
    yield ("edit while pending", *request(base, "PUT", f"/quotes/{qid}", rm, quote("Q-1")))
    yield ("rm cannot approve", *request(base, "POST", f"/quotes/{qid}/approve", rm, {}))
    yield ("other wo cannot approve", *request(base, "POST", f"/quotes/{qid}/approve", wo2, {}))
    yield ("return without comment", *request(base, "POST", f"/quotes/{qid}/return", wo, {}))
    yield ("return with comment", *request(base, "POST", f"/quotes/{qid}/return", wo, {"comment": "Discount too high"}))
    yield ("rm edits draft", *request(base, "PUT", f"/quotes/{qid}", rm, quote("Q-1", items=[
        {"title": "Consulting", "categoryId": SERVICES, "quantity": 2, "unitPrice": 100, "discountPercent": 5},
        {"title": "Rounding probe", "categoryId": HARDWARE, "quantity": 3, "unitPrice": 33.33, "discountPercent": 15, "taxPercent": 7},
    ])))
    yield ("other rm cannot edit", *request(base, "PUT", f"/quotes/{qid}", rm3, quote("Q-1")))
    yield ("submit again after edit", *request(base, "POST", f"/quotes/{qid}/submit", rm, {}))
    yield ("wo approves", *request(base, "POST", f"/quotes/{qid}/approve", wo, {"comment": "OK"}))
    yield ("wo cannot send", *request(base, "POST", f"/quotes/{qid}/send", wo, {}))
    yield ("rm sends", *request(base, "POST", f"/quotes/{qid}/send", rm, {}))
    yield ("send again", *request(base, "POST", f"/quotes/{qid}/send", rm, {}))

    # Customer side.
    yield ("other customer", *request(base, "GET", f"/quotes/{qid}", globex))
    yield ("customer opens (marks viewed)", *request(base, "GET", f"/quotes/{qid}", acme))
    yield ("rm sees viewed + history", *request(base, "GET", f"/quotes/{qid}", rm))
    yield ("public view", *request(base, "GET", f"/public/quotes/{access}"))
    yield ("accept missing signature", *request(base, "POST", f"/quotes/{qid}/accept", acme, {"signerName": " "}))
    yield ("rm cannot accept", *request(base, "POST", f"/quotes/{qid}/accept", rm, SIGNATURE))
    yield ("customer accepts", *request(base, "POST", f"/quotes/{qid}/accept", acme, SIGNATURE))
    yield ("accept again", *request(base, "POST", f"/quotes/{qid}/accept", acme, SIGNATURE))
    yield ("public accept after accept", *request(base, "POST", f"/public/quotes/{access}/accept", body=SIGNATURE))
    yield ("public view after accept", *request(base, "GET", f"/public/quotes/{access}"))

    # A second quote, declined through the share link.
    status, second = request(base, "POST", "/quotes", rm, quote("Q-2"))
    yield "rm creates second quote", status, second
    sid, saccess = second["id"], second["accessToken"]
    for step, token in (("submit", rm), ("approve", wo), ("send", rm)):
        yield (f"second {step}", *request(base, "POST", f"/quotes/{sid}/{step}", token, {}))
    yield ("public decline", *request(base, "POST", f"/public/quotes/{saccess}/reject", body={"comment": "Over budget"}))
    yield ("public decline again", *request(base, "POST", f"/public/quotes/{saccess}/reject", body={}))
    yield ("customer history of declined", *request(base, "GET", f"/quotes/{sid}", acme))

    # Lists.
    for who, token in (("rm", rm), ("wo", wo), ("woc", woc), ("customer", acme), ("rm other team", rm3)):
        status, rows = request(base, "GET", "/quotes", token)
        yield f"list as {who}", status, [r for r in rows or [] if r["quoteNumber"].startswith(prefix)]
    status, rows = request(base, "GET", "/quotes?status=accepted", rm)
    yield "list accepted", status, [r for r in rows or [] if r["quoteNumber"].startswith(prefix)]
    yield ("list invalid status", *request(base, "GET", "/quotes?status=bogus", rm))
    yield ("admin cannot list quotes", *request(base, "GET", "/quotes", admin))

    # Dashboard errors (the summary itself is compared in the snapshot).
    yield ("dashboard as rm", *request(base, "GET", "/dashboard/summary", rm))
    yield ("dashboard as admin", *request(base, "GET", "/dashboard/summary", admin))
    yield ("dashboard bad date", *request(base, "GET", "/dashboard/summary?from=01-01-2026", woc))
    yield ("dashboard from after to", *request(base, "GET", "/dashboard/summary?from=2026-02-01&to=2026-01-01", woc))

    # Admin: users and teams.
    status, newwo = request(base, "POST", "/admin/users", admin, {
        "email": f"{prefix}WO@Example.com", "name": prefix + "New WO", "password": "password", "role": "wo"})
    yield "create wo user", status, newwo
    status, newrm = request(base, "POST", "/admin/users", admin, {
        "email": f"{prefix}rm@example.com", "name": prefix + "New RM", "password": "password", "role": "rm", "teamId": TEAM_ALPHA})
    yield "create rm user", status, newrm
    status, newbuyer = request(base, "POST", "/admin/users", admin, {
        "email": f"{prefix}buyer@example.com", "name": prefix + "Buyer", "password": "password", "role": "customer", "clientId": ACME})
    yield "create customer user", status, newbuyer
    yield ("duplicate email", *request(base, "POST", "/admin/users", admin, {
        "email": f"{prefix}rm@example.com", "name": "x", "password": "password", "role": "rm"}))
    yield ("invalid user", *request(base, "POST", "/admin/users", admin, {
        "email": "not-an-email", "name": "", "password": "short", "role": "boss"}))
    yield ("team on a wo", *request(base, "POST", "/admin/users", admin, {
        "email": f"{prefix}x@example.com", "name": "x", "password": "password", "role": "wo", "teamId": TEAM_ALPHA}))
    yield ("customer without client", *request(base, "POST", "/admin/users", admin, {
        "email": f"{prefix}y@example.com", "name": "y", "password": "password", "role": "customer"}))
    yield ("unknown team", *request(base, "POST", "/admin/users", admin, {
        "email": f"{prefix}z@example.com", "name": "z", "password": "password", "role": "rm", "teamId": "00000000-0000-4000-8000-0000000000ff"}))
    yield ("rm cannot manage users", *request(base, "GET", "/admin/users", rm))
    status, team = request(base, "POST", "/admin/teams", admin, {"name": prefix + "Gamma", "woUserId": newwo["id"]})
    yield "create team", status, team
    yield ("duplicate team", *request(base, "POST", "/admin/teams", admin, {"name": prefix + "Gamma", "woUserId": newwo["id"]}))
    yield ("team without wo", *request(base, "POST", "/admin/teams", admin, {"name": prefix + "Delta"}))
    yield ("team led by an rm", *request(base, "POST", "/admin/teams", admin, {"name": prefix + "Delta", "woUserId": newrm["id"]}))
    yield ("move rm to new team", *request(base, "PUT", f"/admin/users/{newrm['id']}", admin, {
        "name": prefix + "New RM", "role": "rm", "active": True, "teamId": team["id"]}))
    yield ("deactivate team lead", *request(base, "PUT", f"/admin/users/{newwo['id']}", admin, {
        "name": prefix + "New WO", "role": "wo", "active": False}))
    yield ("rename team, hand to wo2", *request(base, "PUT", f"/admin/teams/{team['id']}", admin, {"name": prefix + "Gamma 2", "woUserId": WO2}))
    yield ("update without active", *request(base, "PUT", f"/admin/users/{newwo['id']}", admin, {"name": "x", "role": "wo"}))
    yield ("admin changes own role", *request(base, "PUT", "/admin/users/00000000-0000-4000-8000-000000000002", admin, {
        "name": "Demo Admin", "role": "rm", "active": True}))
    yield ("unknown user", *request(base, "PUT", "/admin/users/00000000-0000-4000-8000-0000000000ff", admin, {
        "name": "x", "role": "rm", "active": True}))
    status, auth = request(base, "POST", "/auth/login", body={"email": f"{prefix}rm@example.com", "password": "password"})
    yield "new rm logs in", status, auth
    newrm_token = auth and auth.get("accessToken")
    yield ("deactivate rm", *request(base, "PUT", f"/admin/users/{newrm['id']}", admin, {
        "name": prefix + "New RM", "role": "rm", "active": False, "teamId": team["id"]}))
    yield ("deactivated token", *request(base, "GET", "/quotes", newrm_token))
    yield ("deactivated login", *request(base, "POST", "/auth/login", body={"email": f"{prefix}rm@example.com", "password": "password"}))

    # Deletes are POSTs to .../delete; only rows nothing depends on can go.
    yield ("delete as rm", *request(base, "POST", f"/admin/users/{newbuyer['id']}/delete", rm))
    yield ("delete user without history", *request(base, "POST", f"/admin/users/{newbuyer['id']}/delete", admin))
    yield ("delete user again", *request(base, "POST", f"/admin/users/{newbuyer['id']}/delete", admin))
    yield ("delete malformed id", *request(base, "POST", "/admin/users/nope/delete", admin))
    yield ("delete yourself", *request(base, "POST", "/admin/users/00000000-0000-4000-8000-000000000002/delete", admin))
    yield ("delete team lead", *request(base, "POST", f"/admin/users/{WO2}/delete", admin))
    yield ("delete user with history", *request(base, "POST", "/admin/users/00000000-0000-4000-8000-000000000012/delete", admin))
    yield ("delete former lead (no history)", *request(base, "POST", f"/admin/users/{newwo['id']}/delete", admin, raw=b"{nope"))
    yield ("delete team with members", *request(base, "POST", f"/admin/teams/{team['id']}/delete", admin))
    status, empty = request(base, "POST", "/admin/teams", admin, {"name": prefix + "Empty", "woUserId": WO2})
    yield "create empty team", status, empty
    yield ("delete empty team", *request(base, "POST", f"/admin/teams/{empty['id']}/delete", admin, {}))
    yield ("delete unknown team", *request(base, "POST", f"/admin/teams/{empty['id']}/delete", admin))
    yield ("delete category in use", *request(base, "POST", f"/admin/categories/{SERVICES}/delete", admin))
    yield ("delete unused category", *request(base, "POST", f"/admin/categories/{retired['id']}/delete", admin))
    yield ("delete unknown category", *request(base, "POST", f"/admin/categories/{retired['id']}/delete", admin))
    yield ("GET on a delete path", *request(base, "GET", f"/admin/categories/{SERVICES}/delete", admin))

    status, rows = request(base, "GET", "/admin/users", admin)
    yield "list users", status, mine(rows or [], lambda r: r["email"])
    status, rows = request(base, "GET", "/admin/teams", admin)
    yield "list teams", status, mine(rows or [], lambda r: r["name"])


def snapshot(base):
    """Shared views over the whole database: read from both backends once both scenarios are done."""
    woc = request(base, "POST", "/auth/login", body={"email": "woc@swiftquote.dev", "password": "password"})[1]["accessToken"]
    admin = request(base, "POST", "/auth/login", body={"email": "demo@swiftquote.dev", "password": "password"})[1]["accessToken"]
    today = date.today().isoformat()
    yield ("dashboard all time", *request(base, "GET", "/dashboard/summary", woc))
    yield ("dashboard today", *request(base, "GET", f"/dashboard/summary?from={today}&to={today}", woc))
    yield ("admin users", *request(base, "GET", "/admin/users", admin))
    yield ("admin teams", *request(base, "GET", "/admin/teams", admin))
    yield ("admin categories", *request(base, "GET", "/admin/categories", admin))


def compare(steps, a_base, b_base, a_norm, b_norm):
    failures = 0
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
    return failures


def main():
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    a_base, b_base = sys.argv[1].rstrip("/"), sys.argv[2].rstrip("/")
    # Unique per invocation: several parity runs may hit the same database within one second.
    run = f"{int(time.time())}{secrets.token_hex(2)}"
    a_prefix, b_prefix = f"PA{run}-", f"PB{run}-"

    failures = compare(zip(scenario(a_base, a_prefix), scenario(b_base, b_prefix)),
                       a_base, b_base, Normaliser(a_prefix), Normaliser(b_prefix))
    print("  -- shared views")
    failures += compare(zip(snapshot(a_base), snapshot(b_base)), a_base, b_base, Normaliser(), Normaliser())

    print(f"\n{'PARITY OK' if failures == 0 else f'{failures} step(s) differ'}")
    sys.exit(1 if failures else 0)


if __name__ == "__main__":
    main()
