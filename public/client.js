// public/client.js
// Two-way screen share with robust canvas-fullscreen fallback
// - uses requestVideoFrameCallback + createImageBitmap when possible
// - falls back to RAF + createImageBitmap
// - uses OffscreenCanvas when available
// - includes cleanup and retries

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

// ---------------- Robust canvas fullscreen implementation ----------------
// Map videoEl -> state { canvas, ctx, rafId, rvfcId, offscreen, stopFn }
const canvasState = new Map();

function makeCanvas(videoEl) {
  // Use OffscreenCanvas when available for performance
  const useOffscreen = typeof OffscreenCanvas !== 'undefined';
  const w = videoEl.videoWidth || 1280;
  const h = videoEl.videoHeight || 720;

  if (useOffscreen) {
    try {
      const off = new OffscreenCanvas(w, h);
      const ctx = off.getContext('2d', { willReadFrequently: true, alpha: false });
      return { canvas: off, ctx, isOffscreen: true, w, h };
    } catch (e) {
      // fallback to DOM canvas
    }
  }

  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  c.style.width = '100%';
  c.style.height = '100%';
  c.style.display = 'block';
  c.style.background = '#000';
  const ctx = c.getContext('2d', { willReadFrequently: true, alpha: false });
  ctx.imageSmoothingEnabled = true;
  return { canvas: c, ctx, isOffscreen: false, w, h };
}

// Draw using requestVideoFrameCallback + createImageBitmap (best)
function startRvfcDraw(videoEl, state) {
  let running = true;

  // wrapper to schedule next frame
  const loop = (now, meta) => {
    if (!running) return;
    // createImageBitmap is used to ensure we get a decoded frame and correct color space
    createImageBitmap(videoEl).then(bitmap => {
      try {
        // If OffscreenCanvas, draw directly. If DOM canvas, use its ctx.
        const ctx = state.ctx;
        if (state.canvas.width !== bitmap.width || state.canvas.height !== bitmap.height) {
          state.canvas.width = bitmap.width;
          state.canvas.height = bitmap.height;
        }
        ctx.drawImage(bitmap, 0, 0, state.canvas.width, state.canvas.height);
        bitmap.close?.();
      } catch (e) {
        // ignore intermittent errors
        console.warn('draw error', e);
      } finally {
        // schedule next via rvfc if still running
        if (running && videoEl.requestVideoFrameCallback) {
          state.rvfcId = videoEl.requestVideoFrameCallback(loop);
        } else {
          // fallback to RAF loop
          state.rafId = requestAnimationFrame(rafLoop);
        }
      }
    }).catch(err=>{
      // if createImageBitmap fails, fallback quickly to RAF
      if (running) state.rafId = requestAnimationFrame(rafLoop);
    });
  };

  // RAF fallback drawing step
  const rafLoop = () => {
    if (!running) return;
    try {
      if (state.canvas.width !== videoEl.videoWidth || state.canvas.height !== videoEl.videoHeight) {
        state.canvas.width = videoEl.videoWidth || state.canvas.width;
        state.canvas.height = videoEl.videoHeight || state.canvas.height;
      }
      state.ctx.drawImage(videoEl, 0, 0, state.canvas.width, state.canvas.height);
    } catch (e) {
      // ignore
    }
    state.rafId = requestAnimationFrame(rafLoop);
  };

  // start with rvfc if available
  if (videoEl.requestVideoFrameCallback) {
    try {
      state.rvfcId = videoEl.requestVideoFrameCallback(loop);
    } catch (e) {
      state.rafId = requestAnimationFrame(rafLoop);
    }
  } else {
    state.rafId = requestAnimationFrame(rafLoop);
  }

  return () => {
    running = false;
    if (state.rvfcId && videoEl.cancelVideoFrameCallback) {
      try { videoEl.cancelVideoFrameCallback(state.rvfcId); } catch {}
    }
    if (state.rafId) {
      try { cancelAnimationFrame(state.rafId); } catch {}
    }
    state.rvfcId = null;
    state.rafId = null;
  };
}

