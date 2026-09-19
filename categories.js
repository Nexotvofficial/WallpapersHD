// categories.js
// Carga conteos dinámicos y portadas personalizadas desde categories_config.json y wallpapers.json

document.addEventListener('DOMContentLoaded', () => {
  // 1. Cargar portadas y títulos personalizados desde categories_config.json
  fetch('./categories_config.json')
    .then(r => r.ok ? r.json() : null)
    .then(cfg => {
      if (!cfg || !cfg.categories) return;
      
      // Actualizar tarjetas en categories.html
      document.querySelectorAll('.wp-cat-page-card[data-category]').forEach(card => {
        const catName = card.dataset.category;
        const catData = cfg.categories[catName];
        if (catData) {
          const bg = card.querySelector('.wp-cat-page-card-bg');
          if (bg && catData.image) bg.style.backgroundImage = `url('${catData.image}')`;
        }
      });

      // Actualizar mosaicos en index.html
      document.querySelectorAll('.wp-cat-tile[data-cat]').forEach(tile => {
        const catName = tile.dataset.cat;
        const catData = cfg.categories[catName];
        if (catData) {
          const bg = tile.querySelector('.wp-cat-tile-bg');
          if (bg && catData.image) bg.style.backgroundImage = `url('${catData.image}')`;
        }
      });
    })
    .catch(() => {});

  // 2. Calcular conteos reales desde wallpapers.json
  const countSpans = document.querySelectorAll('[data-cat-id], [data-cat-count]');
  if (!countSpans.length) return;

  fetch('./wallpapers.json')
    .then((res) => {
      if (!res.ok) throw new Error('No se pudo cargar wallpapers.json');
      return res.json();
    })
    .then((data) => {
      const wallpapers = data.wallpapers || [];
      const counts = {};

      wallpapers.forEach((wp) => {
        if (wp.category) {
          counts[wp.category] = (counts[wp.category] || 0) + 1;
        }
      });

      // Actualizar en categories.html
      document.querySelectorAll('[data-cat-id]').forEach((span) => {
        const catId = span.getAttribute('data-cat-id');
        const count = counts[catId] || 0;
        span.textContent = `${count} fondo${count !== 1 ? 's' : ''}`;
      });

      // Actualizar en index.html
      document.querySelectorAll('[data-cat-count]').forEach((span) => {
        const catId = span.getAttribute('data-cat-count');
        const count = counts[catId] || 0;
        span.textContent = `${count} fondos`;
      });
    })
    .catch((err) => {
      console.warn('Error al calcular conteos:', err);
    });
});
