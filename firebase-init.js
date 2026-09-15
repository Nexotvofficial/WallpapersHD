// firebase-init.js
// Inicializa Firebase y expone helpers de autenticación con Google para
// que app.js (o cualquier otro script) los use sin repetir configuración.
// Se carga como <script type="module"> desde index.html — los navegadores
// modernos (todos los que soportan ES modules) lo entienden sin build step.

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

// Analytics falla en algunos navegadores (bloqueadores de rastreo, Safari
// con ITP, modo incógnito estricto). Se activa solo si el propio SDK dice
// que es soportado, para que un usuario con esas protecciones no rompa el
// login por un error de analytics no relacionado.
analyticsIsSupported().then((ok) => {
  if (ok) {
    try { getAnalytics(app); } catch (_) { /* no-op */ }
  }
});

const auth = getAuth(app);
const googleProvider = new GoogleAuthProvider();

// En el celular, signInWithPopup suele fallar (Safari/Chrome iOS bloquean
// popups o el WebView los mata). Se detecta y se usa redirect en su lugar;
// en escritorio el popup es más cómodo (no navega fuera de la página).
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

// Resuelve el login que quedó pendiente tras el redirect en celular (si
// hubo uno). Conviene llamarlo una vez al cargar la página.
export function resolveRedirectLogin() {
  return getRedirectResult(auth).catch((err) => {
    console.warn("No se pudo resolver el login por redirect:", err);
  });
}

export { auth };
