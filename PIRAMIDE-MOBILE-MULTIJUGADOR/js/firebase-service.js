import { initializeApp } from "https://www.gstatic.com/firebasejs/12.15.0/firebase-app.js";
import {
  getAuth,
  setPersistence,
  browserLocalPersistence,
  signInAnonymously,
  onAuthStateChanged,
  connectAuthEmulator
} from "https://www.gstatic.com/firebasejs/12.15.0/firebase-auth.js";
import {
  getDatabase,
  ref,
  get,
  set,
  update,
  remove,
  onValue,
  onDisconnect,
  runTransaction,
  serverTimestamp,
  connectDatabaseEmulator
} from "https://www.gstatic.com/firebasejs/12.15.0/firebase-database.js";
import { firebaseConfig, useEmulators } from "./firebase-config.js";

const ROOM_CHARACTERS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const ROOM_CODE_LENGTH = 6;
const ROOM_LIFETIME_MS = 12 * 60 * 60 * 1000;
const REVEAL_ORDER = [10, 11, 12, 13, 14, 6, 7, 8, 9, 3, 4, 5, 1, 2, 0];
const VALUES = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
const SUITS = [
  { suit: "hearts", symbol: "♥", color: "red" },
  { suit: "diamonds", symbol: "♦", color: "red" },
  { suit: "clubs", symbol: "♣", color: "black" },
  { suit: "spades", symbol: "♠", color: "black" }
];
const DEFAULT_SETTINGS = Object.freeze({
  mode: "classic",
  cardsPerPlayer: 4,
  multiplierType: "double",
  floorMultipliers: [1, 2, 4, 8, 16],
  handVisibility: "public",
  bluffEnabled: false,
  powersEnabled: false,
  scoringEnabled: true,
  maxPlayers: 8
});

let app;
let auth;
let database;
let initialized = false;
let temporaryHands = null;
let temporaryPyramid = null;

function clientError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function cleanCode(value) {
  const code = String(value || "").trim().toUpperCase();
  if (!new RegExp(`^[${ROOM_CHARACTERS}]{${ROOM_CODE_LENGTH}}$`).test(code)) {
    throw clientError("invalid-code", "El código debe tener seis letras o números válidos.");
  }
  return code;
}

function cleanName(value) {
  const name = String(value || "").trim().replace(/\s+/g, " ");
  if (name.length < 1 || name.length > 18) {
    throw clientError("invalid-name", "Escribe un nombre de hasta 18 caracteres.");
  }
  return name;
}

function normalizeSettings(input = {}, previous = DEFAULT_SETTINGS) {
  const settings = { ...DEFAULT_SETTINGS, ...previous, ...input };
  if (!["private", "public"].includes(settings.handVisibility)) {
    throw clientError("invalid-settings", "La visibilidad de las manos no es válida.");
  }
  if (!Number.isInteger(settings.cardsPerPlayer) || settings.cardsPerPlayer < 3 || settings.cardsPerPlayer > 6) {
    throw clientError("invalid-settings", "Las cartas por jugador deben estar entre 3 y 6.");
  }
  if (!Number.isInteger(settings.maxPlayers) || settings.maxPlayers < 2 || settings.maxPlayers > 12) {
    throw clientError("invalid-settings", "El máximo de jugadores debe estar entre 2 y 12.");
  }
  if (!Array.isArray(settings.floorMultipliers) || settings.floorMultipliers.length !== 5 ||
      settings.floorMultipliers.some(value => !Number.isInteger(value) || value < 1 || value > 99)) {
    throw clientError("invalid-settings", "Configura cinco multiplicadores válidos.");
  }
  settings.mode = "classic";
  settings.multiplierType = "double";
  settings.bluffEnabled = settings.handVisibility === "public" ? false : Boolean(settings.bluffEnabled);
  settings.powersEnabled = Boolean(settings.powersEnabled);
  settings.scoringEnabled = settings.scoringEnabled !== false;
  return settings;
}

function roomExpired(room) {
  return Number(room?.expiresAt || 0) > 0 && room.expiresAt <= Date.now();
}

function makePlayer(uid, name, role) {
  const now = Date.now();
  return {
    uid,
    name,
    role,
    isHost: role === "host",
    joinedAt: now,
    connected: true,
    lastSeen: now,
    skulls: 0,
    crowns: 0,
    availableCards: 0,
    usedCards: 0,
    claimsMade: 0,
    successfulBluffs: 0,
    failedBluffs: 0,
    correctChallenges: 0,
    incorrectChallenges: 0
  };
}

