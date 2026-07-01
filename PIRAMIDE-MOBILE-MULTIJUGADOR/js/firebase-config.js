export const firebaseConfig = globalThis.__PIRAMIDE_FIREBASE_CONFIG__ || {
  apiKey: "AIzaSyC3Smcx9S7n0KLMK_eIgOzzSGslauxEAhA",
  authDomain: "vacila-cb462.firebaseapp.com",
  databaseURL: "https://vacila-cb462-default-rtdb.firebaseio.com/",
  projectId: "vacila-cb462",
  storageBucket: "vacila-cb462.firebasestorage.app",
  messagingSenderId: "576505179710",
  appId: "1:576505179710:web:9b1c43865743f396c4eb6f",
  measurementId: "G-PT8984TWWX"
};

export const functionsRegion = "southamerica-west1";

// Actívalo únicamente cuando ejecutes Firebase Emulator Suite.
export const useEmulators = false;

export function isFirebaseConfigured() {
  return Object.values(firebaseConfig).every(value =>
    typeof value === "string" &&
    value.length > 0 &&
    !value.includes("REEMPLAZAR")
  );
}
