#!/bin/bash
# Double-click to start the PadelVAR camera replay system.
cd "$(dirname "$0")" || exit 1
clear
echo "================================"
echo "     PadelVAR — Camera Replay"
echo "================================"
echo

# Node?
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is not installed. Get it from https://nodejs.org (LTS), then run this again."
  read -p "Press Enter to close."; exit 1
fi
# FFmpeg?
if ! command -v ffmpeg >/dev/null 2>&1; then
  echo "FFmpeg is not installed."
  echo "Install it once with Homebrew:  brew install ffmpeg"
  echo "(Homebrew: https://brew.sh )  then run this again."
  read -p "Press Enter to close."; exit 1
fi
# camera configured?
if [ ! -f config.json ]; then
  echo "No config.json yet."
  echo "Copy config.example.json to config.json and put your camera's RTSP URL in it,"
  echo "then run this again. (See README.md for the URL format for your camera brand.)"
  read -p "Press Enter to close."; exit 1
fi

# free old copy on port 4000
PID=$(lsof -ti tcp:4000 2>/dev/null); [ -n "$PID" ] && kill -9 $PID 2>/dev/null; sleep 1

# deps
if [ ! -d node_modules ]; then
  echo "First-time setup — installing..."
  npm install || { echo "Install failed."; read -p "Press Enter to close."; exit 1; }
  echo
fi

echo "Starting. Your browser will open automatically."
echo "  • Keep THIS window open while using it."
echo "  • Wait ~30s after the camera connects, then press REPLAY."
echo "--------------------------------"
echo
node server.js
