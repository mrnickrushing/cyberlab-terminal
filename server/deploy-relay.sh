#!/usr/bin/env bash
#
# Deploy the terminal relay server to Railway.
#
# The Railway service "terminal-relay" (project "Terminal-Relay") runs Railway's
# serverless `function-bun` image. There is no git build step for it, so the
# server code in ./terminal-relay-server.ts is shipped to the running container
# as a single base64 environment variable (SERVER_B64) and decoded + executed at
# boot by the service start command.
#
# IMPORTANT: do NOT hand-edit the env var in the Railway dashboard. It must stay a
# faithful base64 of terminal-relay-server.ts. Editing it manually (or splitting
# it into PART1/PART2/... chunks) is what previously corrupted the deploy and took
# the site down. Always change terminal-relay-server.ts and re-run this script.
#
# Usage:
#   RAILWAY_TOKEN=<account-or-team-token> ./server/deploy-relay.sh
#
# The start command below is intentionally a single `bun -e` one-liner because the
# function-bun image executes the start command as a quoted argv (NOT through a
# POSIX shell): pipes and $VAR expansion do not work, so the decode must happen
# in-process. Uint8Array.from(atob(...)) is used (not Buffer.from(...,'base64'))
# because it is binary-safe for the UTF-8 glyphs in the UI and avoids a Cloudflare
# WAF rule that blocks the Buffer/base64 form in the GraphQL request.

set -euo pipefail

API="https://backboard.railway.app/graphql/v2"
PROJECT_ID="${RAILWAY_PROJECT_ID:-258ba223-a661-4a5d-ab44-8f2cdba5c5b7}"   # Terminal-Relay
SERVICE_ID="${RAILWAY_SERVICE_ID:-c4f88071-62b2-400d-906f-5fb4180d81f2}"   # terminal-relay
ENV_ID="${RAILWAY_ENVIRONMENT_ID:-f811e3b2-16dd-48a7-9d70-301ddf4e8a89}"   # production

: "${RAILWAY_TOKEN:?Set RAILWAY_TOKEN to a Railway account/team token with access to the Terminal-Relay project}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVER_FILE="$SCRIPT_DIR/terminal-relay-server.ts"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

START_CMD='bun -e '\''await Bun.write("/tmp/server.ts", Uint8Array.from(atob(Bun.env.SERVER_B64), c => c.charCodeAt(0))); await import("/tmp/server.ts");'\'''

echo "==> Encoding $SERVER_FILE"
base64 -w0 "$SERVER_FILE" > "$WORK/server.b64"

# Sanity check: decode must reproduce the source byte-for-byte before we ship it.
base64 -d "$WORK/server.b64" > "$WORK/roundtrip.ts"
if ! cmp -s "$SERVER_FILE" "$WORK/roundtrip.ts"; then
  echo "ERROR: base64 round-trip mismatch, refusing to deploy" >&2
  exit 1
fi
echo "    round-trip OK ($(wc -c < "$WORK/server.b64") base64 bytes)"

gql() {
  # gql <payload-file>
  curl -fsS --max-time 60 -X POST "$API" \
    -H "Authorization: Bearer $RAILWAY_TOKEN" \
    -H "Content-Type: application/json" \
    --data @"$1"
}

echo "==> Upserting SERVER_B64"
python3 - "$PROJECT_ID" "$SERVICE_ID" "$ENV_ID" "$WORK/server.b64" "$WORK/upsert.json" <<'PY'
import sys, json
pid, sid, eid, b64path, out = sys.argv[1:6]
value = open(b64path).read().strip()
q = "mutation($input: VariableUpsertInput!){ variableUpsert(input:$input) }"
json.dump({"query": q, "variables": {"input": {
    "projectId": pid, "environmentId": eid, "serviceId": sid,
    "name": "SERVER_B64", "value": value}}}, open(out, "w"))
PY
gql "$WORK/upsert.json"; echo

echo "==> Setting start command"
python3 - "$SERVICE_ID" "$ENV_ID" "$START_CMD" "$WORK/startcmd.json" <<'PY'
import sys, json
sid, eid, cmd, out = sys.argv[1:5]
q = ("mutation($serviceId:String!,$environmentId:String!,$input:ServiceInstanceUpdateInput!)"
     "{ serviceInstanceUpdate(serviceId:$serviceId, environmentId:$environmentId, input:$input) }")
json.dump({"query": q, "variables": {
    "serviceId": sid, "environmentId": eid,
    "input": {"startCommand": cmd}}}, open(out, "w"))
PY
gql "$WORK/startcmd.json"; echo

echo "==> Triggering redeploy"
python3 - "$SERVICE_ID" "$ENV_ID" "$WORK/deploy.json" <<'PY'
import sys, json
sid, eid, out = sys.argv[1:4]
q = "mutation($serviceId:String!,$environmentId:String!){ serviceInstanceDeployV2(serviceId:$serviceId, environmentId:$environmentId) }"
json.dump({"query": q, "variables": {"serviceId": sid, "environmentId": eid}}, open(out, "w"))
PY
gql "$WORK/deploy.json"; echo

echo "==> Done. Verify: curl -sI https://terminal.vitallity.org/ (expect HTTP 200)"