function randomRoomCode() {
  let code = "";
  const randomValues = new Uint32Array(ROOM_CODE_LENGTH);
  crypto.getRandomValues(randomValues);
  for (const value of randomValues) code += ROOM_CHARACTERS[value % ROOM_CHARACTERS.length];
  return code;
}

export function shuffleArray(array) {
  const copy = [...array];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const randomIndex = Math.floor(Math.random() * (index + 1));
    [copy[index], copy[randomIndex]] = [copy[randomIndex], copy[index]];
  }
  return copy;
}

function buildDeck(requiredCards) {
  const decksNeeded = Math.max(1, Math.ceil(requiredCards / 52));
  const cards = [];
  for (let deckIndex = 0; deckIndex < decksNeeded; deckIndex += 1) {
    for (const value of VALUES) {
      for (const suit of SUITS) {
        cards.push({
          id: `deck${deckIndex + 1}-${value}-${suit.suit}`,
          value,
          suit: suit.suit,
          symbol: suit.symbol,
          color: suit.color,
          used: false
        });
      }
    }
  }
  return shuffleArray(cards);
}

function floorForRevealIndex(index) {
  if (index < 5) return 1;
  if (index < 9) return 2;
  if (index < 12) return 3;
  if (index < 14) return 4;
  return 5;
}

function cardMap(cards) {
  return Object.fromEntries(cards.map(card => [card.id, card]));
}

function saveSession(code, uid, name) {
  localStorage.setItem("pyramidRoomCode", code);
  localStorage.setItem("pyramidPlayerUid", uid);
  localStorage.setItem("pyramidPlayerName", name);
}

function clearSavedSession() {
  localStorage.removeItem("pyramidRoomCode");
  localStorage.removeItem("pyramidPlayerUid");
  localStorage.removeItem("pyramidPlayerName");
}

export async function initializeFirebase() {
  if (initialized) return currentServices();
  app = initializeApp(firebaseConfig);
  auth = getAuth(app);
  database = getDatabase(app);

  if (useEmulators) {
    connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
    connectDatabaseEmulator(database, "127.0.0.1", 9000);
  }

  await setPersistence(auth, browserLocalPersistence);
  if (!auth.currentUser) await signInAnonymously(auth);
  await waitForUser();
  initialized = true;
  return currentServices();
}

function currentServices() {
  return { app, auth, database };
}

export function waitForUser() {
  if (auth?.currentUser) return Promise.resolve(auth.currentUser);
  return new Promise((resolve, reject) => {
    const stop = onAuthStateChanged(auth, user => {
      if (!user) return;
      stop();
      resolve(user);
    }, reject);
  });
}

async function ensureAuthenticated() {
  if (!initialized) await initializeFirebase();
  if (!auth.currentUser) await signInAnonymously(auth);
  return auth.currentUser || waitForUser();
}

async function readRoom(code) {
  const snapshot = await get(ref(database, `rooms/${code}`));
  if (!snapshot.exists()) throw clientError("room-not-found", "La sala no existe o ya fue cerrada.");
  const room = snapshot.val();
  if (roomExpired(room)) throw clientError("room-expired", "La sala venció después de 12 horas.");
  return room;
}

async function readRoomForJoin(code) {
  const base = `rooms/${code}`;
  const [status, expiresAt, settings, players, hostUid] = await Promise.all([
    get(ref(database, `${base}/status`)),
    get(ref(database, `${base}/expiresAt`)),
    get(ref(database, `${base}/settings`)),
    get(ref(database, `${base}/players`)),
    get(ref(database, `${base}/hostUid`))
  ]);
  if (!status.exists()) throw clientError("room-not-found", "La sala no existe o ya fue cerrada.");
  const room = {
    status: status.val(),
    expiresAt: expiresAt.val(),
    settings: settings.val() || DEFAULT_SETTINGS,
    players: players.val() || {},
    hostUid: hostUid.val()
  };
  if (roomExpired(room)) throw clientError("room-expired", "La sala venció después de 12 horas.");
  return room;
}

function requireMember(room, uid) {
  if (!room?.players?.[uid]) throw clientError("permission-denied", "Ya no perteneces a esta sala.");
}

function requireHost(room, uid) {
  if (room?.hostUid !== uid) throw clientError("permission-denied", "Solo el anfitrión puede realizar esta acción.");
}

