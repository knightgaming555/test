// public/client.js
// Two-way screen share with canvas fullscreen fallback to avoid green/black frames.

const socket = io();
const pcConfig = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };

let pc = null;
let localStream = null;
let room = null;

// UI
const localVideo = document.getElementById('localVideo');
const remotesContainer = document.getElementById('remotes');
const roomInput = document.getElementById('room');
const joinBtn = document.getElementById('join');
const shareBtn = document.getElementById('share');
const stopBtn = document.getElementById('stop');
const qualitySelect = document.getElementById('quality');
const localFullBtn = document.getElementById('local-full');
const copyUrlBtn = document.getElementById('copy-url');
const localInfo = document.getElementById('local-info');
const remoteInfo = document.getElementById('remote-info');

joinBtn.onclick = () => {
  room = roomInput.value.trim();
  if (!room) return alert('Enter a room ID.');
  socket.emit('join', room);
  joinBtn.disabled = true;
  roomInput.disabled = true;
  shareBtn.disabled = false;
  appendLog(localInfo, `Joined ${room}`);
};

copyUrlBtn.onclick = async () => {
  const url = `${location.origin}${location.pathname}?room=${encodeURIComponent(room)}`;
  try { await navigator.clipboard.writeText(url); appendLog(localInfo, 'Room link copied'); }
  catch { appendLog(localInfo, 'Copy failed'); }
};

localFullBtn.onclick = () => canvasFullscreenFallback(localVideo);

function appendLog(el, txt){ el.textContent = txt; }

// ---------- Canvas fullscreen fallback utilities ----------
const canvasState = new Map(); // map videoEl -> {canvas, ctx, rafId}

function createCanvasForVideo(videoEl){
  const rect = videoEl.getBoundingClientRect();
  const w = videoEl.videoWidth || Math.max(1280, Math.round(rect.width));
  const h = videoEl.videoHeight || Math.max(720, Math.round(rect.height));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  canvas.style.width = '100%';
  canvas.style.height = '100%';
  canvas.style.background = '#000';
  canvas.style.display = 'block';
  canvas.className = 'fullscreen-canvas';
  const ctx = canvas.getContext('2d');
  return { canvas, ctx, w, h };
}

function startCanvasDrawLoop(videoEl, canvas, ctx, dims){
  let running = true;
  async function draw(){
    if (!running) return;
    try {
      // draw current video frame
      // if video dimension changed, adjust canvas
      if (videoEl.videoWidth && videoEl.videoHeight &&
          (canvas.width !== videoEl.videoWidth || canvas.height !== videoEl.videoHeight)) {
        canvas.width = videoEl.videoWidth;
        canvas.height = videoEl.videoHeight;
      }
      ctx.drawImage(videoEl, 0, 0, canvas.width, canvas.height);
    } catch (e) {
      // ignore transient errors (video not ready)
    }
    const id = requestAnimationFrame(draw);
    canvasState.get(videoEl).rafId = id;
  }
  draw();
  return () => { running = false; };
}

function cleanupCanvasState(videoEl){
  const state = canvasState.get(videoEl);
  if (!state) return;
  if (state.rafId) cancelAnimationFrame(state.rafId);
  if (state.canvas && state.canvas.parentNode) state.canvas.parentNode.removeChild(state.canvas);
  // restore video element visibility if hidden
  videoEl.style.visibility = state.prevVisibility || '';
  canvasState.delete(videoEl);
}

