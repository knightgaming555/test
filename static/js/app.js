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

    // Initialize audio visualization
    function initAudioVisualization(stream) {
      audioContext = new (window.AudioContext || window.webkitAudioContext)();
      analyser = audioContext.createAnalyser();
      const source = audioContext.createMediaStreamSource(stream);
      
      source.connect(analyser);
      analyser.fftSize = 256;
      
      const bufferLength = analyser.frequencyBinCount;
      dataArray = new Uint8Array(bufferLength);
      
      createWaves();
      visualizeAudio();
    }

    function createWaves() {
      audioVisualizer.innerHTML = '';
      const waveCount = 20;
      
      for (let i = 0; i < waveCount; i++) {
        const wave = document.createElement('div');
        wave.className = 'wave';
        wave.style.left = `${(i * 10) - 95}px`;
        wave.style.animationDelay = `${i * 0.1}s`;
        audioVisualizer.appendChild(wave);
      }
    }

    function visualizeAudio() {
      if (!analyser) return;
      
      analyser.getByteFrequencyData(dataArray);
      
      const waves = audioVisualizer.querySelectorAll('.wave');
      let maxAmplitude = 0;
      
      waves.forEach((wave, index) => {
        const amplitude = dataArray[index * 4] || 0;
        const height = Math.max(20, (amplitude / 255) * 100);
        wave.style.height = `${height}px`;
        maxAmplitude = Math.max(maxAmplitude, amplitude);
      });
      
      // Add glow effect based on audio level
      if (maxAmplitude > 50) {
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
          video 
        });
      } catch (e) {
        alert('Media access denied.');
        throw e;
      }
    }

    joinBtn.onclick = async () => {
      const room = roomInput.value.trim();
      if (!room) return;
      
      try {
        localStream = await startMedia();
        localVideo.srcObject = localStream;
        localVideo.classList.add('visible');
        
        // Initialize audio visualization
        initAudioVisualization(localStream);
        
        toggleCamBtn.disabled = false;
        shareScreenBtn.disabled = false;
        joinBtn.disabled = true;
        leaveBtn.disabled = false;
        
        statusIndicator.textContent = 'Connecting...';
        statusIndicator.className = 'status-indicator';
        
        socket.emit('join_room', { room });
      } catch (error) {
        console.error('Failed to join room:', error);
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
          toggleCamBtn.textContent = '📹 Camera (Off)';
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
            shareScreenBtn.textContent = '🖥️ Share Screen';
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
          
          shareScreenBtn.textContent = '🖥️ Stop Sharing';
          isScreenSharing = true;
        } else {
          // Stop screen sharing
          const screenStream = screenShare.srcObject;
          if (screenStream) {
            screenStream.getTracks().forEach(track => track.stop());
          }
          screenShare.classList.remove('visible');
          shareScreenBtn.textContent = '🖥️ Share Screen';
          isScreenSharing = false;
        }
      } catch (error) {
        console.error('Screen sharing failed:', error);
      }
    };

    leaveBtn.onclick = () => {
      socket.emit('leave_room', { room: roomInput.value.trim() });
      
      // Clean up peers
      Object.values(peers).forEach(p => p.destroy());
      peers = {};
      
      // Stop all tracks
      if (localStream) {
        localStream.getTracks().forEach(t => t.stop());
      }
      
      // Stop audio visualization
      if (animationId) {
        cancelAnimationFrame(animationId);
      }
      if (audioContext) {
        audioContext.close();
      }
      
      // Reset UI
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
      
      statusIndicator.textContent = 'Disconnected';
      statusIndicator.className = 'status-indicator disconnected';
      
      // Clear audio visualizer
      audioVisualizer.innerHTML = '';
    };

    socket.on('room_users', users => {
      users.filter(id => id !== socket.id).forEach(sid => {
        const peer = new SimplePeer({ 
          initiator: true, 
          stream: localStream 
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
          stream: localStream 
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
      });
    }

    // Enter key support for room input
    roomInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter' && !joinBtn.disabled) {
        joinBtn.click();
      }
    });