async function cleanupExpiredOwnRoom(uid) {
  const previousCode = localStorage.getItem("pyramidRoomCode");
  if (!previousCode) return;
  const snapshot = await get(ref(database, `rooms/${previousCode}`)).catch(() => null);
  const room = snapshot?.val();
  if (room && room.hostUid === uid && roomExpired(room)) {
    await update(ref(database), {
      [`rooms/${previousCode}`]: null,
      [`privateHands/${previousCode}`]: null,
      [`hostState/${previousCode}`]: null,
      [`claimProofs/${previousCode}`]: null
    }).catch(() => {});
  }
}

export async function createRoomClient(settings = {}, playerName = "") {
  const user = await ensureAuthenticated();
  const name = cleanName(playerName);
  const normalizedSettings = normalizeSettings(settings);
  await cleanupExpiredOwnRoom(user.uid);

  for (let attempt = 0; attempt < 20; attempt += 1) {
    const code = randomRoomCode();
    const now = Date.now();
    const initialRoom = {
      code,
      hostUid: user.uid,
      status: "lobby",
      phase: "waiting",
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      expiresAt: now + ROOM_LIFETIME_MS,
      settings: normalizedSettings,
      players: { [user.uid]: makePlayer(user.uid, name, "host") },
      pyramid: { currentIndex: -1, currentFloor: 1, revealedCards: {} },
      activeClaim: null,
      actionHistory: {},
      version: 1
    };
    const result = await runTransaction(ref(database, `rooms/${code}`), current => (
      current === null ? initialRoom : undefined
    ), { applyLocally: false });
    if (!result.committed) continue;
    saveSession(code, user.uid, name);
    return { code, uid: user.uid };
  }
  throw clientError("code-collision", "No se pudo reservar un código. Inténtalo nuevamente.");
}

export async function joinRoomClient(roomCode, playerName) {
  const user = await ensureAuthenticated();
  const code = cleanCode(roomCode);
  const name = cleanName(playerName);
  await cleanupExpiredOwnRoom(user.uid);
  const room = await readRoomForJoin(code);

  if (room.status !== "lobby") throw clientError("game-started", "La partida ya comenzó.");
  const existing = room.players?.[user.uid];
  if (existing && existing.name.toLocaleLowerCase() !== name.toLocaleLowerCase()) {
    throw clientError("already-joined", "Este dispositivo ya está registrado con otro nombre.");
  }
  const duplicate = Object.values(room.players || {}).some(player =>
    player.uid !== user.uid && player.connected !== false && player.name.toLocaleLowerCase() === name.toLocaleLowerCase()
  );
  if (duplicate) throw clientError("duplicate-name", "Ya hay un jugador activo con ese nombre.");
  if (!existing && Object.keys(room.players || {}).length >= (room.settings?.maxPlayers || 8)) {
    throw clientError("room-full", "La sala está llena.");
  }

  const result = await runTransaction(ref(database, `rooms/${code}/players/${user.uid}`), current => {
    if (current) return current.name === name ? current : undefined;
    return makePlayer(user.uid, name, "guest");
  }, { applyLocally: false });
  if (!result.committed) throw clientError("transaction-cancelled", "La sala cambió mientras intentabas entrar.");
  await update(ref(database, `rooms/${code}`), { updatedAt: serverTimestamp() });
  saveSession(code, user.uid, name);
  return { code, uid: user.uid };
}

export async function restoreRoomClient(roomCode) {
  const user = await ensureAuthenticated();
  const code = cleanCode(roomCode);
  let room = await readRoom(code);
  requireMember(room, user.uid);
  if (room.hostUid === user.uid && room.status === "preparing" && Date.now() - Number(room.updatedAt || 0) > 30000) {
    await update(ref(database, `rooms/${code}`), {
      status: "lobby",
      phase: "waiting",
      updatedAt: serverTimestamp()
    });
    room = await readRoom(code);
  }
  saveSession(code, user.uid, room.players[user.uid].name);
  return { code, room };
}

export async function updateRoomSettingsClient(partialSettings) {
  const user = await ensureAuthenticated();
  const code = cleanCode(localStorage.getItem("pyramidRoomCode"));
  const room = await readRoom(code);
  requireHost(room, user.uid);
  if (room.status !== "lobby") throw clientError("game-started", "La configuración solo puede cambiarse en el lobby.");
  const settings = normalizeSettings(partialSettings, room.settings);
  await set(ref(database, `rooms/${code}/settings`), settings);
  await update(ref(database, `rooms/${code}`), { updatedAt: serverTimestamp() });
  return { settings };
}

