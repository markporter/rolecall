#!/usr/bin/env bash
# ssh-sim.sh — spin up a throwaway SSH server (docker or lxc) for integration tests.
#
# Usage:
#   ssh-sim.sh start --runtime docker|lxc
#   ssh-sim.sh stop  <containerId>
#
# `start` prints ONE line of JSON describing the running sim:
#   {"containerId","host","port","user","privateKeyPath","knownHostsPath","runtime"}
# `stop` tears the container down via `docker stop` / `lxc stop`.

set -euo pipefail

RUNTIME="docker"
CMD_DOCKER_BUILD=(docker build -t rolecall-ssh-sim docker/sshd)
CMD_LXC_LAUNCH=(lxc launch images:alpine/3.20)

usage() {
  echo "usage: ssh-sim.sh {start|stop} [--runtime docker|lxc]" >&2
  exit 2
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    start|stop) ACTION="$1" ;;
    --runtime) RUNTIME="${2:-}"; shift ;;
    *) usage ;;
  esac
  shift || true
done

[[ -n "${ACTION:-}" ]] || usage

if [[ "$RUNTIME" != "docker" && "$RUNTIME" != "lxc" ]]; then
  echo "error: --runtime must be docker or lxc (got '$RUNTIME')" >&2
  exit 2
fi

start_docker() {
  local tmp
  tmp="$(mktemp -d)"
  local key="$tmp/id"
  local pub="$tmp/id.pub"
  local kh="$tmp/known_hosts"

  ssh-keygen -t ed25519 -N "" -f "$key" >/dev/null

  "${CMD_DOCKER_BUILD[@]}"

  local id
  id="$(docker run -d --rm -p 127.0.0.1:0:22 -e "AUTHORIZED_KEY=$(cat "$pub")" rolecall-ssh-sim)"

  # Parse the host-side mapped port from `docker port`.
  local port_line port
  port_line="$(docker port "$id" 22/tcp)"
  # Output looks like: 127.0.0.1:49153
  port="${port_line##*:}"

  # Poll ssh-keyscan until the server accepts connections (timeout ~30s).
  local deadline=$(( $(date +%s) + 30 ))
  while ! ssh-keyscan -p "$port" -T 2 127.0.0.1 >"$kh" 2>/dev/null; do
    if (( $(date +%s) >= deadline )); then
      echo "error: ssh-keyscan timed out for 127.0.0.1:$port" >&2
      docker stop "$id" >/dev/null || true
      exit 1
    fi
    sleep 0.5
  done

  printf '{"containerId":"%s","host":"127.0.0.1","port":%s,"user":"rolecalltest","privateKeyPath":"%s","knownHostsPath":"%s","runtime":"docker"}\n' \
    "$id" "$port" "$key" "$kh"
}

stop_docker() {
  local id="${1:-}"
  [[ -n "$id" ]] || { echo "error: stop requires a containerId" >&2; exit 2; }
  docker stop "$id" >/dev/null
}

start_lxc() {
  local tmp
  tmp="$(mktemp -d)"
  local key="$tmp/id"
  local pub="$tmp/id.pub"
  local kh="$tmp/known_hosts"

  ssh-keygen -t ed25519 -N "" -f "$key" >/dev/null

  local name
  name="rolecall-ssh-sim-$$"

  lxc launch images:alpine/3.20 "$name"
  lxc exec "$name" -- apk add --no-cache openssh >/dev/null
  lxc exec "$name" -- sh -c "adduser -D rolecalltest && mkdir -p /home/rolecalltest/.ssh && chown -R rolecalltest:rolecalltest /home/rolecalltest/.ssh && ssh-keygen -A" >/dev/null
  lxc file push "$pub" "$name/home/rolecalltest/.ssh/authorized_keys" --mode=600 --uid=1000 --gid=1000
  lxc exec "$name" -- /usr/sbin/sshd -D -e &

  local ip
  ip="$(lxc list "$name" -c 4 --format csv | tail -n1 | tr -d ' ')"
  local deadline=$(( $(date +%s) + 30 ))
  while ! ssh-keyscan -p 22 -T 2 "$ip" >"$kh" 2>/dev/null; do
    if (( $(date +%s) >= deadline )); then
      echo "error: ssh-keyscan timed out for $ip" >&2
      lxc stop "$name" >/dev/null || true
      exit 1
    fi
    sleep 0.5
  done

  printf '{"containerId":"%s","host":"%s","port":22,"user":"rolecalltest","privateKeyPath":"%s","knownHostsPath":"%s","runtime":"lxc"}\n' \
    "$name" "$ip" "$key" "$kh"
}

stop_lxc() {
  local id="${1:-}"
  [[ -n "$id" ]] || { echo "error: stop requires a containerId" >&2; exit 2; }
  lxc stop "$id" >/dev/null
}

case "$ACTION" in
  start)
    case "$RUNTIME" in
      docker) start_docker ;;
      lxc) start_lxc ;;
    esac
    ;;
  stop)
    case "$RUNTIME" in
      docker) stop_docker "${1:-}" ;;
      lxc) stop_lxc "${1:-}" ;;
    esac
    ;;
esac
