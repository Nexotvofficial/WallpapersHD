// firebase-init.js
// Inicializa Firebase y expone helpers de autenticación con Google,
// Firestore (db) y Cloud Storage (storage) para app.js, community.js y submit.js.
// Se carga como <script type="module"> desde index.html y otras páginas.

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-app.js";
import { getAnalytics, isSupported as analyticsIsSupported } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-analytics.js";
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  signOut,
  onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";
import { getStorage } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-storage.js";

const firebaseConfig = {
  apiKey: "AIzaSyA_8r6TZv6eveWs1LN4bGx7INCKAUfLoY0",
  authDomain: "nekutoon-a7417.firebaseapp.com",
  projectId: "nekutoon-a7417",
  storageBucket: "nekutoon-a7417.firebasestorage.app",
  messagingSenderId: "220922201940",
  appId: "1:220922201940:web:67be5909a2e5134191aac1",
  measurementId: "G-RH4FVFBW3J",
};

const app = initializeApp(firebaseConfig);

// Analytics opcional y a prueba de fallos
analyticsIsSupported().then((ok) => {
  if (ok) {
    try { getAnalytics(app); } catch (_) { /* no-op */ }
  }
});

const auth = getAuth(app);
const db = getFirestore(app);
const storage = getStorage(app);
const googleProvider = new GoogleAuthProvider();

function isMobile() {
  return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
}

export async function loginWithGoogle() {
  if (isMobile()) {
    return signInWithRedirect(auth, googleProvider);
  }
  return signInWithPopup(auth, googleProvider);
}

export function logout() {
  return signOut(auth);
}

export function watchAuthState(callback) {
  return onAuthStateChanged(auth, callback);
}

export function resolveRedirectLogin() {
  return getRedirectResult(auth).catch((err) => {
    console.warn("No se pudo resolver el login por redirect:", err);
  });
}

export { app, auth, db, storage };
