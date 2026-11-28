#!/bin/bash
set -euo pipefail

# Compiles the macOS wrapper the way install-service.sh does, with the real
# compiler, and checks that the program does not demand a newer macOS than the
# bundle declares. Without an explicit target the compiler stamps its own default,
# which can be newer than the Mac it was built on; Launch Services then refuses the
# icon with kLSIncompatibleSystemVersionErr while the program runs when started by
# hand, so nothing short of reading the stamp catches it.
if [ "$(uname -s)" != "Darwin" ]; then
  echo "SKIP: the macOS wrapper needs a Mac with the Swift compiler."
  exit 0
fi

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
INSTALLER="$ROOT/scripts/install-service.sh"
TMP="$(cd "$(mktemp -d)" && pwd -P)"
trap 'rm -rf "$TMP"' EXIT

fail() {
  echo "FAIL: $*"
  exit 1
}

# not_newer_than <a> <b>: succeeds when version a is b or older.
not_newer_than() {
  awk -v a="$1" -v b="$2" 'BEGIN {
    split(a, x, "."); split(b, y, ".")
    for (i = 1; i <= 3; i++) {
      if ((x[i] + 0) < (y[i] + 0)) exit 0
      if ((x[i] + 0) > (y[i] + 0)) exit 1
    }
    exit 0
  }'
}

declared="$(sed -n 's/.*<key>LSMinimumSystemVersion<\/key><string>\([^<]*\)<\/string>.*/\1/p' "$INSTALLER" | head -n 1)"
[ -n "$declared" ] || fail "install-service.sh does not declare LSMinimumSystemVersion"
target="$(sed -n 's/^SWIFT_TARGET="\([^"]*\)"$/\1/p' "$INSTALLER" | head -n 1)"
[ -n "$target" ] || fail "install-service.sh does not set SWIFT_TARGET"
target="${target//'$(uname -m)'/$(uname -m)}"
case "$target" in
  *-apple-macosx*) ;;
  *) fail "SWIFT_TARGET '$target' is not a macOS target" ;;
esac

xcrun swiftc -parse-as-library -O -target "$target" -framework AppKit -framework WebKit \
  "$ROOT/native/TownmouseApp.swift" -o "$TMP/Townmouse"

minos="$(otool -l "$TMP/Townmouse" | awk '/LC_BUILD_VERSION/ { seen = 1 } seen && /minos/ { print $2; exit }')"
[ -n "$minos" ] || fail "could not read the minimum macOS version from the compiled wrapper"
not_newer_than "$minos" "$declared" || fail "the wrapper demands macOS $minos, newer than the $declared the bundle declares"

echo "PASS: the macOS wrapper is built for macOS $minos or newer, within the declared $declared"
