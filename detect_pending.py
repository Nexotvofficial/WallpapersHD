"""
Chequeo liviano que corre ANTES de instalar ffmpeg/PyTorch en cada shard.

Replica EXACTAMENTE la Fase 1 de generador.py (mismo filtro de extensiones,
mismo criterio de "reutilizable" vía hash+cache+miniatura, mismo orden
alfabético y mismo reparto módulo SHARD_TOTAL/SHARD_INDEX) pero solo usa la
librería estándar de Python (hashlib, os, json) — nada de cv2/PIL/torch — así
puede correr con el Python que ya trae el runner de Ubuntu, sin necesidad de
"actions/setup-python" ni de instalar ninguna dependencia.

Si a este shard no le toca ningún archivo nuevo/modificado, el workflow se
salta por completo los pasos de instalar ffmpeg, instalar PyTorch/transformers
y correr generador.py — que hoy se ejecutaban igual aunque no hubiera nada
que hacer.

Escribe "has_work=true" o "has_work=false" en $GITHUB_OUTPUT.
"""
import hashlib
import json
import os

folder = "./img"
thumbs_folder = "./img/thumbs"
CACHE_FILE = "wallpapers_cache.json"
VALID_EXTENSIONS = (".jpg", ".jpeg", ".png", ".webp", ".mp4", ".webm")

SHARD_INDEX = int(os.environ.get("SHARD_INDEX", "0"))
SHARD_TOTAL = max(1, int(os.environ.get("SHARD_TOTAL", "1")))


def load_cache():
    if os.path.exists(CACHE_FILE):
        try:
            with open(CACHE_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception as e:
            print(f"⚠️ No se pudo leer {CACHE_FILE}, se ignora el cache: {e}")
    return {}


def compute_file_hash(path, chunk_size=1024 * 1024):
    h = hashlib.md5()
    with open(path, "rb") as f:
        while True:
            chunk = f.read(chunk_size)
            if not chunk:
                break
            h.update(chunk)
    return h.hexdigest()


def main():
    cache = load_cache()

    if not os.path.isdir(folder):
        archivos = []
    else:
        archivos = sorted([
            f for f in os.listdir(folder)
            if f.lower().endswith(VALID_EXTENSIONS) and not f.startswith("thumb_")
            and os.path.isfile(os.path.join(folder, f))
        ])

    to_process = []
    for archivo in archivos:
        ruta_completa = os.path.join(folder, archivo)
        try:
            file_hash = compute_file_hash(ruta_completa)
        except Exception:
            file_hash = None

        cached_entry = cache.get(archivo)
        thumb_exists = os.path.exists(os.path.join(thumbs_folder, f"{os.path.splitext(archivo)[0]}.webp"))

        if (cached_entry and file_hash and cached_entry.get("hash") == file_hash
                and cached_entry.get("item") and thumb_exists):
            continue
        to_process.append(archivo)

    my_share = [a for i, a in enumerate(to_process) if i % SHARD_TOTAL == SHARD_INDEX]
    has_work = bool(my_share)

    print(f"Shard {SHARD_INDEX}/{SHARD_TOTAL}: {len(to_process)} archivo(s) pendientes en total, "
          f"{len(my_share)} le tocan a este shard.")

    gh_output = os.environ.get("GITHUB_OUTPUT")
    if gh_output:
        with open(gh_output, "a", encoding="utf-8") as f:
            f.write(f"has_work={'true' if has_work else 'false'}\n")


if __name__ == "__main__":
    main()
