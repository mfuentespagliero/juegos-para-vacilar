const express = require('express');
const http = require('http');
const path = require('path');
const app = express();
const server = http.createServer(app);
const { Server } = require('socket.io');
const io = new Server(server);
const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname)));

const { Game } = require('./game');
const rooms = {}; // roomName -> { players:[], game: Game }

io.on('connection', (socket) => {
  socket.on('joinRoom', ({ room, name }, cb) => {
    if (!room || !name) return cb && cb({ error: 'Nombre o sala inválidos' });
    room = room.trim();
    if (!rooms[room]) rooms[room] = { players: [], game: null };
    if (rooms[room].players.length >= 8) return cb && cb({ error: 'Sala llena (8 jugadores máximo)' });
    const player = { id: socket.id, name };
    rooms[room].players.push(player);
    socket.join(room);
    io.to(room).emit('roomData', { room, players: rooms[room].players });
    cb && cb({ ok: true });
  });

  socket.on('startGame', ({ room }, cb) => {
    const r = rooms[room];
    if (!r) return cb && cb({ error: 'Sala inexistente' });
    // allow starting with bots for testing if <2 players
    if (r.players.length < 2) {
      const botId = `bot_${Date.now()}`;
      const bot = { id: botId, name: 'CPU-1', bot: true };
      r.players.push(bot);
    }
    // create game instance and add players
    const game = new Game();
    for (const p of r.players) game.addPlayer(p);
    game.start();
    r.game = game;
    // send initial hands privately
    for (const p of r.players) {
      if (!p.bot) io.to(p.id).emit('hand', game.hands[p.id]);
    }
    io.to(room).emit('gameStarted', { msg: 'Juego iniciado', snapshot: game.snapshot() });
    // schedule bot moves if any
    scheduleBotMove(room);
    cb && cb({ ok: true });
  });

  socket.on('playerAction', ({ room, action }, cb) => {
    const r = rooms[room];
    if (!r || !r.game) return cb && cb({ error: 'Juego no iniciado' });
    const game = r.game;
    // action: {type:'play', cardIdx}
    if (action.type === 'play'){
      const res = game.playCard(socket.id, action.cardIdx);
      io.to(room).emit('gameUpdate', game.snapshot());
      scheduleBotMove(room);
      cb && cb(res);
      return;
    }
    if(action.type === 'callTruco'){
      const res = game.callTruco(socket.id);
      io.to(room).emit('gameUpdate', game.snapshot());
      cb && cb(res);
      scheduleBotMove(room);
      return;
    }
    if(action.type === 'respondTruco'){
      const res = game.respondTruco(socket.id, action.accept);
      io.to(room).emit('gameUpdate', game.snapshot());
      cb && cb(res);
      return;
    }
    if(action.type === 'callEnvido'){
      const res = game.callEnvido(socket.id);
      io.to(room).emit('gameUpdate', game.snapshot());
      cb && cb(res);
      return;
    }
    if(action.type === 'respondEnvido'){
      const res = game.respondEnvido(socket.id, action.accept);
      io.to(room).emit('gameUpdate', game.snapshot());
      cb && cb(res);
      return;
    }

    socket.to(room).emit('playerAction', { playerId: socket.id, action });
    cb && cb({ ok: true });
  });

  socket.on('disconnect', () => {
    for (const roomName in rooms) {
      const r = rooms[roomName];
      const idx = r.players.findIndex((p) => p.id === socket.id);
      if (idx !== -1) {
        r.players.splice(idx, 1);
        io.to(roomName).emit('roomData', { room: roomName, players: r.players });
        if (r.players.length === 0) delete rooms[roomName];
        break;
      }
    }
  });
});

function scheduleBotMove(roomName){
  const r = rooms[roomName];
  if(!r || !r.game) return;
  const g = r.game;
  const current = g.currentPlayer();
  if(!current) return;
  const p = r.players.find(x=>x.id===current.id);
  if(!p || !p.bot) return;
  setTimeout(()=>{
    // play first available card
    const hand = g.hands[current.id];
    if(hand && hand.length>0){
      g.playCard(current.id, 0);
      io.to(roomName).emit('gameUpdate', g.snapshot());
      // schedule next bot move
      scheduleBotMove(roomName);
    }
  }, 700 + Math.floor(Math.random()*800));
}

server.listen(PORT, () => console.log('Server escuchando en', PORT));
