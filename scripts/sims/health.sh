#!/usr/bin/env bash
# health.sh — probe each sim's health through the farm's aggregate endpoint.
# Exits non-zero if any simulator is DOWN. Does NOT use `set -e` so we can
# report failures explicitly before exiting with the intended code.
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PORT="${SIM_FARM_CONTROL_PORT:-39530}"
CTRL="http://127.0.0.1:$PORT/health"

code="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 5 "$CTRL" 2>/dev/null || true)"
body="$(curl -fsS --max-time 5 "$CTRL" 2>/dev/null || true)"
code="${code:-000}"

if [[ "$code" != "200" ]]; then
  if [[ "$code" == "000" ]]; then
    echo "health: cannot reach farm at $CTRL (is it up? run scripts/sims/up.sh)"
  else
    echo "health: farm returned HTTP $code (UNHEALTHY)"
    printf '%s\n' "$body" | grep -E '"ok":false|"healthy":false' || true
  fi
  exit 1
fi

if ! grep -q '"ok":true' <<<"$body"; then
  echo "health: farm reports ok=false (UNHEALTHY)"
  printf '%s\n' "$body" | grep -E '"healthy":false' || true
  exit 1
fi

if grep -q '"healthy":false' <<<"$body"; then
  echo "health: one or more sims are DOWN:"
  printf '%s\n' "$body" | grep -E '"healthy":false'
  exit 1
fi

echo "health: ALL SIMS HEALTHY via $CTRL"
exit 0
