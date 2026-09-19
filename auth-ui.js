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
  if (user.photoURL) {
    let img = btn.querySelector("img.wp-auth-avatar");
    if (!img) {
      img = document.createElement("img");
      img.className = "wp-auth-avatar";
      img.alt = "";
      img.referrerPolicy = "no-referrer";
      btn.prepend(img);
    }
    img.src = user.photoURL;
  }
}

let currentUser = null;

const avatarModal = document.getElementById("avatarModal");
const avatarList = document.getElementById("avatarList");

// 8 professional placeholder avatars
const avatars = [
  "https://api.dicebear.com/7.x/avataaars/svg?seed=Neku1",
  "https://api.dicebear.com/7.x/avataaars/svg?seed=Neku2",
  "https://api.dicebear.com/7.x/avataaars/svg?seed=Neku3",
  "https://api.dicebear.com/7.x/avataaars/svg?seed=Neku4",
  "https://api.dicebear.com/7.x/bottts/svg?seed=Cyber1",
  "https://api.dicebear.com/7.x/bottts/svg?seed=Cyber2",
  "https://api.dicebear.com/7.x/micah/svg?seed=Pro1",
  "https://api.dicebear.com/7.x/micah/svg?seed=Pro2"
];

function initAvatarModal() {
  if (!avatarList) return;
  avatarList.innerHTML = avatars.map(url => `
    <img src="${url}" class="wp-avatar-option" data-url="${url}" alt="Avatar" style="width:100%; aspect-ratio:1; border-radius:50%; cursor:pointer; background:var(--bg-elev-2); border: 2px solid transparent; transition: all 0.2s;">
  `).join('');

  avatarList.addEventListener("click", async (e) => {
    if (e.target.classList.contains("wp-avatar-option") && currentUser) {
      const url = e.target.dataset.url;
      try {
        const { updateProfile } = await import("https://www.gstatic.com/firebasejs/10.13.2/firebase-auth.js");
        await updateProfile(currentUser, { photoURL: url });
        renderSignedIn(currentUser); // re-render to show new avatar
        avatarModal.classList.add("hidden");
        // Show success toast (dispatching custom event or global func)
        window.dispatchEvent(new CustomEvent("wp:avatar-updated"));
      } catch (err) {
        console.error(err);
      }
    }
  });

  document.getElementById("avatarModalClose")?.addEventListener("click", () => avatarModal.classList.add("hidden"));
  document.getElementById("logoutBtn")?.addEventListener("click", async () => {
    await logout();
    avatarModal.classList.add("hidden");
  });
}

btn.addEventListener("click", async () => {
  try {
    if (currentUser) {
      if (avatarModal) avatarModal.classList.remove("hidden");
      else await logout(); // fallback if modal doesn't exist on this page
    } else {
      await loginWithGoogle();
    }
  } catch (err) {
    console.error("Error de autenticación:", err);
  }
});

// app.js necesita saber si hay sesión activa para desbloquear las
// descargas VIP, pero no importa firebase directamente — se entera por
// este evento en vez de acoplarse a Firebase.
watchAuthState((user) => {
  currentUser = user;
  if (user) renderSignedIn(user);
  else renderSignedOut();
  window.dispatchEvent(new CustomEvent("wp:auth-changed", { detail: { user } }));
});

// Cuando el usuario intenta descargar un fondo VIP sin sesión, app.js
// muestra un aviso con un link "Iniciar sesión" que dispara este evento
// en vez de duplicar la lógica de login acá.
window.addEventListener("wp:request-login", () => {
  if (!currentUser) loginWithGoogle().catch((err) => console.error("Error de autenticación:", err));
});

initAvatarModal();
resolveRedirectLogin();
