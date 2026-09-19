// categories.js
// Carga conteos dinámicos de wallpapers por categoría y gestiona navegación fluida

document.addEventListener('DOMContentLoaded', () => {
  const countSpans = document.querySelectorAll('[data-cat-id]');
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

      countSpans.forEach((span) => {
        const catId = span.getAttribute('data-cat-id');
        const count = counts[catId] || 0;
        span.textContent = `${count} fondo${count !== 1 ? 's' : ''}`;
      });
    })
    .catch((err) => {
      console.warn('Error al calcular conteos de categorías:', err);
      countSpans.forEach((span) => {
        span.textContent = 'Explorar';
      });
    });
});
