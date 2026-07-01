import test, { after, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds
} from "@firebase/rules-unit-testing";
import { ref, get, set, update } from "firebase/database";

const projectId = "piramide-multijugador-spark-test";
let environment;

const settings = {
  mode: "classic",
  cardsPerPlayer: 4,
  multiplierType: "double",
  floorMultipliers: [1, 2, 4, 8, 16],
  handVisibility: "private",
  bluffEnabled: true,
  powersEnabled: false,
  scoringEnabled: true,
  maxPlayers: 8
};

function player(uid, name, role, joinedAt) {
  return {
    uid,
    name,
    role,
    isHost: role === "host",
    joinedAt,
    connected: true,
    lastSeen: joinedAt,
    skulls: 0,
    crowns: 0,
    availableCards: 4,
    usedCards: 0,
    claimsMade: 0,
    successfulBluffs: 0,
    failedBluffs: 0,
    correctChallenges: 0,
    incorrectChallenges: 0
  };
}

const host = player("host", "Marti", "host", 1);
const guest = player("guest", "Camila", "guest", 2);

before(async () => {
  const rules = await readFile(new URL("../database.rules.json", import.meta.url), "utf8");
  environment = await initializeTestEnvironment({ projectId, database: { rules } });
});

beforeEach(async () => {
  await environment.clearDatabase();
  await environment.withSecurityRulesDisabled(async context => {
    const database = context.database();
    await set(ref(database, "rooms/ABC234"), {
      code: "ABC234",
      hostUid: "host",
      status: "lobby",
      phase: "waiting",
      createdAt: 1,
      updatedAt: 1,
      expiresAt: Date.now() + 100000,
      settings,
      players: { host, guest },
      pyramid: { currentIndex: -1, currentFloor: 1 },
      version: 1,
      publicHands: {
        host: { cards: { h1: { id: "h1", value: "7", suit: "hearts", color: "red", symbol: "♥", used: false } } }
      }
    });
    await set(ref(database, "privateHands/ABC234"), {
      host: { cards: { h1: { id: "h1", value: "7", suit: "hearts", color: "red", symbol: "♥", used: false } } },
      guest: { cards: { g1: { id: "g1", value: "Q", suit: "clubs", color: "black", symbol: "♣", used: false } } }
    });
    await set(ref(database, "hostState/ABC234"), { pyramidDeck: { 0: { id: "p0", value: "A" } } });
  });
});

after(async () => environment.cleanup());

test("cada jugador lee únicamente su mano privada", async () => {
  const hostDb = environment.authenticatedContext("host").database();
  await assertSucceeds(get(ref(hostDb, "privateHands/ABC234/host/cards")));
  await assertFails(get(ref(hostDb, "privateHands/ABC234/guest/cards")));
});

test("un miembro lee la sala y un externo solo los datos necesarios para unirse", async () => {
  const guestDb = environment.authenticatedContext("guest").database();
  const strangerDb = environment.authenticatedContext("stranger").database();
  await assertSucceeds(get(ref(guestDb, "rooms/ABC234")));
  await assertFails(get(ref(strangerDb, "rooms/ABC234")));
  const status = await assertSucceeds(get(ref(strangerDb, "rooms/ABC234/status")));
  assert.equal(status.val(), "lobby");
  await assertSucceeds(get(ref(strangerDb, "rooms/ABC234/players")));
});

test("el host configura en lobby y un invitado no puede hacerlo", async () => {
  const hostDb = environment.authenticatedContext("host").database();
  const guestDb = environment.authenticatedContext("guest").database();
  await assertSucceeds(set(ref(hostDb, "rooms/ABC234/settings"), { ...settings, cardsPerPlayer: 5, maxPlayers: 2 }));
  await assertFails(set(ref(guestDb, "rooms/ABC234/settings"), { ...settings, cardsPerPlayer: 6 }));
  await assertFails(set(ref(hostDb, "rooms/ABC234/settings"), {
    ...settings,
    handVisibility: "public",
    bluffEnabled: true
  }));
});

test("un usuario autenticado puede agregarse al lobby, pero no controlar la pirámide", async () => {
  const newcomerDb = environment.authenticatedContext("newcomer").database();
  await assertSucceeds(set(
    ref(newcomerDb, "rooms/ABC234/players/newcomer"),
    player("newcomer", "Nico", "guest", 3)
  ));
  await assertFails(update(ref(newcomerDb, "rooms/ABC234/pyramid"), { currentIndex: 0 }));
});

test("solo el host lee y escribe el estado oculto", async () => {
  const hostDb = environment.authenticatedContext("host").database();
  const guestDb = environment.authenticatedContext("guest").database();
  await assertSucceeds(get(ref(hostDb, "hostState/ABC234")));
  await assertFails(get(ref(guestDb, "hostState/ABC234")));
  await assertSucceeds(update(ref(hostDb, "hostState/ABC234"), { updatedAt: 2 }));
  await assertFails(update(ref(guestDb, "hostState/ABC234"), { updatedAt: 3 }));
});

test("la presencia propia se actualiza y el invitado no cambia el estado de la partida", async () => {
  const guestDb = environment.authenticatedContext("guest").database();
  await assertSucceeds(update(ref(guestDb, "rooms/ABC234/players/guest"), {
    connected: false,
    lastSeen: 10
  }));
  await assertFails(set(ref(guestDb, "rooms/ABC234/status"), "playing"));
});
