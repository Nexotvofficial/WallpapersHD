(() => {
  "use strict";

  const state = {
    all: [],
    query: "",
    category: "Todos",
    format: "all",      // all | landscape | portrait
    device: "all",       // all | apple | android | widescreen
    resolutions: new Set(),
    sort: "recent",
    likes: new Set(JSON.parse(localStorage.getItem("wp_likes") || "[]")),
  };

  // Iconos en línea, mismo peso/estilo para todos — antes eran emoji, que
  // se renderizan distinto (y con calidad dispar) en cada sistema operativo.
  const ICON = (paths) => `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`;
  const CATEGORY_ICONS = {
    "Todos": ICON('<path d="M12 3l2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5z"/>'),
    "Anime": ICON('<circle cx="12" cy="12" r="8"/><path d="M8 10.5c0-1 3-1 4-1s4 0 4 1M9 15c1.2 1 4.8 1 6 0"/>'),
    "Cyberpunk": ICON('<path d="M13 2L4 14h6l-1 8 9-12h-6l1-8z"/>'),
    "Naturaleza": ICON('<path d="M12 3C8 6 6 10 6 13a6 6 0 0012 0c0-3-2-7-6-10z"/><path d="M12 13v8"/>'),
    "Fantasía": ICON('<path d="M6 20c0-6 2-9 6-9s6 3 6 9"/><path d="M9 11c0-4 1-7 3-8 2 1 3 4 3 8"/>'),
    "Minimalista": ICON('<rect x="5" y="5" width="14" height="14" rx="2"/>'),
    "Autos": ICON('<path d="M4 16l1.5-5A2 2 0 017.4 9.5h9.2a2 2 0 011.9 1.5L20 16"/><rect x="3" y="16" width="18" height="4" rx="1"/><circle cx="7.5" cy="20" r="1.4"/><circle cx="16.5" cy="20" r="1.4"/>'),
    "Urbano": ICON('<path d="M4 21V9l6-4 6 4v12"/><path d="M16 21V6l4 3v12"/><path d="M9 21v-4h2v4"/>'),
    "Espacio": ICON('<circle cx="12" cy="12" r="4"/><ellipse cx="12" cy="12" rx="9" ry="3.2" transform="rotate(25 12 12)"/>'),
    "Abstracto": ICON('<path d="M12 3l9 6-3 9H6L3 9z"/>'),
    "Live Video": ICON('<circle cx="12" cy="12" r="9"/><path d="M10 8.5l6 3.5-6 3.5z" fill="currentColor" stroke="none"/>')
  };

  // ---------------- Adsterra (monetización de descargas) ----------------
  // 👉 Pegá acá el link que copiaste con el botón "COPY LINK" de tu
  // Smartlink en el panel de Adsterra. Mientras diga "REEMPLAZA..." la
  // función no hace nada (no rompe las descargas, simplemente no muestra
  // el anuncio).
  const ADSTERRA_SMARTLINK = "https://REEMPLAZA_CON_TU_SMARTLINK_DE_ADSTERRA";
  // Cada cuántas descargas se abre el anuncio en una pestaña nueva. 1 = en
  // todas; 2 = una sí, una no. Subilo si sentís que satura a la gente.
  const ADSTERRA_EVERY_N = 1;

  function isIOS() {
    return /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
  }

  function showToast(html, duration = 6500) {
    const host = document.getElementById("toastHost");
    if (!host) return;
    const el = document.createElement("div");
    el.className = "wp-toast";
    el.innerHTML = html;
    host.appendChild(el);
    setTimeout(() => el.remove(), duration);
  }

  function maybeOpenAd() {
    if (!ADSTERRA_SMARTLINK || ADSTERRA_SMARTLINK.includes("REEMPLAZA")) return;
    const key = "wp_dl_count";
    const count = parseInt(localStorage.getItem(key) || "0", 10) + 1;
    localStorage.setItem(key, String(count));
    if (count % ADSTERRA_EVERY_N === 0) {
      window.open(ADSTERRA_SMARTLINK, "_blank", "noopener");
    }
  }

  // Punto único por el que pasa TODA descarga (grid y lightbox, imagen y
  // live wallpaper, cel y PC). Así el anuncio y los avisos quedan en un
  // solo lugar en vez de duplicados en cada botón.
  function handleDownload(e, item) {
    if (!item) return;
    maybeOpenAd();

    if (isIOS()) {
      // Safari en iOS ignora el atributo `download` en archivos de otro
      // dominio (los abre en el visor en vez de bajarlos), así que ahí la
      // única forma confiable es guiar a guardar manualmente.
      e.preventDefault();
      window.open(item.hd_url, "_blank", "noopener");
      showToast(`📱 Mantené presionada la ${item.is_video ? "vista previa" : "imagen"} y elegí <strong>“Guardar ${item.is_video ? "video" : "imagen"}”</strong> para terminar la descarga.`);
    }

    if (item.is_video) {
      showToast(`🎬 Para usarlo como fondo animado: abrí una app de <em>live wallpaper</em> (por ejemplo "Video Live Wallpaper" en Play Store), elegí "${item.title}" desde tu galería y aplicalo como fondo.`, 8500);
    }
  }

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  // ---------------- device heuristic ----------------
  // El JSON no trae un campo "device": lo aproximamos con aspect_ratio.
  // Apple (iPhone moderno) ronda 0.46; Android suele ser un poco más
  // ancho (~0.5-0.56); widescreen es cualquier landscape >= 1.5.
  function matchesDevice(item, device) {
    if (device === "all") return true;
    if (device === "widescreen") return item.orientation === "landscape" && item.aspect_ratio >= 1.5;
    if (device === "apple") return item.orientation === "portrait" && item.aspect_ratio <= 0.48;
    if (device === "android") return item.orientation === "portrait" && item.aspect_ratio > 0.48;
    return true;
  }

  async function loadData() {
    const res = await fetch("./wallpapers.json", { cache: "no-store" });
    const data = await res.json();
    state.all = data.wallpapers || [];
    buildHero();
    buildTagRail(data.categories || []);
    buildCategoryList(data.categories || []);
    render();
  }

  function buildHero() {
    const collage = $("#heroCollage");
    const pics = state.all.slice(0, 16);
    collage.innerHTML = pics.map(w => `<img src="${w.thumbnail}" alt="" loading="lazy">`).join("");
    const eyebrow = $("#heroEyebrow");
    if (eyebrow) eyebrow.textContent = `${state.all.length} fondos en el catálogo`;
  }

  function buildTagRail(categories) {
    const rail = $("#tagRail");
    const cats = categories.filter(c => c !== "Todos" && c !== "Live Video");
    rail.innerHTML = [`Todos`, ...cats].map(cat => {
      const active = cat === state.category ? "is-active" : "";
      const icon = CATEGORY_ICONS[cat] || "•";
      return `<button class="wp-tagpill ${active}" data-cat="${cat}"><span>${icon}</span>${cat}</button>`;
    }).join("");
    rail.addEventListener("click", (e) => {
      const btn = e.target.closest(".wp-tagpill");
      if (!btn) return;
      state.category = btn.dataset.cat;
      syncActiveStates();
      render();
    });
  }

  function buildCategoryList(categories) {
    const list = $("#categoryList");
    const cats = categories.filter(c => c !== "Live Video");
    list.innerHTML = cats.map(cat => {
      const count = cat === "Todos" ? state.all.length : state.all.filter(w => w.category === cat).length;
      const active = cat === state.category ? "is-active" : "";
      return `<li class="${active}" data-cat="${cat}"><span>${cat}</span><span class="wp-cat-count">${count}</span></li>`;
    }).join("");
    list.addEventListener("click", (e) => {
      const li = e.target.closest("li");
      if (!li) return;
      state.category = li.dataset.cat;
      syncActiveStates();
      render();
    });
  }

  function syncActiveStates() {
    $$(".wp-tagpill").forEach(el => el.classList.toggle("is-active", el.dataset.cat === state.category));
    $$("#categoryList li").forEach(el => el.classList.toggle("is-active", el.dataset.cat === state.category));
  }

  function getFiltered() {
    let items = state.all.filter(w => {
      if (state.category !== "Todos" && w.category !== state.category) return false;
      if (state.format !== "all" && w.orientation !== state.format) return false;
      if (!matchesDevice(w, state.device)) return false;
      if (state.resolutions.size && !state.resolutions.has(w.resolution)) return false;
      if (state.query) {
        const q = state.query.toLowerCase();
        const haystack = `${w.title} ${w.category} ${(w.tags || []).join(" ")}`.toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
    if (state.sort === "popular") {
      items = items.slice().sort((a, b) => b.aesthetic_score - a.aesthetic_score);
    } else {
      items = items.slice().sort((a, b) => Number(b.id) - Number(a.id));
    }
    return items;
  }

  function cardTemplate(w) {
    const liked = state.likes.has(w.id);
    return `
      <article class="wp-card" data-id="${w.id}">
        <div class="wp-card-badges">
          <span class="wp-badge wp-badge-res">${w.resolution}</span>
          ${w.is_vip ? `<span class="wp-badge wp-badge-vip">★ VIP</span>` : w.is_video ? `<span class="wp-badge wp-badge-video">▶ Live</span>` : ""}
        </div>
        <img src="${w.thumbnail}" alt="${w.title}" loading="lazy" style="${w.color ? `background:${w.color}` : ""}">
        <div class="wp-card-overlay">
          <span class="wp-card-title">${w.title}</span>
          <div class="wp-card-actions">
            <button class="wp-mini-btn wp-like-btn ${liked ? "is-liked" : ""}" data-id="${w.id}" aria-label="Guardar" title="Guardar">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="${liked ? "currentColor" : "none"}" stroke="currentColor" stroke-width="1.8"><path d="M12 20s-7-4.4-9.5-8.8C.6 7.8 2.4 4 6 4c2 0 3.5 1.1 4.5 2.6C11.5 5.1 13 4 15 4c3.6 0 5.4 3.8 3.5 7.2C19 15.6 12 20 12 20z"/></svg>
            </button>
            <a class="wp-mini-btn wp-download-btn" href="${w.hd_url}" download="${w.file_name || ""}" data-id="${w.id}" title="Descargar" aria-label="Descargar">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 3v13m0 0l-5-5m5 5l5-5M4 21h16"/></svg>
            </a>
          </div>
        </div>
      </article>`;
  }

  function render() {
    const items = getFiltered();
    const grid = $("#grid");
    const empty = $("#emptyState");
    $("#resultsTitle").textContent = state.category === "Todos" ? "Todos los fondos" : state.category;
    $("#resultsCount").textContent = `${items.length} fondo${items.length === 1 ? "" : "s"}`;

    if (!items.length) {
      grid.innerHTML = "";
      empty.classList.remove("hidden");
      return;
    }
    empty.classList.add("hidden");
    grid.innerHTML = items.map(cardTemplate).join("");
  }

  // ---------------- interactions ----------------
  function toggleLike(id) {
    if (state.likes.has(id)) state.likes.delete(id); else state.likes.add(id);
    localStorage.setItem("wp_likes", JSON.stringify([...state.likes]));
  }

  function setupFilters() {
    $("#searchInput").addEventListener("input", (e) => {
      state.query = e.target.value.trim();
      render();
    });

    $$('.wp-chip-row[data-filter="format"] .wp-chip').forEach(btn => {
      btn.addEventListener("click", () => {
        state.format = btn.dataset.value;
        $$('.wp-chip-row[data-filter="format"] .wp-chip').forEach(b => b.classList.toggle("is-active", b === btn));
        render();
      });
    });

    $$('.wp-chip-row[data-filter="device"] .wp-chip').forEach(btn => {
      btn.addEventListener("click", () => {
        state.device = btn.dataset.value;
        $$('.wp-chip-row[data-filter="device"] .wp-chip').forEach(b => b.classList.toggle("is-active", b === btn));
        render();
      });
    });

    $$('input[name="sort"]').forEach(radio => {
      radio.addEventListener("change", (e) => {
        state.sort = e.target.value;
        render();
      });
    });

    $$('.wp-check-list[data-filter="resolution"] input').forEach(chk => {
      chk.addEventListener("change", (e) => {
        if (e.target.checked) state.resolutions.add(e.target.value);
        else state.resolutions.delete(e.target.value);
        render();
      });
    });

    $("#grid").addEventListener("click", (e) => {
      const likeBtn = e.target.closest(".wp-like-btn");
      if (likeBtn) {
        e.stopPropagation();
        toggleLike(likeBtn.dataset.id);
        likeBtn.classList.toggle("is-liked");
        return;
      }
      const dlBtn = e.target.closest(".wp-download-btn");
      if (dlBtn) {
        e.stopPropagation();
        const item = state.all.find(w => w.id === dlBtn.dataset.id);
        handleDownload(e, item);
        return;
      }
      const card = e.target.closest(".wp-card");
      if (card) openLightbox(card.dataset.id);
    });
  }

  // ---------------- sidebar (mobile) ----------------
  function setupSidebar() {
    const sidebar = $("#sidebar");
    const backdrop = $("#sidebarBackdrop");
    const open = () => { sidebar.classList.add("is-open"); backdrop.classList.add("is-open"); };
    const close = () => { sidebar.classList.remove("is-open"); backdrop.classList.remove("is-open"); };
    $("#sidebarToggle").addEventListener("click", open);
    backdrop.addEventListener("click", close);
  }

  // ---------------- theme ----------------
  function setupTheme() {
    const saved = localStorage.getItem("wp_theme");
    if (saved === "light") applyTheme("light");
    $("#themeToggle").addEventListener("click", () => {
      const current = document.documentElement.getAttribute("data-theme") === "light" ? "light" : "dark";
      applyTheme(current === "light" ? "dark" : "light");
    });
  }
  function applyTheme(theme) {
    if (theme === "light") document.documentElement.setAttribute("data-theme", "light");
    else document.documentElement.removeAttribute("data-theme");
    localStorage.setItem("wp_theme", theme);
    $("#themeIconMoon").classList.toggle("hidden", theme === "light");
    $("#themeIconSun").classList.toggle("hidden", theme !== "light");
  }

  // ---------------- lightbox ----------------
  function openLightbox(id) {
    const w = state.all.find(x => x.id === id);
    if (!w) return;
    state.currentLightboxId = id;
    const lb = $("#lightbox");
    const media = $("#lightboxMedia");
    media.innerHTML = w.is_video
      ? `<video src="${w.hd_url}" controls autoplay muted loop playsinline></video>`
      : `<img src="${w.hd_url}" alt="${w.title}">`;
    $("#lightboxTitle").textContent = w.title;
    $("#lightboxMeta").textContent = `${w.category} · ${w.resolution}${w.is_amoled ? " · AMOLED" : ""}`;
    $("#lightboxDownload").href = w.hd_url;
    $("#lightboxDownload").setAttribute("download", w.file_name || "");

    const likeBtn = $("#lightboxLike");
    likeBtn.classList.toggle("is-liked", state.likes.has(w.id));
    likeBtn.onclick = () => { toggleLike(w.id); likeBtn.classList.toggle("is-liked"); render(); };

    const related = state.all.filter(x => x.category === w.category && x.id !== w.id).slice(0, 8);
    $("#relatedRow").innerHTML = related.map(r => `<img src="${r.thumbnail}" alt="${r.title}" data-id="${r.id}" loading="lazy">`).join("");

    lb.classList.add("is-open");
    document.body.style.overflow = "hidden";
  }
  function closeLightbox() {
    $("#lightbox").classList.remove("is-open");
    $("#lightboxMedia").innerHTML = "";
    document.body.style.overflow = "";
  }
  function setupLightbox() {
    $("#lightboxClose").addEventListener("click", closeLightbox);
    $("#lightboxScrim").addEventListener("click", closeLightbox);
    $("#lightboxDownload").addEventListener("click", (e) => {
      const w = state.all.find(x => x.id === state.currentLightboxId);
      handleDownload(e, w);
    });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeLightbox(); });
    $("#relatedRow").addEventListener("click", (e) => {
      const img = e.target.closest("img");
      if (img) openLightbox(img.dataset.id);
    });
  }

  document.addEventListener("DOMContentLoaded", () => {
    setupFilters();
    setupSidebar();
    setupTheme();
    setupLightbox();
    loadData();
  });
})();
