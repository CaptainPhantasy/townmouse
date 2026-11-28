#!/bin/bash
#
# Townmouse — remove the always-on LaunchAgent. Full reversal of install-service.sh.
# Stops the running service and deletes the plist. Does not touch app code or ports
# beyond releasing 11002 when the process stops. TerminalOne is a separate product:
# its service, its `t1` launcher and TerminalOne.app are never removed here.
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
LABEL="com.floyd.townmouse"
DOMAIN="gui/$(id -u)"
PLIST_DIR="${TERMINALONE_PLIST_DIR:-$HOME/Library/LaunchAgents}"
PLIST="$PLIST_DIR/$LABEL.plist"

launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true
if [ -f "$PLIST" ]; then
  rm -f "$PLIST"
  echo "Removed $PLIST"
else
  echo "No plist found at $PLIST (nothing to remove)"
fi

bash "$SCRIPT_DIR/retire-legacy-service.sh"

if [ -n "${TERMINALONE_BIN_DIR:-}" ]; then
  LAUNCHER_DIRS=("$TERMINALONE_BIN_DIR")
else
  LAUNCHER_DIRS=(/usr/local/bin "$HOME/.local/bin" "$HOME/bin")
fi
# Remove only a `townmouse` launcher this installer wrote (its text says so), so
# an unrelated command of the same name survives.
for dir in "${LAUNCHER_DIRS[@]}"; do
  [ -n "$dir" ] || continue
  launcher="$dir/townmouse"
  if [ -L "$launcher" ]; then
    case "$(readlink "$launcher")" in
      *[Tt]ownmouse*) rm -f "$launcher" && echo "Removed $launcher (symlink)" ;;
    esac
  elif [ -f "$launcher" ] && grep -q 'Townmouse launcher' "$launcher" 2>/dev/null; then
    rm -f "$launcher" && echo "Removed $launcher"
  fi
done

if [ -n "${TERMINALONE_APPLICATIONS_DIR:-}" ]; then
  APP_DIRS=("$TERMINALONE_APPLICATIONS_DIR")
else
  APP_DIRS=(/Applications "$HOME/Applications")
fi
# Remove the no-terminal app launcher Townmouse's installer built, and nothing else.
for dir in "${APP_DIRS[@]}"; do
  [ -n "$dir" ] || continue
  bundle="$dir/Townmouse.app"
  if [ -d "$bundle" ]; then rm -rf "$bundle" && echo "Removed $bundle"; fi
done

# Remove the PATH line added to shell rc files by install-service.sh.
# Use ';' not '&&' for mv: grep -vF exits 1 when the marked line is the last
# remaining content (no output lines), but we must still write the (empty) result.
MARK="# added by Townmouse install-service.sh"
for rc in "$HOME/.zshrc" "$HOME/.bash_profile"; do
  if [ -f "$rc" ] && grep -qF "$MARK" "$rc" 2>/dev/null; then
    tmp="$(mktemp)"
    grep -vF "$MARK" "$rc" > "$tmp"; mv "$tmp" "$rc" && echo "Cleaned PATH line from $rc"
  fi
done

echo "Townmouse service uninstalled."
