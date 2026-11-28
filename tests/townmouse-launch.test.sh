#!/bin/bash
set -euo pipefail

# Runs scripts/townmouse.sh against faked open, curl, launchctl, node, lsof and
# osascript, with a temporary HOME and none of the caller's overrides, so nothing
# is started, opened or nudged and no real hook runs. It checks that Townmouse
# uses its own service name and port, and never TerminalOne's.

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP="$(cd "$(mktemp -d)" && pwd -P)"
trap 'rm -rf "$TMP"' EXIT

FAKEBIN="$TMP/fakebin"
HOME_DIR="$TMP/home"
mkdir -p "$FAKEBIN" "$TMP/logs" "$TMP/state" "$HOME_DIR"

# Every run starts from a clean slate: a PORT or override exported in the
# caller's shell must not reach the launcher under test.
CLEAN=(env -u PORT -u TERMINALONE_APP_DIR -u TERMINALONE_NODE -u TERMINALONE_PLIST_DIR
  -u TERMINALONE_SYSTEM_LOG_DIR -u TERMINALONE_LOG_DIR -u TERMINALONE_URL
  -u TERMINALONE_HEALTH_URL -u TERMINALONE_TRUSTED_ORIGINS)

# A stand-in node-pty package with an executable spawn helper, so the launcher's
# runtime check passes the way it does on a healthy install.
FAKE_PTY_DIR="$TMP/fake-node-pty"
mkdir -p "$FAKE_PTY_DIR/prebuilds/test"
: > "$FAKE_PTY_DIR/prebuilds/test/spawn-helper"
chmod +x "$FAKE_PTY_DIR/prebuilds/test/spawn-helper"

# A hook under the temporary HOME. Its receipt proves that hooks, when the
# launcher runs them, come from the temporary HOME and not from the real one.
HOOK_DIR="$HOME_DIR/.config/terminal-workspace/hooks/terminalone/pre-start.d"
mkdir -p "$HOOK_DIR"
cat > "$HOOK_DIR/10-receipt" <<'EOF'
#!/bin/bash
read -r payload
printf '%s\n%s\n' "$payload" "$HOME" > "$HOOK_RECEIPT"
EOF
chmod +x "$HOOK_DIR/10-receipt"
HOOK_RECEIPT="$TMP/state/hook-receipt.json"

cat > "$FAKEBIN/open" <<'EOF'
#!/bin/bash
echo "OPEN:$*" >> "$STATE_FILE"
EOF

cat > "$FAKEBIN/curl" <<'EOF'
#!/bin/bash
echo "CURL:$*" >> "$STATE_FILE"
if [ -f "$HEALTHY_FILE" ]; then
  exit 0
fi
exit 7
EOF

cat > "$FAKEBIN/launchctl" <<'EOF'
#!/bin/bash
echo "LAUNCHCTL:$*" >> "$STATE_FILE"
exit 0
EOF

cat > "$FAKEBIN/node" <<'EOF'
#!/bin/bash
case "${1:-}" in
  -p)
    case "${2:-}" in *modules*) echo 127 ;; *) echo 22 ;; esac
    exit 0
    ;;
  -v) echo v22.18.0; exit 0 ;;
  -e)
    # node-runtime.sh asks where node-pty lives so it can check its spawn helper.
    case "${2:-}" in *node-pty*) printf '%s\n' "$FAKE_PTY_DIR" ;; esac
    exit 0
    ;;
  -) exit 0 ;;
esac
echo "NODE:$*" >> "$STATE_FILE"
if [ -n "${NODE_START_DELAY:-}" ]; then
  /bin/sleep "$NODE_START_DELAY"
fi
touch "$HEALTHY_FILE"
/bin/sleep 1
EOF

cat > "$FAKEBIN/lsof" <<'EOF'
#!/bin/bash
exit 1
EOF

cat > "$FAKEBIN/osascript" <<'EOF'
#!/bin/bash
echo "OSASCRIPT:$*" >> "$STATE_FILE"
EOF

cat > "$FAKEBIN/sleep" <<'EOF'
#!/bin/bash
/bin/sleep 0.01
EOF

chmod +x "$FAKEBIN/"*

HEALTHY_FILE="$TMP/state/healthy"
LAUNCHER="$ROOT/scripts/townmouse.sh"
DOMAIN="gui/$(id -u)"
OWN_SERVICE="$DOMAIN/com.floyd.townmouse"

fail() {
  echo "FAIL: $*"
  exit 1
}

