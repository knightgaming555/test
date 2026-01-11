// simple express + socket.io signalling server
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// serve static files
app.use(express.static(path.join(__dirname, 'public')));

io.on('connection', socket => {
  console.log('socket connected', socket.id);

  // join a room
  socket.on('join', room => {
    socket.join(room);
    const roomClients = io.sockets.adapter.rooms.get(room) || new Set();
    console.log(`socket ${socket.id} joined room ${room}. clients: ${roomClients.size}`);
    // inform others in the room
    socket.to(room).emit('peer-joined', socket.id);
  });

  // forwarding signalling messages
  socket.on('offer', (data) => {
    const { room, desc } = data;
    socket.to(room).emit('offer', { from: socket.id, desc });
  });

  socket.on('answer', (data) => {
    const { room, desc } = data;
    socket.to(room).emit('answer', { from: socket.id, desc });
  });

  socket.on('ice-candidate', (data) => {
    const { room, candidate } = data;
    socket.to(room).emit('ice-candidate', { from: socket.id, candidate });
  });

  socket.on('disconnect', () => {
    console.log('socket disconnected', socket.id);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server listening on ${PORT}`);
});
