# PadelVAR RTSP — portable 30-second instant replay

Pulls one IP camera's RTSP stream into a rolling **6 × 5s = 30 second** buffer.
Press **REPLAY** to watch the last 30 seconds. No internet streaming, no AI — just replay.

```
padelvar-rtsp/
├─ server.js            # FFmpeg capture + replay builder + web server
├─ config.example.json  # copy to config.json and put your camera URL in it
├─ public/index.html    # the replay screen (REPLAY button)
└─ live/ , replay/      # auto-created working folders
```

## What you need

- A computer to run it on: a **Raspberry Pi 5**, a cheap **mini-PC (Intel N100)**, or any laptop. No GPU needed for replay-only.
- **Node.js 18+** and **FFmpeg** installed.
- Your camera's **RTSP URL** (and the camera reachable on the same network).

## 1. Set your camera URL

Copy `config.example.json` to `config.json` and edit the `rtsp` line. RTSP URL formats by brand:

- **Dahua/Amcrest:** `rtsp://user:pass@CAMERA-IP:554/cam/realmonitor?channel=1&subtype=0`
  (`subtype=0` = main stream, `subtype=1` = lower-res substream)
- **Hikvision:** `rtsp://user:pass@CAMERA-IP:554/Streaming/Channels/101`
  (`101` = main, `102` = substream)
- **TP-Link VIGI:** `rtsp://user:pass@CAMERA-IP:554/stream1` (main) or `/stream2` (sub)
- **Reolink:** `rtsp://user:pass@CAMERA-IP:554/h264Preview_01_main`

Tip: enable RTSP in the camera's settings, and make sure the stream is **H.264** (not H.265) so the replay plays in any browser. The substream is lighter if you don't need full resolution.

## 2. Run it

```bash
npm install
npm start
```

It opens `http://localhost:4000`. Open that on the same computer, or on a phone/tablet on the same Wi‑Fi at `http://THIS-COMPUTER-IP:4000`. Wait ~30s for the buffer to fill, then press **REPLAY**.

You can also pass the URL inline without a config file:

```bash
PADEL_RTSP="rtsp://user:pass@192.168.1.50:554/stream1" npm start
```

## Try it right now (no camera yet)

You don't need the camera to test the whole replay flow. There are three sources:

- **Test pattern (zero setup):** double-click **`Test Now (Mac).command`**, or run `SOURCE=test npm start`. Uses a built-in moving pattern. Wait ~30s, press REPLAY.
- **This computer's webcam:** run `SOURCE=webcam npm start` (macOS will ask Terminal for camera permission the first time). Real video, proves the full pipeline.
- **Real camera:** set `rtsp` in `config.json` (the default once a URL is present) and run normally.

Behavior is identical in all three — only the video source changes. So you can build and demo today, then just paste the camera's RTSP URL in when it arrives.

## Settings (config.json)

| Key | Default | Meaning |
|---|---|---|
| `rtsp` | — | Your camera RTSP URL |
| `port` | 4000 | Web port |
| `segmentSeconds` | 5 | Seconds per buffer chunk |
| `windowSegments` | 6 | Chunks kept (6 × 5s = 30s) |
| `transcode` | false | Set `true` only if replay won't play (forces H.264). Uses more CPU. |

For a different buffer length, change `windowSegments` (e.g. 12 = 60s).

## Portable setup notes

- Power the camera with a **PoE injector** off a **portable power station**; run this app on a Pi/mini‑PC off the same battery (one camera + replay draws ~10–25 W → a small station lasts a full evening).
- Camera and computer must be on the **same network** — use a tiny travel router, or plug the camera straight into the computer's Ethernet and give both static IPs.
- For clean 5‑second chunks, set the camera's **I‑frame interval (GOP)** to ~1 second in its settings.

## How it works

FFmpeg writes a rolling HLS playlist (auto-deleting old chunks) so only the last 30s exists at any time. On **REPLAY**, the current chunks are joined into a single MP4 (`-c copy`, instant) and played in the browser — which is why it works on any device and offline. A still "monitor" frame refreshes every ~2s so you can aim the camera.

## Troubleshooting

- **"buffer not ready"** — wait ~30s after the camera connects.
- **Replay is black / won't play** — your camera is likely H.265; switch the stream to H.264, or set `"transcode": true`.
- **No monitor image** — check the RTSP URL/credentials; watch the terminal for `[ffmpeg]` errors.
