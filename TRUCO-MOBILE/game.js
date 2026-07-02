// Motor básico de Truco (versión inicial)
// Soporta: baraja española 40, reparto de 3 cartas, comparación básica de cartas,
// envido (cálculo) y mecanismo simple de 'truco' (aceptar/rechazar niveles).

const SUITS = ['espada','basto','oro','copa'];

function createDeck(){
  const deck = [];
  // Spanish deck: 1-12 except 8,9 -> use 1-7,10-12
  const ranks = [1,2,3,4,5,6,7,10,11,12];
  for(const s of SUITS){
    for(const r of ranks) deck.push({suit:s, rank:r});
  }
  return deck;
}

function shuffle(arr){
  for(let i=arr.length-1;i>0;i--){
    const j=Math.floor(Math.random()*(i+1));[arr[i],arr[j]]=[arr[j],arr[i]];
  }
}

// Truco ranking (Argentina, aproximado)
const RANK_ORDER = [
  '1_espada', '1_basto', '7_espada', '7_oro',
  // then 3,2,1 (copa/oro), 12,11,10,7 (basto/copa), 6,5,4
];

function cardKey(card){
  return `${card.rank}_${card.suit}`;
}

function cardStrength(card){
  // Return numeric strength: higher = stronger
  const key = cardKey(card);
  const predefined = {
    '1_espada': 100,
    '1_basto': 99,
    '7_espada': 98,
    '7_oro': 97
  };
  if(predefined[key]) return predefined[key];
  if(card.rank===3) return 96;
  if(card.rank===2) return 95;
  if(card.rank===1) return 90; // copa/oro 1s
  if([12,11,10].includes(card.rank)) return 50 + (12 - card.rank);
  if(card.rank===7) return 40; // other 7s
  if([6,5,4].includes(card.rank)) return card.rank;
  return 0;
}

function envidoValueForCard(card){
  // For envido: 10-12 count as 0, others keep rank
  if([10,11,12].includes(card.rank)) return 0;
  return card.rank;
}

function calcEnvido(hand){
  // hand: array of 3 cards
  // If two cards same suit: 20 + sum of their values
  // Otherwise highest card value
  let best = 0;
  for(let i=0;i<hand.length;i++){
    for(let j=i+1;j<hand.length;j++){
      if(hand[i].suit===hand[j].suit){
        const val = 20 + envidoValueForCard(hand[i]) + envidoValueForCard(hand[j]);
        if(val>best) best=val;
      }
    }
  }
  if(best>0) return best;
  // no same suit -> highest card value
  for(const c of hand) best = Math.max(best, envidoValueForCard(c));
  return best;
}

class Game{
  constructor(){
    this.players = []; // {id,name,score}
    this.hands = {}; // playerId -> [cards]
    this.deck = [];
    this.turnIndex = 0; // index in players
    this.table = []; // plays in current trick
    this.tricks = []; // trick winners
    this.trucoLevel = 1; // 1 (normal), can be raised
    this.trucoPending = null; // {from, level}
    this.envidoPending = null; // {from, value, resolved}
  }

  addPlayer(p){
    if(this.players.find(x=>x.id===p.id)) return false;
    this.players.push({id:p.id,name:p.name,score:0});
    return true;
  }

  removePlayer(id){
    const idx = this.players.findIndex(p=>p.id===id);
    if(idx!==-1) this.players.splice(idx,1);
    delete this.hands[id];
  }

  start(){
    this.deck = createDeck();
    shuffle(this.deck);
    // deal 3 cards each
    for(const p of this.players){
      this.hands[p.id] = [this.deck.pop(), this.deck.pop(), this.deck.pop()];
    }
    this.turnIndex = 0;
    this.table = [];
    this.tricks = [];
    this.trucoLevel = 1;
    this.trucoPending = null;
    this.envidoPending = null;
  }

  getPlayerIndex(id){
    return this.players.findIndex(p=>p.id===id);
  }

  currentPlayer(){
    return this.players[this.turnIndex];
  }

