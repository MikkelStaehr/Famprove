#!/usr/bin/env bash
# macOS / Linux twin of serve.ps1: start the web app on port 3100 (agents' port), run a command
# against it, always stop it.
#   .claude/skills/run-web/serve.sh [--mode dev|prod] [--dev-today YYYY-MM-DD] [--dev-fixture <state>] -- "<command>"
# Example:
#   .claude/skills/run-web/serve.sh --dev-fixture midsession -- "node .claude/skills/run-web/shoot.mjs --out \$TMPDIR/traening-390.png"
set -euo pipefail
PORT=3100
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
web="$(cd "$here/../../../web" && pwd)"
mode=dev dev_today="" dev_fixture="" cmd=""
while [ $# -gt 0 ]; do
  case "$1" in
    --mode) mode="$2"; shift 2 ;;
    --dev-today) dev_today="$2"; shift 2 ;;
    --dev-fixture) dev_fixture="$2"; shift 2 ;;
    --) shift; cmd="$*"; break ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done
[ -n "$cmd" ] || { echo 'usage: serve.sh [--mode dev|prod] [--dev-today D] [--dev-fixture F] -- "<command>"' >&2; exit 2; }
[ "$mode" = dev ] || [ "$mode" = prod ] || { echo "--mode is dev or prod" >&2; exit 2; }
if [ -n "$dev_today" ]; then
  [ "$mode" = dev ] || { echo "DEV_TODAY only works in dev mode (next dev)" >&2; exit 2; }
  [[ "$dev_today" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]] || { echo "--dev-today must be YYYY-MM-DD" >&2; exit 2; }
fi
if [ -n "$dev_fixture" ]; then
  [ "$mode" = dev ] || { echo "DEV_FIXTURE only works in dev mode (next dev)" >&2; exit 2; }
  # The data layer's own list is the only list (web/src/lib/db/dev-fixture.ts, const FIXTURES).
  known="$(sed -n '/^const FIXTURES/,/^];/p' "$web/src/lib/db/dev-fixture.ts" | grep -o '"[a-z-]*"' | tr -d '"' | tr '\n' ' ')"
  [[ " $known " == *" $dev_fixture "* ]] || { echo "unknown --dev-fixture '$dev_fixture'; known: $known" >&2; exit 2; }
fi
if lsof -nP -iTCP:$PORT -sTCP:LISTEN >/dev/null 2>&1; then
  echo "port $PORT is already in use; stop that server first (3000 belongs to the user, never touch it)" >&2
  exit 1
fi

server=""
stop() {
  [ -n "$server" ] && kill "$server" 2>/dev/null || true
  for pid in $(lsof -nP -t -iTCP:$PORT -sTCP:LISTEN 2>/dev/null); do kill "$pid" 2>/dev/null || true; done
  sleep 1
  echo "port $PORT listeners left: $(lsof -nP -t -iTCP:$PORT -sTCP:LISTEN 2>/dev/null | wc -l | tr -d ' ')"
}
trap stop EXIT

sub=dev; [ "$mode" = prod ] && sub=start
(
  cd "$web"
  [ -n "$dev_today" ] && export DEV_TODAY="$dev_today"
  [ -n "$dev_fixture" ] && export DEV_FIXTURE="$dev_fixture"
  exec pnpm "$sub" --port "$PORT"
) >"${TMPDIR:-/tmp}/run-web-$PORT.log" 2>&1 &
server=$!

ok=""
for _ in $(seq 1 120); do
  # -L: / redirects to /train since the tab shell (motion-shell); the page behind it must answer 200.
  if [ "$(curl -s -L -o /dev/null -w '%{http_code}' --max-time 60 "http://localhost:$PORT/")" = 200 ]; then ok=1; break; fi
  sleep 0.5
done
[ -n "$ok" ] || { echo "server on $PORT did not answer 200 within about a minute (log: ${TMPDIR:-/tmp}/run-web-$PORT.log)" >&2; exit 1; }
note=""
[ -n "$dev_today" ] && note="$note DEV_TODAY=$dev_today"
[ -n "$dev_fixture" ] && note="$note DEV_FIXTURE=$dev_fixture"
echo "web ($mode) up on http://localhost:$PORT${note:+ with$note}"
cd "$here/../../.."
bash -c "$cmd"
