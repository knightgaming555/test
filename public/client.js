// public/client.js
// Fix: Local video uses standard fullscreen to avoid feedback loops/green artifacts
// Remote videos use Canvas fallback to fix decoding glitches

const socket = io();
const pcConfig = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };

let pc = null;
let localStream = null;
let room = null;

// UI Elements
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

// Join Room
joinBtn.onclick = () => {
  room = roomInput.value.trim();
  if (!room) return alert('Enter a room ID.');
  socket.emit('join', room);
  joinBtn.disabled = true;
  roomInput.disabled = true;
  shareBtn.disabled = false;
  appendLog(localInfo, `Joined ${room}`);
};

// Copy URL
copyUrlBtn.onclick = async () => {
  const url = `${location.origin}${location.pathname}?room=${encodeURIComponent(room)}`;
  try { await navigator.clipboard.writeText(url); appendLog(localInfo, 'Room link copied'); }
  catch { appendLog(localInfo, 'Copy failed'); }
};

// --- FIX 1: Local Video uses Standard Fullscreen (Lightweight) ---
localFullBtn.onclick = () => requestStandardFullscreen(localVideo);
localVideo.addEventListener('dblclick', () => requestStandardFullscreen(localVideo));

function requestStandardFullscreen(elem) {
  try {
    if (elem.requestFullscreen) elem.requestFullscreen();
    else if (elem.webkitRequestFullscreen) elem.webkitRequestFullscreen();
    else if (elem.msRequestFullscreen) elem.msRequestFullscreen();
  } catch (e) {
    console.warn("Fullscreen failed", e);
  }
}

function appendLog(el, txt){ el.textContent = txt; }

// ---------------- Robust canvas fullscreen (For Remote Streams Only) ----------------
const canvasState = new Map();

function makeCanvas(videoEl) {
  const useOffscreen = typeof OffscreenCanvas !== 'undefined';
  const w = videoEl.videoWidth || 1280;
  const h = videoEl.videoHeight || 720;

  if (useOffscreen) {
    try {
      const off = new OffscreenCanvas(w, h);
      const ctx = off.getContext('2d', { willReadFrequently: true, alpha: false });
      return { canvas: off, ctx, isOffscreen: true, w, h };
    } catch (e) {}
  }

  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true, alpha: false });
  ctx.imageSmoothingEnabled = true;
  return { canvas: c, ctx, isOffscreen: false, w, h };
}

function startRvfcDraw(videoEl, state) {
  let running = true;
  const loop = (now, meta) => {
    if (!running) return;
    createImageBitmap(videoEl).then(bitmap => {
      try {
        if (state.canvas.width !== bitmap.width || state.canvas.height !== bitmap.height) {
          state.canvas.width = bitmap.width;
          state.canvas.height = bitmap.height;
        }
        state.ctx.drawImage(bitmap, 0, 0, state.canvas.width, state.canvas.height);
        bitmap.close?.();
      } catch (e) { console.warn('draw error', e); }
      finally {
        if (running && videoEl.requestVideoFrameCallback) state.rvfcId = videoEl.requestVideoFrameCallback(loop);
        else state.rafId = requestAnimationFrame(rafLoop);
      }
    }).catch(() => { if (running) state.rafId = requestAnimationFrame(rafLoop); });
  };
  const rafLoop = () => {
    if (!running) return;
    try {
      if (state.canvas.width !== videoEl.videoWidth || state.canvas.height !== videoEl.videoHeight) {
        state.canvas.width = videoEl.videoWidth || state.canvas.width;
        state.canvas.height = videoEl.videoHeight || state.canvas.height;
      }
      state.ctx.drawImage(videoEl, 0, 0, state.canvas.width, state.canvas.height);
    } catch (e) {}
    state.rafId = requestAnimationFrame(rafLoop);
  };

  if (videoEl.requestVideoFrameCallback) state.rvfcId = videoEl.requestVideoFrameCallback(loop);
  else state.rafId = requestAnimationFrame(rafLoop);

  return () => {
    running = false;
    if (state.rvfcId && videoEl.cancelVideoFrameCallback) videoEl.cancelVideoFrameCallback(state.rvfcId);
    if (state.rafId) cancelAnimationFrame(state.rafId);
  };
}

