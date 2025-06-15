const socket = io();
let localStream;
let peers = {};
const roomInput = document.getElementById('roomInput');
const joinBtn = document.getElementById('joinBtn');
const leaveBtn = document.getElementById('leaveBtn');
const toggleCamBtn = document.getElementById('toggleCamBtn');
const shareScreenBtn = document.getElementById('shareScreenBtn');
const localVideo = document.getElementById('localVideo');
const remoteVideo = document.getElementById('remoteVideo');

async function startMedia(video=true, screen=false) {
  try {
    if (screen) {
      return await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
    }
    return await navigator.mediaDevices.getUserMedia({ audio: true, video });
  } catch (e) {
    alert('Media access denied.');
    throw e;
  }
}

joinBtn.onclick = async () => {
  const room = roomInput.value.trim();
  if (!room) return;
  localStream = await startMedia();
  localVideo.srcObject = localStream;
  toggleCamBtn.disabled = false;
  shareScreenBtn.disabled = false;
  socket.emit('join_room', { room });
};

toggleCamBtn.onclick = async () => {
  if (!localStream) return;
  const videoTrack = localStream.getVideoTracks()[0];
  videoTrack.enabled = !videoTrack.enabled;
};

shareScreenBtn.onclick = async () => {
  const screenStream = await startMedia(false, true);
  const screenTrack = screenStream.getVideoTracks()[0];
  Object.values(peers).forEach(peer => peer.replaceTrack(
    localStream.getVideoTracks()[0], screenTrack, localStream
  ));
  screenTrack.onended = () => {
    Object.values(peers).forEach(peer => peer.replaceTrack(
      screenTrack, localStream.getVideoTracks()[0], localStream
    ));
  };
};

leaveBtn.onclick = () => {
  socket.emit('leave_room', { room: roomInput.value.trim() });
  Object.values(peers).forEach(p => p.destroy()); peers = {};
  localStream.getTracks().forEach(t => t.stop());
  localVideo.srcObject = null; remoteVideo.srcObject = null;
  toggleCamBtn.disabled = true; shareScreenBtn.disabled = true;
};

socket.on('room_users', users => {
  users.filter(id => id !== socket.id).forEach(sid => {
    const peer = new SimplePeer({ initiator: true, stream: localStream });
    setupPeer(peer, sid);
    peers[sid] = peer;
  });
  joinBtn.disabled = true; leaveBtn.disabled = false;
});

socket.on('signal', ({ from, signal }) => {
  if (!peers[from]) {
    const peer = new SimplePeer({ initiator: false, stream: localStream });
    setupPeer(peer, from);
    peers[from] = peer;
    peer.signal(signal);
  } else peers[from].signal(signal);
});

function setupPeer(peer, sid) {
  peer.on('signal', sig => socket.emit('signal', { to: sid, signal: sig }));
  peer.on('stream', stream => {
    remoteVideo.srcObject = stream;
  });
}
