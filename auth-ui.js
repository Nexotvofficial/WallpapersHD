// auth-ui.js
// Cablea el botón #authBtn del header con Firebase Auth (Google). No toca
// wallpapers.json ni el resto del catálogo — solo maneja sesión.
import { loginWithGoogle, logout, watchAuthState, resolveRedirectLogin } from "./firebase-init.js";

const btn = document.getElementById("authBtn");
const label = document.getElementById("authBtnLabel");

function renderSignedOut() {
  btn.classList.remove("is-signed-in");
  btn.setAttribute("aria-label", "Iniciar sesión con Google");
  label.textContent = "Iniciar sesión";
  btn.querySelector("img.wp-auth-avatar")?.remove();
}

function renderSignedIn(user) {
  btn.classList.add("is-signed-in");
  btn.setAttribute("aria-label", `Cerrar sesión (${user.displayName || user.email || "cuenta"})`);
  label.textContent = (user.displayName || user.email || "Mi cuenta").split(" ")[0];
  if (user.photoURL && !btn.querySelector("img.wp-auth-avatar")) {
    const img = document.createElement("img");
    img.src = user.photoURL;
    img.alt = "";
    img.className = "wp-auth-avatar";
    img.referrerPolicy = "no-referrer";
    btn.prepend(img);
  }
}

let currentUser = null;

btn.addEventListener("click", async () => {
  try {
    if (currentUser) {
      await logout();
    } else {
      await loginWithGoogle();
    }
  } catch (err) {
    console.error("Error de autenticación:", err);
    // No interrumpe el resto del sitio: el catálogo funciona igual sin
    // sesión iniciada, así que un fallo de login no debe bloquear nada.
  }
});

watchAuthState((user) => {
  currentUser = user;
  if (user) renderSignedIn(user);
  else renderSignedOut();
});

resolveRedirectLogin();
