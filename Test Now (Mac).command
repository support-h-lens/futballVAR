#!/bin/bash
# Try PadelVAR replay RIGHT NOW with no camera — uses a built-in test pattern.
# (To test with your Mac's camera instead, change SOURCE=test to SOURCE=webcam below.)
cd "$(dirname "$0")" || exit 1
clear
echo "=========================================="
echo "   PadelVAR — Test Now (no camera needed)"
echo "=========================================="
echo
if ! command -v node >/dev/null 2>&1; then echo "Install Node.js from https://nodejs.org then retry."; read -p "Enter to close."; exit 1; fi
if ! command -v ffmpeg >/dev/null 2>&1; then echo "Install FFmpeg:  brew install ffmpeg  (see https://brew.sh) then retry."; read -p "Enter to close."; exit 1; fi
PID=$(lsof -ti tcp:4000 2>/dev/null); [ -n "$PID" ] && kill -9 $PID 2>/dev/null; sleep 1
[ -d node_modules ] || { echo "First-time setup..."; npm install || { read -p "Enter to close."; exit 1; }; }
echo "Starting. Browser opens automatically."
echo "Wait ~30 seconds for the buffer to fill, then press REPLAY."
echo "(Keep this window open. Close it to stop.)"
echo "------------------------------------------"
echo
SOURCE=test node server.js
