#!/usr/bin/env bash
# down.sh — stop the offline simulated-target FARM started by up.sh.
# Reads the recorded PID from the pidfile and terminates it gracefully
# (SIGTERM -> farm closes its listeners), force-killing only if needed.
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PIDFILE="$SCRIPT_DIR/.farm.pid"

if [[ ! -f "$PIDFILE" ]]; then
  echo "down: no pidfile ($PIDFILE); nothing to stop."
  exit 0
fi

PID="$(cat "$PIDFILE" 2>/dev/null)"
if [[ -z "$PID" ]] || ! kill -0 "$PID" 2>/dev/null; then
  echo "down: recorded process $PID is not running (stale pidfile removed)."
  rm -f "$PIDFILE"
  exit 0
fi

kill "$PID" 2>/dev/null
for _ in $(seq 1 10); do
  kill -0 "$PID" 2>/dev/null || break
  sleep 0.5
done
if kill -0 "$PID" 2>/dev/null; then
  kill -9 "$PID" 2>/dev/null || true
  echo "down: force-killed stale process $PID."
else
  echo "down: stopped sim-farm (pid $PID)."
fi

rm -f "$PIDFILE"
exit 0
