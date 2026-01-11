// client-side signalling + WebRTC for screen share
const socket = io();

const pcConfig = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' }
  ]
};

let pc = null;
let localStream = null;
let room = null;

const remoteVideo = document.getElementById('remoteVideo');
const roomInput = document.getElementById('room');
const joinBtn = document.getElementById('join');
const shareBtn = document.getElementById('share');
const stopBtn = document.getElementById('stop');

joinBtn.onclick = () => {
  room = roomInput.value.trim();
  if (!room) {
    alert('Enter a room ID.');
    return;
  }
  socket.emit('join', room);
  shareBtn.disabled = false;
  joinBtn.disabled = true;
  roomInput.disabled = true;
  console.log('joined', room);
};

socket.on('peer-joined', () => {
  console.log('peer joined the room');
});

// handle signalling
socket.on('offer', async ({ from, desc }) => {
  console.log('received offer');
  await ensurePeerConnection();
  await pc.setRemoteDescription(desc);
  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);
  socket.emit('answer', { room, desc: pc.localDescription });
});

socket.on('answer', async ({ from, desc }) => {
  console.log('received answer');
  if (!pc) return;
  await pc.setRemoteDescription(desc);
});

socket.on('ice-candidate', async ({ from, candidate }) => {
  if (!candidate) return;
  try {
    await pc?.addIceCandidate(candidate);
  } catch (e) {
    console.warn('Error adding ICE candidate', e);
  }
});

async function ensurePeerConnection() {
  if (pc) return;
  pc = new RTCPeerConnection(pcConfig);

  pc.onicecandidate = (e) => {
    if (e.candidate) {
      socket.emit('ice-candidate', { room, candidate: e.candidate });
    }
  };

  pc.ontrack = (e) => {
    console.log('remote track', e.streams);
    remoteVideo.srcObject = e.streams[0];
  };
}

shareBtn.onclick = async () => {
  if (!room) {
    alert('Join a room first.');
    return;
  }
  try {
    localStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
  } catch (err) {
    alert('Failed to get display media: ' + err.message);
    return;
  }

  await ensurePeerConnection();

  // add tracks
  localStream.getTracks().forEach(track => pc.addTrack(track, localStream));

  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  socket.emit('offer', { room, desc: pc.localDescription });

  shareBtn.disabled = true;
  stopBtn.disabled = false;

  // stop sharing when local stream ends
  localStream.getVideoTracks()[0].addEventListener('ended', () => {
    stopSharing();
  });
};

function stopSharing() {
  if (localStream) {
    localStream.getTracks().forEach(t => t.stop());
    localStream = null;
  }
  if (pc) {
    pc.getSenders().forEach(s => {
      if (s.track) pc.removeTrack(s);
    });
  }
  shareBtn.disabled = false;
  stopBtn.disabled = true;
}

stopBtn.onclick = () => stopSharing();
