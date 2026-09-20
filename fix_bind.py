import sys

with open('app.js', 'r', encoding='utf-8') as f:
    text = f.read()

bad_func = """
  function buildMegaMenuCategories(categories) {
    const list = $("#megaCategoryList");
    if (!list) return;
    const cats = categories.filter(c => c !== "Todos" && c !== "Live Video");
    list.innerHTML = [`Todos`, ...cats].map(cat => {
      const active = cat === state.category ? "is-active" : "";
      const label = window.WP_I18N ? window.WP_I18N.translateCategory(cat) : cat;
      return `<a href="#" class="${active}" data-cat="${cat}">${label}</a>`;
    }).join("");
  }
"""

good_func = """
  function buildMegaMenuCategories(categories) {
    const list = $("#megaCategoryList");
    if (!list) return;
    const cats = categories.filter(c => c !== "Todos" && c !== "Live Video");
    list.innerHTML = [`Todos`, ...cats].map(cat => {
      const active = cat === state.category ? "is-active" : "";
      const label = window.WP_I18N ? window.WP_I18N.translateCategory(cat) : cat;
      return `<a href="#" class="${active}" data-cat="${cat}">${label}</a>`;
    }).join("");
    
    // Bind clicks dynamically
    list.querySelectorAll("a").forEach(a => {
        a.addEventListener("click", (e) => {
            e.preventDefault();
            state.category = a.dataset.cat;
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
  }
"""
text = text.replace(bad_func, good_func)

with open('app.js', 'w', encoding='utf-8') as f:
    f.write(text)
print("Fixed event bindings")
