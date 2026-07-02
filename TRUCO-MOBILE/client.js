document.addEventListener('DOMContentLoaded', () => {
  const nameInput = document.getElementById('name');
  const roomInput = document.getElementById('room');
  const joinBtn = document.getElementById('joinBtn');
  const roomInfo = document.getElementById('roomInfo');
  const roomNameSpan = document.getElementById('roomName');
  const playersList = document.getElementById('players');
  const startBtn = document.getElementById('startBtn');
  const lobby = document.getElementById('lobby');
  const gameSection = document.getElementById('game');
  const status = document.getElementById('status');
  const cardsArea = document.getElementById('cardsArea');
  const connErrorDiv = document.getElementById('connError');
  const btnTruco = document.getElementById('btnTruco');
  const btnEnvido = document.getElementById('btnEnvido');

  // If socket.io client script isn't loaded (e.g., opened via file://), show helpful message
  if (typeof io === 'undefined') {
    if (connErrorDiv) connErrorDiv.classList.remove('hidden');
    // disable interactive buttons
    joinBtn.disabled = true;
    startBtn.disabled = true;
    if (btnTruco) btnTruco.disabled = true;
    if (btnEnvido) btnEnvido.disabled = true;
    console.error('Socket.io client not loaded. Start the server and open http://localhost:3000');
    return;
  }
  const socket = io();

  let myHand = [];

  joinBtn.addEventListener('click', () => {
    const name = nameInput.value.trim();
    const room = roomInput.value.trim();
    if (!name || !room) {
      alert('Ingresa nombre y sala');
      return;
    }
    socket.emit('joinRoom', { name, room }, (res) => {
      if (res && res.error) return alert(res.error);
      roomInfo.classList.remove('hidden');
      document.getElementById('roomName').textContent = room;
    });
  });

  socket.on('roomData', ({ room, players }) => {
    playersList.innerHTML = '';
    players.forEach((p, i) => {
      const li = document.createElement('li');
      li.textContent = (i === 0 ? '(Host) ' : '') + p.name;
      playersList.appendChild(li);
    });
  });

  startBtn.addEventListener('click', () => {
    const room = roomNameSpan.textContent;
    socket.emit('startGame', { room }, (res) => {
      if (res && res.error) return alert(res.error);
    });
  });

  socket.on('gameStarted', (data) => {
    lobby.classList.add('hidden');
    gameSection.classList.remove('hidden');
    status.textContent = data.msg || 'Juego iniciado';
    renderSnapshot(data.snapshot);
  });

  socket.on('hand', (hand) => {
    myHand = hand;
    renderHand();
  });

  socket.on('gameUpdate', (snapshot) => {
    renderSnapshot(snapshot);
  });

  btnTruco.addEventListener('click', ()=>{
    socket.emit('playerAction', { room: roomNameSpan.textContent, action: { type:'callTruco' } }, (res)=>{
      if(res && res.error) alert(res.error);
    });
  });

  btnEnvido.addEventListener('click', ()=>{
    socket.emit('playerAction', { room: roomNameSpan.textContent, action: { type:'callEnvido' } }, (res)=>{
      if(res && res.error) alert(res.error);
      if(res && res.value) alert('Valor de tu envido: ' + res.value);
    });
  });

  function renderHand(){
    cardsArea.innerHTML = '';
    myHand.forEach((c,i)=>{
      const b = document.createElement('button');
      b.textContent = `${c.rank} de ${c.suit}`;
      b.addEventListener('click', ()=>{
        socket.emit('playerAction', { room: roomNameSpan.textContent, action: { type:'play', cardIdx:i } }, (res)=>{
          if(res && res.error) alert(res.error);
          if(res && res.roundEnd) alert('Ronda terminada. Ganador: ' + res.roundWinner);
        });
      });
      cardsArea.appendChild(b);
    });
  }

  function renderSnapshot(s){
    status.textContent = `Turno: ${s.players[s.turnIndex] ? s.players[s.turnIndex].name : '---' } | Truco: ${s.trucoLevel}`;
    // update players list scores
    playersList.innerHTML = '';
    s.players.forEach((p, i)=>{
      const li = document.createElement('li');
      li.textContent = `${p.name} — ${p.score} pts`;
      playersList.appendChild(li);
    });
  }
});