export function clearSensitiveDealData() {
  if (temporaryHands) {
    for (const uid of Object.keys(temporaryHands)) temporaryHands[uid] = null;
  }
  if (temporaryPyramid) temporaryPyramid.fill(null);
  temporaryHands = null;
  temporaryPyramid = null;
}

export async function startGameClient(roomCode) {
  const user = await ensureAuthenticated();
  const code = cleanCode(roomCode);
  const room = await readRoom(code);
  requireHost(room, user.uid);
  if (room.status !== "lobby") throw clientError("game-started", "La partida ya comenzó o está preparándose.");
  const allPlayers = Object.values(room.players || {});
  const connectedPlayers = allPlayers.filter(player => player.connected !== false);
  if (connectedPlayers.length < 2) throw clientError("not-enough-players", "Se necesitan al menos 2 jugadores conectados.");
  const settings = normalizeSettings(room.settings);
  const requiredCards = 15 + allPlayers.length * settings.cardsPerPlayer;

  const statusLock = await runTransaction(ref(database, `rooms/${code}/status`), status => (
    status === "lobby" ? "preparing" : undefined
  ), { applyLocally: false });
  if (!statusLock.committed) throw clientError("transaction-cancelled", "Otra acción está preparando la partida.");

  try {
    const deck = buildDeck(requiredCards);
    temporaryPyramid = deck.splice(0, 15).map((card, position) => ({ ...card, position }));
    temporaryHands = {};
    for (const player of allPlayers) {
      temporaryHands[player.uid] = cardMap(deck.splice(0, settings.cardsPerPlayer));
    }

    const now = Date.now();
    const playerUpdates = {};
    for (const player of allPlayers) {
      playerUpdates[`rooms/${code}/players/${player.uid}/availableCards`] = settings.cardsPerPlayer;
      playerUpdates[`rooms/${code}/players/${player.uid}/usedCards`] = 0;
      playerUpdates[`rooms/${code}/players/${player.uid}/skulls`] = 0;
    }
    const handsPayload = Object.fromEntries(Object.entries(temporaryHands).map(([uid, cards]) => [uid, { cards }]));
    const pyramidDeck = Object.fromEntries(temporaryPyramid.map(card => [card.position, card]));
    const updates = {
      ...playerUpdates,
      [`rooms/${code}/status`]: "playing",
      [`rooms/${code}/phase`]: "ready",
      [`rooms/${code}/updatedAt`]: now,
      [`rooms/${code}/pyramid`]: { currentIndex: -1, currentFloor: 1, revealedCards: {} },
      [`rooms/${code}/game`]: {
        round: Number(room.game?.round || 0) + 1,
        currentCard: null,
        declaredThisCard: {},
        lastResult: null,
        startedAt: now
      },
      [`rooms/${code}/activeClaim`]: null,
      [`rooms/${code}/publicHands`]: settings.handVisibility === "public" ? handsPayload : null,
      [`privateHands/${code}`]: settings.handVisibility === "private" ? handsPayload : null,
      [`hostState/${code}`]: { pyramidDeck, revealOrder: REVEAL_ORDER, createdAt: now },
      [`claimProofs/${code}`]: null
    };
    await update(ref(database), updates);
    return { status: "playing", handVisibility: settings.handVisibility };
  } catch (error) {
    await update(ref(database, `rooms/${code}`), { status: "lobby", phase: "waiting", updatedAt: serverTimestamp() }).catch(() => {});
    throw error;
  } finally {
    clearSensitiveDealData();
  }
}

export async function revealNextCardClient(roomCode) {
  const user = await ensureAuthenticated();
  const code = cleanCode(roomCode);
  const room = await readRoom(code);
  requireHost(room, user.uid);
  if (room.status !== "playing") throw clientError("game-finished", "La partida no está activa.");
  if (room.activeClaim) throw clientError("pending-claim", "Resuelvan la declaración pendiente.");

  const indexRef = ref(database, `rooms/${code}/pyramid/currentIndex`);
  const result = await runTransaction(indexRef, current => {
    const next = Number(current ?? -1) + 1;
    return next < 15 ? next : undefined;
  }, { applyLocally: false });
  if (!result.committed) throw clientError("pyramid-complete", "La pirámide ya está completa.");

  const revealIndex = result.snapshot.val();
  const position = REVEAL_ORDER[revealIndex];
  const cardSnapshot = await get(ref(database, `hostState/${code}/pyramidDeck/${position}`));
  if (!cardSnapshot.exists()) throw clientError("stale-data", "Falta la carta oculta. Reinicia la ronda.");
  const card = { ...cardSnapshot.val(), revealed: true };
  const floor = floorForRevealIndex(revealIndex);
  await update(ref(database), {
    [`rooms/${code}/pyramid/revealedCards/${position}`]: card,
    [`rooms/${code}/pyramid/currentFloor`]: floor,
    [`rooms/${code}/game/currentCard`]: card,
    [`rooms/${code}/game/declaredThisCard`]: null,
    [`rooms/${code}/game/lastResult`]: null,
    [`rooms/${code}/phase`]: "claiming",
    [`rooms/${code}/updatedAt`]: serverTimestamp()
  });
  return { currentCard: card };
}