  playCard(playerId, cardIdx){
    const idx = this.getPlayerIndex(playerId);
    if(idx===-1) return {error:'Jugador no en la partida'};
    if(this.turnIndex!==idx) return {error:'No es tu turno'};
    const hand = this.hands[playerId];
    if(!hand || cardIdx<0 || cardIdx>=hand.length) return {error:'Carta inválida'};
    const card = hand.splice(cardIdx,1)[0];
    this.table.push({playerId, card});
    // advance turn
    this.turnIndex = (this.turnIndex + 1) % this.players.length;
    // if table length equals number of players, resolve trick
    if(this.table.length === this.players.length){
      const winner = this.resolveTrick();
      this.tricks.push(winner);
      this.table = [];
      // set turnIndex to winner's index
      const winIdx = this.getPlayerIndex(winner);
      if(winIdx!==-1) this.turnIndex = winIdx;
    }
    // check for end of round (3 tricks played or players out of cards)
    const cardsLeft = Object.values(this.hands).some(h=>h && h.length>0);
    if(!cardsLeft || this.tricks.length>=3){
      const roundWinner = this.resolveRound();
      this.awardPoints(roundWinner);
      return {roundEnd:true, roundWinner};
    }
    return {ok:true};
  }

  resolveTrick(){
    // Determine highest card among table
    let best = null; let bestStrength = -1;
    for(const play of this.table){
      const s = cardStrength(play.card);
      if(s>bestStrength){ bestStrength=s; best=play.playerId; }
    }
    return best;
  }

  resolveRound(){
    // Winner is the player who won majority of tricks; naive: last trick winner
    if(this.tricks.length===0) return null;
    // count wins per player
    const counts = {};
    for(const w of this.tricks) counts[w]=(counts[w]||0)+1;
    let best=null; let max=0;
    for(const k in counts){ if(counts[k]>max){max=counts[k];best=k;} }
    return best;
  }

  awardPoints(winnerId){
    if(!winnerId) return;
    const p = this.players.find(x=>x.id===winnerId);
    if(!p) return;
    p.score += this.trucoLevel; // award points equal to truco level
  }

  callTruco(playerId){
    // Start truco or raise
    // Levels: 1 -> 2 (truco), 2 -> 3 (retruco), 3 -> 4 (vale cuatro)
    const mapping = {1:2,2:3,3:4};
    const next = mapping[this.trucoLevel] || 4;
    this.trucoPending = {from:playerId, level:next};
    return {pending:true, level:next};
  }

  respondTruco(playerId, accept){
    if(!this.trucoPending) return {error:'No hay truco pendiente'};
    if(accept){
      this.trucoLevel = this.trucoPending.level;
      this.trucoPending = null;
      return {accepted:true, level:this.trucoLevel};
    } else {
      // reject: the team that called gets 1 point (simplified: give to caller)
      const caller = this.trucoPending.from;
      const p = this.players.find(x=>x.id===caller);
      if(p) p.score += 1;
      this.trucoPending = null;
      return {rejected:true};
    }
  }

  callEnvido(playerId){
    const hand = this.hands[playerId];
    if(!hand) return {error:'Mano no encontrada'};
    const val = calcEnvido(hand);
    this.envidoPending = {from:playerId, value:val, resolved:false};
    return {value:val};
  }

  respondEnvido(playerId, accept){
    if(!this.envidoPending) return {error:'No hay envido pendiente'};
    const caller = this.envidoPending.from;
    const callerVal = this.envidoPending.value;
    const responderHand = this.hands[playerId];
    const responderVal = calcEnvido(responderHand);
    this.envidoPending.resolved = true;
    if(accept){
      if(callerVal>responderVal){
        const p = this.players.find(x=>x.id===caller);
        if(p) p.score += 2; // simplified points
        return {winner:caller, callerVal, responderVal};
      } else {
        const p = this.players.find(x=>x.id===playerId);
        if(p) p.score += 2;
        return {winner:playerId, callerVal, responderVal};
      }
    } else {
      // reject -> caller gets 1 point
      const p = this.players.find(x=>x.id===caller);
      if(p) p.score += 1;
      return {rejected:true};
    }
  }

  snapshot(){
    return {
      players: this.players.map(p=>({id:p.id,name:p.name,score:p.score})),
      handsInfo: Object.fromEntries(Object.entries(this.hands).map(([k,v])=>[k,{count:v.length}])),
      table: this.table,
      tricks: this.tricks,
      turnIndex: this.turnIndex,
      trucoLevel: this.trucoLevel,
      trucoPending: this.trucoPending,
      envidoPending: this.envidoPending
    };
  }
}

module.exports = { Game };