async function canvasFullscreenFallback(videoEl) {
  if (!videoEl || canvasState.has(videoEl)) return;
  try { await videoEl.play(); } catch (e) {}

  const { canvas, ctx, isOffscreen } = makeCanvas(videoEl);
  const domCanvas = isOffscreen ? (() => {
    const p = document.createElement('canvas');
    p.style.cssText = 'width:100%;height:100%;display:block;background:#000;';
    return { placeholder: p, isProxy: true };
  })() : { placeholder: canvas, isProxy: false };

  if (!domCanvas.isProxy) {
    canvas.style.cssText = 'width:100%;height:100%;display:block;background:#000;';
  }

  const prevVis = videoEl.style.visibility;
  videoEl.style.visibility = 'hidden';
  const wrapper = videoEl.parentElement || document.body;
  wrapper.appendChild(domCanvas.placeholder);

  const state = {
    canvas, ctx, isOffscreen,
    prevVisibility: prevVis,
    placeholderEl: domCanvas.placeholder,
    stopFn: null
  };
  canvasState.set(videoEl, state);

  if (isOffscreen) {
    const drawToOffscreen = () => {
      try {
        if (canvas.width !== videoEl.videoWidth || canvas.height !== videoEl.videoHeight) {
          canvas.width = videoEl.videoWidth || canvas.width;
          canvas.height = videoEl.videoHeight || canvas.height;
        }
        state.ctx.drawImage(videoEl, 0, 0, canvas.width, canvas.height);
        const bmp = canvas.transferToImageBitmap();
        const phCtx = state.placeholderEl.getContext('2d');
        if (state.placeholderEl.width !== bmp.width || state.placeholderEl.height !== bmp.height) {
          state.placeholderEl.width = bmp.width;
          state.placeholderEl.height = bmp.height;
        }
        phCtx.drawImage(bmp, 0, 0);
        bmp.close?.();
      } catch (e) {}
      if (videoEl.requestVideoFrameCallback) state.rvfcId = videoEl.requestVideoFrameCallback(drawToOffscreen);
      else state.rafId = requestAnimationFrame(drawToOffscreen);
    };
    if (videoEl.requestVideoFrameCallback) state.rvfcId = videoEl.requestVideoFrameCallback(drawToOffscreen);
    else state.rafId = requestAnimationFrame(drawToOffscreen);
    
    state.stopFn = () => {
      if (state.rvfcId && videoEl.cancelVideoFrameCallback) videoEl.cancelVideoFrameCallback(state.rvfcId);
      if (state.rafId) cancelAnimationFrame(state.rafId);
      if (state.placeholderEl.parentNode) state.placeholderEl.parentNode.removeChild(state.placeholderEl);
      videoEl.style.visibility = state.prevVisibility || '';
      canvasState.delete(videoEl);
    };
  } else {
    const stopLoop = startRvfcDraw(videoEl, state);
    state.stopFn = () => {
      stopLoop();
      if (state.canvas.parentNode) state.canvas.parentNode.removeChild(state.canvas);
      videoEl.style.visibility = state.prevVisibility || '';
      canvasState.delete(videoEl);
    };
  }

  const nodeToFs = state.placeholderEl || state.canvas;
  try {
    if (nodeToFs.requestFullscreen) await nodeToFs.requestFullscreen();
    else if (nodeToFs.webkitRequestFullscreen) await nodeToFs.webkitRequestFullscreen();
  } catch (e) {
    state.stopFn();
    try { videoEl.requestFullscreen(); } catch {}
    return;
  }

  const onFsChange = () => {
    if (!(document.fullscreenElement || document.webkitFullscreenElement)) {
      state.stopFn();
      document.removeEventListener('fullscreenchange', onFsChange);
      document.removeEventListener('webkitfullscreenchange', onFsChange);
    }
  };
  document.addEventListener('fullscreenchange', onFsChange);
  document.addEventListener('webkitfullscreenchange', onFsChange);
}
// -------------------------------------------------------------------------

function addLocalTracksToPc(pc, stream) {
  const senders = pc.getSenders();
  const videoTrack = stream.getVideoTracks()[0];
  let replaced = false;

  if (senders.length) {
    for (const s of senders) {
      if (s.track && s.track.kind === 'video') {
        s.replaceTrack(videoTrack).catch(() => {});
        trySetMaxBitrate(s, 8000);
        replaced = true;
        break;
      }
    }
  }

  if (!replaced) {
    stream.getTracks().forEach(track => {
      const s = pc.addTrack(track, stream);
      trySetMaxBitrate(s, 8000);
    });
  }
}

