import os, time, threading, logging
from flask import Flask, jsonify, send_from_directory, request
from flask_socketio import SocketIO, emit
import eventlet

eventlet.monkey_patch()

# Logging
logging.basicConfig(level=os.getenv('LOG_LEVEL', 'INFO').upper(),
                    format='%(asctime)s [%(levelname)s] %(name)s: %(message)s')
log = logging.getLogger('voice_signaling')

# App setup
app = Flask(__name__, static_folder='static', static_url_path='')
socketio = SocketIO(app, cors_allowed_origins='*')

rooms = {}  # room_id: set(sid)

@app.route('/ping')
def ping():
    return jsonify(ok=True)

# Serve client
@app.route('/')
def index():
    return send_from_directory('static', 'index.html')

@socketio.on('join_room')
def on_join(data):
    room = data.get('room')
    sid = request.sid
    rooms.setdefault(room, set()).add(sid)
    emit('room_users', list(rooms[room]), to=sid)
    log.info(f"{sid} joined room {room}")

@socketio.on('signal')
def on_signal(data):
    # data: {to: sid, from: sid, signal: {...}}
    target = data.get('to')
    sig = data.get('signal')
    emit('signal', {'from': request.sid, 'signal': sig}, to=target)
    log.info(f"Signaling from {request.sid} to {target}")

@socketio.on('leave_room')
def on_leave(data):
    room = data.get('room')
    sid = request.sid
    if room in rooms:
        rooms[room].discard(sid)
        log.info(f"{sid} left room {room}")

@socketio.on('disconnect')
def on_disconnect():
    sid = request.sid
    for room, members in rooms.items():
        if sid in members:
            members.remove(sid)
            log.info(f"{sid} disconnected from room {room}")

@app.before_request
def before_request():
    # This helps with some automated tools but won't eliminate the browser warning
    pass

@app.after_request
def after_request(response):
    response.headers['ngrok-skip-browser-warning'] = 'true'
    return response

if __name__ == '__main__':
    socketio.run(app, host='0.0.0.0', port=8000)