# run_launcher <event log> [launcher arguments...]. PORT is unset so each run
# proves the default unless an argument overrides it.
run_launcher() {
  local state="$1"
  shift
  "${CLEAN[@]}" \
    HOME="$HOME_DIR" \
    STATE_FILE="$state" \
    HEALTHY_FILE="$HEALTHY_FILE" \
    FAKE_PTY_DIR="$FAKE_PTY_DIR" \
    HOOK_RECEIPT="$HOOK_RECEIPT" \
    PATH="$FAKEBIN:/usr/bin:/bin:/usr/sbin:/sbin" \
    TERMINALONE_APP_DIR="$ROOT" \
    TERMINALONE_LOG_DIR="$TMP/logs" \
    bash "$LAUNCHER" "$@"
}

# expect_hook_from_temporary_home: the run that just finished reached the
# hooks, and the hook it ran is the one planted under the temporary HOME, not
# anything under the real one.
expect_hook_from_temporary_home() {
  [ -s "$HOOK_RECEIPT" ] || fail "the launcher did not run the hooks under the temporary HOME"
  grep -q 'pre-start' "$HOOK_RECEIPT" || fail "the hook receipt does not describe the pre-start event"
  [ "$(tail -n 1 "$HOOK_RECEIPT")" = "$HOME_DIR" ] || fail "a hook ran under a HOME other than the temporary one"
}

# A run that only prints must not nudge a service, start a backend or open a UI.
expect_print_only() {
  if grep -q -E '^(LAUNCHCTL|NODE|OPEN):' "$1" 2>/dev/null; then
    fail "the launcher started something when it should only have printed"
  fi
}

for help_arg in --help -h help; do
  state="$TMP/state/help-${help_arg#-}.log"
  help_output="$(run_launcher "$state" "$help_arg")"
  grep -q '^Usage: townmouse ' <<< "$help_output" || fail "usage line missing for $help_arg"
  for option in --port --no-open --version; do
    grep -q -- "$option" <<< "$help_output" || fail "usage does not list $option"
  done
  expect_print_only "$state"
done

