import sys
import re

with open('app.js', 'r', encoding='utf-8') as f:
    text = f.read()

new_func = """
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
text += new_func

# Call buildMegaMenuCategories where buildTagRail is called
text = text.replace('buildTagRail(state.lastCategories);', 'buildTagRail(state.lastCategories);\n    buildMegaMenuCategories(state.lastCategories);')
text = text.replace('buildTagRail(state.lastCategories || []);', 'buildTagRail(state.lastCategories || []);\n    buildMegaMenuCategories(state.lastCategories || []);')

# Update syncActiveStates to include mega menu items
old_sync = '$$(".wp-nav-link[data-cat]").forEach(el => el.classList.toggle("is-active", el.dataset.cat === state.category));'
new_sync = '$$(".wp-nav-link[data-cat]").forEach(el => el.classList.toggle("is-active", el.dataset.cat === state.category));\n    $$("#megaCategoryList a").forEach(el => el.classList.toggle("is-active", el.dataset.cat === state.category));'
text = text.replace(old_sync, new_sync)

# Update setupNavLinks to handle mega menu clicks
old_nav = '$$(".wp-nav-link[data-cat]").forEach(link => {'
new_nav = '$$(".wp-nav-link[data-cat], #megaCategoryList a, #megaMenu a[data-cat]").forEach(link => {'
text = text.replace(old_nav, new_nav)

with open('app.js', 'w', encoding='utf-8') as f:
    f.write(text)
print("Updated app.js")
