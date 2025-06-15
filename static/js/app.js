 const socket = io();
    let localStream;
    let peers = {};
    let audioContext;
    let analyser;
    let dataArray;
    let animationId;
    let isScreenSharing = false;

    const roomInput = document.getElementById('roomInput');
    const joinBtn = document.getElementById('joinBtn');
    const leaveBtn = document.getElementById('leaveBtn');
    const toggleCamBtn = document.getElementById('toggleCamBtn');
    const shareScreenBtn = document.getElementById('shareScreenBtn');
    const localVideo = document.getElementById('localVideo');
    const remoteVideo = document.getElementById('remoteVideo');
    const screenShare = document.getElementById('screenShare');
    const centralCircle = document.getElementById('centralCircle');
    const audioVisualizer = document.getElementById('audioVisualizer');
    const statusIndicator = document.getElementById('statusIndicator');

    function initAudioVisualization(stream) {
      try {
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
        analyser = audioContext.createAnalyser();
        const source = audioContext.createMediaStreamSource(stream);
        
        source.connect(analyser);
        analyser.fftSize = 128;
        
        const bufferLength = analyser.frequencyBinCount;
        dataArray = new Uint8Array(bufferLength);
        
        createWaves();
        visualizeAudio();
      } catch (error) {
        console.error('Audio visualization failed:', error);
        createStaticWaves();
      }
    }

    function createWaves() {
      audioVisualizer.innerHTML = '';
      const isMobile = window.innerWidth <= 768;
      const waveCount = isMobile ? 12 : 16;
      
      for (let i = 0; i < waveCount; i++) {
        const wave = document.createElement('div');
        wave.className = 'wave';
        wave.style.animationDelay = `${i * 0.1}s`;
        audioVisualizer.appendChild(wave);
      }
    }

    function createStaticWaves() {
      audioVisualizer.innerHTML = '';
      const isMobile = window.innerWidth <= 768;
      const waveCount = isMobile ? 12 : 16;
      
      for (let i = 0; i < waveCount; i++) {
        const wave = document.createElement('div');
        wave.className = 'wave';
        wave.style.animationDelay = `${i * 0.1}s`;
        wave.style.height = `${15 + Math.random() * 25}px`;
        audioVisualizer.appendChild(wave);
      }
    }

    function visualizeAudio() {
      if (!analyser || !dataArray) return;
      
      analyser.getByteFrequencyData(dataArray);
      
      const waves = audioVisualizer.querySelectorAll('.wave');
      let maxAmplitude = 0;
      
      waves.forEach((wave, index) => {
        const amplitude = dataArray[index * 2] || 0;
        const minHeight = window.innerWidth <= 768 ? 10 : 15;
        const maxHeight = window.innerWidth <= 768 ? 25 : 40;
        const height = Math.max(minHeight, (amplitude / 255) * maxHeight);
        wave.style.height = `${height}px`;
        maxAmplitude = Math.max(maxAmplitude, amplitude);
      });
      
      if (maxAmplitude > 30) {
        centralCircle.classList.add('active');
      } else {
        centralCircle.classList.remove('active');
      }
      
      animationId = requestAnimationFrame(visualizeAudio);
    }

    async function startMedia(video = true, screen = false) {
      try {
        if (screen) {
          return await navigator.mediaDevices.getDisplayMedia({ 
            video: true, 
            audio: true 
          });
        }
        return await navigator.mediaDevices.getUserMedia({ 
          audio: true, 
          video: video ? { 
            width: { ideal: 1280 },
            height: { ideal: 720 },
            facingMode: 'user'
          } : false
        });
      } catch (e) {
        alert('Media access denied. Please allow camera and microphone access.');
        throw e;
      }
    }

    joinBtn.onclick = async () => {
      const room = roomInput.value.trim();
      if (!room) {
        alert('Please enter a room name');
        return;
      }
      
      try {
        localStream = await startMedia();
        localVideo.srcObject = localStream;
        localVideo.classList.add('visible');
        
        initAudioVisualization(localStream);
        
        toggleCamBtn.disabled = false;
        shareScreenBtn.disabled = false;
        joinBtn.disabled = true;
        leaveBtn.disabled = false;
        roomInput.disabled = true;
        
        statusIndicator.textContent = 'Connecting...';
        statusIndicator.className = 'status-indicator';
        
        socket.emit('join_room', { room });
      } catch (error) {
        console.error('Failed to join room:', error);
        statusIndicator.textContent = 'Connection failed';
        statusIndicator.className = 'status-indicator disconnected';
      }
    };

    toggleCamBtn.onclick = async () => {
      if (!localStream) return;
      
      const videoTrack = localStream.getVideoTracks()[0];
      if (videoTrack) {
        videoTrack.enabled = !videoTrack.enabled;
        
        if (videoTrack.enabled) {
          localVideo.classList.add('visible');
          toggleCamBtn.textContent = '📹 Camera';
        } else {
          localVideo.classList.remove('visible');
          toggleCamBtn.textContent = '📹 Off';
        }
      }
    };

    shareScreenBtn.onclick = async () => {
      try {
        if (!isScreenSharing) {
          const screenStream = await startMedia(false, true);
          screenShare.srcObject = screenStream;
          screenShare.classList.add('visible');
          
          const screenTrack = screenStream.getVideoTracks()[0];
          
          Object.values(peers).forEach(peer => {
            const sender = peer._pc.getSenders().find(s => 
              s.track && s.track.kind === 'video'
            );
            if (sender) {
              sender.replaceTrack(screenTrack);
            }
          });
          
          screenTrack.onended = () => {
            screenShare.classList.remove('visible');
            shareScreenBtn.textContent = window.innerWidth <= 768 ? '🖥️ Share' : '🖥️ Share Screen';
            isScreenSharing = false;
            
            const videoTrack = localStream.getVideoTracks()[0];
            Object.values(peers).forEach(peer => {
              const sender = peer._pc.getSenders().find(s => 
                s.track && s.track.kind === 'video'
              );
              if (sender && videoTrack) {
                sender.replaceTrack(videoTrack);
              }
            });
          };
          
          shareScreenBtn.textContent = window.innerWidth <= 768 ? '🖥️ Stop' : '🖥️ Stop Share';
          isScreenSharing = true;
        } else {
          const screenStream = screenShare.srcObject;
          if (screenStream) {
            screenStream.getTracks().forEach(track => track.stop());
          }
          screenShare.classList.remove('visible');
          shareScreenBtn.textContent = window.innerWidth <= 768 ? '🖥️ Share' : '🖥️ Share Screen';
          isScreenSharing = false;
        }
      } catch (error) {
        console.error('Screen sharing failed:', error);
        alert('Screen sharing is not supported on this device');
      }
    };

    leaveBtn.onclick = () => {
      socket.emit('leave_room', { room: roomInput.value.trim() });
      
      Object.values(peers).forEach(p => p.destroy());
      peers = {};
      
      if (localStream) {
        localStream.getTracks().forEach(t => t.stop());
      }
      
      if (animationId) {
        cancelAnimationFrame(animationId);
      }
      if (audioContext && audioContext.state !== 'closed') {
        audioContext.close();
      }
      
      localVideo.srcObject = null;
      remoteVideo.srcObject = null;
      screenShare.srcObject = null;
      
      localVideo.classList.remove('visible');
      remoteVideo.classList.remove('visible');
      screenShare.classList.remove('visible');
      centralCircle.classList.remove('active');
      
      toggleCamBtn.disabled = true;
      shareScreenBtn.disabled = true;
      joinBtn.disabled = false;
      leaveBtn.disabled = true;
      roomInput.disabled = false;
      
      toggleCamBtn.textContent = '📹 Camera';
      shareScreenBtn.textContent = window.innerWidth <= 768 ? '🖥️ Share' : '🖥️ Share Screen';
      
      statusIndicator.textContent = 'Disconnected';
      statusIndicator.className = 'status-indicator disconnected';
      
      audioVisualizer.innerHTML = '';
      isScreenSharing = false;
    };

    socket.on('room_users', users => {
      users.filter(id => id !== socket.id).forEach(sid => {
        const peer = new SimplePeer({ 
          initiator: true, 
          stream: localStream,
          config: {
            iceServers: [
              { urls: 'stun:stun.l.google.com:19302' },
              { urls: 'stun:global.stun.twilio.com:3478' }
            ]
          }
        });
        setupPeer(peer, sid);
        peers[sid] = peer;
      });
      
      statusIndicator.textContent = 'Connected';
      statusIndicator.className = 'status-indicator connected';
    });

    socket.on('signal', ({ from, signal }) => {
      if (!peers[from]) {
        const peer = new SimplePeer({ 
          initiator: false, 
          stream: localStream,
          config: {
            iceServers: [
              { urls: 'stun:stun.l.google.com:19302' },
              { urls: 'stun:global.stun.twilio.com:3478' }
            ]
          }
        });
        setupPeer(peer, from);
        peers[from] = peer;
        peer.signal(signal);
      } else {
        peers[from].signal(signal);
      }
    });

    function setupPeer(peer, sid) {
      peer.on('signal', sig => {
        socket.emit('signal', { to: sid, signal: sig });
      });
      
      peer.on('stream', stream => {
        remoteVideo.srcObject = stream;
        remoteVideo.classList.add('visible');
      });
      
      peer.on('close', () => {
        remoteVideo.classList.remove('visible');
        delete peers[sid];
        
        if (Object.keys(peers).length === 0) {
          statusIndicator.textContent = 'Connected (No peers)';
        }
      });
      
      peer.on('error', (err) => {
        console.error('Peer error:', err);
        delete peers[sid];
      });
    }

    roomInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter' && !joinBtn.disabled) {
        joinBtn.click();
      }
    });

    // Handle orientation changes
    window.addEventListener('orientationchange', () => {
      setTimeout(() => {
        createWaves();
      }, 100);
    });

    // Handle resize
    window.addEventListener('resize', () => {
      if (audioVisualizer.children.length > 0) {
        createWaves();
      }
    });

    // Initialize static waves on load
    createStaticWaves();
