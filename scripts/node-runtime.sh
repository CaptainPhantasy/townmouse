#!/bin/bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
EXPECTED_MAJOR="${TERMINALONE_NODE_MAJOR:-22}"
NATIVE_MODULES=(node-pty)

resolve_node() {
  local candidate major fallback=""
  for candidate in "${TERMINALONE_NODE:-}" "$(command -v node 2>/dev/null || true)" /usr/local/bin/node /opt/homebrew/bin/node; do
    [ -n "$candidate" ] && [ -x "$candidate" ] || continue
    major="$($candidate -p 'process.versions.node.split(".")[0]' 2>/dev/null || true)"
    if [ "$major" = "$EXPECTED_MAJOR" ]; then
      printf '%s\n' "$candidate"
      return 0
    fi
    # node-pty is built on Node-API, so it loads across supported majors. Prefer
    # the documented major, but do not refuse a machine that only has a newer
    # LTS — the package's engines field already permits 22 through 26.
    if [ -z "$fallback" ] && (cd "$ROOT" && "$candidate" -e 'require("node-pty")') >/dev/null 2>&1; then
      fallback="$candidate"
    fi
  done
  if [ -n "$fallback" ]; then
    echo "Townmouse: Node $EXPECTED_MAJOR.x not found; using $("$fallback" -v)." >&2
    printf '%s\n' "$fallback"
    return 0
  fi
  echo "Townmouse requires Node $EXPECTED_MAJOR.x (or a newer release where node-pty loads). Set TERMINALONE_NODE to its absolute path." >&2
  return 1
}

NODE_BIN="$(resolve_node)"
PATH="$(dirname "$NODE_BIN"):$PATH"
export PATH

# npm hoists dependencies for a normal install and nests them for a global one, so
# the package-local path is not where node-pty lives in either case. Ask Node.
resolve_node_pty_dir() {
  (
    cd "$ROOT" || exit 1
    "$NODE_BIN" -e '
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

# Mark every macOS spawn helper executable. `npm pack` does not preserve the
# execute bit, and a non-executable helper makes spawn() fail with
# "posix_spawnp failed" while the rest of the app looks healthy.
fix_spawn_helpers() {
  local pty_dir="$1" helper found=false
  [ -n "$pty_dir" ] && [ -d "$pty_dir" ] || return 0
  for helper in "$pty_dir"/prebuilds/*/spawn-helper "$pty_dir"/build/Release/spawn-helper; do
    [ -e "$helper" ] || continue
    found=true
    chmod +x "$helper" 2>/dev/null || true
  done
  $found || return 0
}

verify_native_modules() {
  local pty_dir helper found=false
  (cd "$ROOT" && "$NODE_BIN" - <<'NODE'
require('node-pty');
NODE
  ) >/dev/null 2>&1 || return 1
  [ "$(uname -s)" != "Darwin" ] && return 0
  pty_dir="$(resolve_node_pty_dir)" || return 1
  [ -n "$pty_dir" ] || return 1
  for helper in "$pty_dir"/prebuilds/*/spawn-helper "$pty_dir"/build/Release/spawn-helper; do
    [ -e "$helper" ] || continue
    found=true
    [ -x "$helper" ] || return 1
  done
  $found
}

repair_native_modules() {
  local npm_bin pty_dir project_root
  npm_bin="$(command -v npm 2>/dev/null || true)"
  [ -n "$npm_bin" ] || { echo "npm is required to rebuild Townmouse native modules." >&2; return 1; }
  pty_dir="$(resolve_node_pty_dir || true)"
  [ -n "$pty_dir" ] || pty_dir="$ROOT/node_modules/node-pty"
  # The owning project is whatever sits above the LAST node_modules segment:
  # a hoisted consumer root, or the package itself for a global install.
  project_root="${pty_dir%/node_modules/*}"
  [ "$project_root" = "$pty_dir" ] && project_root="$ROOT"
  (cd "$project_root" && "$npm_bin" rebuild "${NATIVE_MODULES[@]}")
  fix_spawn_helpers "$pty_dir"
  verify_native_modules
}

case "${1:-doctor}" in
  path)
    printf '%s\n' "$NODE_BIN"
    ;;
  doctor)
    printf 'node=%s version=%s abi=%s\n' "$NODE_BIN" "$($NODE_BIN -v)" "$($NODE_BIN -p 'process.versions.modules')"
    if verify_native_modules; then
      echo "native_modules=ok"
    else
      echo "native_modules=unusable (node-pty failed to load or its spawn helper is not executable); run: scripts/node-runtime.sh repair" >&2
      exit 1
    fi
    ;;
  repair)
    repair_native_modules
    echo "native_modules=repaired"
    ;;
  exec)
    shift
    fix_spawn_helpers "$(resolve_node_pty_dir || true)"
    verify_native_modules || {
      echo "Townmouse native modules do not match $($NODE_BIN -v). Run: scripts/node-runtime.sh repair" >&2
      exit 70
    }
    exec "$NODE_BIN" "$@"
    ;;
  run)
    shift
    verify_native_modules || {
      echo "Townmouse native modules do not match $($NODE_BIN -v). Run: scripts/node-runtime.sh repair" >&2
      exit 70
    }
    exec "$@"
    ;;
  *)
    echo "Usage: $0 {path|doctor|repair|exec NODE_ARGS...|run COMMAND...}" >&2
    exit 64
    ;;
esac