async function canvasFullscreenFallback(videoEl) {
  if (!videoEl) return;
  // if already active for this video, ignore
  if (canvasState.has(videoEl)) return;

  // make sure video is playing (some browsers need play before frames are available)
  try { await videoEl.play(); } catch (e) { /* ignore */ }

  // create canvas (Offscreen or DOM) and start draw loop
  const { canvas, ctx, isOffscreen } = makeCanvas(videoEl);
  const domCanvas = isOffscreen ? (function(){ // convert Offscreen to DOM for fullscreen: transfer to ImageBitmap on RAF
    const placeholder = document.createElement('canvas');
    placeholder.style.width = '100%';
    placeholder.style.height = '100%';
    placeholder.style.display = 'block';
    placeholder.style.background = '#000';
    // we'll draw frames into offscreen and then copy to placeholder using transferToImageBitmap
    return { placeholder, isProxy: true };
  })() : { placeholder: canvas, isProxy: false };

  // hide video but keep it playing
  const prevVis = videoEl.style.visibility;
  videoEl.style.visibility = 'hidden';

  // insert DOM canvas placeholder next to the video
  const wrapper = videoEl.parentElement || document.body;
  if (domCanvas.isProxy) {
    // add placeholder for offscreen canvas presentation
    wrapper.appendChild(domCanvas.placeholder);
  } else {
    wrapper.appendChild(canvas);
  }

  // state storage
  const state = {
    canvas: isOffscreen ? canvas : canvas, // store offscreen or dom canvas
    ctx: isOffscreen ? canvas.getContext('2d') : ctx,
    rafId: null,
    rvfcId: null,
    stopFn: null,
    prevVisibility: prevVis,
    isOffscreen,
    placeholderEl: domCanvas.isProxy ? domCanvas.placeholder : null
  };
  canvasState.set(videoEl, state);

  // Start draw loop.
  // If OffscreenCanvas was created, we'll draw into offscreen and transfer frames to placeholder using transferToImageBitmap
  if (isOffscreen) {
    // draw into offscreen using rvfc/raf, then copy to placeholder
    const drawToOffscreen = (now, meta) => {
      // createImageBitmap from video into offscreen? Instead drawImage into offscreen ctx.
      try {
        // resize offscreen if needed
        if (canvas.width !== videoEl.videoWidth || canvas.height !== videoEl.videoHeight) {
          canvas.width = videoEl.videoWidth || canvas.width;
          canvas.height = videoEl.videoHeight || canvas.height;
        }
        const offCtx = state.ctx;
        offCtx.drawImage(videoEl, 0, 0, canvas.width, canvas.height);
      } catch (e) {
        // ignore
      }
      // transfer to bitmap and paint to placeholder canvas (main thread)
      try {
        const bmp = canvas.transferToImageBitmap();
        // paint on main-thread placeholder
        const ph = state.placeholderEl;
        if (ph && ph.getContext) {
          const phCtx = ph.getContext('2d');
          if (ph.width !== bmp.width || ph.height !== bmp.height) {
            ph.width = bmp.width;
            ph.height = bmp.height;
          }
          phCtx.clearRect(0,0,ph.width,ph.height);
          phCtx.drawImage(bmp, 0, 0, ph.width, ph.height);
        }
        bmp.close?.();
      } catch (err) {
        // fallback: nothing
      } finally {
        if (videoEl.requestVideoFrameCallback) {
          state.rvfcId = videoEl.requestVideoFrameCallback(drawToOffscreen);
        } else {
          state.rafId = requestAnimationFrame(drawToOffscreen);
        }
      }
    };

    // start
    if (videoEl.requestVideoFrameCallback) state.rvfcId = videoEl.requestVideoFrameCallback(drawToOffscreen);
    else state.rafId = requestAnimationFrame(drawToOffscreen);

    // stop function
    state.stopFn = () => {
      if (state.rvfcId && videoEl.cancelVideoFrameCallback) {
        try { videoEl.cancelVideoFrameCallback(state.rvfcId); } catch {}
      }
      if (state.rafId) try { cancelAnimationFrame(state.rafId); } catch {}
      // remove placeholder
      if (state.placeholderEl && state.placeholderEl.parentNode) state.placeholderEl.parentNode.removeChild(state.placeholderEl);
      videoEl.style.visibility = state.prevVisibility || '';
      canvasState.delete(videoEl);
    };
  } else {
    // DOM canvas path: use requestVideoFrameCallback + createImageBitmap if available
    const stopLoop = startRvfcDraw(videoEl, state);
    state.stopFn = () => {
      stopLoop();
      if (state.canvas && state.canvas.parentNode) state.canvas.parentNode.removeChild(state.canvas);
      videoEl.style.visibility = state.prevVisibility || '';
      canvasState.delete(videoEl);
    };
  }

  // request fullscreen on the placeholder or canvas DOM node
  const nodeToFs = state.isOffscreen ? state.placeholderEl : state.canvas;
  if (!nodeToFs) {
    // something wrong: cleanup and try direct video fullscreen as last resort
    state.stopFn();
    try { if (videoEl.requestFullscreen) videoEl.requestFullscreen(); } catch {}
    return;
  }

  try {
    if (nodeToFs.requestFullscreen) await nodeToFs.requestFullscreen();
    else if (nodeToFs.webkitRequestFullscreen) await nodeToFs.webkitRequestFullscreen();
    else if (nodeToFs.msRequestFullscreen) await nodeToFs.msRequestFullscreen();
  } catch (err) {
    // if fullscreen failed, cleanup and fallback to direct video fullscreen
    state.stopFn();
    try { if (videoEl.requestFullscreen) await videoEl.requestFullscreen(); } catch {}
    return;
  }

  // listen for fullscreen exit to cleanup
  function onFsChange() {
    const fsEl = document.fullscreenElement || document.webkitFullscreenElement || document.msFullscreenElement;
    if (fsEl !== nodeToFs) {
      // fullscreen ended
      try { state.stopFn(); } catch (e) {}
      document.removeEventListener('fullscreenchange', onFsChange);
      document.removeEventListener('webkitfullscreenchange', onFsChange);
      document.removeEventListener('msfullscreenchange', onFsChange);
    }
  }
  document.addEventListener('fullscreenchange', onFsChange);
  document.addEventListener('webkitfullscreenchange', onFsChange);
  document.addEventListener('msfullscreenchange', onFsChange);
}
// -------------------------------------------------------------------------

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

    if (videoEl.srcObject !== stream) {
      try {
        videoEl.srcObject = stream;
        setTimeout(()=>{ videoEl.play().catch(()=>{}); }, 50);
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
  } catch (e) { /* ignore */ }
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
  // clean up any canvas state for local video
  if (canvasState.has(localVideo)) {
    try { canvasState.get(localVideo).stopFn(); } catch (e) {}
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
