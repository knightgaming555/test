const socket = io();
    let localStream;
    let peers = {};
    let audioContext;
    let analyser;
    let dataArray;
    let animationId;
    let isScreenSharing = false;
    let isMobile = window.innerWidth <= 768;

    const roomInput = document.getElementById('roomInput');
    const joinBtn = document.getElementById('joinBtn');
    const leaveBtn = document.getElementById('leaveBtn');
    const toggleCamBtn = document.getElementById('toggleCamBtn');
    const shareScreenBtn = document.getElementById('shareScreenBtn');
    const toggleMicBtn = document.getElementById('toggleMicBtn');
    
    const localVideo = document.getElementById('localVideo');
    const remoteVideo = document.getElementById('remoteVideo');
    const screenShare = document.getElementById('screenShare');
    const centralCircle = document.getElementById('centralCircle');
    const audioVisualizer = document.getElementById('audioVisualizer');
    const statusIndicator = document.getElementById('statusIndicator');



    // Optimized constraints for better performance
    const getVideoConstraints = (isMobile, isScreen = false) => {
      if (isScreen) {
        return isMobile ? {
          width: { max: 1280 },
          height: { max: 720 },
          frameRate: { max: 15 }
        } : {
          width: { max: 1920 },
          height: { max: 1080 },
          frameRate: { max: 30 }
        };
      }
      
      return isMobile ? {
        width: { ideal: 640, max: 720 },
        height: { ideal: 480, max: 540 },
        frameRate: { ideal: 15, max: 24 },
        facingMode: 'user'
      } : {
        width: { ideal: 1280, max: 1920 },
        height: { ideal: 720, max: 1080 },
        frameRate: { ideal: 30 },
        facingMode: 'user'
      };
    };

    function initAudioVisualization(stream) {
      try {
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
        analyser = audioContext.createAnalyser();
        const source = audioContext.createMediaStreamSource(stream);
        
        source.connect(analyser);
        analyser.fftSize = 64; // Reduced for better performance
        
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
      const waveCount = isMobile ? 8 : 12; // Reduced for better performance
      
      for (let i = 0; i < waveCount; i++) {
        const wave = document.createElement('div');
        wave.className = 'wave';
        wave.style.animationDelay = `${i * 0.1}s`;
        audioVisualizer.appendChild(wave);
      }
    }

    function createStaticWaves() {
      audioVisualizer.innerHTML = '';
      const waveCount = isMobile ? 8 : 12;
      
      for (let i = 0; i < waveCount; i++) {
        const wave = document.createElement('div');
        wave.className = 'wave';
        wave.style.animationDelay = `${i * 0.1}s`;
        wave.style.height = `${(isMobile ? 8 : 15) + Math.random() * (isMobile ? 12 : 25)}px`;
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
        const minHeight = isMobile ? 8 : 15;
        const maxHeight = isMobile ? 20 : 40;
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
          const constraints = {
            video: getVideoConstraints(isMobile, true),
            audio: true
          };
          return await navigator.mediaDevices.getDisplayMedia(constraints);
        }
        
        const constraints = {
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            sampleRate: isMobile ? 16000 : 48000
          },
          video: video ? getVideoConstraints(isMobile) : false
        };
        
        return await navigator.mediaDevices.getUserMedia(constraints);
      } catch (e) {
        alert('Media access denied. Please allow camera and microphone access.');
        throw e;
      }
    }

    // Optimized peer configuration
    const getPeerConfig = () => ({
      initiator: false,
      config: {
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'stun:global.stun.twilio.com:3478' }
        ]
      },
      sdpTransform: (sdp) => {
        // Optimize bandwidth for mobile
        if (isMobile) {
          sdp = sdp.replace(/b=AS:\d+/g, 'b=AS:500'); // Limit to 500kbps
        }
        return sdp;
      }
    });

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
        
        // Only initialize audio visualization if not on mobile for performance
        if (!isMobile) {
          initAudioVisualization(localStream);
        } else {
          createStaticWaves();
        }
        
        toggleCamBtn.disabled = false;
        toggleMicBtn.disabled = false;
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

    toggleMicBtn.onclick = () => {
  const audioTrack = localStream.getAudioTracks()[0];
  if (!audioTrack) return;
  audioTrack.enabled = !audioTrack.enabled;
  toggleMicBtn.textContent = audioTrack.enabled ? '🎤 Mic' : '🔇 Mic';
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
          
          // Replace video track for all peers
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
            shareScreenBtn.textContent = '🖥️ Share';
            isScreenSharing = false;
            
            // Restore camera track
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
          
          shareScreenBtn.textContent = '🖥️ Stop';
          isScreenSharing = true;
        } else {
          const screenStream = screenShare.srcObject;
          if (screenStream) {
            screenStream.getTracks().forEach(track => track.stop());
          }
          screenShare.classList.remove('visible');
          shareScreenBtn.textContent = '🖥️ Share';
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
      shareScreenBtn.textContent = '🖥️ Share';
      
      statusIndicator.textContent = 'Disconnected';
      statusIndicator.className = 'status-indicator disconnected';
      
      audioVisualizer.innerHTML = '';
      isScreenSharing = false;
    };

    socket.on('room_users', users => {
      users.filter(id => id !== socket.id).forEach(sid => {
        const config = getPeerConfig();
        config.initiator = true;
        config.stream = localStream;
        
        const peer = new SimplePeer(config);
        setupPeer(peer, sid);
        peers[sid] = peer;
      });
      
      statusIndicator.textContent = 'Connected';
      statusIndicator.className = 'status-indicator connected';
    });

    socket.on('signal', ({ from, signal }) => {
      if (!peers[from]) {
        const config = getPeerConfig();
        config.initiator = false;
        config.stream = localStream;
        
        const peer = new SimplePeer(config);
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
        isMobile = window.innerWidth <= 768;
        createWaves();
      }, 100);
    });

    // Handle resize
    window.addEventListener('resize', () => {
      isMobile = window.innerWidth <= 768;
      if (audioVisualizer.children.length > 0) {
        createWaves();
      }
    });

    // Initialize static waves on load
    createStaticWaves();
