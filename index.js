const http = require('http');
const WebSocket = require('ws');

const PORT = process.env.PORT || 8080;
const rooms = new Map();

function makeCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code;
  do {
    code = Array.from({ length: 5 }, () =>
      chars[Math.floor(Math.random() * chars.length)]
    ).join('');
  } while (rooms.has(code));
  return code;
}

const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('Sala das Portas - servidor multiplayer online');
});

const wss = new WebSocket.Server({ server });

function send(ws, data) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(data));
  }
}

function broadcast(room, data, except = null) {
  for (const client of room.players) {
    if (client !== except) send(client, data);
  }
}

function leaveRoom(ws) {
  const code = ws.roomCode;
  if (!code) return;
  const room = rooms.get(code);
  ws.roomCode = null;
  if (!room) return;
  room.players.delete(ws);
  broadcast(room, { type: 'player_left', id: ws.player.id });
  if (room.players.size === 0) {
    rooms.delete(code);
  }
}

wss.on('connection', ws => {
  // Player com tudo que seu jogo precisa sincronizar
  ws.player = {
    id: Math.random().toString(36).slice(2, 11),
    x: 0,
    y: 0,
    z: 5,
    ry: 0,
    anim: 'idle',      // idle | walk | run | flash
    hasFlash: false,   // tem lanterna na mão?
    flashOn: false     // lanterna ligada?
  };

  send(ws, { type: 'connected', id: ws.player.id });

  ws.on('message', raw => {
    let data;
    try { data = JSON.parse(raw.toString()); } catch { return; }

    if (data.type === 'create_room') {
      leaveRoom(ws);
      const code = makeCode();
      const room = { players: new Set([ws]) };
      rooms.set(code, room);
      ws.roomCode = code;
      send(ws, { type: 'room_created', code, id: ws.player.id, players: [] });
      return;
    }

    if (data.type === 'join_room') {
      const code = String(data.code || '').trim().toUpperCase();
      const room = rooms.get(code);
      if (!room) { send(ws, { type: 'error', message: 'Sala não encontrada.' }); return; }
      if (room.players.size >= 4 && !room.players.has(ws)) { send(ws, { type: 'error', message: 'Sala cheia (máximo 4 jogadores).' }); return; }
      leaveRoom(ws);
      room.players.add(ws);
      ws.roomCode = code;
      const players = [...room.players].filter(c => c !== ws).map(c => c.player);
      send(ws, { type: 'room_joined', code, id: ws.player.id, players });
      broadcast(room, { type: 'player_joined', player: ws.player }, ws);
      return;
    }

    if (data.type === 'move') {
      if (!ws.roomCode) return;
      const room = rooms.get(ws.roomCode);
      if (!room || !room.players.has(ws)) return;

      // Posição e rotação
      for (const k of ['x', 'y', 'z', 'ry']) {
        if (Number.isFinite(Number(data[k]))) {
          ws.player[k] = Math.max(-1000, Math.min(1000, Number(data[k])));
        }
      }

      // Animação - só aceita valores válidos
      if (typeof data.anim === 'string') {
        const valid = ['idle', 'walk', 'run', 'flash', 'walk_flash', 'run_flash'];
        const anim = data.anim.toLowerCase().slice(0, 20);
        if (valid.includes(anim) || anim.startsWith('idle') || anim.startsWith('walk') || anim.startsWith('run')) {
          ws.player.anim = anim;
        }
      }

      // Lanterna
      if (typeof data.hasFlash !== 'undefined') ws.player.hasFlash = !!data.hasFlash;
      if (typeof data.flashOn !== 'undefined') ws.player.flashOn = !!data.flashOn;

      // Manda pra todo mundo da sala, menos pra você
      broadcast(room, { type: 'player_moved', player: ws.player }, ws);
    }

    if (data.type === 'flash_toggle') {
      if (!ws.roomCode) return;
      const room = rooms.get(ws.roomCode);
      if (!room) return;
      ws.player.flashOn = !!data.on;
      ws.player.hasFlash = true;
      broadcast(room, { type: 'player_moved', player: ws.player }, ws);
    }
  });

  ws.on('close', () => leaveRoom(ws));
  ws.on('error', () => leaveRoom(ws));
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Servidor multiplayer iniciado na porta ${PORT}`);
});