function availableCards(hand = {}) {
  return Object.values(hand?.cards || hand || {}).filter(card => !card.used);
}

export async function submitClaimClient({ code: rawCode, targetUid, selectedCardId = null, declaredAsReal = false }) {
  const user = await ensureAuthenticated();
  const code = cleanCode(rawCode);
  const room = await readRoom(code);
  requireMember(room, user.uid);
  requireMember(room, targetUid);
  if (targetUid === user.uid) throw clientError("invalid-target", "Debes elegir a otra persona.");
  if (room.status !== "playing" || !room.game?.currentCard) throw clientError("stale-data", "No hay una carta activa.");
  if (room.activeClaim) throw clientError("pending-claim", "Ya existe una declaración pendiente.");
  if (room.game?.declaredThisCard?.[user.uid]) throw clientError("already-claimed", "Ya declaraste sobre esta carta.");

  const handPath = room.settings.handVisibility === "public"
    ? `rooms/${code}/publicHands/${user.uid}/cards`
    : `privateHands/${code}/${user.uid}/cards`;
  const hand = (await get(ref(database, handPath))).val() || {};
  const selectedCard = selectedCardId ? hand[selectedCardId] : null;
  if (declaredAsReal && (!selectedCard || selectedCard.used || selectedCard.value !== room.game.currentCard.value)) {
    throw clientError("invalid-card", "La carta seleccionada no coincide o ya fue utilizada.");
  }
  if (!declaredAsReal && !room.settings.bluffEnabled) {
    throw clientError("bluff-disabled", "El bluff está desactivado en esta sala.");
  }

  const claimId = crypto.randomUUID?.() || `${Date.now()}-${user.uid.slice(0, 8)}`;
  const multiplier = room.settings.floorMultipliers[(room.pyramid?.currentFloor || 1) - 1];
  const claim = {
    id: claimId,
    claimId,
    claimantId: user.uid,
    claimantUid: user.uid,
    claimantName: room.players[user.uid].name,
    targetId: targetUid,
    targetUid,
    targetName: room.players[targetUid].name,
    pyramidCardId: room.game.currentCard.id,
    claimedValue: room.game.currentCard.value,
    selectedCardId: declaredAsReal ? selectedCardId : null,
    declaredAsReal: Boolean(declaredAsReal),
    multiplier,
    status: "pending",
    createdAt: Date.now()
  };
  if (selectedCard) {
    await set(ref(database, `claimProofs/${code}/${claimId}`), {
      claimantUid: user.uid,
      targetUid,
      card: selectedCard,
      createdAt: Date.now()
    });
  }
  const result = await runTransaction(ref(database, `rooms/${code}/activeClaim`), current => (
    current === null ? claim : undefined
  ), { applyLocally: false });
  if (!result.committed) {
    await remove(ref(database, `claimProofs/${code}/${claimId}`)).catch(() => {});
    throw clientError("transaction-cancelled", "Otra declaración se registró primero.");
  }
  await update(ref(database), {
    [`rooms/${code}/players/${user.uid}/claimsMade`]: (room.players[user.uid].claimsMade || 0) + 1,
    [`rooms/${code}/phase`]: "resolving",
    [`rooms/${code}/updatedAt`]: serverTimestamp()
  });
  return { claim };
}

function resolveClaimOutcome(truthful, decision, multiplier) {
  if (decision === "accept") return {
    title: truthful ? "Carga aceptada" : "Bluff aceptado",
    claimantLoad: 0,
    targetLoad: multiplier,
    consumeCard: truthful,
    revealTruth: false
  };
  return truthful ? {
    title: "La coincidencia era real",
    claimantLoad: 0,
    targetLoad: multiplier * 2,
    consumeCard: true,
    revealTruth: true
  } : {
    title: "Bluff descubierto",
    claimantLoad: multiplier,
    targetLoad: 0,
    consumeCard: false,
    revealTruth: true
  };
}