state="$TMP/state/version.log"
version_output="$(run_launcher "$state" --version)"
expected="$(sed -n 's/^  "version": "\([^"]*\)".*/\1/p' "$ROOT/package.json" | head -n 1)"
[ -n "$expected" ] || fail "could not read the version from package.json"
[ "$version_output" = "$expected" ] || fail "--version printed '$version_output', expected '$expected'"
expect_print_only "$state"

# Service down: nudge Townmouse's own service, start this checkout's backend
# when it does not come up, then open the UI on Townmouse's port.
state="$TMP/state/events.log"
rm -f "$HOOK_RECEIPT"
run_launcher "$state"
expect_hook_from_temporary_home
grep -q "LAUNCHCTL:kickstart $OWN_SERVICE" "$state" || fail "the launcher nudged something other than Townmouse's service"
grep -q "NODE:.*$ROOT/src/server.js" "$state" || fail "the backend started is not this checkout's server"
grep -q 'CURL:-sf http://localhost:11002/health' "$state" || fail "health was not checked on Townmouse's port"
grep -q 'OPEN:.*http://localhost:11002' "$state" || fail "the UI was not opened on Townmouse's port"
if grep -q -E 'com\.floyd\.terminalone|11001' "$state"; then
  fail "the launcher used TerminalOne's service name or port"
fi

# Service healthy: --port chooses the port and --no-open leaves the browser shut.
state="$TMP/state/port-argument.log"
port_output="$(run_launcher "$state" --port 12125 --no-open)"
grep -q 'CURL:-sf http://localhost:12125/health' "$state" || fail "--port <n> was not used for the health check"
grep -q 'Townmouse service ready -> http://localhost:12125' <<< "$port_output" || fail "--no-open did not report readiness"
if grep -q '^OPEN:' "$state"; then fail "--no-open opened a browser"; fi

state="$TMP/state/port-equals.log"
run_launcher "$state" --port=12126 --serve-only >/dev/null
grep -q 'CURL:-sf http://localhost:12126/health' "$state" || fail "--port=<n> was not used for the health check"

# The same range bin/townmouse accepts: 1 to 65535, nothing else.
for bad_port in abc 0 65536 99999999999999999999; do
  state="$TMP/state/port-invalid.log"
  rm -f "$state"
  if port_output="$(run_launcher "$state" --port "$bad_port" 2>&1)"; then
    fail "the port '$bad_port' was accepted"
  fi
  grep -q 'Invalid port' <<< "$port_output" || fail "the bad port '$bad_port' was not explained"
  expect_print_only "$state"
done

if run_launcher "$TMP/state/port-missing.log" --port >/dev/null 2>&1; then
  fail "--port without a value was accepted"
fi
expect_print_only "$TMP/state/port-missing.log"

cat > "$FAKEBIN/lsof" <<'EOF'
#!/bin/bash
echo "COMMAND   PID USER   FD   TYPE DEVICE SIZE/OFF NODE NAME"
echo "python3 99999 user   12u  IPv4    0x0      0t0  TCP *:11002 (LISTEN)"
EOF
chmod +x "$FAKEBIN/lsof"
rm -f "$HEALTHY_FILE"

state="$TMP/state/port-collision.log"
if port_output="$(run_launcher "$state" 2>&1)"; then
  fail "expected the port collision to fail"
fi
grep -q "LAUNCHCTL:kickstart $OWN_SERVICE" "$state" || fail "the service was not nudged before the collision check"
grep -q 'OSASCRIPT:' "$state" || fail "the port collision did not surface a dialog"
grep -q 'already in use by another process' <<< "$port_output" || fail "the port collision was not explained"
if grep -q '^OPEN:' "$state"; then fail "the port collision opened the UI"; fi

cat > "$FAKEBIN/lsof" <<'EOF'
#!/bin/bash
echo "COMMAND PID USER   FD   TYPE DEVICE SIZE/OFF NODE NAME"
echo "node    123 user   12u  IPv4 0x0      0t0  TCP *:11002 (LISTEN)"
EOF
chmod +x "$FAKEBIN/lsof"

rm -f "$HEALTHY_FILE"
run_launcher "$TMP/state/node-listener.log" --serve-only > "$TMP/state/node-listener.out" 2>&1
grep -q 'Townmouse service ready' "$TMP/state/node-listener.out" || fail "a starting Node listener blocked the launcher"
if grep -q 'already in use by another process' "$TMP/state/node-listener.out"; then
  fail "a Node listener must not be treated as a foreign port owner"
fi

# Two launches that overlap must both report the service ready.
rm -f "$HEALTHY_FILE"
: > "$TMP/state/overlap.log"
for run in 1 2; do
  "${CLEAN[@]}" \
    HOME="$HOME_DIR" \
    STATE_FILE="$TMP/state/overlap.log" \
    HEALTHY_FILE="$HEALTHY_FILE" \
    FAKE_PTY_DIR="$FAKE_PTY_DIR" \
    HOOK_RECEIPT="$TMP/state/hook-receipt-overlap.json" \
    NODE_START_DELAY=0.1 \
    PATH="$FAKEBIN:/usr/bin:/bin:/usr/sbin:/sbin" \
    TERMINALONE_APP_DIR="$ROOT" \
    TERMINALONE_LOG_DIR="$TMP/logs" \
    bash "$LAUNCHER" --serve-only > "$TMP/state/overlap-$run.out" 2>&1 &
  pids[$run]=$!
done
for run in 1 2; do
  wait "${pids[$run]}"
  grep -q 'Townmouse service ready' "$TMP/state/overlap-$run.out" || fail "overlapping launch $run did not report ready"
  if grep -q 'already in use by another process' "$TMP/state/overlap-$run.out"; then
    fail "overlapping launches reported a false port conflict"
  fi
done

cat > "$FAKEBIN/lsof" <<'EOF'
#!/bin/bash
exit 1
EOF
chmod +x "$FAKEBIN/lsof"

# The installed launcher may live on the internal disk while the app sits
# elsewhere: the app directory is derived from the script's own location, so
# TERMINALONE_APP_DIR stays unset here on purpose.
ALT_ROOT="$TMP/alt-checkout"
mkdir -p "$ALT_ROOT/scripts" "$ALT_ROOT/src" \
  "$ALT_ROOT/node_modules/node-pty/prebuilds/test"
for script in townmouse.sh node-runtime.sh run-hooks; do
  cp "$ROOT/scripts/$script" "$ALT_ROOT/scripts/$script"
done
touch "$ALT_ROOT/src/server.js"
touch "$ALT_ROOT/node_modules/node-pty/prebuilds/test/spawn-helper"
chmod +x "$ALT_ROOT/scripts/"* \
  "$ALT_ROOT/node_modules/node-pty/prebuilds/test/spawn-helper"

rm -f "$HEALTHY_FILE" "$HOOK_RECEIPT"
"${CLEAN[@]}" \
  HOME="$HOME_DIR" \
  STATE_FILE="$TMP/state/derived.log" \
  HEALTHY_FILE="$HEALTHY_FILE" \
  FAKE_PTY_DIR="$FAKE_PTY_DIR" \
  HOOK_RECEIPT="$HOOK_RECEIPT" \
  PATH="$FAKEBIN:/usr/bin:/bin:/usr/sbin:/sbin" \
  TERMINALONE_LOG_DIR="$TMP/logs" \
  bash "$ALT_ROOT/scripts/townmouse.sh"
grep -q "NODE:.*$ALT_ROOT/src/server.js" "$TMP/state/derived.log" || fail "the backend started is not the one beside the launcher"
grep -q 'OPEN:' "$TMP/state/derived.log" || fail "the derived-checkout launch did not open the UI"
expect_hook_from_temporary_home

echo "PASS: townmouse launcher uses com.floyd.townmouse on 11002 and never TerminalOne's name or port"