// Fullscreen a canvas that mirrors the video to avoid GPU overlay issues
async function canvasFullscreenFallback(videoEl){
  if (!videoEl) return;
  // If already active for this video, just return
  if (canvasState.has(videoEl)) return;

  // Ensure video is playing
  try { await videoEl.play(); } catch (e) {}

  // create canvas and start drawing
  const { canvas, ctx } = createCanvasForVideo(videoEl);
  const prevVisibility = videoEl.style.visibility;
  // hide video but keep it playing
  videoEl.style.visibility = 'hidden';

  // insert canvas next to video element's wrapper (so CSS looks correct)
  const wrapper = videoEl.parentNode || document.body;
  wrapper.appendChild(canvas);

  canvasState.set(videoEl, { canvas, ctx, rafId: null, prevVisibility });

  // start loop
  const stopLoop = startCanvasDrawLoop(videoEl, canvas, ctx);

  // request fullscreen on canvas
  try {
    if (canvas.requestFullscreen) await canvas.requestFullscreen();
    else if (canvas.webkitRequestFullscreen) await canvas.webkitRequestFullscreen();
    else if (canvas.msRequestFullscreen) await canvas.msRequestFullscreen();
  } catch (err) {
    // fallback: try to fullscreen the video element itself if canvas fullscreen failed
    console.warn('Canvas fullscreen request failed, falling back to direct video fullscreen', err);
    cleanupCanvasState(videoEl);
    try { if (videoEl.requestFullscreen) await videoEl.requestFullscreen(); } catch {}
    return;
  }

  // store a listener to cleanup when fullscreen exits
  function onFsChange(){
    const fsEl = document.fullscreenElement || document.webkitFullscreenElement || document.msFullscreenElement;
    if (fsEl !== canvas) {
      // fullscreen ended or changed to something else -> stop and cleanup
      cleanupCanvasState(videoEl);
      document.removeEventListener('fullscreenchange', onFsChange);
      document.removeEventListener('webkitfullscreenchange', onFsChange);
      document.removeEventListener('msfullscreenchange', onFsChange);
    }
  }
  document.addEventListener('fullscreenchange', onFsChange);
  document.addEventListener('webkitfullscreenchange', onFsChange);
  document.addEventListener('msfullscreenchange', onFsChange);
}
// ------------------------------------------------------------

// create or reuse RTCPeerConnection
function ensurePeerConnection(){
  if (pc) return pc;
  pc = new RTCPeerConnection(pcConfig);

  pc.onicecandidate = (e) => {
    if (e.candidate) socket.emit('ice-candidate', { room, candidate: e.candidate });
  };

  pc.ontrack = (e) => {
    const streams = e.streams;
    if (!streams || streams.length === 0) return;
    const stream = streams[0];
    const id = stream.id || (e.track && e.track.id) || Math.random().toString(36).slice(2,9);
    let wrapper = document.getElementById('wrapper-' + id);
    let videoEl = document.getElementById('remote-' + id);

    if (!videoEl) {
      videoEl = document.createElement('video');
      videoEl.id = 'remote-' + id;
      videoEl.autoplay = true;
      videoEl.playsInline = true;
      videoEl.muted = false;
      videoEl.controls = false;
      videoEl.style.display = 'block';
      videoEl.style.width = '100%';
      videoEl.style.height = 'auto';
      videoEl.style.maxHeight = '80vh';
      videoEl.style.background = '#000';
      videoEl.addEventListener('dblclick', () => canvasFullscreenFallback(videoEl));

      wrapper = document.createElement('div');
      wrapper.id = 'wrapper-' + id;
      wrapper.className = 'video-card';
      const badge = document.createElement('div');
      badge.className = 'badge';
      badge.textContent = 'Remote';
      wrapper.appendChild(badge);
      wrapper.appendChild(videoEl);

      const btn = document.createElement('button');
      btn.textContent = 'Fullscreen';
      btn.style.marginTop = '8px';
      btn.onclick = () => canvasFullscreenFallback(videoEl);
      wrapper.appendChild(btn);

      remotesContainer.appendChild(wrapper);
    }

    // attach stream then play
    if (videoEl.srcObject !== stream) {
      try {
        videoEl.srcObject = stream;
        // small delay then play
        setTimeout(() => {
          videoEl.play().catch(()=>{});
        }, 50);
      } catch (err) {
        console.warn('Failed to set srcObject or play', err);
      }
    }

    appendLog(remoteInfo, 'Remote streams: ' + remotesContainer.querySelectorAll('video').length);
  };

  pc.onconnectionstatechange = () => {
    appendLog(localInfo, 'Connection: ' + pc.connectionState);
  };

  return pc;
}

