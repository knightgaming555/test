// client.js - two-way screen share with quality knobs and fullscreen
const socket = io();

const pcConfig = {
  iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
};

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

localFullBtn.onclick = () => requestFullscreen(localVideo);

function appendLog(el, txt){
  el.textContent = txt;
}

// utility: request fullscreen for element
async function requestFullscreen(el){
  if (!el) return;
  if (el.requestFullscreen) return el.requestFullscreen();
  if (el.webkitRequestFullscreen) return el.webkitRequestFullscreen();
  if (el.msRequestFullscreen) return el.msRequestFullscreen();
}

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
    // identify stream by remote id in track's id + stream id, but we'll use track.id + stream.id
    const id = stream.id || e.track.id;
    const from = e.track?.id || id;
    // check if video element exists for this stream
    let videoEl = document.getElementById('remote-' + id);
    if (!videoEl) {
      videoEl = document.createElement('video');
      videoEl.id = 'remote-' + id;
      videoEl.autoplay = true;
      videoEl.playsInline = true;
      videoEl.controls = false;
      videoEl.style.display = 'block';
      videoEl.style.width = '100%';
      videoEl.style.maxHeight = '60vh';
      videoEl.addEventListener('dblclick', () => requestFullscreen(videoEl));
      // add a small badge
      const wrapper = document.createElement('div');
      wrapper.className = 'video-card';
      const badge = document.createElement('div');
      badge.className = 'badge';
      badge.textContent = 'Remote';
      wrapper.appendChild(badge);
      wrapper.appendChild(videoEl);
      remotesContainer.appendChild(wrapper);

      // add fullscreen button
      const btn = document.createElement('button');
      btn.textContent = 'Fullscreen';
      btn.onclick = () => requestFullscreen(videoEl);
      wrapper.appendChild(btn);
    }
    videoEl.srcObject = stream;
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
      // set max bitrate
      e.maxBitrate = kbps * 1000;
      // prefer performance
      e.priority = 'high';
    });
    await sender.setParameters(params);
    console.log('set sender params', params);
  } catch (e) {
    console.warn('Failed to set sender parameters', e);
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
    // ask user to share screen
    localStream = await navigator.mediaDevices.getDisplayMedia(constraints);
  } catch (err) {
    return alert('Failed to get display media: ' + (err.message || err));
  }

  localVideo.srcObject = localStream;
  shareBtn.disabled = true;
  stopBtn.disabled = false;

  ensurePeerConnection();

  // add tracks (use replaceTrack if we've already shared once)
  const senders = pc.getSenders ? pc.getSenders() : [];
  const videoTrack = localStream.getVideoTracks()[0];

  // try to reuse existing video sender by replacing track
  let replaced = false;
  if (senders && senders.length) {
    for (const s of senders) {
      if (s.track && s.track.kind === 'video') {
        try {
          await s.replaceTrack(videoTrack);
          // set bitrate target to 8 Mbps (8000 kbps) for high quality if supported
          await trySetMaxBitrate(s, 8000);
          replaced = true;
          break;
        } catch (e) {
          // ignore and continue
        }
      }
    }
  }

  if (!replaced) {
    // add new track(s)
    localStream.getTracks().forEach(track => {
      const sender = pc.addTrack(track, localStream);
      // try to increase bitrate on that sender
      trySetMaxBitrate(sender, 8000);
    });
  }

  // create an offer to notify the other peer(s)
  try {
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    socket.emit('offer', { room, desc: pc.localDescription });
  } catch (e) {
    console.error('Offer failed', e);
  }

  // stop sharing when user stops in browser
  videoTrack.addEventListener('ended', () => stopSharing());
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

// when someone else joins
socket.on('peer-joined', (peerId) => {
  appendLog(localInfo, `Peer joined`);
});

// incoming offer
socket.on('offer', async ({ from, desc }) => {
  console.log('got offer', from);
  ensurePeerConnection();
  try {
    await pc.setRemoteDescription(desc);
    // create answer
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    socket.emit('answer', { room, desc: pc.localDescription });
  } catch (e) {
    console.error('Error handling offer', e);
  }
});

// incoming answer
socket.on('answer', async ({ from, desc }) => {
  console.log('got answer', from);
  try {
    if (!pc) {
      console.warn('No pc when answer arrived');
      return;
    }
    await pc.setRemoteDescription(desc);
  } catch (e) {
    console.error('Error setting remote desc', e);
  }
});

// incoming ice
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

// parse room from URL if provided
(function hydrateFromUrl(){
  const p = new URLSearchParams(location.search);
  const r = p.get('room');
  if (r) roomInput.value = r;
})();

// double-click local video to fullscreen
localVideo.addEventListener('dblclick', () => requestFullscreen(localVideo));
