#!/bin/bash
# Test PadelVAR with your Mac's built-in camera (or a GoPro in USB "webcam" mode).
# macOS will ask Terminal for camera permission the first time — allow it.
cd "$(dirname "$0")" || exit 1
clear
echo "==========================================="
echo "   PadelVAR — Test with this Mac's camera"
echo "==========================================="
echo
if ! command -v node >/dev/null 2>&1; then echo "Install Node.js from https://nodejs.org then retry."; read -p "Enter to close."; exit 1; fi
if ! command -v ffmpeg >/dev/null 2>&1; then echo "Install FFmpeg:  brew install ffmpeg  then retry."; read -p "Enter to close."; exit 1; fi
PID=$(lsof -ti tcp:4000 2>/dev/null); [ -n "$PID" ] && kill -9 $PID 2>/dev/null; sleep 1
[ -d node_modules ] || { echo "First-time setup..."; npm install || { read -p "Enter to close."; exit 1; }; }
echo "Starting with the Mac camera. Browser opens automatically."
echo "Wait ~30 seconds, then press REPLAY. (Keep this window open.)"
echo "-------------------------------------------"
echo
SOURCE=webcam node server.js
