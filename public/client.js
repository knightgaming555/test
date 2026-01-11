// client.js - two-way screen share with fullscreen fix + quality knobs
const socket = io();

const pcConfig = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };

let pc = null;
let localStream = null;
let room = null;
let clientId = null;

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

localFullBtn.onclick = () => enterFullscreen(localVideo);

function appendLog(el, txt){ el.textContent = txt; }

// ---------- Fullscreen helpers (fixes black screen) ----------
async function enterFullscreen(el){
  if (!el) return;
  // request fullscreen on the video element (not wrapper)
  try {
    if (el.requestFullscreen) await el.requestFullscreen();
    else if (el.webkitRequestFullscreen) await el.webkitRequestFullscreen();
    else if (el.msRequestFullscreen) await el.msRequestFullscreen();
  } catch (err) {
    console.warn('Fullscreen request failed', err);
  }
  // ensure playback restarts and force a repaint
  try { await el.play(); } catch (e) { /* ignore */ }
  forceRepaint(el);
}

function forceRepaint(el){
  // a tiny GPU hint and repaint hack that's effective in most browsers
  el.style.transform = 'translateZ(0)';
  // small timeout to clear the hack
  setTimeout(() => { el.style.transform = ''; }, 120);
}

// handle fullscreen change to re-play & repaint remote video(s)
function onFullScreenChange(){
  const fs = document.fullscreenElement || document.webkitFullscreenElement || document.msFullscreenElement;
  if (fs && fs.tagName === 'VIDEO') {
    try { fs.play(); } catch (e) {}
    forceRepaint(fs);
  } else {
    // when exiting fullscreen, try to play local video again
    try { localVideo.play(); } catch (e) {}
  }
}
document.addEventListener('fullscreenchange', onFullScreenChange);
document.addEventListener('webkitfullscreenchange', onFullScreenChange);
document.addEventListener('msfullscreenchange', onFullScreenChange);
// ---------------------------------------------------------------

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
    // try to find an existing element by stream id
    const id = stream.id || (e.track && e.track.id) || Math.random().toString(36).slice(2,9);
    let wrapper = document.getElementById('wrapper-' + id);
    let videoEl = document.getElementById('remote-' + id);

    if (!videoEl) {
      // create elements
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
      videoEl.addEventListener('dblclick', () => enterFullscreen(videoEl));

      wrapper = document.createElement('div');
      wrapper.id = 'wrapper-' + id;
      wrapper.className = 'video-card';
      const badge = document.createElement('div');
      badge.className = 'badge';
      badge.textContent = 'Remote';
      wrapper.appendChild(badge);
      wrapper.appendChild(videoEl);

      // fullscreen button (keeps focus on video element)
      const btn = document.createElement('button');
      btn.textContent = 'Fullscreen';
      btn.style.marginTop = '8px';
      btn.onclick = () => enterFullscreen(videoEl);
      wrapper.appendChild(btn);

      remotesContainer.appendChild(wrapper);
    }

    // attach stream then play
    if (videoEl.srcObject !== stream) {
      try {
        videoEl.srcObject = stream;
        // small delay then play to avoid black frame issues in some browsers
        setTimeout(() => {
          videoEl.play().catch(()=>{});
          forceRepaint(videoEl);
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
  } catch (e) {
    // browsers may refuse, ignore
  }
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

  // stop sharing when user stops in browser
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
  clientId = socket.id;
  appendLog(localInfo, 'Connected: ' + clientId);
});

socket.on('peer-joined', () => {
  appendLog(localInfo, `Peer joined`);
});

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

// double-click local video to fullscreen
localVideo.addEventListener('dblclick', () => enterFullscreen(localVideo));
