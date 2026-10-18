#!/usr/bin/env bash
# up.sh — start the offline simulated-target FARM (all three in-process sims)
#         and emit ONE line of JSON describing it.
#
# Offline deviation from plan: the original task invoked a containerized sshd
# via docker/lxc/podman. THIS ENVIRONMENT HAS NO CONTAINER RUNTIME, so every
# target runs IN-PROCESS (pure-JS ssh2 Server + Bun.serve). If a runtime IS
# detected we print an informational message and DO NOT execute the docker path.
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
PIDFILE="$SCRIPT_DIR/.farm.pid"
ARTIFACT="$SCRIPT_DIR/farm-info.json"
PORT="${SIM_FARM_CONTROL_PORT:-39530}"

for bin in docker podman lxc; do
  if command -v "$bin" >/dev/null 2>&1; then
    echo "container runtime '$bin' detected -> this harness would launch a containerized sshd instead of the in-process farm (not executed)." >&2
    echo '{"note":"container-runtime-detected","inProcessFarmNotLaunched":true,"runtime":"'"$bin"'"}'
    exit 0
  fi
done

is_alive() { kill -0 "$1" 2>/dev/null; }

# Already running? Report existing state and bail out cleanly.
if [[ -f "$PIDFILE" ]] && is_alive "$(cat "$PIDFILE" 2>/dev/null)"; then
  echo "sim-farm already running (pid $(cat "$PIDFILE"))"
  cat "$ARTIFACT" 2>/dev/null || true
  exit 0
fi

FARM_SRC="$REPO_ROOT/src/testing/sim-farm.ts"
OUT="$SCRIPT_DIR/farm.out"

# Start the farm; its stdout carries only the final JSON artifact line.
bun run "$FARM_SRC" >"$OUT" 2>&1 &
FARM_PID=$!
echo "$FARM_PID" > "$PIDFILE"

# Wait until the control endpoint answers (up to ~20s), capturing /info once live.
ready=""
for _ in $(seq 1 40); do
  if ! is_alive "$FARM_PID"; then
    echo "ERROR: sim-farm exited unexpectedly (see $OUT):" >&2
    tail -n 60 "$OUT" >&2 || true
    rm -f "$PIDFILE"
    exit 1
  fi
  ready="$(curl -fsS --max-time 2 "http://127.0.0.1:$PORT/info" 2>/dev/null || true)"
  [[ -n "$ready" ]] && break
  sleep 0.5
done

if [[ -z "$ready" ]]; then
  echo "ERROR: sim-farm did not become ready in time (see $OUT):" >&2
  tail -n 60 "$OUT" >&2 || true
  rm -f "$PIDFILE"
  exit 1
fi

printf '%s\n' "$ready" > "$ARTIFACT"
# Emit exactly one line describing the farm.
printf '%s\n' "$ready"
