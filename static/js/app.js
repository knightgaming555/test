 const socket = io();
    let localStream;
    let audioContext;
    let analyser;
    let peers = {};
    let isRecording = false;

    const roomInput = document.getElementById('roomInput');
    const joinBtn = document.getElementById('joinBtn');
    const leaveBtn = document.getElementById('leaveBtn');
    const statusIndicator = document.getElementById('statusIndicator');
    const waveBars = document.querySelectorAll('.wave-bar');

    // Background particles
    function createParticles() {
      const backgroundEffect = document.getElementById('backgroundEffect');
      for (let i = 0; i < 20; i++) {
        const particle = document.createElement('div');
        particle.className = 'particle';
        particle.style.left = Math.random() * 100 + '%';
        particle.style.animationDelay = Math.random() * 6 + 's';
        particle.style.animationDuration = (Math.random() * 3 + 3) + 's';
        backgroundEffect.appendChild(particle);
      }
    }

    // Audio visualization
    function setupAudioVisualization() {
      if (!audioContext && localStream) {
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
        analyser = audioContext.createAnalyser();
        const source = audioContext.createMediaStreamSource(localStream);
        source.connect(analyser);
        analyser.fftSize = 256;
        analyzeAudio();
      }
    }

    function analyzeAudio() {
      const bufferLength = analyser.frequencyBinCount;
      const dataArray = new Uint8Array(bufferLength);

      function animate() {
        if (!isRecording) {
          // Default animation when not recording
          waveBars.forEach(bar => bar.classList.remove('active'));
          requestAnimationFrame(animate);
          return;
        }

        analyser.getByteFrequencyData(dataArray);
        
        // Calculate average volume
        const average = dataArray.reduce((a, b) => a + b) / bufferLength;
        const normalizedAverage = average / 255;

        // Activate bars based on audio level
        const activeBars = Math.floor(normalizedAverage * waveBars.length);
        waveBars.forEach((bar, index) => {
          if (index < activeBars) {
            bar.classList.add('active');
          } else {
            bar.classList.remove('active');
          }
        });

        requestAnimationFrame(animate);
      }
      animate();
    }

    // Get user media
    async function initMedia() {
      if (!localStream) {
        try {
          localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
          setupAudioVisualization();
          isRecording = true;
        } catch (err) {
          console.error('Error accessing microphone:', err);
          alert('Could not access microphone.');
        }
      }
    }

    // Join room
    joinBtn.addEventListener('click', async () => {
      await initMedia();
      const room = roomInput.value.trim();
      if (!room) return;
      socket.emit('join_room', { room });
    });

    socket.on('room_users', users => {
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
      statusIndicator.classList.add('connected');
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

    // Leave room
    leaveBtn.addEventListener('click', () => {
      const room = roomInput.value.trim();
      socket.emit('leave_room', { room });
      Object.values(peers).forEach(p => p.destroy());
      peers = {};
      joinBtn.disabled = false;
      leaveBtn.disabled = true;
      statusIndicator.classList.remove('connected');
      isRecording = false;
      if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
        localStream = null;
      }
      if (audioContext) {
        audioContext.close();
        audioContext = null;
      }
    });

    // Initialize particles
    createParticles();
