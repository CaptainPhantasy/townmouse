#!/bin/bash
#
# townmouse — open Townmouse. Ensures the always-on service is running, waits for
# it to be healthy, then opens the UI as a chrome-less app window (falls back to
# the default browser). This is the volume-resident implementation; install-service.sh
# generates a self-contained `townmouse` launcher on the internal disk that delegates
# here, plus /Applications/Townmouse.app. Run install once, then use `townmouse` or
# Spotlight.
#
# Townmouse keeps its own service name and port so it can sit beside TerminalOne,
# the engine it embeds: Townmouse is `com.floyd.townmouse` on 11002, TerminalOne is
# `com.floyd.terminalone` on 11001.
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
PORT="${PORT:-11002}"
APP_DIR="${TERMINALONE_APP_DIR:-$(cd "$SCRIPT_DIR/.." && pwd -P)}"
LOG_DIR="${TERMINALONE_LOG_DIR:-$HOME/Library/Logs/Townmouse}"
LABEL="com.floyd.townmouse"
DOMAIN="gui/$(id -u)"
SERVE_ONLY=false

show_usage() {
  cat <<'EOF'
Usage: townmouse [--port <n>] [--no-open]

Open Townmouse, or ensure its service is healthy without opening a browser.

Options:
  --port <n>    Port for the local server (default 11002)
  --no-open     Start or verify the service, then exit
  --serve-only  Same as --no-open
  -v, --version Show the installed version and exit
  -h, --help    Show this help and exit
EOF
}

show_error() {
  local msg="$1"
  printf 'townmouse: %s\n' "$msg" >&2
  if [ ! -t 2 ] && command -v osascript >/dev/null 2>&1; then
    osascript -e "display dialog \"$msg\" with title \"Townmouse\" buttons {\"OK\"} default button \"OK\" with icon caution" >/dev/null 2>&1 || true
  fi
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    help|-h|--help)
      show_usage
      exit 0
      ;;
    -v|--version)
      sed -n 's/^  "version": "\([^"]*\)".*/\1/p' "$APP_DIR/package.json" | head -n 1
      exit 0
      ;;
    --serve-only|--no-open)
      SERVE_ONLY=true
      ;;
    --port)
      [ "$#" -ge 2 ] || { show_error "--port needs a number"; exit 2; }
      PORT="$2"
      shift
      ;;
    --port=*)
      PORT="${1#--port=}"
      ;;
  esac
  shift
done

case "$PORT" in
  ''|*[!0-9]*) show_error "Invalid port: '$PORT'."; exit 2 ;;
esac

URL="${TERMINALONE_URL:-http://localhost:$PORT}"
HEALTH_URL="${TERMINALONE_HEALTH_URL:-$URL/health}"

wait_for_health() {
  local tries="${1:-32}"
  for _ in $(seq 1 "$tries"); do
    if curl -sf "$HEALTH_URL" >/dev/null 2>&1; then
      return 0
    fi
    sleep 0.25
  done
  return 1
}

start_direct_backend() {
  mkdir -p "$LOG_DIR"
  "$APP_DIR/scripts/run-hooks" pre-start
  nohup env PORT="$PORT" "$APP_DIR/scripts/node-runtime.sh" exec "$APP_DIR/src/server.js" >>"$LOG_DIR/local-launch.out.log" 2>>"$LOG_DIR/local-launch.err.log" &
}

if ! wait_for_health 1; then
  # Nudge the service (no-op if it isn't installed / already running).
  launchctl kickstart "$DOMAIN/$LABEL" 2>/dev/null || true

  if ! wait_for_health 16; then
    # lsof's first line is a column header, not a listener. Inspect command
    # names only on real listener rows so a starting Node service is not
    # mistaken for a foreign process.
    if lsof -nP -iTCP:"$PORT" -sTCP:LISTEN 2>/dev/null \
      | awk 'NR > 1 && tolower($1) !~ /node/ { foreign = 1 } END { exit !foreign }'; then
      show_error "Port $PORT is already in use by another process. Free the port or change Townmouse's port."
      exit 1
    fi

    if ! "$APP_DIR/scripts/node-runtime.sh" doctor >/dev/null 2>&1; then
      show_error "Townmouse runtime is not ready. Run: townmouse repair"
      exit 1
    fi

    if [ ! -f "$APP_DIR/src/server.js" ]; then
      show_error "Townmouse files are missing at $APP_DIR."
      exit 1
    fi

    start_direct_backend

    if ! wait_for_health 32; then
      "$APP_DIR/scripts/run-hooks" start-error --best-effort
      show_error "Townmouse failed to start. Logs: $LOG_DIR/local-launch.err.log"
      exit 1
    fi
    "$APP_DIR/scripts/run-hooks" post-start --best-effort
  fi
fi

if $SERVE_ONLY; then
  echo "Townmouse service ready -> $URL"
  exit 0
fi

if [ -d "/Applications/Google Chrome.app" ]; then
  open -na "Google Chrome" --args --app="$URL"
elif [ -d "/Applications/Google Chrome Beta.app" ]; then
  open -na "Google Chrome Beta" --args --app="$URL"
else
  open "$URL"
fi
echo "Townmouse -> $URL"
