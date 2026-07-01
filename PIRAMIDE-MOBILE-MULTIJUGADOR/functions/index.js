"use strict";

const crypto = require("node:crypto");
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { setGlobalOptions } = require("firebase-functions/v2/options");
const { initializeApp } = require("firebase-admin/app");
const { getDatabase } = require("firebase-admin/database");
const {
  DEFAULT_SETTINGS,
  normalizeSettings,
  assertStartSettings,
  dealGame,
  floorForRevealIndex,
  availableCards,
  findMatchingCard,
  resolveClaimOutcome
} = require("./src/game");

initializeApp();
const FUNCTIONS_REGION = "southamerica-west1";
const callableOptions = {
  region: FUNCTIONS_REGION,
  cors: true
};

setGlobalOptions({
  region: FUNCTIONS_REGION,
  maxInstances: 20,
  timeoutSeconds: 30
});

const db = getDatabase();
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const MAX_PLAYERS = 12;

function callable(handler) {
  return onCall(callableOptions, handler);
}

function asHttpsError(error) {
  if (error instanceof HttpsError) return error;
  const allowed = new Set([
    "invalid-argument",
    "failed-precondition",
    "permission-denied",
    "not-found",
    "already-exists",
    "resource-exhausted"
  ]);
  const code = allowed.has(error?.code) ? error.code : "internal";
  return new HttpsError(code, error?.message || "No se pudo completar la acción.");
}

function requireUid(request) {
  if (!request.auth?.uid) {
    throw new HttpsError("unauthenticated", "Debes autenticarte para jugar.");
  }
  return request.auth.uid;
}

