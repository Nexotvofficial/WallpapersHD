"""
clean_titles.py
----------------
Borra del TÍTULO de cada fondo cualquier palabra/frase listada en
title_blacklist.txt (un archivo tuyo, privado — este script no sabe ni
necesita saber qué palabras contiene).

Corré esto UNA VEZ para limpiar los títulos que ya existen en tu catálogo:

    python clean_titles.py

Actualiza wallpapers.json (lo que lee el sitio) Y wallpapers_cache.json
(la caché de generador.py). Es importante actualizar los dos: si solo
tocás wallpapers.json, la próxima vez que corra el pipeline y vea que el
archivo original no cambió, va a reusar el título viejo desde la caché y
tu limpieza se "revierte" sola.

Los fondos que subas DE AHORA EN MÁS ya salen limpios directamente, sin
necesidad de correr este script — generador.py también aplica la misma
lista negra (ver la función format_title).
"""

import json
import os
import re

WALLPAPERS_JSON = "wallpapers.json"
CACHE_FILE = "wallpapers_cache.json"
BLACKLIST_FILE = "title_blacklist.txt"


def load_blacklist(path=BLACKLIST_FILE):
    words = []
    if not os.path.exists(path):
        print(f"⚠️ No encontré {path} en esta carpeta. Creá ese archivo "
              f"(uno por línea, '#' para comentarios) y volvé a correr esto.")
        return words
    with open(path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            words.append(line)
    return words


def clean_title(title, blacklist):
    if not title:
        return title
    cleaned = title
    for word in blacklist:
        # \b = límite de palabra: borra "gratis" como palabra suelta pero no
        # te destroza "gratisimo" a la mitad. re.IGNORECASE para no importar
        # mayúsculas/minúsculas. Funciona igual con frases de varias palabras.
        pattern = r"\b" + re.escape(word) + r"\b"
        cleaned = re.sub(pattern, "", cleaned, flags=re.IGNORECASE)
    # Junta espacios dobles que quedan al borrar una palabra del medio, y
    # saca guiones/espacios sueltos que puedan quedar al principio/final.
    cleaned = re.sub(r"\s{2,}", " ", cleaned).strip(" -_")
    return cleaned if cleaned else "Wallpaper"


def clean_wallpapers_json(blacklist):
    if not os.path.exists(WALLPAPERS_JSON):
        print(f"⚠️ No encontré {WALLPAPERS_JSON}, se omite.")
        return
    with open(WALLPAPERS_JSON, "r", encoding="utf-8") as f:
        data = json.load(f)

    changed = 0
    for item in data.get("wallpapers", []):
        old = item.get("title", "")
        new = clean_title(old, blacklist)
        if new != old:
            item["title"] = new
            changed += 1

    with open(WALLPAPERS_JSON, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
    print(f"✅ {WALLPAPERS_JSON}: {changed} título(s) actualizados de {len(data.get('wallpapers', []))} totales.")


def clean_cache_json(blacklist):
    if not os.path.exists(CACHE_FILE):
        print(f"⚠️ No encontré {CACHE_FILE}, se omite (no es grave si todavía no existe).")
        return
    with open(CACHE_FILE, "r", encoding="utf-8") as f:
        cache = json.load(f)

    changed = 0
    for entry in cache.values():
        item = entry.get("item") if isinstance(entry, dict) else None
        if not item:
            continue
        old = item.get("title", "")
        new = clean_title(old, blacklist)
        if new != old:
            item["title"] = new
            changed += 1

    with open(CACHE_FILE, "w", encoding="utf-8") as f:
        json.dump(cache, f, indent=2, ensure_ascii=False)
    print(f"✅ {CACHE_FILE}: {changed} título(s) sincronizados.")


def main():
    blacklist = load_blacklist()
    if not blacklist:
        print("No hay palabras cargadas en title_blacklist.txt — no se cambió nada.")
        return
    print(f"🧹 Limpiando títulos con {len(blacklist)} palabra(s)/frase(s) de la lista negra...\n")
    clean_wallpapers_json(blacklist)
    clean_cache_json(blacklist)
    print("\nListo. Subí los 2 archivos actualizados a tu repo (o dejá que el próximo commit los incluya).")


if __name__ == "__main__":
    main()