function ensurePeerConnection(){
  if (pc) return pc;
  pc = new RTCPeerConnection(pcConfig);

  pc.onicecandidate = (e) => {
    if (e.candidate) socket.emit('ice-candidate', { room, candidate: e.candidate });
  };

  pc.ontrack = (e) => {
    const stream = e.streams[0] || new MediaStream([e.track]);
    const id = stream.id; 
    let videoEl = document.getElementById('remote-' + id);
    const domId = 'remote-' + (videoEl ? id : Math.random().toString(36).substr(2,9));
    
    if (!videoEl) {
      const wrapper = document.createElement('div');
      wrapper.className = 'video-card';
      wrapper.id = 'wrapper-' + domId;
      
      videoEl = document.createElement('video');
      videoEl.id = domId;
      videoEl.autoplay = true;
      videoEl.playsInline = true;
      videoEl.controls = false;
      videoEl.style.width = '100%';
      videoEl.style.background = '#000';
      // Remotes still use the robust canvas fullscreen fallback
      videoEl.addEventListener('dblclick', () => canvasFullscreenFallback(videoEl));

      const btn = document.createElement('button');
      btn.textContent = 'Fullscreen';
      btn.style.marginTop = '5px';
      btn.onclick = () => canvasFullscreenFallback(videoEl);

      wrapper.appendChild(document.createTextNode('Remote Stream'));
      wrapper.appendChild(videoEl);
      wrapper.appendChild(btn);
      remotesContainer.appendChild(wrapper);
    }

    if (videoEl.srcObject !== stream) {
      videoEl.srcObject = stream;
      videoEl.play().catch(console.error);
    }
  };
  
  return pc;
}

async function trySetMaxBitrate(sender, kbps) {
  if (!sender || !sender.getParameters) return;
  try {
    const params = sender.getParameters();
    if (!params.encodings) params.encodings = [{}];
    params.encodings[0].maxBitrate = kbps * 1000;
    params.encodings[0].priority = 'high';
    await sender.setParameters(params);
  } catch (e) {}
}

shareBtn.onclick = async () => {
  if (!room) return alert('Join a room first.');
  const q = qualitySelect.value;
  let constraints;
  
  if (q === 'high') constraints = { video: { width: 1920, height: 1080, frameRate: 60 }, audio: false };
  else if (q === 'medium') constraints = { video: { width: 1280, height: 720, frameRate: 30 }, audio: false };
  else constraints = { video: { width: 854, height: 480, frameRate: 24 }, audio: false };

  try {
    localStream = await navigator.mediaDevices.getDisplayMedia(constraints);
  } catch (err) { return alert('Share failed: ' + err.message); }

  localVideo.srcObject = localStream;
  localVideo.play().catch(()=>{});
  shareBtn.disabled = true;
  stopBtn.disabled = false;

  ensurePeerConnection();
  addLocalTracksToPc(pc, localStream);

  try {
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    socket.emit('offer', { room, desc: pc.localDescription });
  } catch (e) { console.error('Offer failed', e); }

  localStream.getVideoTracks()[0].onended = () => stopSharing();
};

function stopSharing() {
  if (localStream) {
    localStream.getTracks().forEach(t => t.stop());
    localStream = null;
    localVideo.srcObject = null;
  }
  // No complex cleanup needed for local video now
  shareBtn.disabled = false;
  stopBtn.disabled = true;
}

socket.on('connect', () => appendLog(localInfo, 'Connected'));

socket.on('peer-joined', async () => {
  appendLog(localInfo, `Peer joined.`);
  if (localStream && pc) {
    appendLog(localInfo, 'Syncing stream to new peer...');
    try {
      addLocalTracksToPc(pc, localStream);
      const offer = await pc.createOffer({ offerToReceiveVideo: true });
      await pc.setLocalDescription(offer);
      socket.emit('offer', { room, desc: pc.localDescription });
    } catch (e) { console.error('Error syncing to new peer', e); }
  }
});

socket.on('offer', async ({ from, desc }) => {
  ensurePeerConnection();
  try {
    await pc.setRemoteDescription(desc);
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    socket.emit('answer', { room, desc: pc.localDescription });
  } catch (e) { console.error('Handle offer error', e); }
});

socket.on('answer', async ({ from, desc }) => {
  if (!pc) return;
  try { await pc.setRemoteDescription(desc); } catch (e) {}
});

socket.on('ice-candidate', async ({ candidate }) => {
  try { await ensurePeerConnection().addIceCandidate(candidate); } catch (e) {}
});

const p = new URLSearchParams(location.search);
if (p.get('room')) roomInput.value = p.get('room');