async function resolveClaimClient(roomCode, decision) {
  const user = await ensureAuthenticated();
  const code = cleanCode(roomCode);
  const room = await readRoom(code);
  const claim = room.activeClaim;
  if (!claim || claim.targetUid !== user.uid || claim.status !== "pending") {
    throw clientError("permission-denied", "Solo el objetivo puede resolver esta declaración.");
  }
  if (room.settings.handVisibility === "public" && decision === "challenge") {
    throw clientError("failed-precondition", "No se puede desafiar cuando las cartas son visibles.");
  }
  const lock = await runTransaction(ref(database, `rooms/${code}/activeClaim/status`), status => (
    status === "pending" ? "resolving" : undefined
  ), { applyLocally: false });
  if (!lock.committed) throw clientError("transaction-cancelled", "La declaración ya fue resuelta.");

  try {
    let selectedCard = null;
    if (claim.selectedCardId) {
      if (room.settings.handVisibility === "public") {
        selectedCard = room.publicHands?.[claim.claimantUid]?.cards?.[claim.selectedCardId] || null;
      } else {
        const proof = await get(ref(database, `claimProofs/${code}/${claim.claimId}`));
        selectedCard = proof.val()?.card || null;
      }
    }
    const truthful = Boolean(
      claim.declaredAsReal && selectedCard && !selectedCard.used && selectedCard.value === claim.claimedValue
    );
    const outcome = resolveClaimOutcome(truthful, decision, claim.multiplier);
    const claimant = room.players[claim.claimantUid];
    const target = room.players[claim.targetUid];
    const scoringEnabled = room.settings.scoringEnabled !== false;
    const updates = {
      [`rooms/${code}/game/declaredThisCard/${claim.claimantUid}`]: true,
      [`rooms/${code}/game/lastResult`]: {
        claimId: claim.claimId,
        title: outcome.title,
        claimantUid: claim.claimantUid,
        targetUid: claim.targetUid,
        decision,
        truthful: outcome.revealTruth ? truthful : null,
        resolvedAt: Date.now()
      },
      [`rooms/${code}/actionHistory/${claim.claimId}`]: {
        type: "claim-resolution",
        claimantUid: claim.claimantUid,
        targetUid: claim.targetUid,
        decision,
        truthful: outcome.revealTruth ? truthful : null,
        multiplier: claim.multiplier,
        createdAt: Date.now()
      },
      [`rooms/${code}/activeClaim`]: null,
      [`rooms/${code}/phase`]: "claiming",
      [`rooms/${code}/updatedAt`]: serverTimestamp(),
      [`claimProofs/${code}/${claim.claimId}`]: null
    };
    if (scoringEnabled) {
      updates[`rooms/${code}/players/${claim.claimantUid}/skulls`] = (claimant.skulls || 0) + outcome.claimantLoad;
      updates[`rooms/${code}/players/${claim.targetUid}/skulls`] = (target.skulls || 0) + outcome.targetLoad;
    }
    if (scoringEnabled && decision === "accept" && !truthful) {
      updates[`rooms/${code}/players/${claim.claimantUid}/successfulBluffs`] = (claimant.successfulBluffs || 0) + 1;
      updates[`rooms/${code}/players/${claim.claimantUid}/crowns`] = (claimant.crowns || 0) + 1;
    }
    if (scoringEnabled && decision === "challenge" && truthful) {
      updates[`rooms/${code}/players/${claim.targetUid}/incorrectChallenges`] = (target.incorrectChallenges || 0) + 1;
    }
    if (scoringEnabled && decision === "challenge" && !truthful) {
      updates[`rooms/${code}/players/${claim.claimantUid}/failedBluffs`] = (claimant.failedBluffs || 0) + 1;
      updates[`rooms/${code}/players/${claim.targetUid}/correctChallenges`] = (target.correctChallenges || 0) + 1;
      updates[`rooms/${code}/players/${claim.targetUid}/crowns`] = (target.crowns || 0) + 1;
    }
    if (outcome.consumeCard && claim.selectedCardId) {
      const cardBase = room.settings.handVisibility === "public"
        ? `rooms/${code}/publicHands/${claim.claimantUid}/cards/${claim.selectedCardId}`
        : `privateHands/${code}/${claim.claimantUid}/cards/${claim.selectedCardId}`;
      updates[`${cardBase}/used`] = true;
      updates[`rooms/${code}/players/${claim.claimantUid}/availableCards`] = Math.max(0, (claimant.availableCards || 0) - 1);
      updates[`rooms/${code}/players/${claim.claimantUid}/usedCards`] = (claimant.usedCards || 0) + 1;
    }
    await update(ref(database), updates);
    return { result: updates[`rooms/${code}/game/lastResult`] };
  } catch (error) {
    await set(ref(database, `rooms/${code}/activeClaim/status`), "pending").catch(() => {});
    throw error;
  }
}

