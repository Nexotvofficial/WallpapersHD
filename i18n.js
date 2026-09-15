// i18n.js
// Motor de traducción liviano, sin dependencias. Traduce todo el "chrome"
// de la interfaz (header, sidebar, footer, avisos) y los nombres de
// categoría/filtros que arma app.js dinámicamente. Los títulos de cada
// fondo individual vienen de wallpapers.json en español y NO se traducen
// automáticamente (traducir 100+ títulos requeriría re-generar el catálogo
// o un servicio de traducción aparte — lo dejamos como nota al final).
(() => {
  "use strict";

  const DICT = {
    es: {
      search_placeholder: "Buscar fondos, categorías, etiquetas…",
      login: "Iniciar sesión",
      logout_aria: "Cerrar sesión",
      sidebar_toggle_aria: "Abrir filtros",
      theme_toggle_aria: "Cambiar tema",
      hero_eyebrow_count: (n) => `${n} fondos en el catálogo`,
      hero_title_l1: "Fondos que se sienten",
      hero_title_l2: "como tuyos.",
      hero_subtitle: "Curados a diario. En 4K, listos para AMOLED, y algunos que se mueven.",
      format_label: "Formato",
      format_all: "Todos",
      format_landscape: "Escritorio",
      format_portrait: "Móvil",
      sort_label: "Ordenar por",
      sort_recent: "Recientes",
      sort_popular: "Más populares",
      resolution_label: "Resolución",
      devices_label: "Dispositivos",
      device_all: "Todos",
      device_apple: "Apple",
      device_android: "Android",
      device_widescreen: "Widescreen",
      categories_label: "Categorías",
      results_title_all: "Todos los fondos",
      results_count: (n) => `${n} fondo${n === 1 ? "" : "s"}`,
      empty_state: "No encontramos fondos con esos filtros. Prueba a quitar alguno.",
      footer_rights: (y) => `© ${y} Nekutoon. Todos los derechos reservados.`,
      footer_privacy: "Privacidad",
      footer_terms: "Términos",
      footer_dmca: "DMCA / Contacto",
      lightbox_close_aria: "Cerrar",
      like_btn: "Guardar",
      download_hd: "Descargar HD",
      related_title: "Fondos relacionados",
      vip_locked_toast: `🔒 Este fondo es <strong>VIP</strong>. <a href="#" id="wpLoginFromToast">Iniciá sesión con Google</a> para desbloquear la descarga.`,
      download_fallback_toast: (kind) => `No pudimos iniciar la descarga automática. Se abrió el ${kind} en una pestaña nueva: mantené presionado (o click derecho → "Guardar como") para terminar de guardarlo.`,
      ios_save_toast: (kind) => `📱 Mantené presionada la ${kind} y elegí <strong>“Guardar ${kind === "vista previa" ? "video" : "imagen"}”</strong> para terminar la descarga.`,
      live_wallpaper_toast: (title) => `🎬 Para usarlo como fondo animado: abrí una app de <em>live wallpaper</em> (por ejemplo "Video Live Wallpaper" en Play Store), elegí "${title}" desde tu galería y aplicalo como fondo.`,
      categories: { "Todos": "Todos", "Anime": "Anime", "Cyberpunk": "Cyberpunk", "Naturaleza": "Naturaleza", "Fantasía": "Fantasía", "Minimalista": "Minimalista", "Autos": "Autos", "Urbano": "Urbano", "Espacio": "Espacio", "Abstracto": "Abstracto", "Live Video": "Live Video" }
    },
    en: {
      search_placeholder: "Search wallpapers, categories, tags…",
      login: "Sign in",
      logout_aria: "Sign out",
      sidebar_toggle_aria: "Open filters",
      theme_toggle_aria: "Toggle theme",
      hero_eyebrow_count: (n) => `${n} wallpapers in the catalog`,
      hero_title_l1: "Wallpapers that feel",
      hero_title_l2: "like yours.",
      hero_subtitle: "Curated daily. In 4K, AMOLED-ready, and some that move.",
      format_label: "Format",
      format_all: "All",
      format_landscape: "Desktop",
      format_portrait: "Mobile",
      sort_label: "Sort by",
      sort_recent: "Recent",
      sort_popular: "Most popular",
      resolution_label: "Resolution",
      devices_label: "Devices",
      device_all: "All",
      device_apple: "Apple",
      device_android: "Android",
      device_widescreen: "Widescreen",
      categories_label: "Categories",
      results_title_all: "All wallpapers",
      results_count: (n) => `${n} wallpaper${n === 1 ? "" : "s"}`,
      empty_state: "No wallpapers match those filters. Try removing one.",
      footer_rights: (y) => `© ${y} Nekutoon. All rights reserved.`,
      footer_privacy: "Privacy",
      footer_terms: "Terms",
      footer_dmca: "DMCA / Contact",
      lightbox_close_aria: "Close",
      like_btn: "Save",
      download_hd: "Download HD",
      related_title: "Related wallpapers",
      vip_locked_toast: `🔒 This wallpaper is <strong>VIP</strong>. <a href="#" id="wpLoginFromToast">Sign in with Google</a> to unlock the download.`,
      download_fallback_toast: (kind) => `We couldn't start the automatic download. The ${kind} opened in a new tab: long-press it (or right click → "Save as") to finish saving it.`,
      ios_save_toast: (kind) => `📱 Long-press the ${kind} and choose <strong>“Save ${kind === "preview" ? "video" : "image"}”</strong> to finish the download.`,
      live_wallpaper_toast: (title) => `🎬 To use it as a live wallpaper: open a live-wallpaper app (e.g. "Video Live Wallpaper" on the Play Store), pick "${title}" from your gallery and apply it.`,
      categories: { "Todos": "All", "Anime": "Anime", "Cyberpunk": "Cyberpunk", "Naturaleza": "Nature", "Fantasía": "Fantasy", "Minimalista": "Minimal", "Autos": "Cars", "Urbano": "Urban", "Espacio": "Space", "Abstracto": "Abstract", "Live Video": "Live Video" }
    },
    pt: {
      search_placeholder: "Buscar papéis de parede, categorias, tags…",
      login: "Entrar",
      logout_aria: "Sair",
      sidebar_toggle_aria: "Abrir filtros",
      theme_toggle_aria: "Alternar tema",
      hero_eyebrow_count: (n) => `${n} papéis de parede no catálogo`,
      hero_title_l1: "Papéis de parede que parecem",
      hero_title_l2: "seus.",
      hero_subtitle: "Curados todos os dias. Em 4K, prontos para AMOLED, e alguns que se movem.",
      format_label: "Formato",
      format_all: "Todos",
      format_landscape: "Desktop",
      format_portrait: "Celular",
      sort_label: "Ordenar por",
      sort_recent: "Recentes",
      sort_popular: "Mais populares",
      resolution_label: "Resolução",
      devices_label: "Dispositivos",
      device_all: "Todos",
      device_apple: "Apple",
      device_android: "Android",
      device_widescreen: "Widescreen",
      categories_label: "Categorias",
      results_title_all: "Todos os papéis de parede",
      results_count: (n) => `${n} papel${n === 1 ? "" : "éis"} de parede`,
      empty_state: "Não encontramos papéis de parede com esses filtros. Tente remover algum.",
      footer_rights: (y) => `© ${y} Nekutoon. Todos os direitos reservados.`,
      footer_privacy: "Privacidade",
      footer_terms: "Termos",
      footer_dmca: "DMCA / Contato",
      lightbox_close_aria: "Fechar",
      like_btn: "Salvar",
      download_hd: "Baixar HD",
      related_title: "Relacionados",
      vip_locked_toast: `🔒 Este papel de parede é <strong>VIP</strong>. <a href="#" id="wpLoginFromToast">Entre com o Google</a> para desbloquear o download.`,
      download_fallback_toast: (kind) => `Não conseguimos iniciar o download automático. O ${kind} abriu em uma nova aba: mantenha pressionado (ou clique direito → "Salvar como") para terminar.`,
      ios_save_toast: (kind) => `📱 Mantenha pressionado(a) ${kind} e escolha <strong>“Salvar ${kind === "prévia" ? "vídeo" : "imagem"}”</strong> para terminar o download.`,
      live_wallpaper_toast: (title) => `🎬 Para usar como papel de parede animado: abra um app de <em>live wallpaper</em> (ex.: "Video Live Wallpaper" na Play Store), escolha "${title}" na galeria e aplique.`,
      categories: { "Todos": "Todos", "Anime": "Anime", "Cyberpunk": "Cyberpunk", "Naturaleza": "Natureza", "Fantasía": "Fantasia", "Minimalista": "Minimalista", "Autos": "Carros", "Urbano": "Urbano", "Espacio": "Espaço", "Abstracto": "Abstrato", "Live Video": "Live Video" }
    },
    fr: {
      search_placeholder: "Rechercher fonds d'écran, catégories, tags…",
      login: "Se connecter",
      logout_aria: "Se déconnecter",
      sidebar_toggle_aria: "Ouvrir les filtres",
      theme_toggle_aria: "Changer de thème",
      hero_eyebrow_count: (n) => `${n} fonds d'écran dans le catalogue`,
      hero_title_l1: "Des fonds d'écran qui vous",
      hero_title_l2: "ressemblent.",
      hero_subtitle: "Sélectionnés chaque jour. En 4K, prêts pour l'AMOLED, et certains qui bougent.",
      format_label: "Format",
      format_all: "Tous",
      format_landscape: "Ordinateur",
      format_portrait: "Mobile",
      sort_label: "Trier par",
      sort_recent: "Récents",
      sort_popular: "Les plus populaires",
      resolution_label: "Résolution",
      devices_label: "Appareils",
      device_all: "Tous",
      device_apple: "Apple",
      device_android: "Android",
      device_widescreen: "Écran large",
      categories_label: "Catégories",
      results_title_all: "Tous les fonds d'écran",
      results_count: (n) => `${n} fond${n === 1 ? "" : "s"} d'écran`,
      empty_state: "Aucun fond d'écran ne correspond à ces filtres. Essayez d'en retirer un.",
      footer_rights: (y) => `© ${y} Nekutoon. Tous droits réservés.`,
      footer_privacy: "Confidentialité",
      footer_terms: "Conditions",
      footer_dmca: "DMCA / Contact",
      lightbox_close_aria: "Fermer",
      like_btn: "Enregistrer",
      download_hd: "Télécharger en HD",
      related_title: "Fonds d'écran similaires",
      vip_locked_toast: `🔒 Ce fond d'écran est <strong>VIP</strong>. <a href="#" id="wpLoginFromToast">Connectez-vous avec Google</a> pour débloquer le téléchargement.`,
      download_fallback_toast: (kind) => `Impossible de lancer le téléchargement automatique. Le ${kind} s'est ouvert dans un nouvel onglet : appui long (ou clic droit → "Enregistrer sous") pour terminer.`,
      ios_save_toast: (kind) => `📱 Appuyez longuement sur ${kind} et choisissez <strong>« Enregistrer ${kind === "l'aperçu" ? "la vidéo" : "l'image"} »</strong> pour finir le téléchargement.`,
      live_wallpaper_toast: (title) => `🎬 Pour l'utiliser en fond animé : ouvrez une appli "live wallpaper" (ex. "Video Live Wallpaper" sur le Play Store), choisissez "${title}" dans votre galerie et appliquez-le.`,
      categories: { "Todos": "Tous", "Anime": "Anime", "Cyberpunk": "Cyberpunk", "Naturaleza": "Nature", "Fantasía": "Fantaisie", "Minimalista": "Minimaliste", "Autos": "Voitures", "Urbano": "Urbain", "Espacio": "Espace", "Abstracto": "Abstrait", "Live Video": "Live Video" }
    },
    de: {
      search_placeholder: "Wallpaper, Kategorien, Tags suchen…",
      login: "Anmelden",
      logout_aria: "Abmelden",
      sidebar_toggle_aria: "Filter öffnen",
      theme_toggle_aria: "Design wechseln",
      hero_eyebrow_count: (n) => `${n} Wallpaper im Katalog`,
      hero_title_l1: "Wallpaper, die sich anfühlen",
      hero_title_l2: "wie deine.",
      hero_subtitle: "Täglich kuratiert. In 4K, AMOLED-tauglich, manche bewegt.",
      format_label: "Format",
      format_all: "Alle",
      format_landscape: "Desktop",
      format_portrait: "Handy",
      sort_label: "Sortieren nach",
      sort_recent: "Neueste",
      sort_popular: "Beliebteste",
      resolution_label: "Auflösung",
      devices_label: "Geräte",
      device_all: "Alle",
      device_apple: "Apple",
      device_android: "Android",
      device_widescreen: "Breitbild",
      categories_label: "Kategorien",
      results_title_all: "Alle Wallpaper",
      results_count: (n) => `${n} Wallpaper`,
      empty_state: "Keine Wallpaper mit diesen Filtern gefunden. Versuch einen zu entfernen.",
      footer_rights: (y) => `© ${y} Nekutoon. Alle Rechte vorbehalten.`,
      footer_privacy: "Datenschutz",
      footer_terms: "Nutzungsbedingungen",
      footer_dmca: "DMCA / Kontakt",
      lightbox_close_aria: "Schließen",
      like_btn: "Speichern",
      download_hd: "HD herunterladen",
      related_title: "Ähnliche Wallpaper",
      vip_locked_toast: `🔒 Dieses Wallpaper ist <strong>VIP</strong>. <a href="#" id="wpLoginFromToast">Mit Google anmelden</a>, um den Download freizuschalten.`,
      download_fallback_toast: (kind) => `Der automatische Download konnte nicht gestartet werden. ${kind} wurde in einem neuen Tab geöffnet: lange drücken (oder Rechtsklick → "Speichern unter"), um es abzuschließen.`,
      ios_save_toast: (kind) => `📱 Drücke lange auf ${kind} und wähle <strong>„${kind === "die Vorschau" ? "Video" : "Bild"} sichern“</strong>, um den Download abzuschließen.`,
      live_wallpaper_toast: (title) => `🎬 Als animiertes Wallpaper nutzen: Öffne eine Live-Wallpaper-App (z. B. "Video Live Wallpaper" im Play Store), wähle "${title}" aus deiner Galerie und wende es an.`,
      categories: { "Todos": "Alle", "Anime": "Anime", "Cyberpunk": "Cyberpunk", "Naturaleza": "Natur", "Fantasía": "Fantasy", "Minimalista": "Minimalistisch", "Autos": "Autos", "Urbano": "Urban", "Espacio": "Weltraum", "Abstracto": "Abstrakt", "Live Video": "Live Video" }
    }
  };

  const SUPPORTED = Object.keys(DICT); // ["es","en","pt","fr","de"]

  function detectInitialLang() {
    const saved = localStorage.getItem("wp_lang");
    if (saved && SUPPORTED.includes(saved)) return saved;
    const nav = (navigator.language || "es").slice(0, 2).toLowerCase();
    return SUPPORTED.includes(nav) ? nav : "es";
  }

  let currentLang = detectInitialLang();

  function t(key, ...args) {
    const entry = (DICT[currentLang] && DICT[currentLang][key]) ?? DICT.es[key];
    return typeof entry === "function" ? entry(...args) : entry;
  }

  function translateCategory(cat) {
    return (DICT[currentLang]?.categories?.[cat]) ?? (DICT.es.categories?.[cat]) ?? cat;
  }

  function applyStaticDom() {
    document.documentElement.lang = currentLang;
    document.querySelectorAll("[data-i18n]").forEach(el => {
      const key = el.getAttribute("data-i18n");
      const val = t(key);
      if (typeof val === "string") el.textContent = val;
    });
    document.querySelectorAll("[data-i18n-attr]").forEach(el => {
      // formato: data-i18n-attr="aria-label:sidebar_toggle_aria"
      el.getAttribute("data-i18n-attr").split(";").forEach(pair => {
        const [attr, key] = pair.split(":").map(s => s.trim());
        if (attr && key) el.setAttribute(attr, t(key));
      });
    });
    const rights = document.getElementById("footerRights");
    if (rights) rights.textContent = t("footer_rights", new Date().getFullYear());
    const search = document.getElementById("searchInput");
    if (search) search.placeholder = t("search_placeholder");
    const authLabel = document.getElementById("authBtnLabel");
    // Solo pisamos el texto de login si NO hay sesión iniciada (si hay
    // sesión, auth-ui.js ya puso el nombre/email de la cuenta ahí).
    if (authLabel && !document.getElementById("authBtn")?.classList.contains("is-signed-in")) {
      authLabel.textContent = t("login");
    }
  }

  function setLang(lang) {
    if (!SUPPORTED.includes(lang)) return;
    currentLang = lang;
    localStorage.setItem("wp_lang", lang);
    applyStaticDom();
    window.dispatchEvent(new CustomEvent("wp:lang-changed", { detail: { lang } }));
  }

  window.WP_I18N = { t, translateCategory, setLang, get lang() { return currentLang; }, SUPPORTED };

  document.addEventListener("DOMContentLoaded", () => {
    const select = document.getElementById("langSelect");
    if (select) {
      select.value = currentLang;
      select.addEventListener("change", (e) => setLang(e.target.value));
    }
    applyStaticDom();
  });
})();
