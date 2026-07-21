// PadelVAR RTSP — portable 30-second instant replay from an IP camera.
// One FFmpeg pulls the camera's RTSP stream into a rolling buffer of 6 x 5s
// segments (= last 30s). Press REPLAY: the current 6 segments are joined into
// a single MP4 and played back (plays in any browser, works offline).
// A low-rate still "monitor" lets you aim the camera. No internet streaming, no AI.

const express = require('express');
const { spawn, execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

// ---- config ----
let cfg = {};
try { cfg = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'))); } catch (e) {}
const RTSP      = process.env.PADEL_RTSP || cfg.rtsp || '';
const PORT      = Number(process.env.PORT || cfg.port || 4000);
const SEG       = Number(cfg.segmentSeconds || 5);
const WINDOW    = Number(cfg.windowSegments || 6);   // 6 x 5s = 30s
const TRANSCODE = process.env.TRANSCODE === '1' || cfg.transcode === true;
// source: 'rtsp' (real camera), 'webcam' (this computer's camera, for testing),
// or 'test' (a built-in moving test pattern, no camera needed).
const SOURCE    = process.env.SOURCE || cfg.source || (RTSP ? 'rtsp' : 'test');
const HAS_SOURCE = SOURCE === 'webcam' || SOURCE === 'test' || (SOURCE === 'rtsp' && !!RTSP);
// auto-delete saved clips after this many hours (0 = never). Default: 24h.
const CLIP_MAX_HOURS = Number(process.env.CLIP_MAX_HOURS != null ? process.env.CLIP_MAX_HOURS
                             : (cfg.clipMaxHours != null ? cfg.clipMaxHours : 24));

const LIVE = path.join(__dirname, 'live');
const REPLAY = path.join(__dirname, 'replay');
for (const d of [LIVE, REPLAY]) { fs.rmSync(d, { recursive: true, force: true }); fs.mkdirSync(d, { recursive: true }); }

// ---- live MJPEG stream (smooth, low-lag) fanned out to browser clients ----
const mjpegClients = new Set();
let mjpegAcc = Buffer.alloc(0);
const SOI = Buffer.from([0xFF, 0xD8]), EOI = Buffer.from([0xFF, 0xD9]);
function onMjpegChunk(chunk) {
  mjpegAcc = Buffer.concat([mjpegAcc, chunk]);
  while (true) {
    const s = mjpegAcc.indexOf(SOI);
    if (s < 0) { if (mjpegAcc.length > 4000000) mjpegAcc = Buffer.alloc(0); break; }
    const e = mjpegAcc.indexOf(EOI, s + 2);
    if (e < 0) { if (s > 0) mjpegAcc = mjpegAcc.slice(s); break; }
    const frame = mjpegAcc.slice(s, e + 2);
    mjpegAcc = mjpegAcc.slice(e + 2);
    for (const res of mjpegClients) {
      try {
        res.write(`--frame\r\nContent-Type: image/jpeg\r\nContent-Length: ${frame.length}\r\n\r\n`);
        res.write(frame); res.write('\r\n');
      } catch (_) {}
    }
  }
}

if (SOURCE === 'rtsp' && !RTSP) {
  console.error('\n  No camera RTSP URL set.');
  console.error('  Put it in config.json  ->  { "rtsp": "rtsp://user:pass@CAMERA-IP:554/..." }');
  console.error('  or test now without a camera:  SOURCE=test npm start   (built-in pattern)');
  console.error('  or use this computer\'s camera:  SOURCE=webcam npm start\n');
}

// ---- one ffmpeg: RTSP -> rolling HLS segments ----
let ff = null;
function startFfmpeg() {
  // pick the input based on source
  let inputArgs, needTranscode;
  if (SOURCE === 'webcam') {                       // this computer's camera (macOS / Windows / Linux)
    const idx = String(cfg.webcamIndex || '0');
    // Some cameras (e.g. GoPro) only offer certain sizes. Set webcamSize/webcamFps in config.json
    // to match what your camera supports (run: ffmpeg -f avfoundation -list_devices true -i "").
    const wsize = cfg.webcamSize || '1920x1080';   // GoPro HERO12 needs 1920x1080
    const wfps  = String(cfg.webcamFps || 30);
    // GoPro-as-webcam sends broken/jumping timestamps -> regenerate them from the wall clock,
    // otherwise the HLS segmenter can't close clean segments and the buffer never fills.
    const wclock = ['-use_wallclock_as_timestamps','1'];
    if (process.platform === 'darwin')      inputArgs = [...wclock,'-f','avfoundation','-framerate',wfps,'-video_size',wsize,'-i', idx + ':none'];
    else if (process.platform === 'win32')  inputArgs = [...wclock,'-f','dshow','-i','video=' + (cfg.webcamName || 'Integrated Camera')];
    else                                    inputArgs = [...wclock,'-f','v4l2','-framerate',wfps,'-video_size',wsize,'-i','/dev/video' + idx];
    needTranscode = true;
  } else if (SOURCE === 'test') {                   // built-in moving pattern, no camera needed
    inputArgs = ['-f','lavfi','-i','testsrc=size=1280x720:rate=30'];
    needTranscode = true;
  } else {                                          // real camera over RTSP
    if (!RTSP) return;
    inputArgs = ['-rtsp_transport','tcp','-hwaccel','none','-analyzeduration','10000000','-probesize','10000000','-fflags','+discardcorrupt','-i', RTSP];
    needTranscode = TRANSCODE;
  }
  const vcodec = needTranscode
    ? ['-c:v','libx264','-preset','veryfast','-pix_fmt','yuv420p',
       '-force_key_frames', 'expr:gte(t,n_forced*' + SEG + ')',  // clean keyframe at each segment (no green)
       '-sc_threshold','0','-g', String(SEG*30)]
    : ['-c:v','copy'];
  // for live webcams, pin a constant output frame rate so segments are exactly SEG seconds
  const fpsFix = (SOURCE === 'webcam') ? ['-vsync','cfr','-r', String(cfg.webcamFps || 30)] : [];
  const args = [
    '-nostdin','-loglevel','warning', ...inputArgs,
    '-an', ...vcodec, ...fpsFix, '-f','hls','-hls_time', String(SEG),'-hls_list_size', String(WINDOW),
    '-hls_flags','delete_segments+independent_segments+omit_endlist',
    '-hls_segment_type','mpegts','-hls_segment_filename', path.join(LIVE,'seg_%05d.ts'),
    path.join(LIVE,'live.m3u8'),
    // 2nd output: low-res still frame (fallback for /api/frame)
    '-an','-r','2','-s','854x480','-q:v','8','-update','1','-y', path.join(LIVE,'monitor.jpg'),
    // 3rd output: raw MJPEG to stdout -> streamed live to the browser (smooth)
    '-an','-r','12','-s','854x480','-q:v','7','-f','mjpeg','pipe:1'
  ];
  console.log(`Starting capture (source: ${SOURCE})...`);
  mjpegAcc = Buffer.alloc(0);
  ff = spawn('ffmpeg', args);
  ff.stdout.on('data', onMjpegChunk);
  ff.stderr.on('data', d => process.stdout.write('[ffmpeg] ' + d));
  ff.on('exit', code => { console.log(`ffmpeg exited (${code}); retrying in 3s...`); ff = null; setTimeout(startFfmpeg, 3000); });
}
startFfmpeg();

// list current completed segments (in order) from the live playlist
function currentSegments() {
  const m3u8 = path.join(LIVE, 'live.m3u8');
  if (!fs.existsSync(m3u8)) return [];
  return fs.readFileSync(m3u8, 'utf8').split('\n').map(s => s.trim())
    .filter(s => s && !s.startsWith('#') && s.endsWith('.ts'));
}

// ---- replay: join current segments into one MP4 ----
function makeReplay(cb) {
  const segs = currentSegments();
  if (!segs.length) return cb(new Error('buffer not ready'));
  const id = Date.now();
  const listFile = path.join(REPLAY, `list_${id}.txt`);
  fs.writeFileSync(listFile, segs.map(s => `file '${path.join(LIVE, s).replace(/'/g,"'\\''")}'`).join('\n'));
  const outName = `clip_${id}.mp4`;
  const out = path.join(REPLAY, outName);
  execFile('ffmpeg', ['-nostdin','-loglevel','error','-fflags','+genpts','-f','concat','-safe','0','-i',listFile,
                      '-c','copy','-avoid_negative_ts','make_zero','-movflags','+faststart', out], (err) => {
    try { fs.unlinkSync(listFile); } catch (e) {}
    if (err) return cb(err);
    cleanupReplays();
    cb(null, { url: `/replay/${outName}`, id: String(id), watchUrl: `/watch/${id}`, seconds: segs.length * SEG });
  });
}
function cleanupReplays() {
  const now = Date.now();
  const maxAgeMs = CLIP_MAX_HOURS > 0 ? CLIP_MAX_HOURS * 3600 * 1000 : Infinity;
  let mp4s = fs.readdirSync(REPLAY).filter(f => f.endsWith('.mp4'))
    .map(f => ({ f, t: fs.statSync(path.join(REPLAY, f)).mtimeMs }));
  // 1) delete clips older than CLIP_MAX_HOURS (24h by default)
  mp4s = mp4s.filter(({ f, t }) => {
    if (now - t > maxAgeMs) { try { fs.unlinkSync(path.join(REPLAY, f)); } catch (e) {} return false; }
    return true;
  });
  // 2) also cap the total to the newest 200 (safety for very busy days)
  mp4s.sort((a, b) => b.t - a.t).slice(200)
    .forEach(({ f }) => { try { fs.unlinkSync(path.join(REPLAY, f)); } catch (e) {} });
}
// sweep on start, then every hour — so old clips expire even when no new replays are made
cleanupReplays();
setInterval(cleanupReplays, 60 * 60 * 1000);

// (the live monitor frame is now written directly by FFmpeg at ~4 fps — see args above)

// ---- web ----
const app = express();
// allow the separate button-site and replays-site (different origins) to call this backend
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', '*');
  res.header('Access-Control-Allow-Methods', 'GET,OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});
app.use('/replay', express.static(REPLAY));
app.get('/api/status', (req, res) => res.json({
  camera: HAS_SOURCE, source: SOURCE, capturing: currentSegments().length > 0, window: WINDOW * SEG
}));
app.get('/api/frame', (req, res) => {
  const f = path.join(LIVE, 'monitor.jpg');
  if (!fs.existsSync(f)) return res.status(503).end();
  res.set('Cache-Control','no-store'); res.sendFile(f);
});
app.get('/api/mjpeg', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'multipart/x-mixed-replace; boundary=frame',
    'Cache-Control': 'no-store', 'Pragma': 'no-cache', 'Connection': 'close'
  });
  mjpegClients.add(res);
  req.on('close', () => { mjpegClients.delete(res); try { res.end(); } catch (_) {} });
});
app.get('/api/replay', (req, res) => {
  makeReplay((err, r) => {
    if (err) return res.status(503).json({ error: 'buffer not ready — wait a few seconds after the camera starts' });
    res.json(r);
  });
});
// list all saved clips (newest first) for the Clips page
app.get('/api/clips', (req, res) => {
  let list = [];
  try {
    list = fs.readdirSync(REPLAY).filter(f => /^clip_\d+\.mp4$/.test(f))
      .map(f => { const id = f.match(/clip_(\d+)\.mp4/)[1]; return { id, url: `/replay/${f}`, watchUrl: `/watch/${id}`, time: Number(id) }; })
      .sort((a, b) => b.time - a.time);
  } catch (e) {}
  res.json(list);
});
// shareable replay page: /watch/<id> plays that saved clip
app.get('/watch/:id', (req, res) => res.sendFile(path.join(__dirname, 'public', 'watch.html')));
// the Clips library page
app.get('/clips', (req, res) => res.sendFile(path.join(__dirname, 'public', 'clips.html')));
app.use(express.static(path.join(__dirname, 'public')));

app.listen(PORT, () => {
  const url = `http://localhost:${PORT}`;
  console.log(`\n1/2 Lens VAR running on ${url}`);
  let lan = null;
  const ifs = os.networkInterfaces();
  for (const name of Object.keys(ifs)) for (const i of ifs[name]) if (i.family === 'IPv4' && !i.internal) { lan = i.address; break; }
  if (lan) console.log(`On your phone (same Wi-Fi), open:  http://${lan}:${PORT}`);
  console.log(`Source: ${SOURCE}   Buffer: ${WINDOW} x ${SEG}s = ${WINDOW*SEG}s\n`);
  const cmd = process.platform === 'darwin' ? `open "${url}"`
            : process.platform === 'win32' ? `start "" "${url}"` : `xdg-open "${url}"`;
  if (process.env.NO_OPEN !== '1') require('child_process').exec(cmd, () => {});
});