export function acceptClaimClient(roomCode) {
  return resolveClaimClient(roomCode, "accept");
}

export function challengeClaimClient(roomCode) {
  return resolveClaimClient(roomCode, "challenge");
}

export async function completeCurrentCardClient(roomCode) {
  const user = await ensureAuthenticated();
  const code = cleanCode(roomCode);
  const room = await readRoom(code);
  requireHost(room, user.uid);
  if (room.activeClaim) throw clientError("pending-claim", "Resuelvan la declaración pendiente.");
  await update(ref(database, `rooms/${code}`), {
    "game/currentCard": null,
    "game/lastResult": null,
    phase: "ready",
    updatedAt: serverTimestamp()
  });
}

export async function finishOnlineGameClient(roomCode) {
  const user = await ensureAuthenticated();
  const code = cleanCode(roomCode);
  const room = await readRoom(code);
  requireHost(room, user.uid);
  if (room.status !== "playing" || Number(room.pyramid?.currentIndex ?? -1) < 14 || room.activeClaim) {
    throw clientError("pyramid-incomplete", "Completa la pirámide y resuelve la declaración pendiente.");
  }
  await update(ref(database, `rooms/${code}`), {
    status: "finished",
    phase: "finished",
    "game/finishedAt": serverTimestamp(),
    updatedAt: serverTimestamp()
  });
}

export async function restartOnlineRoundClient(roomCode) {
  const user = await ensureAuthenticated();
  const code = cleanCode(roomCode);
  const room = await readRoom(code);
  requireHost(room, user.uid);
  if (room.status !== "finished") throw clientError("game-active", "La ronda todavía no terminó.");
  const updates = {
    [`rooms/${code}/status`]: "lobby",
    [`rooms/${code}/phase`]: "waiting",
    [`rooms/${code}/game`]: null,
    [`rooms/${code}/pyramid`]: { currentIndex: -1, currentFloor: 1, revealedCards: {} },
    [`rooms/${code}/activeClaim`]: null,
    [`rooms/${code}/publicHands`]: null,
    [`rooms/${code}/updatedAt`]: serverTimestamp(),
    [`privateHands/${code}`]: null,
    [`hostState/${code}`]: null,
    [`claimProofs/${code}`]: null
  };
  for (const player of Object.values(room.players || {})) {
    updates[`rooms/${code}/players/${player.uid}/availableCards`] = 0;
    updates[`rooms/${code}/players/${player.uid}/usedCards`] = 0;
    updates[`rooms/${code}/players/${player.uid}/skulls`] = 0;
  }
  await update(ref(database), updates);
}

export async function closeRoomClient(roomCode) {
  const user = await ensureAuthenticated();
  const code = cleanCode(roomCode);
  const room = await readRoom(code);
  requireHost(room, user.uid);
  await update(ref(database), {
    [`rooms/${code}`]: null,
    [`privateHands/${code}`]: null,
    [`hostState/${code}`]: null,
    [`claimProofs/${code}`]: null
  });
  clearSavedSession();
  return { deleted: true };
}

export async function leaveRoomClient(roomCode) {
  const user = await ensureAuthenticated();
  const code = cleanCode(roomCode);
  const room = await readRoom(code);
  requireMember(room, user.uid);
  if (room.hostUid === user.uid) return closeRoomClient(code);
  const updates = {
    [`rooms/${code}/players/${user.uid}`]: null,
    [`rooms/${code}/publicHands/${user.uid}`]: null,
    [`privateHands/${code}/${user.uid}`]: null,
    [`rooms/${code}/updatedAt`]: serverTimestamp()
  };
  const claim = room.activeClaim;
  if (claim && [claim.claimantUid, claim.targetUid].includes(user.uid)) {
    updates[`rooms/${code}/activeClaim`] = null;
    updates[`rooms/${code}/phase`] = "claiming";
    updates[`claimProofs/${code}/${claim.claimId}`] = null;
  }
  await update(ref(database), updates);
  clearSavedSession();
  return { deleted: false };
}