// set sender bitrate where possible
async function trySetMaxBitrate(sender, kbps) {
  if (!sender || !sender.getParameters) return;
  try {
    const params = sender.getParameters();
    if (!params.encodings) params.encodings = [{}];
    params.encodings.forEach(e => {
      e.maxBitrate = kbps * 1000;
      e.priority = 'high';
    });
    await sender.setParameters(params);
  } catch (e) { /* ignore if not supported */ }
}

// share screen with chosen constraints
shareBtn.onclick = async () => {
  if (!room) return alert('Join a room first.');
  const q = qualitySelect.value;
  let constraints;
  if (q === 'high') constraints = { video: { width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 60 } }, audio: false };
  else if (q === 'medium') constraints = { video: { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } }, audio: false };
  else constraints = { video: { width: { ideal: 854 }, height: { ideal: 480 }, frameRate: { ideal: 24 } }, audio: false };

  try {
    localStream = await navigator.mediaDevices.getDisplayMedia(constraints);
  } catch (err) {
    return alert('Failed to get display media: ' + (err.message || err));
  }

  localVideo.srcObject = localStream;
  try { await localVideo.play(); } catch (e) {}
  shareBtn.disabled = true;
  stopBtn.disabled = false;

  ensurePeerConnection();

  const senders = pc.getSenders ? pc.getSenders() : [];
  const videoTrack = localStream.getVideoTracks()[0];

  let replaced = false;
  if (senders && senders.length) {
    for (const s of senders) {
      if (s.track && s.track.kind === 'video') {
        try {
          await s.replaceTrack(videoTrack);
          await trySetMaxBitrate(s, 8000);
          replaced = true;
          break;
        } catch (e) {}
      }
    }
  }

  if (!replaced) {
    localStream.getTracks().forEach(track => {
      const sender = pc.addTrack(track, localStream);
      trySetMaxBitrate(sender, 8000);
    });
  }

  try {
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    socket.emit('offer', { room, desc: pc.localDescription });
  } catch (e) {
    console.error('Offer failed', e);
  }

  const vt = localStream.getVideoTracks()[0];
  if (vt) vt.addEventListener('ended', () => stopSharing());
};

// stop sharing local screen
function stopSharing() {
  if (localStream) {
    localStream.getTracks().forEach(t => t.stop());
    localStream = null;
    localVideo.srcObject = null;
  }
  shareBtn.disabled = false;
  stopBtn.disabled = true;
}

// signalling handlers
socket.on('connect', () => {
  appendLog(localInfo, 'Connected');
});

socket.on('peer-joined', () => appendLog(localInfo, `Peer joined`));

socket.on('offer', async ({ from, desc }) => {
  ensurePeerConnection();
  try {
    await pc.setRemoteDescription(desc);
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    socket.emit('answer', { room, desc: pc.localDescription });
  } catch (e) {
    console.error('Error handling offer', e);
  }
});

socket.on('answer', async ({ from, desc }) => {
  try {
    if (!pc) return;
    await pc.setRemoteDescription(desc);
  } catch (e) {
    console.error('Error setting remote desc', e);
  }
});

socket.on('ice-candidate', async ({ from, candidate }) => {
  if (!candidate) return;
  try {
    await ensurePeerConnection().addIceCandidate(candidate);
  } catch (e) {
    console.warn('Error adding ICE candidate', e);
  }
});

// stop button
stopBtn.onclick = () => stopSharing();

// hydrate room from URL if provided
(function hydrateFromUrl(){
  const p = new URLSearchParams(location.search);
  const r = p.get('room');
  if (r) roomInput.value = r;
})();

// double-click local video to canvas fullscreen
localVideo.addEventListener('dblclick', () => canvasFullscreenFallback(localVideo));
