#!/bin/sh
# Mark node-pty's macOS spawn helpers executable wherever npm placed them.
#
# npm hoists dependencies for a normal install (`npm install townmouse`, `npx`)
# and nests them for a global install, so the old package-local
# `$ROOT/node_modules/node-pty` path silently matched nothing and every terminal
# pane failed with "posix_spawnp failed". Resolve the real directory through
# Node instead, then fix the helpers there.
set -eu
ROOT=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)
NODE="${TERMINALONE_NODE:-$(command -v node 2>/dev/null || true)}"

node_pty_dir() {
  [ -n "$NODE" ] || return 1
  (
    cd "$ROOT" || exit 1
    "$NODE" -e '
      const path = require("path");
      const fs = require("fs");
      let dir = path.dirname(require.resolve("node-pty"));
      while (dir !== path.dirname(dir) && !fs.existsSync(path.join(dir, "package.json"))) {
        dir = path.dirname(dir);
      }
      process.stdout.write(dir);
    ' 2>/dev/null
  )
}

PTY_DIR=$(node_pty_dir || true)
[ -n "$PTY_DIR" ] || PTY_DIR="$ROOT/node_modules/node-pty"
[ -d "$PTY_DIR" ] || exit 0

for helper in "$PTY_DIR"/prebuilds/darwin-*/spawn-helper; do
  [ ! -f "$helper" ] || chmod +x "$helper"
done