export function subscribeToRoom(code, onData, onError) {
  return onValue(ref(database, `rooms/${code}`), snapshot => onData(snapshot.val()), onError);
}

export function subscribeToPlayers(code, onData, onError) {
  return onValue(ref(database, `rooms/${code}/players`), snapshot => onData(snapshot.val() || {}), onError);
}

export function subscribeToPyramid(code, onData, onError) {
  return onValue(ref(database, `rooms/${code}/pyramid`), snapshot => onData(snapshot.val() || {}), onError);
}

export function subscribeToActiveClaim(code, onData, onError) {
  return onValue(ref(database, `rooms/${code}/activeClaim`), snapshot => onData(snapshot.val()), onError);
}

export function subscribeToPrivateHand(code, uid, onData, onError) {
  return onValue(ref(database, `privateHands/${code}/${uid}/cards`), snapshot => onData(snapshot.val() || {}), onError);
}

export function subscribeToPublicHands(code, onData, onError) {
  return onValue(ref(database, `rooms/${code}/publicHands`), snapshot => onData(snapshot.val() || {}), onError);
}

export function unsubscribeFromOnlineGame(...unsubscribe) {
  unsubscribe.flat().forEach(stop => {
    if (typeof stop === "function") stop();
  });
}

export async function roomExistsForMember(code) {
  const user = await ensureAuthenticated();
  const room = await readRoom(cleanCode(code));
  return room.players?.[user.uid] ? room : null;
}

export function connectPresence(code, uid) {
  const connectedInfo = ref(database, ".info/connected");
  const playerRef = ref(database, `rooms/${code}/players/${uid}`);
  let presenceDisconnect = null;
  const stop = onValue(connectedInfo, async snapshot => {
    if (snapshot.val() !== true) return;
    try {
      presenceDisconnect = onDisconnect(playerRef);
      await presenceDisconnect.update({ connected: false, lastSeen: serverTimestamp() });
      await update(playerRef, { connected: true, lastSeen: serverTimestamp() });
    } catch {
      // La sala puede haberse cerrado mientras se restablecía la presencia.
    }
  });
  return () => {
    stop();
    presenceDisconnect?.cancel().catch(() => {});
  };
}

export const api = {
  createRoom: ({ name, settings } = {}) => createRoomClient(settings, name),
  joinRoom: ({ code, name }) => joinRoomClient(code, name),
  updateRoomSettings: ({ settings }) => updateRoomSettingsClient(settings),
  startOnlineGame: ({ code }) => startGameClient(code),
  revealNextCard: ({ code }) => revealNextCardClient(code),
  submitClaim: data => submitClaimClient(data),
  acceptClaim: ({ code }) => acceptClaimClient(code),
  challengeClaim: ({ code }) => challengeClaimClient(code),
  completeCurrentCard: ({ code }) => completeCurrentCardClient(code),
  finishOnlineGame: ({ code }) => finishOnlineGameClient(code),
  restartOnlineRound: ({ code }) => restartOnlineRoundClient(code),
  leaveRoom: ({ code }) => leaveRoomClient(code),
  closeRoom: ({ code }) => closeRoomClient(code)
};

export function humanizeFirebaseError(error) {
  const code = String(error?.code || "").replace(/^database\//, "").replace(/^auth\//, "");
  const messages = {
    "network-request-failed": "Sin conexión. Revisa internet e inténtalo otra vez.",
    "unauthorized-domain": "Este dominio no está autorizado en Firebase Authentication.",
    "room-not-found": "La sala no existe o ya fue cerrada.",
    "invalid-code": "El código de sala no es válido.",
    "room-full": "La sala está llena.",
    "game-started": "La partida ya comenzó.",
    "duplicate-name": "Ya hay un jugador activo con ese nombre.",
    "permission-denied": "No tienes permiso para realizar esta acción.",
    "transaction-cancelled": "Los datos cambiaron. Inténtalo nuevamente.",
    "stale-data": "Los datos quedaron desactualizados. Vuelve a intentarlo.",
    "game-finished": "La partida ya terminó.",
    "room-expired": "La sala venció después de 12 horas."
  };
  if (messages[code]) return messages[code];
  const message = String(error?.message || "No se pudo completar la acción.")
    .replace(/^FirebaseError:\s*/i, "")
    .replace(/^internal\s*/i, "");
  return message.charAt(0).toUpperCase() + message.slice(1);
}
