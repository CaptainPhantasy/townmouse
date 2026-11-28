#!/bin/bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# A reader who installs Townmouse must be able to find its own service identity.
grep -q 'port 11002 by default' README.md
grep -q 'com.floyd.townmouse' docs/PACKAGING.md
grep -q 'scripts/install-service.sh' docs/PACKAGING.md
grep -q 'scripts/uninstall-service.sh' docs/PACKAGING.md

# The shipped scripts agree with the docs.
grep -q '^LABEL="com.floyd.townmouse"' scripts/install-service.sh scripts/uninstall-service.sh scripts/townmouse.sh
grep -q '^PORT="${PORT:-11002}"' scripts/install-service.sh scripts/townmouse.sh
grep -q 'src/server.js` on PORT 11002' scripts/install-service.sh

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
