#!/bin/bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

fail() {
  echo "FAIL: $*"
  exit 1
}

# require_line <pattern> <file>...: every file must exist and contain a line that
# matches. One grep over several files stops at the first match, which would let
# a regression in a single file through.
require_line() {
  local pattern="$1"
  shift
  local file
  for file in "$@"; do
    [ -f "$file" ] || fail "$file is missing"
    grep -q -e "$pattern" "$file" || fail "$file does not contain: $pattern"
  done
}

# A reader who installs Townmouse must be able to find its own service identity.
require_line 'port 11002 by default' README.md
require_line 'com.floyd.townmouse' docs/PACKAGING.md
require_line 'scripts/install-service.sh' docs/PACKAGING.md
require_line 'scripts/uninstall-service.sh' docs/PACKAGING.md

# The shipped scripts agree with the docs.
require_line '^LABEL="com.floyd.townmouse"' scripts/install-service.sh scripts/uninstall-service.sh scripts/townmouse.sh
require_line '^PORT="${PORT:-11002}"' scripts/install-service.sh scripts/townmouse.sh
require_line 'src/server.js` on PORT 11002' scripts/install-service.sh

# Nothing executable claims TerminalOne's identity any more. Its label and port
# may appear only in comments, or in the script that retires the 0.2.x service.
leftovers="$(grep -rn -E 'com\.floyd\.terminalone|11001' bin native src scripts start.sh Dockerfile \
  | grep -v '^scripts/retire-legacy-service.sh:' \
  | grep -v -E ':[0-9]+:[[:space:]]*(#|//)' \
  || true)"
if [ -n "$leftovers" ]; then
  echo "executable files still carry TerminalOne's label or port outside comments:"
  printf '%s\n' "$leftovers"
  exit 1
fi

echo "PASS: docs and scripts name Townmouse's own service, port and launcher"
