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
  onValue,
  update,
  onDisconnect,
  serverTimestamp,
  connectDatabaseEmulator
} from "https://www.gstatic.com/firebasejs/12.15.0/firebase-database.js";
import {
  getFunctions,
  httpsCallable,
  connectFunctionsEmulator
} from "https://www.gstatic.com/firebasejs/12.15.0/firebase-functions.js";
import {
  firebaseConfig,
  functionsRegion,
  useEmulators
} from "./firebase-config.js";

let app;
let auth;
let database;
let functions;
let initialized = false;

export async function initializeFirebase() {
  if (initialized) return currentServices();
  app = initializeApp(firebaseConfig);
  auth = getAuth(app);
  database = getDatabase(app);
  functions = getFunctions(app, functionsRegion);

  if (useEmulators) {
    connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
    connectDatabaseEmulator(database, "127.0.0.1", 9000);
    connectFunctionsEmulator(functions, "127.0.0.1", 5001);
  }

  await setPersistence(auth, browserLocalPersistence);
  if (!auth.currentUser) await signInAnonymously(auth);
  initialized = true;
  return currentServices();
}

function currentServices() {
  return { app, auth, database, functions };
}

export function waitForUser() {
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
  if (!auth.currentUser) await waitForUser();
  return auth.currentUser;
}

async function call(name, data = {}) {
  await ensureAuthenticated();
  const callable = httpsCallable(functions, name);
  const response = await callable(data);
  return response.data;
}

export const api = {
  createRoom: data => call("createRoom", data),
  joinRoom: data => call("joinRoom", data),
  updateRoomSettings: data => call("updateRoomSettings", data),
  startOnlineGame: data => call("startOnlineGame", data),
  revealNextCard: data => call("revealNextCard", data),
  submitClaim: data => call("submitClaim", data),
  acceptClaim: data => call("acceptClaim", data),
  challengeClaim: data => call("challengeClaim", data),
  completeCurrentCard: data => call("completeCurrentCard", data),
  finishOnlineGame: data => call("finishOnlineGame", data),
  restartOnlineRound: data => call("restartOnlineRound", data),
  leaveRoom: data => call("leaveRoom", data)
};

export function subscribeToRoom(code, onData, onError) {
  return onValue(ref(database, `rooms/${code}`), snapshot => {
    onData(snapshot.exists() ? snapshot.val() : null);
  }, onError);
}

export function subscribeToPrivateHand(code, uid, onData, onError) {
  return onValue(ref(database, `privateHands/${code}/${uid}/cards`), snapshot => {
    onData(snapshot.val() || {});
  }, onError);
}

export function subscribeToPublicHands(code, onData, onError) {
  return onValue(ref(database, `rooms/${code}/publicHands`), snapshot => {
    onData(snapshot.val() || {});
  }, onError);
}

export async function roomExistsForMember(code) {
  const snapshot = await get(ref(database, `rooms/${code}`));
  return snapshot.exists() ? snapshot.val() : null;
}

export function connectPresence(code, uid) {
  const connectedInfo = ref(database, ".info/connected");
  const playerRef = ref(database, `rooms/${code}/players/${uid}`);
  let presenceDisconnect = null;

  const stop = onValue(connectedInfo, async snapshot => {
    if (snapshot.val() !== true) return;
    try {
      await update(playerRef, {
        connected: true,
        lastSeen: serverTimestamp()
      });
      presenceDisconnect = onDisconnect(playerRef);
      await presenceDisconnect.update({
        connected: false,
        lastSeen: serverTimestamp()
      });
    } catch {
      // La sala puede haberse cerrado entre la conexión y esta escritura.
    }
  });

  return () => {
    stop();
    presenceDisconnect?.cancel().catch(() => {});
  };
}

export function humanizeFirebaseError(error) {
  const message = String(error?.message || "No se pudo completar la acción.")
    .replace(/^FirebaseError:\s*/i, "")
    .replace(/^internal\s*/i, "");
  return message.charAt(0).toUpperCase() + message.slice(1);
}
