import test, { after, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds
} from "@firebase/rules-unit-testing";
import {
  ref,
  get,
  set,
  update
} from "firebase/database";

const projectId = "piramide-multijugador-test";
let environment;

const host = {
  uid: "host",
  name: "Marti",
  role: "host",
  joinedAt: 1,
  connected: true,
  lastSeen: 1,
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

const guest = {
  ...host,
  uid: "guest",
  name: "Camila",
  role: "guest",
  joinedAt: 2
};

before(async () => {
  const rules = await readFile(new URL("../database.rules.json", import.meta.url), "utf8");
  environment = await initializeTestEnvironment({
    projectId,
    database: { rules }
  });
});

beforeEach(async () => {
  await environment.clearDatabase();
  await environment.withSecurityRulesDisabled(async context => {
    const database = context.database();
    await set(ref(database, "rooms/ABC123"), {
      code: "ABC123",
      hostUid: "host",
      status: "lobby",
      settings: {
        handVisibility: "private",
        bluffEnabled: true,
        cardsPerPlayer: 4
      },
      players: { host, guest },
      publicHands: {
        host: {
          cards: {
            h1: { id: "h1", value: "7", suit: "hearts", color: "red", symbol: "♥", used: false }
          }
        }
      }
    });
    await set(ref(database, "privateHands/ABC123"), {
      host: {
        cards: {
          h1: { id: "h1", value: "7", suit: "hearts", color: "red", symbol: "♥", used: false }
        }
      },
      guest: {
        cards: {
          g1: { id: "g1", value: "Q", suit: "clubs", color: "black", symbol: "♣", used: false }
        }
      }
    });
  });
});

after(async () => {
  await environment.cleanup();
});

test("cada jugador puede leer únicamente su mano privada", async () => {
  const hostDb = environment.authenticatedContext("host").database();
  await assertSucceeds(get(ref(hostDb, "privateHands/ABC123/host/cards")));
  await assertFails(get(ref(hostDb, "privateHands/ABC123/guest/cards")));
});

test("un miembro puede leer las manos públicas de su sala", async () => {
  const guestDb = environment.authenticatedContext("guest").database();
  const snapshot = await assertSucceeds(get(ref(guestDb, "rooms/ABC123/publicHands")));
  assert.equal(snapshot.child("host/cards/h1/value").val(), "7");
});

test("un usuario externo no puede leer la sala", async () => {
  const strangerDb = environment.authenticatedContext("stranger").database();
  await assertFails(get(ref(strangerDb, "rooms/ABC123")));
});

test("ni el anfitrión ni un invitado pueden editar configuración desde el cliente", async () => {
  const hostDb = environment.authenticatedContext("host").database();
  const guestDb = environment.authenticatedContext("guest").database();
  await assertFails(update(ref(hostDb, "rooms/ABC123/settings"), { handVisibility: "public" }));
  await assertFails(update(ref(guestDb, "rooms/ABC123/settings"), { handVisibility: "public" }));
});

test("un jugador puede actualizar solo su presencia", async () => {
  const guestDb = environment.authenticatedContext("guest").database();
  await assertSucceeds(update(ref(guestDb, "rooms/ABC123/players/guest"), {
    connected: false,
    lastSeen: 10
  }));
  await assertFails(update(ref(guestDb, "rooms/ABC123/players/guest"), {
    crowns: 99
  }));
});

test("un jugador no puede borrar su registro ni editar cartas públicas", async () => {
  const guestDb = environment.authenticatedContext("guest").database();
  await assertFails(set(ref(guestDb, "rooms/ABC123/players/guest"), null));
  await assertFails(update(ref(guestDb, "rooms/ABC123/publicHands/host/cards/h1"), { used: true }));
});
