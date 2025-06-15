const socket = io();
let localStream;
let peers = {}; // sid -> SimplePeer instance

const roomInput = document.getElementById('roomInput');
const joinBtn = document.getElementById('joinBtn');
const leaveBtn = document.getElementById('leaveBtn');

// get user media
async function initMedia() {
  localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
}

// join room
yoinBtn.addEventListener('click', async () => {
  await initMedia();
  const room = roomInput.value.trim();
  if (!room) return;
  socket.emit('join_room', { room });
});

socket.on('room_users', users => {
  // create peers for each
  users.forEach(sid => {
    if (sid === socket.id) return;
    const peer = new SimplePeer({ initiator: true, stream: localStream });
    peer.on('signal', data => socket.emit('signal', { to: sid, signal: data }));
    peer.on('stream', stream => {
      const audio = document.createElement('audio');
      audio.srcObject = stream;
      audio.play();
    });
    peers[sid] = peer;
  });
  joinBtn.disabled = true;
  leaveBtn.disabled = false;
});

socket.on('signal', ({ from, signal }) => {
  if (!peers[from]) {
    const peer = new SimplePeer({ initiator: false, stream: localStream });
    peer.on('signal', data => socket.emit('signal', { to: from, signal: data }));
    peer.on('stream', stream => {
      const audio = document.createElement('audio');
      audio.srcObject = stream;
      audio.play();
    });
    peers[from] = peer;
    peer.signal(signal);
  } else {
    peers[from].signal(signal);
  }
});

// leave room
leaveBtn.addEventListener('click', () => {
  const room = roomInput.value.trim();
  socket.emit('leave_room', { room });
  Object.values(peers).forEach(p => p.destroy());
  peers = {};
  joinBtn.disabled = false;
  leaveBtn.disabled = true;
});
