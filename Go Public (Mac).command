#!/bin/bash
# Run ReplayVAR AND expose it on a public https link (so replay links open from anywhere,
# and you can install the app on a phone). Uses Cloudflare Tunnel — no account needed.
# Note: footage is served from THIS computer (stays in-Kingdom) — good for PDPL.
cd "$(dirname "$0")" || exit 1
clear
PORT=4000
echo "============================================="
echo "      ReplayVAR — Go Public (shareable)"
echo "============================================="
echo
command -v node >/dev/null 2>&1 || { echo "Install Node.js from https://nodejs.org then retry."; read -p "Enter to close."; exit 1; }
command -v ffmpeg >/dev/null 2>&1 || { echo "Install FFmpeg: brew install ffmpeg  then retry."; read -p "Enter to close."; exit 1; }
# Choose the video source:
#   - real camera if config.json exists
#   - otherwise the built-in TEST PATTERN (so you can test the public link now)
#   - to go public with THIS Mac's camera instead, change the next line to: SRC=webcam
SRC=""
if [ -f config.json ]; then
  echo "Using your configured camera (config.json)."
else
  SRC="test"
  echo "No camera configured — going public with the TEST PATTERN."
  echo "(To use this Mac's camera instead, edit this file and set  SRC=webcam )"
fi
echo

# get cloudflared (one-time)
if [ ! -x ./cloudflared ]; then
  echo "Downloading the secure tunnel tool (one-time)..."
  A=amd64; [ "$(uname -m)" = "arm64" ] && A=arm64
  curl -L --fail -o cf.tgz "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-darwin-$A.tgz" \
    || { echo "Download failed — check internet."; read -p "Enter to close."; exit 1; }
  tar -xzf cf.tgz && rm -f cf.tgz && chmod +x cloudflared && xattr -d com.apple.quarantine ./cloudflared 2>/dev/null
  echo
fi

PID=$(lsof -ti tcp:$PORT 2>/dev/null); [ -n "$PID" ] && kill -9 $PID 2>/dev/null; sleep 1
[ -d node_modules ] || npm install || { read -p "Enter to close."; exit 1; }

SOURCE="$SRC" NO_OPEN=1 node server.js > /tmp/replayvar_server.log 2>&1 &
SRV=$!
for i in $(seq 1 40); do curl -s -o /dev/null "http://localhost:$PORT" && break; sleep 0.5; done

echo "Creating your public link..."
./cloudflared tunnel --url "http://localhost:$PORT" > /tmp/replayvar_tunnel.log 2>&1 &
TUN=$!
PUB=""
for i in $(seq 1 40); do PUB=$(grep -Eo 'https://[a-z0-9-]+\.trycloudflare\.com' /tmp/replayvar_tunnel.log | head -1); [ -n "$PUB" ] && break; sleep 1; done
echo
if [ -n "$PUB" ]; then
  echo "============================================="
  echo "  ✅ PUBLIC LINK (open & share this):"
  echo
  echo "     $PUB"
  echo
  echo "  • Open it on your phone → 'Add to Home Screen' to install the ReplayVAR app."
  echo "  • Every replay's 'Open / Copy link' now works from ANY network."
  echo "  • Keep this window open. Closing it ends the public link."
  echo "============================================="
  open "$PUB"
else
  echo "Couldn't get a public link — see /tmp/replayvar_tunnel.log"
fi
trap "kill $SRV $TUN 2>/dev/null" EXIT
wait $TUN
