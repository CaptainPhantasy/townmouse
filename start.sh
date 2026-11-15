#!/bin/bash

# Townmouse startup script (developer convenience).

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PORT=${PORT:-11001}

echo "Townmouse"
echo "========="
echo ""
echo "Checking dependencies..."

if ! command -v node > /dev/null; then
    echo "ERROR: Node.js is not installed. Install Node.js 22.x first."
    exit 1
fi

echo "OK: Node.js $(node -v)"

if [ ! -d "$SCRIPT_DIR/node_modules" ]; then
    echo ""
    echo "Installing dependencies..."
    cd "$SCRIPT_DIR"
    npm install
else
    echo "OK: dependencies already installed"
fi

echo ""
echo "Starting Townmouse..."
echo "   URL: http://localhost:$PORT"
echo "   Ctrl+C to stop"
echo ""

cd "$SCRIPT_DIR"
PORT=$PORT node src/server.js