function cleanCode(value) {
  const code = String(value || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (code.length !== 6) throw new HttpsError("invalid-argument", "El código de sala debe tener 6 caracteres.");
  return code;
}

function cleanName(value) {
  const name = String(value || "").trim().replace(/\s+/g, " ");
  if (name.length < 2 || name.length > 18) {
    throw new HttpsError("invalid-argument", "El nombre debe tener entre 2 y 18 caracteres.");
  }
  return name;
}

function makeCode() {
  let code = "";
  for (let index = 0; index < 6; index += 1) {
    code += ALPHABET[crypto.randomInt(0, ALPHABET.length)];
  }
  return code;
}

function playerRecord(uid, name, role) {
  return {
    uid,
    name,
    role,
    joinedAt: Date.now(),
    connected: true,
    lastSeen: Date.now(),
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

function requireMember(room, uid) {
  if (!room?.players?.[uid]) {
    throw new HttpsError("permission-denied", "No perteneces a esta sala.");
  }
  return room.players[uid];
}

function requireHost(room, uid) {
  requireMember(room, uid);
  if (room.hostUid !== uid) {
    throw new HttpsError("permission-denied", "Solo el anfitrión puede realizar esta acción.");
  }
}

function requireLobbyHost(room, uid) {
  requireHost(room, uid);
  if (room.status !== "lobby") {
    throw new HttpsError("failed-precondition", "La configuración solo puede cambiarse en el lobby.");
  }
}

async function readRoom(code) {
  const snapshot = await db.ref(`rooms/${code}`).get();
  if (!snapshot.exists()) throw new HttpsError("not-found", "La sala no existe.");
  return snapshot.val();
}

async function readHand(room, code, uid) {
  if (room.settings.handVisibility === "public") {
    return room.publicHands?.[uid]?.cards || {};
  }
  const snapshot = await db.ref(`privateHands/${code}/${uid}/cards`).get();
  return snapshot.val() || {};
}

async function createRoomHandler(request) {
  try {
    const uid = requireUid(request);
    const name = cleanName(request.data?.name);
    const settings = normalizeSettings(request.data?.settings || {}, DEFAULT_SETTINGS);

    for (let attempt = 0; attempt < 12; attempt += 1) {
      const code = makeCode();
      const room = {
        code,
        hostUid: uid,
        status: "lobby",
        settings,
        players: {
          [uid]: playerRecord(uid, name, "host")
        },
        createdAt: Date.now(),
        updatedAt: Date.now()
      };
      const result = await db.ref(`rooms/${code}`).transaction(current => current === null ? room : undefined);
      if (result.committed) return { code, room };
    }
    throw new HttpsError("resource-exhausted", "No se pudo generar un código de sala.");
  } catch (error) {
    throw asHttpsError(error);
  }
}

async function joinRoomHandler(request) {
  try {
    const uid = requireUid(request);
    const code = cleanCode(request.data?.code);
    const name = cleanName(request.data?.name);
    const roomRef = db.ref(`rooms/${code}`);
    const before = await roomRef.get();
    if (!before.exists()) throw new HttpsError("not-found", "La sala no existe.");
    const initial = before.val();
    if (initial.status !== "lobby" && !initial.players?.[uid]) {
      throw new HttpsError("failed-precondition", "La partida ya comenzó.");
    }

    let rejection = "";
    const result = await roomRef.transaction(room => {
      if (!room) {
        rejection = "La sala ya no existe.";
        return undefined;
      }
      const players = room.players || {};
      if (players[uid]) {
        players[uid].connected = true;
        players[uid].lastSeen = Date.now();
        if (room.status === "lobby") players[uid].name = name;
        room.updatedAt = Date.now();
        return room;
      }
      if (room.status !== "lobby") {
        rejection = "La partida ya comenzó.";
        return undefined;
      }
      if (Object.keys(players).length >= MAX_PLAYERS) {
        rejection = "La sala está llena.";
        return undefined;
      }
      const duplicate = Object.values(players).some(player =>
        player.name.toLocaleLowerCase("es") === name.toLocaleLowerCase("es")
      );
      if (duplicate) {
        rejection = "Ese nombre ya está en uso.";
        return undefined;
      }
      players[uid] = playerRecord(uid, name, "guest");
      room.players = players;
      room.updatedAt = Date.now();
      return room;
    });

    if (!result.committed) {
      throw new HttpsError("failed-precondition", rejection || "No se pudo entrar a la sala.");
    }
    return { code, room: result.snapshot.val() };
  } catch (error) {
    throw asHttpsError(error);
  }
}

async function updateRoomSettingsHandler(request) {
  try {
    const uid = requireUid(request);
    const code = cleanCode(request.data?.code);
    const roomRef = db.ref(`rooms/${code}`);
    const room = await readRoom(code);
    requireLobbyHost(room, uid);
    const settings = normalizeSettings(request.data?.settings || {}, room.settings);

    const result = await roomRef.transaction(current => {
      if (!current || current.hostUid !== uid || current.status !== "lobby") return undefined;
      current.settings = settings;
      current.updatedAt = Date.now();
      return current;
    });
    if (!result.committed) {
      throw new HttpsError("failed-precondition", "La configuración quedó bloqueada.");
    }
    return { settings };
  } catch (error) {
    throw asHttpsError(error);
  }
}

async function startGameHandler(request) {
  const uid = requireUid(request);
  const code = cleanCode(request.data?.code);
  const roomRef = db.ref(`rooms/${code}`);
  let lockedRoom = null;

  try {
    const lock = await roomRef.transaction(room => {
      if (!room || room.hostUid !== uid || room.status !== "lobby") return undefined;
      room.status = "starting";
      room.updatedAt = Date.now();
      return room;
    });
    if (!lock.committed) {
      throw new HttpsError("failed-precondition", "Solo el anfitrión puede iniciar desde el lobby.");
    }
    lockedRoom = lock.snapshot.val();
    requireHost(lockedRoom, uid);

    const playerUids = Object.keys(lockedRoom.players || {});
    if (playerUids.length < 3) {
      throw new HttpsError("failed-precondition", "Se necesitan al menos 3 jugadores.");
    }

    const settings = normalizeSettings(lockedRoom.settings, DEFAULT_SETTINGS);
    assertStartSettings(settings);
    const dealt = dealGame(playerUids, settings);
    const nextRoom = {
      ...lockedRoom,
      status: "playing",
      settings,
      game: dealt.game,
      publicHands: null,
      updatedAt: Date.now()
    };

    for (const playerUid of playerUids) {
      nextRoom.players[playerUid].availableCards = settings.cardsPerPlayer;
      nextRoom.players[playerUid].usedCards = 0;
      nextRoom.players[playerUid].skulls = 0;
    }

    const updates = {
      [`rooms/${code}`]: nextRoom,
      [`privateHands/${code}`]: null,
      [`roomSecrets/${code}`]: null
    };

    if (settings.handVisibility === "private") {
      updates[`privateHands/${code}`] = Object.fromEntries(
        playerUids.map(playerUid => [playerUid, { cards: dealt.hands[playerUid] }])
      );
    } else {
      nextRoom.publicHands = Object.fromEntries(
        playerUids.map(playerUid => [playerUid, { cards: dealt.hands[playerUid] }])
      );
      updates[`rooms/${code}`] = nextRoom;
    }

    await db.ref().update(updates);
    return { status: "playing", handVisibility: settings.handVisibility };
  } catch (error) {
    if (lockedRoom) {
      await roomRef.update({ status: "lobby", updatedAt: Date.now() }).catch(() => {});
    }
    throw asHttpsError(error);
  }
}

async function revealNextCardHandler(request) {
  try {
    const uid = requireUid(request);
    const code = cleanCode(request.data?.code);
    const roomRef = db.ref(`rooms/${code}`);
    let rejection = "";

    const result = await roomRef.transaction(room => {
      if (!room || room.hostUid !== uid) {
        rejection = "Solo el anfitrión puede revelar cartas.";
        return undefined;
      }
      if (room.status !== "playing") {
        rejection = "La partida no está activa.";
        return undefined;
      }
      if (room.game?.activeClaim) {
        rejection = "Resuelvan la declaración pendiente.";
        return undefined;
      }
      const index = room.game?.pyramidIndex || 0;
      if (index >= 15) {
        rejection = "La pirámide ya está completa.";
        return undefined;
      }
      const position = room.game.revealOrder[index];
      const card = room.game.pyramidCards[position];
      card.revealed = true;
      room.game.currentFloor = floorForRevealIndex(index);
      room.game.currentCard = card;
      room.game.highlightedValue = card.value;
      room.game.pyramidIndex = index + 1;
      room.game.declaredThisCard = {};
      room.game.lastResult = null;
      room.updatedAt = Date.now();
      return room;
    });

    if (!result.committed) {
      throw new HttpsError("failed-precondition", rejection || "No se pudo revelar la carta.");
    }
    return { currentCard: result.snapshot.val().game.currentCard };
  } catch (error) {
    throw asHttpsError(error);
  }
}

async function createClaimHandler(request) {
  const uid = requireUid(request);
  const code = cleanCode(request.data?.code);
  const targetUid = String(request.data?.targetUid || "");
  const secretRef = db.ref(`roomSecrets/${code}/activeClaim`);

  try {
    const room = await readRoom(code);
    requireMember(room, uid);
    requireMember(room, targetUid);
    if (uid === targetUid) throw new HttpsError("invalid-argument", "Debes elegir a otra persona.");
    if (room.status !== "playing" || !room.game?.currentCard) {
      throw new HttpsError("failed-precondition", "No hay una carta activa.");
    }
    if (room.game.activeClaim) {
      throw new HttpsError("failed-precondition", "Ya existe una declaración pendiente.");
    }
    if (room.game.declaredThisCard?.[uid]) {
      throw new HttpsError("failed-precondition", "Ya declaraste esta carta.");
    }

    const hand = await readHand(room, code, uid);
    const matching = findMatchingCard(hand, room.game.currentCard.value);
    if (!matching && !room.settings.bluffEnabled) {
      throw new HttpsError("failed-precondition", "No tienes una coincidencia disponible.");
    }

    const claimId = crypto.randomUUID();
    const multiplier = room.settings.floorMultipliers[room.game.currentFloor - 1];
    const secret = {
      claimId,
      claimantUid: uid,
      targetUid,
      truthful: Boolean(matching),
      matchingCardId: matching?.id || null,
      multiplier,
      status: "pending",
      createdAt: Date.now()
    };

    const lock = await secretRef.transaction(current => current === null ? secret : undefined);
    if (!lock.committed) throw new HttpsError("already-exists", "Ya existe una declaración pendiente.");

    let rejection = "";
    const publicClaim = {
      claimId,
      claimantUid: uid,
      targetUid,
      claimedValue: room.game.currentCard.value,
      multiplier,
      status: "pending",
      createdAt: Date.now()
    };
    const roomResult = await db.ref(`rooms/${code}`).transaction(current => {
      if (!current || current.status !== "playing" || current.game?.activeClaim ||
          current.game?.currentCard?.id !== room.game.currentCard.id) {
        rejection = "La ronda cambió antes de registrar la declaración.";
        return undefined;
      }
      current.game.activeClaim = publicClaim;
      current.game.lastResult = null;
      current.players[uid].claimsMade = (current.players[uid].claimsMade || 0) + 1;
      current.updatedAt = Date.now();
      return current;
    });

    if (!roomResult.committed) {
      await secretRef.remove();
      throw new HttpsError("failed-precondition", rejection);
    }
    return { claim: publicClaim };
  } catch (error) {
    throw asHttpsError(error);
  }
}

async function resolveClaimHandler(request) {
  const uid = requireUid(request);
  const code = cleanCode(request.data?.code);
  const decision = String(request.data?.decision || "");
  const secretRef = db.ref(`roomSecrets/${code}/activeClaim`);

  try {
    let secret = null;
    const lock = await secretRef.transaction(current => {
      if (!current || current.targetUid !== uid || current.status !== "pending") return undefined;
      secret = { ...current };
      current.status = "resolving";
      return current;
    });
    if (!lock.committed || !secret) {
      throw new HttpsError("permission-denied", "Solo el objetivo puede resolver esta declaración.");
    }

    const room = await readRoom(code);
    const claim = room.game?.activeClaim;
    if (!claim || claim.claimId !== secret.claimId || room.status !== "playing") {
      await secretRef.remove();
      throw new HttpsError("failed-precondition", "La declaración ya no está activa.");
    }
    if (room.settings.handVisibility === "public" && decision === "challenge") {
      throw new HttpsError(
        "failed-precondition",
        "No se puede desafiar cuando todas las cartas son visibles."
      );
    }

    const outcome = resolveClaimOutcome({
      truthful: secret.truthful,
      decision,
      multiplier: secret.multiplier
    });
    const nextRoom = JSON.parse(JSON.stringify(room));
    const claimant = nextRoom.players[secret.claimantUid];
    const target = nextRoom.players[secret.targetUid];
    claimant.skulls = (claimant.skulls || 0) + outcome.claimantLoad;
    target.skulls = (target.skulls || 0) + outcome.targetLoad;

    if (decision === "accept" && !secret.truthful) {
      claimant.successfulBluffs = (claimant.successfulBluffs || 0) + 1;
      claimant.crowns = (claimant.crowns || 0) + 1;
    }
    if (decision === "challenge" && secret.truthful) {
      target.incorrectChallenges = (target.incorrectChallenges || 0) + 1;
    }
    if (decision === "challenge" && !secret.truthful) {
      claimant.failedBluffs = (claimant.failedBluffs || 0) + 1;
      target.correctChallenges = (target.correctChallenges || 0) + 1;
      target.crowns = (target.crowns || 0) + 1;
    }

    const updates = {
      [`rooms/${code}`]: nextRoom,
      [`roomSecrets/${code}/activeClaim`]: null
    };

    if (outcome.consumeCard && secret.matchingCardId) {
      claimant.availableCards = Math.max(0, (claimant.availableCards || 0) - 1);
      claimant.usedCards = (claimant.usedCards || 0) + 1;
      if (nextRoom.settings.handVisibility === "public") {
        const card = nextRoom.publicHands?.[secret.claimantUid]?.cards?.[secret.matchingCardId];
        if (!card || card.used) throw new HttpsError("failed-precondition", "La carta ya fue utilizada.");
        card.used = true;
      } else {
        const cardPath = `privateHands/${code}/${secret.claimantUid}/cards/${secret.matchingCardId}/used`;
        const cardSnapshot = await db.ref(cardPath).get();
        if (!cardSnapshot.exists() || cardSnapshot.val() === true) {
          throw new HttpsError("failed-precondition", "La carta ya fue utilizada.");
        }
        updates[cardPath] = true;
      }
    }

    nextRoom.game.declaredThisCard = nextRoom.game.declaredThisCard || {};
    nextRoom.game.declaredThisCard[secret.claimantUid] = true;
    nextRoom.game.activeClaim = null;
    nextRoom.game.lastResult = {
      claimId: secret.claimId,
      title: outcome.title,
      claimantUid: secret.claimantUid,
      targetUid: secret.targetUid,
      decision,
      truthful: outcome.revealTruth ? secret.truthful : null,
      resolvedAt: Date.now()
    };
    nextRoom.updatedAt = Date.now();
    updates[`rooms/${code}`] = nextRoom;
    await db.ref().update(updates);
    return { result: nextRoom.game.lastResult };
  } catch (error) {
    const current = await secretRef.get().catch(() => null);
    if (current?.val()?.status === "resolving") {
      await secretRef.child("status").set("pending").catch(() => {});
    }
    throw asHttpsError(error);
  }
}

async function finishRoundHandler(request) {
  try {
    const uid = requireUid(request);
    const code = cleanCode(request.data?.code);
    let rejection = "";
    const result = await db.ref(`rooms/${code}`).transaction(room => {
      if (!room || room.hostUid !== uid) {
        rejection = "Solo el anfitrión puede terminar la ronda.";
        return undefined;
      }
      if (room.status !== "playing" || (room.game?.pyramidIndex || 0) < 15 || room.game?.activeClaim) {
        rejection = "Completa la pirámide y resuelve la declaración pendiente.";
        return undefined;
      }
      room.status = "finished";
      room.game.finishedAt = Date.now();
      room.updatedAt = Date.now();
      return room;
    });
    if (!result.committed) throw new HttpsError("failed-precondition", rejection);
    return { status: "finished" };
  } catch (error) {
    throw asHttpsError(error);
  }
}

async function prepareRematchHandler(request) {
  try {
    const uid = requireUid(request);
    const code = cleanCode(request.data?.code);
    const room = await readRoom(code);
    requireHost(room, uid);
    if (room.status !== "finished") {
      throw new HttpsError("failed-precondition", "La ronda todavía no terminó.");
    }
    const nextRoom = JSON.parse(JSON.stringify(room));
    nextRoom.status = "lobby";
    nextRoom.game = null;
    nextRoom.publicHands = null;
    nextRoom.updatedAt = Date.now();
    for (const player of Object.values(nextRoom.players)) {
      player.availableCards = 0;
      player.usedCards = 0;
      player.skulls = 0;
    }
    await db.ref().update({
      [`rooms/${code}`]: nextRoom,
      [`privateHands/${code}`]: null,
      [`roomSecrets/${code}`]: null
    });
    return { status: "lobby" };
  } catch (error) {
    throw asHttpsError(error);
  }
}

async function leaveRoomHandler(request) {
  try {
    const uid = requireUid(request);
    const code = cleanCode(request.data?.code);
    const room = await readRoom(code);
    requireMember(room, uid);

    if (room.hostUid === uid) {
      await db.ref().update({
        [`rooms/${code}`]: null,
        [`privateHands/${code}`]: null,
        [`roomSecrets/${code}`]: null
      });
      return { deleted: true };
    }

    const nextRoom = JSON.parse(JSON.stringify(room));
    delete nextRoom.players[uid];
    if (nextRoom.publicHands) delete nextRoom.publicHands[uid];
    const claimInvolvesPlayer = Boolean(
      nextRoom.game?.activeClaim &&
      [nextRoom.game.activeClaim.claimantUid, nextRoom.game.activeClaim.targetUid].includes(uid)
    );
    if (claimInvolvesPlayer) {
      nextRoom.game.activeClaim = null;
    }
    if (nextRoom.status === "playing" && Object.keys(nextRoom.players).length < 3) {
      nextRoom.status = "finished";
      if (nextRoom.game) nextRoom.game.finishedAt = Date.now();
    }
    nextRoom.updatedAt = Date.now();
    const updates = {
      [`rooms/${code}`]: nextRoom,
      [`privateHands/${code}/${uid}`]: null
    };
    if (claimInvolvesPlayer) updates[`roomSecrets/${code}/activeClaim`] = null;
    await db.ref().update(updates);
    return { deleted: false };
  } catch (error) {
    throw asHttpsError(error);
  }
}

async function completeCurrentCardHandler(request) {
  try {
    const uid = requireUid(request);
    const code = cleanCode(request.data?.code);
    let rejection = "";

    const result = await db.ref(`rooms/${code}`).transaction(room => {
      if (!room || room.hostUid !== uid) {
        rejection = "Solo el anfitrión puede completar la carta actual.";
        return undefined;
      }
      if (room.status !== "playing" || !room.game?.currentCard) {
        rejection = "No hay una carta activa para completar.";
        return undefined;
      }
      if (room.game.activeClaim) {
        rejection = "Resuelvan la declaración pendiente antes de continuar.";
        return undefined;
      }

      room.game.currentCard = null;
      room.game.highlightedValue = null;
      room.game.declaredThisCard = {};
      room.game.lastResult = null;
      room.updatedAt = Date.now();
      return room;
    });

    if (!result.committed) {
      throw new HttpsError("failed-precondition", rejection || "No se pudo completar la carta.");
    }
    return { completed: true };
  } catch (error) {
    throw asHttpsError(error);
  }
}

function withDecision(request, decision) {
  return {
    ...request,
    data: {
      ...(request.data || {}),
      decision
    }
  };
}

// Nombres existentes: se conservan para no romper clientes ni despliegues previos.
exports.createRoom = callable(createRoomHandler);
exports.joinRoom = callable(joinRoomHandler);
exports.leaveRoom = callable(leaveRoomHandler);
exports.updateRoomSettings = callable(updateRoomSettingsHandler);
exports.startGame = callable(startGameHandler);
exports.revealNextCard = callable(revealNextCardHandler);
exports.createClaim = callable(createClaimHandler);
exports.resolveClaim = callable(resolveClaimHandler);
exports.finishRound = callable(finishRoundHandler);
exports.prepareRematch = callable(prepareRematchHandler);

// API online explícita usada por el frontend.
exports.startOnlineGame = callable(startGameHandler);
exports.submitClaim = callable(createClaimHandler);
exports.acceptClaim = callable(request =>
  resolveClaimHandler(withDecision(request, "accept"))
);
exports.challengeClaim = callable(request =>
  resolveClaimHandler(withDecision(request, "challenge"))
);
exports.completeCurrentCard = callable(completeCurrentCardHandler);
exports.finishOnlineGame = callable(finishRoundHandler);
exports.restartOnlineRound = callable(prepareRematchHandler);
