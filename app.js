(() => {
  "use strict";

  const urlParams = new URLSearchParams(window.location.search);
  const initialCat = urlParams.get("cat");

  const state = {
    all: [],
    query: "",
    category: initialCat || "Todos",
    format: "all",
    device: "all",
    resolutions: new Set(),
    sort: "recent",
    likes: new Set(JSON.parse(localStorage.getItem("wp_likes") || "[]")),
    page: 1,
    perPage: 20
  };

  const ICON = (paths) => `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`;
  
  const CATEGORY_ICONS = {
    "Todos": ICON('<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/>'),
    "Anime": ICON('<circle cx="12" cy="12" r="10"/><path d="M8 9.05v-.1"/><path d="M16 9.05v-.1"/><path d="M16 14c-1.5 1.5-3.09 2-4 2s-2.5-.5-4-2"/>'),
    "Cyberpunk": ICON('<path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/>'),
    "Naturaleza": ICON('<path d="M12 22v-7"/><path d="M12 15c-3-2-5-5-5-8 0-3.5 2-6 5-6s5 2.5 5 6c0 3-2 6-5 8z"/>'),
    "Fantasía": ICON('<path d="M12 2l2.4 7.6H22l-6.2 4.5 2.4 7.6-6.2-4.5-6.2 4.5 2.4-7.6L2 9.6h7.6z"/>'),
    "Minimalista": ICON('<rect x="4" y="4" width="16" height="16" rx="2" ry="2"/><line x1="4" y1="12" x2="20" y2="12"/>'),
    "Autos": ICON('<path d="M19 17h2c.6 0 1-.4 1-1v-3c0-.9-.7-1.7-1.5-1.9C18.7 10.6 16 10 16 10s-1.3-1.4-2.2-2.3c-.5-.4-1.1-.7-1.8-.7H5c-.6 0-1.1.4-1.4.9L3 11H1c-.6 0-1 .4-1 1v3c0 .6.4 1 1 1h2"/><circle cx="7" cy="17" r="2"/><circle cx="17" cy="17" r="2"/>'),
    "Urbano": ICON('<path d="M4 22V10l8-6 8 6v12"/><path d="M9 22v-5h6v5"/>'),
    "Espacio": ICON('<circle cx="12" cy="12" r="10"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/><path d="M2 12h20"/>'),
    "Abstracto": ICON('<path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/>'),
    "Live Video": ICON('<path d="M15 10l4.5-3.5a1 1 0 0 1 1.5.8v9.4a1 1 0 0 1-1.5.8L15 14v-4z"/><rect x="2" y="6" width="13" height="12" rx="2" ry="2"/>')
  };

  function isIOS() {
    return /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
  }

  let currentUser = null;
  window.addEventListener("wp:auth-changed", (e) => {
    currentUser = e.detail?.user || null;
    if (state.all.length) render();
  });

  function requestLogin() {
    window.dispatchEvent(new CustomEvent("wp:request-login"));
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

  async function forceDownload(item) {
    const downloadUrl = item.hd_url || item.thumbnail;
    try {
      let res = await fetch(downloadUrl, { mode: "cors" }).catch(() => null);
      if (!res || !res.ok) {
        res = await fetch(item.thumbnail, { mode: "cors" });
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = blobUrl;
      a.download = item.file_name || item.title || "wallpaper";
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(blobUrl), 4000);
    } catch (err) {
      console.warn("No se pudo forzar la descarga automática, uso el fallback manual:", err);
      window.open(item.thumbnail || downloadUrl, "_blank", "noopener");
      const kind = item.is_video ? "video" : "imagen";
      const msg = window.WP_I18N ? window.WP_I18N.t("download_fallback_toast", kind) : `Se abrió el archivo en una pestaña nueva: mantené presionado (o click derecho → "Guardar como") para guardarlo.`;
      showToast(msg, 8000);
    }
  }

  function proceedWithDownload(item) {
    if (isIOS()) {
      window.open(item.hd_url, "_blank", "noopener");
      const kind = item.is_video ? "vista previa" : "imagen";
      const iosMsg = window.WP_I18N ? window.WP_I18N.t("ios_save_toast", kind) : `📱 Mantené presionada la ${kind} y elegí <strong>"Guardar ${item.is_video ? "video" : "imagen"}"</strong> para terminar la descarga.`;
      showToast(iosMsg);
    } else {
      forceDownload(item);
    }

    if (item.is_video) {
      const liveMsg = window.WP_I18N ? window.WP_I18N.t("live_wallpaper_toast", item.title) : `🎬 Para usarlo como fondo animado: abrí una app de <em>live wallpaper</em> (por ejemplo "Video Live Wallpaper" en Play Store), elegí "${item.title}" desde tu galería y aplicalo como fondo.`;
      showToast(liveMsg, 8500);
    }
  }

  function handleDownload(e, item) {
    if (!item) return;
    e.preventDefault();

    if (item.is_vip && !currentUser) {
      const msg = window.WP_I18N ? window.WP_I18N.t("vip_locked_toast") : `🔒 Este fondo es <strong>VIP</strong>. <a href="#" id="wpLoginFromToast">Iniciá sesión con Google</a> para desbloquear la descarga.`;
      showToast(msg, 7000);
      document.getElementById("wpLoginFromToast")?.addEventListener("click", (ev) => { ev.preventDefault(); requestLogin(); });
      return;
    }

    proceedWithDownload(item);
  }

  const $ = (sel, root = document) => root.querySelector(sel);   const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  function matchesDevice(item, device) {
    if (device === "all") return true;
    if (device === "widescreen") return item.orientation === "landscape" && item.aspect_ratio >= 1.5;
    if (device === "apple") return item.orientation === "portrait" && item.aspect_ratio <= 0.48;
    if (device === "android") return item.orientation === "portrait" && item.aspect_ratio > 0.48;
    return true;
  }

  async function checkApprovedCommunity() {
    try {
      const comm = window.WP_COMMUNITY;
      if (comm?.loadApprovedWallpapers) {
        const approved = await comm.loadApprovedWallpapers();
        if (approved && approved.length) {
          const currentIds = new Set(state.all.map(x => x.id));
          const toAdd = approved.filter(a => !currentIds.has(a.id));
          if (toAdd.length) {
            state.all = [...toAdd, ...state.all];
            updateCatTileCounts();
            render();
          }
        }
      }
    } catch (_) {}
  }

  window.addEventListener("wp:community-ready", () => {
    checkApprovedCommunity();
    buildTopCreatorsSection();
  });

  async function loadData() {
    const res = await fetch("./wallpapers.json", { cache: "no-store" });
    const data = await res.json();
    state.all = data.wallpapers || [];
    state.lastCategories = data.categories || [];

    // Cargar fondos aprobados desde Firestore
    await checkApprovedCommunity();

    // Actualizar contador de stats en el hero
    const statEl = document.getElementById("heroStatCount");
    if (statEl) {
      const count = state.all.length;
      statEl.textContent = count >= 1000 ? (count / 1000).toFixed(1).replace(".0","") + "K+" : count + "+";
    }
    updateCatTileCounts();
    buildHero();
    buildFeaturedSection();
    buildTagRail(state.lastCategories);
    buildCategoryList(state.lastCategories);
    setupNavLinks();
    render();
    if (initialCat) {
      setTimeout(() => {
        const target = document.getElementById("resultsTitle");
        if (target) {
          const y = target.getBoundingClientRect().top + window.pageYOffset - 80;
          window.scrollTo({ top: y, behavior: "smooth" });
        }
      }, 150);
    }
  }

  let heroInterval = null;
  function buildHero() {
    if (!state.all.length) return;
    // Seleccionar fondos con mejor estética y soporte 4K/video para el hero
    const candidates = state.all.filter(w => (w.aesthetic_score && w.aesthetic_score >= 8.5) || w.is_video || w.resolution.includes("4K"));
    state.heroItems = (candidates.length >= 3 ? candidates : state.all).slice(0, 3);
    state.heroIndex = 0;

    const imgEl = $("#heroShowcaseImg");
    const badgeText = $("#heroShowcaseBadgeText");
    const dots = $$("#heroDots .wp-hero-dot");

    function updateHeroSlide(idx) {
      if (!state.heroItems.length) return;
      state.heroIndex = (idx + state.heroItems.length) % state.heroItems.length;
      const cur = state.heroItems[state.heroIndex];
      if (imgEl) {
        imgEl.style.opacity = "0.7";
        setTimeout(() => {
          imgEl.src = cur.thumbnail || cur.hd_url;
          imgEl.alt = cur.title;
          imgEl.style.opacity = "1";
        }, 150);
      }
      if (badgeText) {
        badgeText.textContent = cur.is_video ? "LIVE WALLPAPER" : cur.resolution || "4K ULTRA HD";
      }
      dots.forEach((dot, i) => dot.classList.toggle("is-active", i === state.heroIndex));
    }

    dots.forEach((dot, i) => {
      dot.onclick = () => {
        updateHeroSlide(i);
        restartHeroTimer();
      };
    });

    const card = $("#heroShowcaseCard");
    if (card) {
      card.onclick = () => {
        if (state.heroItems[state.heroIndex]) {
          openLightbox(state.heroItems[state.heroIndex].id);
        }
      };
    }

    function restartHeroTimer() {
      if (heroInterval) clearInterval(heroInterval);
      heroInterval = setInterval(() => updateHeroSlide(state.heroIndex + 1), 6000);
    }
    restartHeroTimer();
    updateHeroSlide(0);

    // Botón de guardar favoritos del Hero
    const favBtn = $("#heroFavsBtn");
    if (favBtn) {
      favBtn.onclick = () => {
        if (state.likes.size === 0) {
          const i18n = window.WP_I18N;
          showToast(i18n ? "No tienes fondos guardados todavía. Toca el corazón en cualquier fondo para agregarlo a tus favoritos." : "No tienes fondos guardados todavía. Toca el corazón en cualquier fondo.");
          return;
        }
        state.showingOnlyLikes = !state.showingOnlyLikes;
        favBtn.classList.toggle("is-active", state.showingOnlyLikes);
        state.page = 1;
        render();
        const resultsEl = document.getElementById("resultsTitle");
        if (resultsEl) resultsEl.scrollIntoView({ behavior: "smooth" });
      };
    }
  }

  function buildFeaturedSection() {
    const track = $("#featuredTrack");
    if (!track || !state.all.length) return;
    
    // Top 12 más populares o destacados por puntuación estética
    const topPicks = state.all.slice().sort((a, b) => (b.aesthetic_score || 0) - (a.aesthetic_score || 0)).slice(0, 14);
    
    track.innerHTML = topPicks.map(w => `
      <div class="wp-feat-card" data-id="${w.id}">
        <img src="${w.thumbnail}" alt="${w.title}" loading="lazy">
        <div class="wp-feat-info">
          <span class="wp-feat-title">${w.title}</span>
          <span class="wp-feat-cat">${w.category}</span>
        </div>
      </div>
    `).join("");

    track.onclick = (e) => {
      const card = e.target.closest(".wp-feat-card");
      if (card) openLightbox(card.dataset.id);
    };

    $("#featPrevBtn")?.addEventListener("click", () => {
      track.scrollBy({ left: -280, behavior: "smooth" });
    });
    $("#featNextBtn")?.addEventListener("click", () => {
      track.scrollBy({ left: 280, behavior: "smooth" });
    });
  }

  function setupNavLinks() {
    $$(".wp-nav-link[data-cat]").forEach(link => {
      link.addEventListener("click", (e) => {
        e.preventDefault();
        state.category = link.dataset.cat;
        state.page = 1;
        syncActiveStates();
        render();
        const target = document.getElementById("resultsTitle");
        if (target) {
          const y = target.getBoundingClientRect().top + window.pageYOffset - 80;
          window.scrollTo({ top: y, behavior: "smooth" });
        }
      });
    });

    $("#navMoreDropdownTrigger")?.addEventListener("click", () => {
      const sidebar = $("#sidebar");
      const backdrop = $("#sidebarBackdrop");
      sidebar?.classList.add("is-open");
      backdrop?.classList.add("is-open");
    });

    $("#wpFollowBtn")?.addEventListener("click", () => {
      showToast("✨ ¡Gracias por seguir a Nekutoon! Actualizamos fondos en 4K y Live a diario.");
    });
  }

  function buildTagRail(categories) {
    const rail = $("#tagRail");
    const cats = categories.filter(c => c !== "Todos" && c !== "Live Video");
    rail.innerHTML = [`Todos`, ...cats].map(cat => {
      const active = cat === state.category ? "is-active" : "";
      const icon = CATEGORY_ICONS[cat] || "•";
      const label = window.WP_I18N ? window.WP_I18N.translateCategory(cat) : cat;
      return `<button class="wp-tagpill ${active}" data-cat="${cat}"><span>${icon}</span>${label}</button>`;
    }).join("");
    rail.addEventListener("click", (e) => {
      const btn = e.target.closest(".wp-tagpill");
      if (!btn) return;
      state.category = btn.dataset.cat;
      state.page = 1;
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
      const label = window.WP_I18N ? window.WP_I18N.translateCategory(cat) : cat;
      return `<li class="${active}" data-cat="${cat}"><span>${label}</span><span class="wp-cat-count">${count}</span></li>`;
    }).join("");
    list.addEventListener("click", (e) => {
      const li = e.target.closest("li");
      if (!li) return;
      state.category = li.dataset.cat;
      state.page = 1;
      syncActiveStates();
      render();
    });
  }

  function syncActiveStates() {
    $$(".wp-tagpill").forEach(el => el.classList.toggle("is-active", el.dataset.cat === state.category));
    $$("#categoryList li").forEach(el => el.classList.toggle("is-active", el.dataset.cat === state.category));
    $$(".wp-nav-link[data-cat]").forEach(el => el.classList.toggle("is-active", el.dataset.cat === state.category));
  }

  function getFiltered() {
    let items = state.all.filter(w => {
      if (state.showingOnlyLikes && !state.likes.has(w.id)) return false;
      if (state.category !== "Todos" && w.category !== state.category) return false;
      if (state.format !== "all") {
        const ori = String(w.orientation || "").toLowerCase();
        if (state.format === "landscape" && !ori.includes("land") && !ori.includes("horiz") && !ori.includes("escritorio") && !ori.includes("pc")) return false;
        if (state.format === "portrait" && !ori.includes("port") && !ori.includes("vert") && !ori.includes("celular") && !ori.includes("móvil")) return false;
      }
      if (!matchesDevice(w, state.device)) return false;
      if (state.resolutions.size && !state.resolutions.has(w.resolution)) return false;
      if (state.query) {
        const q = state.query.toLowerCase();
        const haystack = `${w.title} ${w.category} ${(w.tags || []).join(" ")} ${w.authorName || ""}`.toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
    if (state.sort === "popular") {
      items = items.slice().sort((a, b) => (b.aesthetic_score || 8) - (a.aesthetic_score || 8));
    } else {
      items = items.slice().sort((a, b) => {
        if (a.is_community && !b.is_community) return -1;
        if (!a.is_community && b.is_community) return 1;
        return (Number(b.id) || 0) - (Number(a.id) || 0);
      });
    }
    return items;
  }

  function cardTemplate(w) {
    const liked = state.likes.has(w.id);
    return `
      <article class="wp-card" data-id="${w.id}">
        <div class="wp-card-badges">
          <span class="wp-badge wp-badge-res">${w.resolution}</span>
          ${w.is_community ? `<span class="wp-badge" style="background:rgba(0,242,195,0.18); border:1px solid rgba(0,242,195,0.4); color:var(--teal)">👤 ${w.authorName || 'Comunidad'}</span>` : ''}
          ${w.is_vip ? `<span class="wp-badge wp-badge-vip">${currentUser ? "★" : "🔒"} VIP</span>` : w.is_video ? `<span class="wp-badge wp-badge-video">▶ Live</span>` : ""}
        </div>
        <img src="${w.thumbnail}" alt="${w.title}" loading="lazy" style="${w.color ? `background:${w.color}` : ""}">
        <div class="wp-card-overlay">
          <span class="wp-card-title">${w.title}</span>
          ${w.is_community ? `<span style="font-size:0.75rem; color:rgba(255,255,255,0.75); margin-top:2px">Por ${w.authorName || 'Comunidad'}</span>` : ''}
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

  function goToPage(pageNum) {
    const items = getFiltered();
    const totalPages = Math.max(1, Math.ceil(items.length / state.perPage));
    if (pageNum < 1 || pageNum > totalPages || pageNum === state.page) return;
    state.page = pageNum;
    render();
    const resultsEl = document.getElementById("resultsTitle");
    if (resultsEl) {
      const y = resultsEl.getBoundingClientRect().top + window.pageYOffset - 80;
      window.scrollTo({ top: y, behavior: "smooth" });
    }
  }

  function renderPagination(totalItems, totalPages, startIdx, endIdx) {
    const container = $("#paginationContainer");
    if (!container) return;

    if (totalItems <= state.perPage) {
      container.classList.add("hidden");
      return;
    }
    container.classList.remove("hidden");

    const info = $("#paginationInfo");
    if (info) {
      const i18n = window.WP_I18N;
      info.textContent = i18n
        ? i18n.t("pagination_showing", startIdx + 1, endIdx, totalItems)
        : `Mostrando ${startIdx + 1}–${endIdx} de ${totalItems} fondos`;
    }

    const prevBtn = $("#prevPageBtn");
    const nextBtn = $("#nextPageBtn");
    if (prevBtn) prevBtn.disabled = state.page <= 1;
    if (nextBtn) nextBtn.disabled = state.page >= totalPages;

    const pageNumbersEl = $("#pageNumbers");
    if (pageNumbersEl) {
      const range = [];
      if (totalPages <= 7) {
        for (let i = 1; i <= totalPages; i++) range.push(i);
      } else {
        if (state.page <= 4) {
          range.push(1, 2, 3, 4, 5, "...", totalPages);
        } else if (state.page >= totalPages - 3) {
          range.push(1, "...", totalPages - 4, totalPages - 3, totalPages - 2, totalPages - 1, totalPages);
        } else {
          range.push(1, "...", state.page - 1, state.page, state.page + 1, "...", totalPages);
        }
      }

      pageNumbersEl.innerHTML = range.map(p => {
        if (p === "...") return `<span class="wp-page-ellipsis">…</span>`;
        const active = p === state.page ? "is-active" : "";
        return `<button class="wp-page-num ${active}" data-page="${p}">${p}</button>`;
      }).join("");
    }
  }

  function render() {
    const items = getFiltered();
    const grid = $("#grid");
    const empty = $("#emptyState");
    const container = $("#paginationContainer");
    const i18n = window.WP_I18N;
    
    $("#resultsTitle").textContent = state.showingOnlyLikes
      ? (i18n ? i18n.t("hero_saved") : "Guardar favoritos")
      : state.category === "Todos"
        ? (i18n ? i18n.t("results_title_all") : "Todos los fondos")
        : (i18n ? i18n.translateCategory(state.category) : state.category);
    $("#resultsCount").textContent = i18n ? i18n.t("results_count", items.length) : `${items.length} fondo${items.length === 1 ? "" : "s"}`;

    if (!items.length) {
      grid.innerHTML = "";
      empty.classList.remove("hidden");
      if (container) container.classList.add("hidden");
      return;
    }
    empty.classList.add("hidden");
    
    const totalItems = items.length;
    const totalPages = Math.max(1, Math.ceil(totalItems / state.perPage));
    if (state.page > totalPages) state.page = totalPages;

    const startIdx = (state.page - 1) * state.perPage;
    const endIdx = Math.min(startIdx + state.perPage, totalItems);
    const paginatedItems = items.slice(startIdx, endIdx);

    grid.innerHTML = paginatedItems.map(cardTemplate).join("");
    renderPagination(totalItems, totalPages, startIdx, endIdx);
  }

  function toggleLike(id) {
    if (state.likes.has(id)) state.likes.delete(id); else state.likes.add(id);
    localStorage.setItem("wp_likes", JSON.stringify([...state.likes]));
  }

  function setupFilters() {
    const resetPageEvent = () => { state.page = 1; render(); };

    $("#searchInput").addEventListener("input", (e) => {
      state.query = e.target.value.trim();
      state.page = 1;
      render();
    });

    $$('.wp-chip-row[data-filter="format"] .wp-chip').forEach(btn => {       btn.addEventListener("click", () => {         state.format = btn.dataset.value;         $$
('.wp-chip-row[data-filter="format"] .wp-chip').forEach(b => b.classList.toggle("is-active", b === btn));
        resetPageEvent();
      });
    });

    $$('.wp-chip-row[data-filter="device"] .wp-chip').forEach(btn => {       btn.addEventListener("click", () => {         state.device = btn.dataset.value;         $$
('.wp-chip-row[data-filter="device"] .wp-chip').forEach(b => b.classList.toggle("is-active", b === btn));
        resetPageEvent();
      });
    });

    $$('input[name="sort"]').forEach(radio => {       radio.addEventListener("change", (e) => {         state.sort = e.target.value;         resetPageEvent();       });     });      $$
('.wp-check-list[data-filter="resolution"] input').forEach(chk => {
      chk.addEventListener("change", (e) => {
        if (e.target.checked) state.resolutions.add(e.target.value);
        else state.resolutions.delete(e.target.value);
        resetPageEvent();
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

    $("#prevPageBtn")?.addEventListener("click", () => {
      goToPage(state.page - 1);
    });

    $("#nextPageBtn")?.addEventListener("click", () => {
      goToPage(state.page + 1);
    });

    $("#pageNumbers")?.addEventListener("click", (e) => {
      const btn = e.target.closest(".wp-page-num");
      if (btn && btn.dataset.page) {
        goToPage(Number(btn.dataset.page));
      }
    });
  }

  function setupSidebar() {
    const sidebar = $("#sidebar");
    const backdrop = $("#sidebarBackdrop");
    const open = () => { sidebar.classList.add("is-open"); backdrop.classList.add("is-open"); };
    const close = () => { sidebar.classList.remove("is-open"); backdrop.classList.remove("is-open"); };
    $("#sidebarToggle").addEventListener("click", open);
    backdrop.addEventListener("click", close);
  }

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

  function openLightbox(id) {
    const w = state.all.find(x => x.id === id);
    if (!w) return;
    state.currentLightboxId = id;
    const lb = $("#lightbox");
    const media = $("#lightboxMedia");
    const safeHd = w.hd_url || w.thumbnail;
    const safeThumb = w.thumbnail || w.hd_url;

    media.innerHTML = w.is_video
      ? `<video src="${safeHd}" controls autoplay muted loop playsinline poster="${safeThumb}" onerror="this.onerror=null; this.outerHTML='<div class=\\'wp-video-fallback\\'><img src=\\'${safeThumb}\\' alt=\\'${w.title}\\'><p>Vista previa en imagen</p></div>';"></video>`
      : `<img src="${safeHd}" alt="${w.title}" onerror="if(this.src!=='${safeThumb}'){this.src='${safeThumb}';}">`;
    $("#lightboxTitle").textContent = w.title;
    $("#lightboxMeta").textContent = `${w.category} · ${w.resolution}${w.is_amoled ? " · AMOLED" : ""}`;
    $("#lightboxDownload").href = safeHd;
    $("#lightboxDownload").setAttribute("download", w.file_name || "");

    const likeBtn = $("#lightboxLike");
    likeBtn.classList.toggle("is-liked", state.likes.has(w.id));
    likeBtn.onclick = () => { toggleLike(w.id); likeBtn.classList.toggle("is-liked"); render(); };

    const related = state.all.filter(x => x.category === w.category && x.id !== w.id).slice(0, 8);
    $("#relatedRow").innerHTML = related.map(r => `<img src="${r.thumbnail}" alt="${r.title}" data-id="${r.id}" loading="lazy">`).join("");

    lb.classList.add("is-open");
    document.body.style.overflow = "hidden";

    // Load ratings, comments and creator via community.js
    loadLightboxCommunity(w);
  }

  // Load ratings + comments + creator from community.js (loaded as module separately)
  let commentsUnsub = null;
  let ratingsUnsub = null;
  let followersUnsub = null;

  async function loadLightboxCommunity(w) {
    const community = window.WP_COMMUNITY;
    if (!community || !w) return;
    const wallpaperId = w.id;

    // Limpiar suscripciones previas
    if (commentsUnsub) { commentsUnsub(); commentsUnsub = null; }
    if (ratingsUnsub) { ratingsUnsub(); ratingsUnsub = null; }
    if (followersUnsub) { followersUnsub(); followersUnsub = null; }

    // --- Tarjeta del Creador y Sistema de Seguir ---
    const creatorCard = $("#lightboxCreatorCard");
    const creatorAvatar = $("#lightboxCreatorAvatar");
    const creatorName = $("#lightboxCreatorName");
    const creatorFollowers = $("#lightboxCreatorFollowers");
    const creatorTag = $("#lightboxCreatorTag");
    const followBtn = $("#lightboxFollowBtn");

    if (creatorCard) {
      const authorName = w.authorName || (w.is_community ? "Creador Comunitario" : "Nekutoon Studio");
      const authorPhoto = w.authorPhoto || (w.is_community ? "" : "https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=120&auto=format&fit=crop&q=80");
      const authorUid = w.authorUid || (w.is_community ? "c_" + (w.authorName || "comunidad").replace(/\s+/g, '_') : "c_nekutoon");

      if (creatorName) creatorName.textContent = authorName;
      if (creatorAvatar) {
        creatorAvatar.src = authorPhoto || 'data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 24 24%22><circle cx=%2212%22 cy=%228%22 r=%224%22 fill=%22%23666%22/><path d=%22M4 20c0-4 3.6-7 8-7s8 3 8 7%22 fill=%22%23666%22/></svg>';
      }
      if (creatorTag) creatorTag.textContent = w.is_community ? "Colaborador" : "Creador Oficial";

      async function updateFollowState() {
        if (!community.isFollowing || !followBtn) return;
        const following = await community.isFollowing(authorUid);
        followBtn.classList.toggle("is-following", following);
        const textSpan = followBtn.querySelector(".wp-follow-text");
        const addIcon = followBtn.querySelector(".wp-follow-icon-add");
        const checkIcon = followBtn.querySelector(".wp-follow-icon-check");
        if (textSpan) textSpan.textContent = following ? "Siguiendo" : "Seguir";
        if (addIcon) addIcon.style.display = following ? "none" : "inline";
        if (checkIcon) checkIcon.style.display = following ? "inline" : "none";
      }
      updateFollowState();

      if (community.subscribeFollowers && creatorFollowers) {
        followersUnsub = community.subscribeFollowers(authorUid, (count) => {
          const totalF = w.is_community ? count : count + 1540;
          creatorFollowers.textContent = `${totalF} seguidor${totalF === 1 ? '' : 'es'}`;
        });
      }

      if (followBtn) {
        followBtn.onclick = async () => {
          if (!currentUser) {
            requestLogin();
            return;
          }
          const isF = await community.isFollowing(authorUid);
          try {
            if (isF) {
              await community.unfollowUser(authorUid);
              showToast(`Dejaste de seguir a ${authorName}`);
            } else {
              await community.followUser(authorUid, authorName, authorPhoto);
              showToast(`✨ ¡Ahora sigues a ${authorName}!`);
            }
            updateFollowState();
            buildTopCreatorsSection();
          } catch (err) {
            showToast(err.message || "Error al actualizar seguimiento.");
          }
        };
      }
    }

    // --- Ratings ---
    const avgEl = $("#lightboxRatingAvg");
    const starsEl = $$("#lightboxStars .wp-star");

    // Suscripción en TIEMPO REAL a calificaciones
    if (community.subscribeRatings) {
      ratingsUnsub = community.subscribeRatings(wallpaperId, ({ avg, total }) => {
        if (avgEl) {
          avgEl.textContent = total > 0 ? `★ ${avg} (${total})` : "Sin votos aún";
          avgEl.classList.toggle("has-rating", total > 0);
        }
      });
    } else {
      try {
        const { avg, total } = await community.getAvgRating(wallpaperId);
        if (avgEl) {
          avgEl.textContent = total > 0 ? `★ ${avg} (${total})` : "Sin votos aún";
          avgEl.classList.toggle("has-rating", total > 0);
        }
      } catch (_) {}
    }

    const userRating = await community.getUserRating(wallpaperId);
    starsEl.forEach((star, i) => {
      star.classList.toggle("is-active", i < userRating);
    });

    // Star hover + click
    starsEl.forEach((star, i) => {
      star.onmouseenter = () => starsEl.forEach((s, j) => s.classList.toggle("is-hover", j <= i));
      star.onmouseleave = () => starsEl.forEach(s => s.classList.remove("is-hover"));
      star.onclick = async () => {
        if (!window.WP_COMMUNITY) return;
        try {
          await community.setRating(wallpaperId, i + 1);
          starsEl.forEach((s, j) => s.classList.toggle("is-active", j <= i));
          showToast("⭐ ¡Gracias por calificar este fondo!");
        } catch (err) {
          showToast(err.message || "Inicia sesión para calificar.");
        }
      };
    });

    // --- Comments en TIEMPO REAL ---
    const listEl = $("#commentsList");
    const countEl = $("#commentsCount");
    if (listEl) {
      listEl.innerHTML = `<div class="wp-comments-loading"><div class="wp-spin"></div></div>`;
      if (community.subscribeComments) {
        commentsUnsub = community.subscribeComments(wallpaperId, (comments) => {
          if (countEl) countEl.textContent = comments.length || "";
          if (!comments.length) {
            listEl.innerHTML = `<p class="wp-comments-empty">Sé el primero en comentar 👋</p>`;
            return;
          }
          listEl.innerHTML = comments.map(c => `
            <div class="wp-comment-item">
              <img class="wp-comment-item-avatar" src="${c.authorPhoto || ''}" alt="${c.authorName}" 
                   onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 24 24%22><circle cx=%2212%22 cy=%228%22 r=%224%22 fill=%22%23555%22/><path d=%22M4 20c0-4 3.6-7 8-7s8 3 8 7%22 fill=%22%23555%22/></svg>'">
              <div class="wp-comment-item-body">
                <div class="wp-comment-item-name">${c.authorName || "Anónimo"}</div>
                <div class="wp-comment-item-text">${c.text}</div>
                <div class="wp-comment-item-date">${formatCommentDate(c.createdAt)}</div>
              </div>
            </div>
          `).join("");
        });
      } else {
        loadComments(wallpaperId);
      }
    }

    setupCommentForm(wallpaperId);
  }

  async function loadComments(wallpaperId) {
    const listEl = $("#commentsList");
    const countEl = $("#commentsCount");
    if (!listEl) return;
    listEl.innerHTML = `<div class="wp-comments-loading"><div class="wp-spin"></div></div>`;
    const community = window.WP_COMMUNITY;
    if (!community) {
      listEl.innerHTML = `<p class="wp-comments-empty">Los comentarios estarán disponibles pronto.</p>`;
      return;
    }
    try {
      const comments = await community.loadComments(wallpaperId);
      if (countEl) countEl.textContent = comments.length || "";
      if (!comments.length) {
        listEl.innerHTML = `<p class="wp-comments-empty">Sé el primero en comentar 👋</p>`;
        return;
      }
      listEl.innerHTML = comments.map(c => `
        <div class="wp-comment-item">
          <img class="wp-comment-item-avatar" src="${c.authorPhoto || ''}" alt="${c.authorName}" 
               onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 24 24%22><circle cx=%2212%22 cy=%228%22 r=%224%22 fill=%22%23555%22/><path d=%22M4 20c0-4 3.6-7 8-7s8 3 8 7%22 fill=%22%23555%22/></svg>'">
          <div class="wp-comment-item-body">
            <div class="wp-comment-item-name">${c.authorName || "Anónimo"}</div>
            <div class="wp-comment-item-text">${c.text}</div>
            <div class="wp-comment-item-date">${formatCommentDate(c.createdAt)}</div>
          </div>
        </div>
      `).join("");
    } catch (_) {
      listEl.innerHTML = `<p class="wp-comments-empty">Error al cargar comentarios.</p>`;
    }
  }

  function formatCommentDate(ts) {
    if (!ts) return "";
    const d = ts.toDate ? ts.toDate() : new Date(ts);
    const diff = Math.floor((Date.now() - d) / 1000);
    if (diff < 60) return "Ahora";
    if (diff < 3600) return `Hace ${Math.floor(diff/60)} min`;
    if (diff < 86400) return `Hace ${Math.floor(diff/3600)} h`;
    return d.toLocaleDateString("es-ES", { day: "numeric", month: "short" });
  }

  function setupCommentForm(wallpaperId) {
    const authPrompt = $("#commentAuthPrompt");
    const inputRow = $("#commentInputRow");
    const textarea = $("#commentText");
    const charsEl = $("#commentChars");
    const submitBtn = $("#commentSubmit");
    const avatarEl = $("#commentAvatar");

    // Show/hide based on auth state
    if (currentUser) {
      if (authPrompt) authPrompt.style.display = "none";
      if (inputRow) inputRow.style.display = "flex";
      if (avatarEl && currentUser.photoURL) avatarEl.src = currentUser.photoURL;
    } else {
      if (authPrompt) authPrompt.style.display = "flex";
      if (inputRow) inputRow.style.display = "none";
    }

    if (authPrompt) authPrompt.onclick = () => window.dispatchEvent(new CustomEvent("wp:request-login"));

    if (textarea) {
      textarea.oninput = () => {
        const left = 500 - textarea.value.length;
        if (charsEl) charsEl.textContent = left;
        if (submitBtn) submitBtn.disabled = !textarea.value.trim();
      };
    }

    if (submitBtn) {
      submitBtn.onclick = async () => {
        const text = textarea?.value?.trim();
        if (!text || !window.WP_COMMUNITY) return;
        submitBtn.disabled = true;
        try {
          await window.WP_COMMUNITY.postComment(wallpaperId, text);
          textarea.value = "";
          if (charsEl) charsEl.textContent = "500";
          showToast("💬 Comentario publicado. ¡Gracias!");
        } catch (err) {
          showToast(err.message || "Error al publicar el comentario.");
        } finally {
          submitBtn.disabled = false;
        }
      };
    }
  }

  function closeLightbox() {
    if (commentsUnsub) { commentsUnsub(); commentsUnsub = null; }
    if (ratingsUnsub) { ratingsUnsub(); ratingsUnsub = null; }
    if (followersUnsub) { followersUnsub(); followersUnsub = null; }
    $("#lightbox").classList.remove("is-open");
    const media = $("#lightboxMedia");
    if (media) media.innerHTML = "";
    document.body.style.overflow = "";
  }

  // --- Sección Top Creadores del Mes ---
  async function buildTopCreatorsSection() {
    const grid = document.getElementById("topCreatorsGrid");
    if (!grid || !window.WP_COMMUNITY?.getTopCreators) return;

    try {
      const creators = await window.WP_COMMUNITY.getTopCreators(4);
      if (!creators || !creators.length) return;

      const medals = ["🥇 #1", "🥈 #2", "🥉 #3", "#4"];

      grid.innerHTML = creators.map((c, i) => {
        const isFollowingCreator = localStorage.getItem(`wp_following_${c.uid}`) === "1";
        return `
          <div class="wp-top-creator-card">
            <span class="wp-top-creator-rank">${medals[i] || `#${i+1}`}</span>
            <div class="wp-top-creator-avatar-wrap">
              <img class="wp-top-creator-avatar" src="${c.photo || 'data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 24 24%22><circle cx=%2212%22 cy=%228%22 r=%224%22 fill=%22%23666%22/><path d=%22M4 20c0-4 3.6-7 8-7s8 3 8 7%22 fill=%22%23666%22/></svg>'}" alt="${c.name}">
              <span class="wp-top-creator-badge-pill">${c.badge || 'Creador'}</span>
            </div>
            <h3 class="wp-top-creator-name">${c.name}</h3>
            <div class="wp-top-creator-sub">
              <strong>${c.followersCount}</strong> seguidores · ${c.wallpapersCount} fondos
            </div>
            <button class="wp-top-creator-follow-btn ${isFollowingCreator ? 'is-following' : ''}" data-creator-uid="${c.uid}" data-creator-name="${c.name}" data-creator-photo="${c.photo}">
              <span>${isFollowingCreator ? '✓ Siguiendo' : '+ Seguir'}</span>
            </button>
          </div>
        `;
      }).join("");

      grid.querySelectorAll(".wp-top-creator-follow-btn").forEach(btn => {
        btn.onclick = async () => {
          if (!currentUser) {
            requestLogin();
            return;
          }
          const uid = btn.dataset.creatorUid;
          const name = btn.dataset.creatorName;
          const photo = btn.dataset.creatorPhoto;
          const comm = window.WP_COMMUNITY;
          if (!comm) return;

          const isF = await comm.isFollowing(uid);
          try {
            if (isF) {
              await comm.unfollowUser(uid);
              showToast(`Dejaste de seguir a ${name}`);
            } else {
              await comm.followUser(uid, name, photo);
              showToast(`✨ ¡Ahora sigues a ${name}!`);
            }
            buildTopCreatorsSection();
          } catch (err) {
            showToast(err.message || "Error al actualizar seguimiento.");
          }
        };
      });
    } catch (e) {
      console.warn("Aviso top creadores:", e);
    }
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

  // Update category tile counts and custom images on index page
  function updateCatTileCounts() {
    document.querySelectorAll("[data-cat-count]").forEach(el => {
      const cat = el.dataset.catCount;
      const count = cat === "Todos" ? state.all.length : state.all.filter(w => w.category === cat).length;
      el.textContent = `${count} fondos`;
    });

    fetch("./categories_config.json").then(r => r.ok ? r.json() : null).then(cfg => {
      if (!cfg || !cfg.categories) return;
      document.querySelectorAll(".wp-cat-tile[data-cat]").forEach(tile => {
        const catName = tile.dataset.cat;
        const catData = cfg.categories[catName];
        if (catData && catData.image) {
          const bg = tile.querySelector(".wp-cat-tile-bg");
          if (bg) bg.style.backgroundImage = `url('${catData.image}')`;
        }
      });
    }).catch(() => {});
  }

  // News banner close
  function setupNewsBanner() {
    const banner = $("#newsBanner");
    const closeBtn = $("#newsBannerClose");
    if (!banner || !closeBtn) return;
    if (sessionStorage.getItem("wp_news_closed")) {
      banner.classList.add("is-hidden");
      return;
    }
    // Load latest news text
    fetch("./news.json").then(r => r.json()).then(data => {
      const latest = data.news?.[0];
      if (latest) {
        const textEl = $("#newsBannerText");
        if (textEl) textEl.textContent = latest.title;
      }
    }).catch(() => {});
    closeBtn.addEventListener("click", () => {
      banner.classList.add("is-hidden");
      sessionStorage.setItem("wp_news_closed", "1");
    });
  }

  window.addEventListener("wp:lang-changed", () => {
    if (!state.all.length) return;
    buildHero();
    buildTagRail(state.lastCategories || []);
    buildCategoryList(state.lastCategories || []);
    syncActiveStates();
    render();
  });

  document.addEventListener("DOMContentLoaded", () => {
    setupFilters();
    setupSidebar();
    setupTheme();
    setupLightbox();
    setupNewsBanner();
    loadData();
    buildTopCreatorsSection();
    const yearEl = $("#footerYear");
    if (yearEl) yearEl.textContent = new Date().getFullYear();
    const footerFavs = $("#footerFavsLink");
    if (footerFavs) footerFavs.onclick = (e) => {
      e.preventDefault();
      state.showingOnlyLikes = true;
      state.page = 1;
      render();
      window.scrollTo({ top: 0, behavior: "smooth" });
    };
  });
})();
